/**
 * Importa il planning INVERNALE bagnini (settimana tipo) in `eventsByComparto.piscina`.
 * Eseguire dopo build-planning-piscina.mjs.
 *
 * Estate (due vasche): nel JSON / revisioni usa le zone `interna` ed `esterna` per distinguere
 * piscina interna ed esterna; l’import invernale qui sotto imposta di solito `invernale`.
 *
 * Formato foglio (per ogni giorno, 3 colonne affiancate):
 * - Colonna sinistra: ore “piene” (07:00, 08:00, …) solo su alcune righe
 * - Colonna centrale: nomi bagnini (celle unite su più righe da 30 min)
 * - Colonna destra: mezze ore (06:30, 07:30, …) sulle altre righe
 * Le righe sono slot da 30 minuti: su ogni riga compare **un solo** orario (sinistra **oppure** destra), a zig-zag.
 *
 * File (scegline uno):
 *   - apps/web/data/planning-import/INVERNALE 2025-2026.xlsx
 *   - oppure BAGNINI_XLSX=percorso\assoluto\file.xlsx
 *
 * Foglio: il primo il cui nome contiene "INVERNALE" (case-insensitive), altrimenti il primo foglio.
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")

function loadXlsx() {
  const req = createRequire(import.meta.url)
  const tryPaths = [
    () => req("xlsx"),
    () => req(path.join(webRoot, "node_modules", "xlsx")),
    () => req(path.join(webRoot, "..", "node_modules", "xlsx")),
  ]
  for (const fn of tryPaths) {
    try {
      const m = fn()
      if (m) return m
    } catch {
      /* next */
    }
  }
  console.error("[xlsx] Pacchetto non trovato.")
  process.exit(1)
}

const XLSX = loadXlsx()
const importDir = path.join(webRoot, "data", "planning-import")
const outFile = path.join(webRoot, "src", "data", "planning-weekly.json")

const DEFAULT_FILES = [
  path.join(importDir, "INVERNALE 2025-2026.xlsx"),
  path.join(importDir, "invernale-2025-2026.xlsx"),
]

function pad2(n) {
  return String(n).padStart(2, "0")
}

function normDayHeader(cell) {
  return String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
}

const HEADER_TO_DOW = {
  LUNEDI: 1,
  MARTEDI: 2,
  MERCOLEDI: 3,
  GIOVEDI: 4,
  VENERDI: 5,
  SABATO: 6,
  DOMENICA: 0,
}

function dayHeaderToDow(cell) {
  const h = normDayHeader(cell)
  for (const [key, dow] of Object.entries(HEADER_TO_DOW)) {
    if (h === key || h.startsWith(key + " ") || h.startsWith(key + "'")) return dow
  }
  return null
}

function cellToStart(v) {
  if (v === "" || v == null) return null
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null
    if (v > 2000) return null
    if (v > 0 && v < 1) {
      const totalMin = Math.round(v * 24 * 60)
      const h = Math.floor(totalMin / 60)
      const m = totalMin % 60
      if (h >= 5 && h <= 23) return `${pad2(h)}:${pad2(m)}`
      return null
    }
    if (Number.isInteger(v) && v >= 6 && v <= 23) return `${pad2(v)}:00`
    const str = String(v).replace(",", ".")
    const dm = /^(\d{1,2})\.(\d{1,2})$/.exec(str)
    if (dm) {
      const h = Number(dm[1])
      let m = Number(dm[2])
      if (dm[2].length === 1) m = Number(dm[2]) * 6
      if (h >= 5 && h <= 23 && m >= 0 && m <= 59) return `${pad2(h)}:${pad2(m)}`
    }
  }
  const t = String(v).trim().replace(",", ".")
  const m = t.match(/^(\d{1,2})[.:](\d{2})\s*$/)
  if (m) return `${pad2(Math.min(23, Number(m[1])))}:${m[2]}`
  return null
}

