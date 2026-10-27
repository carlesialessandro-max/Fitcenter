export type MattonaiRiga = {
  nominativo: string
  mese: string
  totale: number
  descrizione: string
  tipo: "sportivo" | "gestionale"
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

function inpsCaricoSocieta(extras: number[]): number {
  const used = new Set<number>()
  let societa = 0
  for (let i = 0; i < extras.length; i++) {
    if (used.has(i)) continue
    for (let j = i + 1; j < extras.length; j++) {
      if (used.has(j)) continue
      const lo = Math.min(extras[i]!, extras[j]!)
      const hi = Math.max(extras[i]!, extras[j]!)
      if (Math.abs(hi - lo * 2) < 0.08) {
        societa += hi
        used.add(i)
        used.add(j)
        break
      }
    }
  }
  if (societa > 0) return Math.round(societa * 100) / 100
  if (extras.length >= 2) return extras[extras.length - 1]!
  return 0
}

/** Lordo + INPS carico società se il lordo c’è, altrimenti solo netto. */
export function totaleMensileMattonai(amts: number[]): number {
  const pos = amts.filter((n) => Number.isFinite(n) && n > 0)
  if (!pos.length) return 0
  const netto = pos[0]!
  if (pos.length === 1) return netto

  let cols = pos.slice()
  if (cols.length >= 3) {
    const last = cols[cols.length - 1]!
    const restSum = Math.round(cols.slice(0, -1).reduce((s, n) => s + n, 0) * 100) / 100
    if (Math.abs(last - restSum) < 0.05) cols = cols.slice(0, -1)
  }

  const maybeLordo = cols[1]
  const hasLordo = maybeLordo != null && maybeLordo >= netto - 0.009
  const base = hasLordo ? maybeLordo! : netto
  const extras = (hasLordo ? cols.slice(2) : cols.slice(1)).filter((n) => n < base)
  if (!extras.length) return base
  return Math.round((base + inpsCaricoSocieta(extras)) * 100) / 100
}

export function parseMattonaiPdf(text: string, mese: string): MattonaiRiga[] {
  const ym = meseFromText(text, mese)
  let sezione: "sportivo" | "gestionale" = "sportivo"
  const rows: MattonaiRiga[] = []
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
    const totale = totaleMensileMattonai(amts)
    if (totale <= 0) continue
    const key = `${sezione}:${nominativo.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      nominativo,
      mese: ym,
      totale,
      descrizione: sezione === "gestionale" ? "Riepilogo amm/gest" : "Riepilogo istruttori",
      tipo: sezione,
    })
  }
  return rows
}

export function defaultRepartoMattonai(row: MattonaiRiga): string {
  return row.tipo === "sportivo" ? "personale-condiviso" : "amministrazione-uffici"
}
