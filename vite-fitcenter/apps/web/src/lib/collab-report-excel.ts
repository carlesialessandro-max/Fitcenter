import * as XLSX from "xlsx"

export type CollabReportExcelRiga = {
  nominativo: string
  mese: string
  totale: number
  tipo: "sportivo" | "gestionale"
}

export type CollabReportExcelRimanenza = {
  nominativo: string
  importo: number
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
    // 447.519999… da Excel: centesimi. 1.025 come numero inglese è 1.025, non 1.025 € italiani.
    return Math.round(raw * 100) / 100
  }
  const s = String(raw).replace(/\s/g, "").replace(/[€$]/g, "").replace(/eur/gi, "")
  if (!s || s === "-" || s === "—") return null
  // 1.025 / 12.500 → migliaia italiane (non 1,025 dollari)
  if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
    const n = Number(s.replace(/\./g, ""))
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  let n: number
  if (lastComma > lastDot) n = Number(s.replace(/\./g, "").replace(",", "."))
  else if (lastDot > lastComma) {
    const decimals = s.length - lastDot - 1
    n = decimals === 3 ? Number(s.replace(/\./g, "")) : Number(s.replace(/,/g, ""))
  } else n = Number(s.replace(",", "."))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function setRiga(
  byKey: Map<string, CollabReportExcelRiga>,
  nominativo: string,
  mese: string,
  tot: number,
  tipo: "sportivo" | "gestionale"
) {
  const key = `${nominativo.toLowerCase()}|${mese}`
  const prev = byKey.get(key)
  // Una riga per persona/mese: il file non si somma (due blocchi Gen–Dic raddoppiavano importi e centesimi).
  byKey.set(key, {
    nominativo,
    mese,
    totale: tot,
    tipo: tipo === "gestionale" || prev?.tipo === "gestionale" ? "gestionale" : "sportivo",
  })
}

function skipNome(s: string): boolean {
  const t = s.replace(/\s+/g, " ").trim()
  if (!t || t === ".") return true
  if (/^totale/i.test(t)) return true
  if (/partite\s*iva/i.test(t)) return true
  if (/^num\b/i.test(t)) return true
  if (/scadenza/i.test(t)) return true
  if (/^importo\b/i.test(t)) return true
  if (/^oltre\b/i.test(t)) return true
  if (isRigaTitoloMese(t)) return true
  const n = normMese(t)
  return n in MESE_NUM
}

function meseDaTesto(s: string): { mm: number; year?: number } | null {
  const n = String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (!n) return null
  const tokens = n.split(/\s+/).filter(Boolean)
  const yTok = tokens.find((t) => /^20\d{2}$/.test(t))
  const year = yTok ? Number(yTok) : undefined
  let mm: number | undefined
  let best = 0
  for (const [k, v] of Object.entries(MESE_NUM)) {
    if (k.length < 3) continue
    if (tokens.includes(k) && k.length > best) {
      best = k.length
      mm = v
    }
  }
  if (!mm) {
    for (const [k, v] of Object.entries(MESE_NUM)) {
      if (k.length < 3) continue
      const glued = tokens.find((t) => t.startsWith(k) && /^20\d{2}$/.test(t.slice(k.length)))
      if (glued) return { mm: v, year: Number(glued.slice(k.length)) }
    }
  }
  return mm ? { mm, year } : null
}

function isRigaTitoloMese(s: string): boolean {
  const hit = meseDaTesto(s)
  if (!hit) return false
  if (hit.year) return true
  return normMese(s) in MESE_NUM
}

