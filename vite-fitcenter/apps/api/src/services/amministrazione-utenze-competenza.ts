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

function parsePeriodoMesi(text: string): string[] | null {
  const t = normalized(text)
  if (!t) return null

  const dates: string[] = []
  const dateRe = /\b(\d{1,2})\s+(\d{1,2})\s+(20\d{2})\b/g
  let dm: RegExpExecArray | null
  while ((dm = dateRe.exec(t))) {
    const month = Number(dm[2])
    if (month >= 1 && month <= 12) dates.push(`${dm[3]}-${pad2(month)}`)
  }
  if (dates.length >= 2) return monthsInclusive(dates[0]!, dates[dates.length - 1]!)

  const named: string[] = []
  const names = Object.keys(MESI_IT).sort((a, b) => b.length - a.length)
  const nameRe = new RegExp(`\\b(${names.join("|")})\\s+(20\\d{2})\\b`, "g")
  let nm: RegExpExecArray | null
  while ((nm = nameRe.exec(t))) {
    const mm = MESI_IT[nm[1] ?? ""]
    if (mm) named.push(`${nm[2]}-${mm}`)
  }
  if (named.length >= 2) return monthsInclusive(named[0]!, named[named.length - 1]!)
  if (named.length === 1) return [named[0]!]
  if (dates.length === 1) return [dates[0]!]
  return null
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

  if (isPubbliacqua(s.fornitore)) {
    const parsed = parsePeriodoMesi(`${s.descrizione ?? ""} ${s.numeroDocumento ?? ""}`)
    const mesi = parsed?.length ? parsed : [shiftYm(invoiceYm, -2), shiftYm(invoiceYm, -1)]
    return splitImporto(s.totale, mesi)
  }

  return [{ mese: invoiceYm, importo: s.totale }]
}

export function mesiCompetenza(s: {
  fornitore: string
  dataDocumento: string
  descrizione?: string
  totale: number
}): string[] {
  return ripartoCompetenza(s).map((p) => p.mese)
}

export function spesaNelMese(
  s: { fornitore: string; dataDocumento: string; descrizione?: string; totale: number },
  mese: string
): boolean {
  return mesiCompetenza(s).includes(mese)
}

export function spesaNellAnno(
  s: { fornitore: string; dataDocumento: string; descrizione?: string; totale: number },
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