function looksLikeStaffAbbrev(s) {
  const t = String(s ?? "").trim()
  if (t.length < 2 || t.length > 24) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return false
  if (dayHeaderToDow(t) != null) return false
  return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'\s-]*$/u.test(t)
}

function hmToMinutes(hm) {
  const parts = String(hm).trim().split(":")
  const h = Number(parts[0])
  const m = Number(parts[1] ?? 0)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1
  return h * 60 + m
}

/** Inizio dello slot 30 min sulla riga (orario a zig-zag sinistra/destra). */
function rowSlotStart(row, timeCol, timeRightCol) {
  const tL = cellToStart(row[timeCol])
  const tR = cellToStart(row[timeRightCol])
  if (tL != null && tR != null) {
    const a = hmToMinutes(tL)
    const b = hmToMinutes(tR)
    if (a >= 0 && b >= 0) return a <= b ? tL : tR
  }
  return tL ?? tR
}

function scoreTripleBase(rows, headerRow, base) {
  if (base < 0) return -1
  let score = 0
  const last = Math.min(headerRow + 50, rows.length - 1)
  for (let ri = headerRow + 1; ri <= last; ri++) {
    const row = rows[ri] || []
    if (base + 2 >= row.length) return -1
    const tL = cellToStart(row[base])
    const tR = cellToStart(row[base + 2])
    const staffCell = String(row[base + 1] ?? "").trim()
    if (tL || tR) score += 1
    if (staffCell && looksLikeStaffAbbrev(staffCell)) score += 4
    if (dayHeaderToDow(staffCell) != null) score -= 10
  }
  return score
}

/**
 * La cella col nome del giorno può essere sulla 1ª o 2ª colonna del blocco da 3:
 * scegliamo la base `timeCol` che massimizza orari + nomi nelle righe sotto l’intestazione.
 * @param {unknown[][]} rows
 * @param {number} headerRow
 * @param {number} dayCol colonna in cui compare "Lunedì" / …
 */
function inferTripleBase(rows, headerRow, dayCol) {
  const candidates = [dayCol - 2, dayCol - 1, dayCol].filter((b) => b >= 0)
  let best = dayCol
  let bestScore = -1
  for (const b of candidates) {
    const s = scoreTripleBase(rows, headerRow, b)
    if (s > bestScore) {
      bestScore = s
      best = b
    }
  }
  return best
}

/**
 * @param {unknown[][]} rows
 * @param {number} timeCol
 * @param {number} staffCol
 * @param {number} timeRightCol
 * @param {number} startRow
 * @param {number} dow
 */
function parseInvernaleDayBlock(rows, timeCol, staffCol, timeRightCol, startRow, dow) {
  /** @type {{ dow: number; start: string; staff: string }[]} */
  const out = []
  let curStaff = null
  let curStart = null
  let emptyRun = 0

  for (let ri = startRow; ri < rows.length; ri++) {
    const row = rows[ri] || []
    const t = rowSlotStart(row, timeCol, timeRightCol)
    const staffRaw = String(row[staffCol] ?? "").trim()
    const staff = looksLikeStaffAbbrev(staffRaw) ? staffRaw : ""

    const intruder =
      dayHeaderToDow(row[timeCol]) ?? dayHeaderToDow(row[staffCol]) ?? dayHeaderToDow(row[timeRightCol])
    if (intruder != null && intruder !== dow && ri > startRow + 5) break

    if (staff) {
      if (curStaff != null && curStaff !== staff && curStart) {
        out.push({ dow, start: curStart, staff: curStaff })
      }
      if (curStaff !== staff) {
        curStaff = staff
        curStart = t ?? "07:00"
      }
      emptyRun = 0
    } else if (t && curStaff) {
      emptyRun = 0
    } else {
      emptyRun++
      if (emptyRun > 45) break
    }
  }
  if (curStaff && curStart) out.push({ dow, start: curStart, staff: curStaff })

  const seen = new Set()
  const dedup = []
  for (const e of out) {
    const k = `${e.dow}|${e.start}|${e.staff}`
    if (seen.has(k)) continue
    seen.add(k)
    dedup.push(e)
  }
  return dedup
}

