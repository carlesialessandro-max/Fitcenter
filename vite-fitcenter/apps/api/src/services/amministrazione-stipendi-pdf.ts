export type AmmPdfRiga = {
  nominativo: string
  mese: string
  totale: number
  descrizione: string
  tipo: "sportivo" | "gestionale" | "dipendente"
  qualifica?: string
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
  const re = /(?:€\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}|-)\s*€?/g
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

const MESE_RE =
  /\b(GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)\s+(\d{4})\s+(?:\d+\s+){2,8}([A-ZÀÈÉÌÒÙ'][A-ZÀÈÉÌÒÙ'\s]+?)\s+(\d{2}\/\d{2}\/\d{4})/i

function qualificaRepartoHint(chunk: string): string {
  const s = chunk.toLowerCase()
  if (/puliz/.test(s)) return "pulizie"
  if (/manutenz|operaio|idraulic|elettric/.test(s)) return "manutenzione-impianti"
  if (/bagnin/.test(s)) return "piscina-coperta"
  if (/\bdesk\b|reception|segreter/.test(s)) return "amministrazione-uffici"
  if (/impiegat|amminist|direzion/.test(s)) return "amministrazione-uffici"
  return "amministrazione-uffici"
}

function parseTeamsystem(text: string, mese: string): AmmPdfRiga[] {
  const ym = meseFromText(text, mese)
  const pages = text.split(/\n--- PAGE \d+ ---\n/i)
  const chunks = pages.length > 1 ? pages : text.split(/\n(?=Ditta\b)/)
  const byName = new Map<string, AmmPdfRiga>()
  for (const chunk of chunks) {
    if (/R\s*I\s*E\s*P\s*I\s*L\s*O\s*G\s*O\s*P\s*A\s*G\s*H\s*E/i.test(chunk)) continue
    if (/DISTINTA CONTANTI/i.test(chunk)) continue
    if (/STAMPA VERSAMENTI CONTRIBUTI/i.test(chunk)) continue
    const hm = MESE_RE.exec(chunk)
    if (!hm) continue
    const nominativo = titleName(hm[3] ?? "")
    if (nominativo.split(" ").length < 2) continue
    const iban = /\bIT[A-Z0-9]{15,}\s+((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s+((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})/.exec(chunk)
    const tot = iban ? parseEuro(iban[1] ?? "") : null
    if (tot == null || tot <= 0) continue
    const key = nominativo.toLowerCase()
    if (byName.has(key)) continue
    byName.set(key, {
      nominativo,
      mese: ym,
      totale: tot,
      descrizione: "Busta paga",
      tipo: "dipendente",
      qualifica: qualificaRepartoHint(chunk),
    })
  }
  return [...byName.values()]
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
  const buste = parseTeamsystem(t, mese)
  if (buste.length) return buste
  throw Object.assign(new Error("PDF non riconosciuto: serve il riepilogo istruttori o le buste paga"), { status: 400 })
}

export function defaultRepartoFor(row: AmmPdfRiga): string {
  if (row.tipo === "sportivo") return "personale-condiviso"
  if (row.qualifica) return row.qualifica
  return "amministrazione-uffici"
}
