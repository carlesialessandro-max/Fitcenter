export type AmmPdfRiga = {
  nominativo: string
  mese: string
  totale: number
  descrizione: string
  tipo: "sportivo" | "gestionale" | "dipendente"
  qualifica?: string
  dettaglioDipendenti?: { nominativo: string; totale: number }[]
}

const MESI: Record<string, string> = {
  gennaio: "01",
  febbraio: "02",
  marzo: "03",
  aprile: "04",
  maggio: "05",
  giugno: "06",
  luglio: "07",
  agosto: "08",
  settembre: "09",
  ottobre: "10",
  novembre: "11",
  dicembre: "12",
}

function parseEuro(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/€/g, "").replace(/eur/gi, "")
  if (!s || s === "-") return 0
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  let n: number
  if (lastComma > lastDot) n = Number(s.replace(/\./g, "").replace(",", "."))
  else if (lastDot > lastComma) n = Number(s.replace(/,/g, ""))
  else n = Number(s.replace(",", "."))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

function titleName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|\s)([a-zàèéìòù])/g, (_, a, b) => a + String(b).toUpperCase())
}

function meseFromText(text: string, fallback: string): string {
  if (/^\d{4}-\d{2}$/.test(fallback)) return fallback
  const m = /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/i.exec(
    text
  )
  if (!m) return fallback
  const mm = MESI[m[1]!.toLowerCase()]
  return mm ? `${m[2]}-${mm}` : fallback
}

const SKIP_MATTONAI =
  /studio mattonai|compensi mensili|cognome e nome|compenso netto|compenso lordo|compenso per|debiti verso|dettaglio|scadenza|inps carico|inail carico|inail collaboratore|note |largo roma|tel\.|www\.|e-mail|cod fisc|aqua sport ssd|centro elaborazione|consulenza aziendale|prestazioni|attività|sportiv|amm\/gest|addizionale|ritenuta|collaboratore società|carico società/i

function amountsOn(line: string): number[] {
  const out: number[] = []
  const re = /(?:€\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}|-)\s*€?(?![\d.,])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const n = parseEuro(m[1] ?? "")
    if (n != null) out.push(n)
  }
  return out
}

