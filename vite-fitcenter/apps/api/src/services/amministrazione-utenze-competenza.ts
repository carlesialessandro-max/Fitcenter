import { fornitoreMatch } from "./amministrazione-fornitori-quote.js"

/** Bollette luce/gas: la fattura del mese N è il consumo del mese N−1. */
const ENERGIA_MENO_UNO = [
  "italpower",
  "tip energia",
  "tip poweregas",
  "tip power e gas",
  "poweregas",
  "tres energia",
  "sima energia",
]

/** Acqua: spesso un periodo di più mesi. */
const PUBBLIACQUA = ["publiacqua", "pubbliacqua"]

/** Energia piscina: competenza dalle date in fattura, altrimenti giugno–luglio. */
const TRASTEEL = ["trasteel energy", "trasteel"]

const MESI_IT: Record<string, string> = {
  GENNAIO: "01",
  GEN: "01",
  FEBBRAIO: "02",
  FEB: "02",
  MARZO: "03",
  APRILE: "04",
  MAGGIO: "05",
  GIUGNO: "06",
  LUGLIO: "07",
  AGOSTO: "08",
  SETTEMBRE: "09",
  SETT: "09",
  OTTOBRE: "10",
  NOVEMBRE: "11",
  DICEMBRE: "12",
  DIC: "12",
}

const MESI_LABEL = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
]

export type CompetenzaQuota = { mese: string; importo: number }

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}

function monthsInclusive(fromYm: string, toYm: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(fromYm) || !/^\d{4}-\d{2}$/.test(toYm)) return []
  const start = fromYm <= toYm ? fromYm : toYm
  const end = fromYm <= toYm ? toYm : fromYm
  const out: string[] = []
  let cur = start
  while (cur <= end && out.length < 24) {
    out.push(cur)
    cur = shiftYm(cur, 1)
  }
  return out
}