function isImportoHeader(s: string): boolean {
  const t = String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  return t === "importo" || t === "totale" || t === "compenso" || t === "lordo" || t === "netto"
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

function parseRimanenzeCell(raw: unknown): number {
  if (raw instanceof Date) return 0
  if (typeof raw === "string" && /\d{1,2}\s*[\\/\-]\s*\d{1,2}/.test(raw)) return 0
  const n = parseImporto(raw)
  if (n == null || n <= 0) return 0
  if (n >= 20000 && n <= 80000) return 0
  return n
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

function ymValido(s: string | undefined): s is string {
  return Boolean(s && /^\d{4}-\d{2}$/.test(s))
}

function packEsito(
  anno: number,
  formato: "annuo" | "mese",
  byKey: Map<string, CollabReportExcelRiga>,
  rimByNome: Map<string, CollabReportExcelRimanenza>,
  emptyMsg: string
) {
  const righe = [...byKey.values()]
  if (!righe.length) throw new Error(emptyMsg)
  const rimanenze = [...rimByNome.values()]
  const tot = Math.round(righe.reduce((s, r) => s + r.totale, 0) * 100) / 100
  const totRimanenze = Math.round(rimanenze.reduce((s, r) => s + r.importo, 0) * 100) / 100
  const nPersone = new Set([
    ...righe.map((r) => r.nominativo.toLowerCase()),
    ...rimanenze.map((r) => r.nominativo.toLowerCase()),
  ]).size
  const mesi = [...new Set(righe.map((r) => r.mese))].sort()
  return { anno, formato, righe, rimanenze, nPersone, tot, totRimanenze, mesi }
}

function parseAnnuo(rows: unknown[][], anno: number) {
  let mesiCols: { col: number; mm: number }[] = []
  let skipRest = false
  const byKey = new Map<string, CollabReportExcelRiga>()
  const rimByNome = new Map<string, CollabReportExcelRimanenza>()

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
    const firstCol = mesiCols[0]?.col ?? 0
    const rim = firstCol > 0 ? parseRimanenzeCell(row[firstCol - 1]) : 0
    if (rim > 0) rimByNome.set(nominativo.toLowerCase(), { nominativo, importo: rim })
    for (const m of mesiCols) {
      const tot = parseImporto(row[m.col])
      if (tot == null || tot <= 0) continue
      const mese = `${anno}-${String(m.mm).padStart(2, "0")}`
      setRiga(byKey, nominativo, mese, tot, tipo)
    }
  }
  return packEsito(
    anno,
    "annuo",
    byKey,
    rimByNome,
    "Nessun importo nel file. Serve il REPORT GENERALE (colonne Gen–Dic) oppure un Excel di un solo mese con colonna IMPORTO."
  )
}

function parseMensile(rows: unknown[][], anno: number, meseSolo?: string) {
  let mese = ymValido(meseSolo) ? meseSolo : ""
  let importoCol = -1
  const byKey = new Map<string, CollabReportExcelRiga>()
  const rimByNome = new Map<string, CollabReportExcelRimanenza>()

  for (const row of rows.slice(0, 8)) {
    if (!Array.isArray(row)) continue
    for (let col = 0; col < row.length; col++) {
      const cell = String(row[col] ?? "")
      const hit = meseDaTesto(cell)
      if (hit?.mm && (hit.year || !mese)) {
        const y = hit.year ?? anno
        if (!mese || hit.year) mese = `${y}-${String(hit.mm).padStart(2, "0")}`
      }
      if (isImportoHeader(cell) && importoCol < 0) importoCol = col
    }
    const joined = row.map((c) => String(c ?? "")).join(" ")
    const hitJoined = meseDaTesto(joined)
    if (hitJoined?.mm && hitJoined.year) {
      mese = `${hitJoined.year}-${String(hitJoined.mm).padStart(2, "0")}`
    }
  }
  if (importoCol < 0) importoCol = 1
  if (!ymValido(mese)) {
    throw new Error("Excel di un solo mese: scegli il mese in alto (Mese) oppure metti il mese nel titolo del foglio, es. OTTOBRE 2026.")
  }

  for (const row of rows) {
    if (!Array.isArray(row) || !row.length) continue
    const nomeRaw = String(row[0] ?? "").replace(/\s+/g, " ").trim()
    if (/partite\s*iva/i.test(nomeRaw)) break
    if (skipNome(nomeRaw)) continue
    const nominativo = cleanNome(nomeRaw)
    if (!nominativo) continue
    const tot = parseImporto(row[importoCol])
    if (tot == null || tot <= 0) continue
    const tipo = tipoFrom(nomeRaw)
    setRiga(byKey, nominativo, mese, tot, tipo)
  }
  return packEsito(
    Number(mese.slice(0, 4)) || anno,
    "mese",
    byKey,
    rimByNome,
    "Nessun importo nella colonna IMPORTO. Compila gli importi del mese nel file e riprova: ogni riga si abbina al nominativo, non all’ordine della pagina."
  )
}

export function parseCollabReportExcel(
  buf: ArrayBuffer,
  anno: number,
  meseSolo?: string
): {
  anno: number
  formato: "annuo" | "mese"
  righe: CollabReportExcelRiga[]
  rimanenze: CollabReportExcelRimanenza[]
  nPersone: number
  tot: number
  totRimanenze: number
  mesi: string[]
} {
  if (!Number.isFinite(anno) || anno < 1990 || anno > 2100) throw new Error("Anno non valido")
  const wb = XLSX.read(buf, { type: "array", cellDates: true })
  const name = wb.SheetNames[0]
  if (!name) throw new Error("Excel vuoto")
  const sheet = wb.Sheets[name]
  // raw:false = testo come in Excel (1.025 = mille, non 1,025). I numeri restano number.
  const rowsRaw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][]
  const rowsFmt = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][]
  const rows = rowsRaw.map((row, i) => {
    const fmt = rowsFmt[i] ?? []
    return (row ?? []).map((cell, j) => {
      if (typeof cell === "number") {
        const shown = String(fmt[j] ?? "").trim()
        if (shown) {
          const fromShown = parseImporto(shown)
          if (fromShown != null) return fromShown
        }
      }
      return cell
    })
  }) as unknown[][]
  const hasAnnuo = rows.some((row) => Array.isArray(row) && mesiDaRiga(row).length >= 6)
  if (hasAnnuo) return parseAnnuo(rows, anno)
  return parseMensile(rows, anno, meseSolo)
}