function parseMattonai(text: string, mese: string): AmmPdfRiga[] {
  const ym = meseFromText(text, mese)
  let sezione: "sportivo" | "gestionale" = "sportivo"
  const rows: AmmPdfRiga[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, " ").replace(/[ \t]+/g, " ").trim()
    if (!line) continue
    if (/compensi mensili totali amministrativi/i.test(line)) {
      sezione = "gestionale"
      continue
    }
    if (/compensi mensili totali istruttori/i.test(line)) {
      sezione = "sportivo"
      continue
    }
    if (SKIP_MATTONAI.test(line)) continue
    if (/^settembre\b/i.test(line) && /€/.test(line)) continue
    const nameM = /^([A-ZÀÈÉÌÒÙ'][A-ZÀÈÉÌÒÙ'\s]{2,50}?)(?:\s+€|\s+(?:\d{1,3}(?:\.\d{3})*,\d{2})|\s+-)/.exec(line)
    if (!nameM) continue
    const nominativo = titleName(nameM[1] ?? "")
    if (nominativo.split(" ").length < 2) continue
    const amts = amountsOn(line)
    if (!amts.length) continue
    const lordo = amts.length >= 2 ? amts[1]! : amts[0]!
    if (lordo <= 0) continue
    const key = `${sezione}:${nominativo.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      nominativo,
      mese: ym,
      totale: lordo,
      descrizione: sezione === "gestionale" ? "Riepilogo amm/gest" : "Riepilogo istruttori",
      tipo: sezione,
    })
  }
  return rows
}

/** Nel riepilogo paghe il costo per l’azienda è di solito la colonna più alta (lordo + INPS/Inail ditta), non il netto. */
function costoAziendaFromLine(line: string): number | null {
  const amts = amountsOn(line).filter((n) => n > 0)
  if (!amts.length) return null
  if (amts.length === 1) return amts[0]!
  return Math.max(...amts)
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

function aggregateDipendenti(mese: string, totale: number, descrizione: string): AmmPdfRiga[] {
  return [
    {
      nominativo: "Dipendenti fissi (costo azienda)",
      mese,
      totale,
      descrizione,
      tipo: "dipendente",
      qualifica: "amministrazione-uffici",
    },
  ]
}

export function parseDettaglioCostiDipendenti(text: string): {
  righe: { nominativo: string; totale: number }[]
  totale: number | null
} {
  const pages = text.split(/(?=---\s*PAGE\s+\d+\s*---)/i)
  for (const page of pages) {
    const lines = page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const headerAt = lines.findIndex((line) => {
      const label = normalizeLabel(line)
      return label.includes("cognomeenome") && label.includes("lorda") && (label.includes("costo") || label.includes("tfr"))
    })
    if (headerAt < 0) continue

    const righe: { nominativo: string; totale: number }[] = []
    let totale: number | null = null
    for (const line of lines.slice(headerAt + 1)) {
      const importi = amountsOn(line)
      const firstAmount = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?![\d.,])/.exec(line)
      if (!firstAmount) continue
      const name = titleName(line.slice(0, firstAmount.index).replace(/^\s*\d+\s+/, ""))
      if (name.split(" ").some((word) => normalizeLabel(word).startsWith("total"))) {
        if (importi.length) totale = importi[importi.length - 1]!
        break
      }
      if (importi.length < 3) continue
      const lastAmount = importi[importi.length - 1]!
      const precedingAmount = importi[importi.length - 2]!
      if (lastAmount >= 1000 && lastAmount > precedingAmount * 2) {
        totale = lastAmount
        break
      }
      if (name.split(" ").length < 2 || !/[a-zàèéìòù]/i.test(name)) continue
      const costo = importi[importi.length - 2]
      if (costo == null || costo <= 0) continue
      righe.push({ nominativo: name, totale: costo })
    }
    if (righe.length) return { righe, totale }
  }
  return { righe: [], totale: null }
}

function isCostoConsuntivoPage(text: string): boolean {
  const label = normalizeLabel(text)
  return label.includes("costoconsuntivo") && label.includes("periodo")
}

function totaleDaRigaConsuntivo(line: string): number | null {
  const amounts = amountsOn(line).filter((value) => value > 0)
  if (amounts.length >= 2) {
    const values = amounts.slice()
    if (values[0]! <= 5000 && Math.abs(values[0]! - Math.round(values[0]!)) < 0.01) values.shift()
    if (values.length > 1 && values[values.length - 1]! < 100) values.pop()
    if (values.length >= 2) {
      const largest = Math.max(...values)
      const components = values.reduce((sum, value) => sum + value, 0) - largest
      if (Math.abs(largest - components) < 0.03) return largest
    }
    if (values.length >= 4) return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100
  }
  return null
}

function parseCostoConsuntivo(text: string, mese: string): AmmPdfRiga[] {
  const pages = text.split(/(?=---\s*PAGE\s+\d+\s*---)/i)
  const dettaglio = parseDettaglioCostiDipendenti(text)
  const totals = pages.flatMap((page) => {
    if (!isCostoConsuntivoPage(page)) return []
    const lines = page.split(/\r?\n/)
    const values: number[] = []
    for (let i = 0; i < lines.length; i++) {
      const label = normalizeLabel(lines[i] ?? "")
      if (/^(?:totale|totali)azienda/.test(label)) {
        const value = totaleDaRigaConsuntivo(lines.slice(i, i + 5).join(" "))
        if (value != null) values.push(value)
      } else if (/^(?:totale|totali)$/.test(label)) {
        const nearby = lines.slice(i, i + 6)
        if (!nearby.some((line) => /^azienda/.test(normalizeLabel(line)))) continue
        const value = totaleDaRigaConsuntivo(nearby.join(" "))
        if (value != null) values.push(value)
      }
    }
    return values
  })
  if (!totals.length && dettaglio.totale == null && !dettaglio.righe.length) return []
  const dettaglioTotal = Math.round(dettaglio.righe.reduce((sum, row) => sum + row.totale, 0) * 100) / 100
  const totaleUfficiale = dettaglio.totale ?? (totals.length ? Math.max(...totals) : dettaglioTotal)
  if (dettaglio.righe.length && Math.abs(dettaglioTotal - totaleUfficiale) > 0.03) {
    throw Object.assign(
      new Error("Il dettaglio dei dipendenti non coincide con il totale del consuntivo. Verifica il PDF prima di importarlo."),
      { status: 400 },
    )
  }
  const [riga] = aggregateDipendenti(
    meseFromText(text, mese),
    totaleUfficiale,
    "Costo azienda mese — totale consuntivo del periodo",
  )
  if (riga && dettaglio.righe.length) riga.dettaglioDipendenti = dettaglio.righe
  return riga ? [riga] : []
}

function parseTeamsystem(text: string, mese: string): AmmPdfRiga[] {
  return parseCostoConsuntivo(text, mese)
}

export function parseStipendiPdf(text: string, filename: string, mese: string): AmmPdfRiga[] {
  const fn = filename.toLowerCase()
  const t = text
  if (/studio mattonai|compensi mensili totali istruttori|riepilogo contabile/i.test(t + " " + fn)) {
    return parseMattonai(t, mese)
  }
  if (/teamsystem|netto busta|totale retribuzione|pg00/i.test(t + " " + fn)) {
    return parseTeamsystem(t, mese)
  }
  const sport = parseMattonai(t, mese)
  if (sport.length >= 5) return sport
  const riepilogoDipendenti = parseTeamsystem(t, mese)
  if (riepilogoDipendenti.length) return riepilogoDipendenti
  throw Object.assign(
    new Error("Riepilogo costi dipendenti non trovato. Importa il PDF “Costo consuntivo del periodo”, non i cedolini individuali."),
    { status: 400 },
  )
}

export function defaultRepartoFor(row: AmmPdfRiga): string {
  if (row.tipo === "sportivo") return "personale-condiviso"
  if (row.qualifica) return row.qualifica
  return "amministrazione-uffici"
}