/**
 * Trova la riga con più intestazioni giorno; per ogni hit inferisce il blocco (time | staff | time) a 3 colonne.
 */
function findDayBlocks(rows) {
  let bestHits = /** @type {{ r: number; c: number; dow: number }[]} */ ([])
  for (let r = 0; r < Math.min(40, rows.length); r++) {
    const row = rows[r] || []
    /** @type {{ r: number; c: number; dow: number }[]} */
    const hits = []
    for (let c = 0; c < row.length; c++) {
      const dow = dayHeaderToDow(row[c])
      if (dow != null) hits.push({ r, c, dow })
    }
    if (hits.length > bestHits.length) bestHits = hits
  }
  if (bestHits.length < 3) return null
  bestHits.sort((a, b) => a.c - b.c)
  /** @type {{ dow: number; timeCol: number; staffCol: number; timeRightCol: number; headerRow: number }[]} */
  const blocks = []
  for (const h of bestHits) {
    const base = inferTripleBase(rows, h.r, h.c)
    const timeCol = base
    const staffCol = base + 1
    const timeRightCol = base + 2
    blocks.push({
      dow: h.dow,
      timeCol,
      staffCol,
      timeRightCol,
      headerRow: h.r,
    })
  }
  return blocks
}

function pickSheetName(wb) {
  const env = process.env.BAGNINI_SHEET?.trim()
  if (env && wb.SheetNames.includes(env)) return env
  const hit = wb.SheetNames.find((n) => /invernale/i.test(String(n)))
  return hit ?? wb.SheetNames[0]
}

function resolveBagniniPath() {
  if (process.env.BAGNINI_XLSX && fs.existsSync(process.env.BAGNINI_XLSX)) return process.env.BAGNINI_XLSX
  for (const p of DEFAULT_FILES) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function main() {
  if (!fs.existsSync(outFile)) {
    console.error("Manca", outFile, "— eseguire prima build-planning-data.mjs")
    process.exit(1)
  }

  const bPath = resolveBagniniPath()
  const raw = fs.readFileSync(outFile, "utf8")
  const payload = JSON.parse(raw)

  if (!bPath) {
    console.warn("[bagnini] Nessun file INVERNALE trovato. Opzionale: copia INVERNALE…xlsx in data/planning-import/ o imposta BAGNINI_XLSX.")
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
    return
  }

  const wb = XLSX.readFile(bPath)
  const sheetName = pickSheetName(wb)
  const sh = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" })
  const blocks = findDayBlocks(rows)
  if (!blocks?.length) {
    console.warn("[bagnini] Struttura non riconosciuta (intestazioni giorno). Skip import.")
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
    return
  }

  /** @type {object[]} */
  const events = []
  for (const b of blocks) {
    const startRow = b.headerRow + 1
    const evs = parseInvernaleDayBlock(rows, b.timeCol, b.staffCol, b.timeRightCol, startRow, b.dow)
    for (const e of evs) {
      events.push({
        id: `invernale-${e.dow}-${e.start}-${e.staff}`.replace(/\s+/g, "_"),
        zona: "invernale",
        sheet: String(sheetName).slice(0, 80),
        dow: e.dow,
        start: e.start,
        title: "Copertura",
        staff: e.staff,
      })
    }
  }

  payload.eventsByComparto = payload.eventsByComparto ?? {}
  const prevPiscina = Array.isArray(payload.eventsByComparto.piscina) ? payload.eventsByComparto.piscina : []
  const rest = prevPiscina.filter((e) => String(e?.zona ?? "") !== "invernale")
  payload.eventsByComparto.piscina = rest.concat(events)
  payload.bagniniSources = [path.relative(webRoot, bPath).replace(/\\/g, "/")]
  payload.generatedAtBagnini = new Date().toISOString()

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
  console.log("[bagnini] Foglio:", sheetName, "→ eventi invernali:", events.length, "| totale piscina:", payload.eventsByComparto.piscina.length)
}

main()