function normalized(text: string): string {
  return String(text ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
}

function ymFromDmy(day: string, month: string, year: string): string | null {
  const mm = Number(month)
  const y = Number(year)
  if (!Number.isFinite(mm) || mm < 1 || mm > 12 || !Number.isFinite(y)) return null
  return `${y}-${pad2(mm)}`
}

function collectDateYms(t: string): string[] {
  const dates: string[] = []
  const dateRe = /\b(\d{1,2})\s+(\d{1,2})\s+(20\d{2})\b/g
  let dm: RegExpExecArray | null
  while ((dm = dateRe.exec(t))) {
    const ym = ymFromDmy(dm[1] ?? "", dm[2] ?? "", dm[3] ?? "")
    if (ym) dates.push(ym)
  }
  const isoRe = /\b(20\d{2})\s+(\d{1,2})\s+(\d{1,2})\b/g
  let im: RegExpExecArray | null
  while ((im = isoRe.exec(t))) {
    const ym = ymFromDmy(im[3] ?? "", im[2] ?? "", im[1] ?? "")
    if (ym) dates.push(ym)
  }
  const names = Object.keys(MESI_IT).sort((a, b) => b.length - a.length)
  const nameRe = new RegExp(`\\b(${names.join("|")})\\s+(20\\d{2})\\b`, "g")
  let nm: RegExpExecArray | null
  while ((nm = nameRe.exec(t))) {
    const mm = MESI_IT[nm[1] ?? ""]
    if (mm) dates.push(`${nm[2]}-${mm}`)
  }
  return dates
}

function parsePeriodoMesi(text: string, invoiceYm?: string): string[] | null {
  const t = normalized(text)
  if (!t) return null

  const dalAl = t.match(
    /\bDAL\s+(\d{1,2})\s+(\d{1,2})\s+(20\d{2})\s+(?:AL|A)\s+(\d{1,2})\s+(\d{1,2})\s+(20\d{2})\b/
  )
  if (dalAl) {
    const a = ymFromDmy(dalAl[1] ?? "", dalAl[2] ?? "", dalAl[3] ?? "")
    const b = ymFromDmy(dalAl[4] ?? "", dalAl[5] ?? "", dalAl[6] ?? "")
    if (a && b) return monthsInclusive(a, b)
  }

  const names = Object.keys(MESI_IT).sort((a, b) => b.length - a.length)
  const namedRange = t.match(
    new RegExp(`\\bDAL\\s+(${names.join("|")})(?:\\s+(20\\d{2}))?\\s+(?:AL|A)\\s+(${names.join("|")})\\s+(20\\d{2})\\b`)
  )
  if (namedRange) {
    const y2 = namedRange[4] ?? ""
    const y1 = namedRange[2] || y2
    const a = MESI_IT[namedRange[1] ?? ""]
    const b = MESI_IT[namedRange[3] ?? ""]
    if (a && b && y1 && y2) return monthsInclusive(`${y1}-${a}`, `${y2}-${b}`)
  }

  const dates = collectDateYms(t)
  const unique = [...new Set(dates)]
  const withoutInvoice = invoiceYm ? unique.filter((d) => d !== invoiceYm) : unique
  const use = withoutInvoice.length >= 1 ? withoutInvoice : unique
  if (use.length >= 2) {
    const span = monthsInclusive(use[0]!, use[use.length - 1]!)
    if (span.length <= 6) return span
    return monthsInclusive(use[0]!, use[1]!)
  }
  if (use.length === 1) return [use[0]!]
  return null
}

function fallbackTrasteel(invoiceYm: string): string[] {
  const y = Number(invoiceYm.slice(0, 4))
  const m = Number(invoiceYm.slice(5, 7))
  const year = Number.isFinite(m) && m <= 5 ? y - 1 : y
  return [`${year}-06`, `${year}-07`]
}

function splitImporto(totale: number, mesi: string[]): CompetenzaQuota[] {
  const unique = [...new Set(mesi.filter((m) => /^\d{4}-\d{2}$/.test(m)))]
  if (!unique.length) return []
  const cents = Math.round((Number(totale) || 0) * 100)
  const n = unique.length
  const base = Math.floor(cents / n)
  let rest = cents - base * n
  return unique.map((mese, i) => {
    const extra = i === n - 1 ? rest : 0
    if (i === n - 1) rest = 0
    return { mese, importo: (base + extra) / 100 }
  })
}

export function isUtenzaEnergiaMenoUno(fornitore: string): boolean {
  return fornitoreMatch(fornitore, ENERGIA_MENO_UNO)
}

export function isPubbliacqua(fornitore: string): boolean {
  return fornitoreMatch(fornitore, PUBBLIACQUA)
}

export function isTrasteelEnergy(fornitore: string): boolean {
  return fornitoreMatch(fornitore, TRASTEEL)
}

export function ripartoCompetenza(s: {
  fornitore: string
  dataDocumento: string
  descrizione?: string
  numeroDocumento?: string
  totale: number
}): CompetenzaQuota[] {
  const invoiceYm = String(s.dataDocumento ?? "").slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(invoiceYm)) return [{ mese: invoiceYm || "", importo: s.totale }]

  if (isUtenzaEnergiaMenoUno(s.fornitore)) {
    return [{ mese: shiftYm(invoiceYm, -1), importo: s.totale }]
  }

  const testoPeriodo = `${s.descrizione ?? ""} ${s.numeroDocumento ?? ""}`

  if (isPubbliacqua(s.fornitore)) {
    const parsed = parsePeriodoMesi(testoPeriodo, invoiceYm)
    const mesi = parsed?.length ? parsed : [shiftYm(invoiceYm, -2), shiftYm(invoiceYm, -1)]
    return splitImporto(s.totale, mesi)
  }

  if (isTrasteelEnergy(s.fornitore)) {
    const parsed = parsePeriodoMesi(testoPeriodo, invoiceYm)
    const mesi = parsed?.length ? parsed : fallbackTrasteel(invoiceYm)
    return splitImporto(s.totale, mesi)
  }

  return [{ mese: invoiceYm, importo: s.totale }]
}

export function mesiCompetenza(s: {
  fornitore: string
  dataDocumento: string
  descrizione?: string
  numeroDocumento?: string
  totale: number
}): string[] {
  return ripartoCompetenza(s).map((p) => p.mese)
}

export function spesaNelMese(
  s: {
    fornitore: string
    dataDocumento: string
    descrizione?: string
    numeroDocumento?: string
    totale: number
  },
  mese: string
): boolean {
  return mesiCompetenza(s).includes(mese)
}

export function spesaNellAnno(
  s: {
    fornitore: string
    dataDocumento: string
    descrizione?: string
    numeroDocumento?: string
    totale: number
  },
  anno: string
): boolean {
  return mesiCompetenza(s).some((m) => m.startsWith(anno))
}

export function labelCompetenza(mesi: string[]): string {
  const unique = [...new Set(mesi.filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort()
  if (!unique.length) return ""
  const fmt = (ym: string) => {
    const month = Number(ym.slice(5, 7))
    const name = MESI_LABEL[month - 1] ?? ym.slice(5, 7)
    return `${name} ${ym.slice(0, 4)}`
  }
  if (unique.length === 1) return fmt(unique[0]!)
  return `${fmt(unique[0]!)} – ${fmt(unique[unique.length - 1]!)}`
}
