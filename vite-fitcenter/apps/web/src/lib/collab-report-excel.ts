import * as XLSX from "xlsx"

export type CollabReportExcelRiga = {
  nominativo: string
  mese: string
  totale: number
  tipo: "sportivo" | "gestionale"
}

const MESE_NUM: Record<string, number> = {
  gen: 1,
  gennaio: 1,
  feb: 2,
  febbraio: 2,
  mar: 3,
  marzo: 3,
  apr: 4,
  aprile: 4,
  mag: 5,
  maggio: 5,
  giu: 6,
  giugno: 6,
  lug: 7,
  luglio: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  sett: 9,
  settembre: 9,
  ott: 10,
  ottobre: 10,
  nov: 11,
  novembre: 11,
  dic: 12,
  dicembre: 12,
}

function normMese(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "")
}

function parseImporto(raw: unknown): number | null {
  if (raw == null || raw === "") return null
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null
    return Math.round(raw * 100) / 100
  }
  const s = String(raw).replace(/\s/g, "").replace(/[€$]/g, "").replace(/eur/gi, "")
  if (!s || s === "-" || s === "—") return null
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  let n: number
  if (lastComma > lastDot) n = Number(s.replace(/\./g, "").replace(",", "."))
  else if (lastDot > lastComma) n = Number(s.replace(/,/g, ""))
  else n = Number(s.replace(",", "."))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function skipNome(s: string): boolean {
  const t = s.replace(/\s+/g, " ").trim()
  if (!t || t === ".") return true
  if (/^totale/i.test(t)) return true
  if (/partite\s*iva/i.test(t)) return true
  if (/^num\b/i.test(t)) return true
  if (/scadenza/i.test(t)) return true
  const n = normMese(t)
  return n in MESE_NUM
}

function tipoFrom(raw: string): "sportivo" | "gestionale" {
  return /gest\.?\s*amm|gestionale/i.test(raw) ? "gestionale" : "sportivo"
}

function cleanNome(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*(DIP\.?\s*\+?\s*COLL\.?\s*SPORT\.?|GEST\.?\s*AMM\.?.*|\bEX\b.*|\bDP\b)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

function mesiDaRiga(row: unknown[]): { col: number; mm: number }[] {
  const out: { col: number; mm: number }[] = []
  const seen = new Set<number>()
  row.forEach((cell, col) => {
    const mm = MESE_NUM[normMese(String(cell ?? ""))]
    if (!mm || seen.has(mm)) return
    seen.add(mm)
    out.push({ col, mm })
  })
  return out
}

export function parseCollabReportExcel(buf: ArrayBuffer, anno: number): {
  anno: number
  righe: CollabReportExcelRiga[]
  nPersone: number
  tot: number
} {
  if (!Number.isFinite(anno) || anno < 1990 || anno > 2100) throw new Error("Anno non valido")
  const wb = XLSX.read(buf, { type: "array", raw: true })
  const name = wb.SheetNames[0]
  if (!name) throw new Error("Excel vuoto")
  const sheet = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][]
  let mesiCols: { col: number; mm: number }[] = []
  let skipRest = false
  const byKey = new Map<string, CollabReportExcelRiga>()

  for (const row of rows) {
    if (!Array.isArray(row) || !row.length) continue
    const nomeRaw = String(row[0] ?? "").replace(/\s+/g, " ").trim()
    if (/partite\s*iva/i.test(nomeRaw)) {
      skipRest = true
      continue
    }
    if (skipRest) continue
    const found = mesiDaRiga(row)
    if (found.length >= 6) {
      mesiCols = found
      continue
    }
    if (!mesiCols.length) continue
    if (skipNome(nomeRaw)) continue
    const nominativo = cleanNome(nomeRaw)
    if (!nominativo) continue
    const tipo = tipoFrom(nomeRaw)
    for (const m of mesiCols) {
      const tot = parseImporto(row[m.col])
      if (tot == null || tot <= 0) continue
      const mese = `${anno}-${String(m.mm).padStart(2, "0")}`
      const key = `${nominativo.toLowerCase()}|${mese}`
      const prev = byKey.get(key)
      byKey.set(key, {
        nominativo,
        mese,
        totale: Math.round(((prev?.totale ?? 0) + tot) * 100) / 100,
        tipo: tipo === "gestionale" || prev?.tipo === "gestionale" ? "gestionale" : "sportivo",
      })
    }
  }

  const righe = [...byKey.values()]
  if (!righe.length) throw new Error("Nessun importo nel file. Serve il REPORT GENERALE con le colonne Gen–Dic.")
  const tot = Math.round(righe.reduce((s, r) => s + r.totale, 0) * 100) / 100
  const nPersone = new Set(righe.map((r) => r.nominativo.toLowerCase())).size
  return { anno, righe, nPersone, tot }
}
