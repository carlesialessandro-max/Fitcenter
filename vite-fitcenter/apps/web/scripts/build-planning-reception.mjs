/**
 * Importa l'orario reception da OrarioReception.xlsx in `eventsByComparto.reception`.
 * Eseguire dopo build-planning-piscina.mjs e build-planning-bagnini.mjs (catena `pnpm run build:planning`).
 *
 * Formato foglio (OrarioReception.xlsx):
 * - Riga intestazione: LUNEDI, MARTEDI, … (colonna orario + 2–3 colonne staff per giorno).
 * - Righe dati: in ogni blocco giorno la prima colonna ha l'orario (08:00/08:30 o 14:00), le successive i nomi.
 * - Un evento JSON per ogni nome (stesso orario = più persone in parallelo, come in Excel).
 *
 * File: apps/web/data/planning-import/OrarioReception.xlsx oppure RECEPTION_XLSX=…
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
  console.error("[xlsx] Pacchetto non trovato. pnpm install dalla root monorepo.")
  process.exit(1)
}

const XLSX = loadXlsx()
const importDir = path.join(webRoot, "data", "planning-import")
const outFile = path.join(webRoot, "src", "data", "planning-weekly.json")

const DEFAULT_RECEPTION_FILES = [path.join(importDir, "OrarioReception.xlsx")]

function pad2(n) {
  return String(n).padStart(2, "0")
}

function hmToMinutes(hm) {
  const [h, m] = hm.split(":").map((x) => Number(x))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

function minutesToHm(total) {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`
}

function normToken(cell) {
  return String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^['"]+|['"]+$/g, "")
}

/** Primo orario HH:mm in una cella. */
function cellToStart(text) {
  const s = String(text ?? "").trim()
  if (!s) return null
  const m = s.match(/(\d{1,2})[:.](\d{2})/)
  if (!m) return null
  const hh = Math.min(23, Math.max(0, Number(m[1])))
  const mm = Math.min(59, Math.max(0, Number(m[2])))
  return `${pad2(hh)}:${pad2(mm)}`
}

/** Nome operatore plausibile (esclude note di fondo foglio). */
function isStaffName(raw) {
  const t = String(raw ?? "").trim()
  if (!t || t.length < 2 || t.length > 32) return false
  if (cellToStart(t) === t) return false
  const u = t.toUpperCase()
  if (u.startsWith("NO ") || u.includes("NON VIENE") || u.includes("STA CON") || u.includes("MALATA")) return false
  if (/^\d+$/.test(t)) return false
  return /^[A-Za-z][A-Za-z0-9.\s'-]{0,30}$/.test(t)
}

/** Fascia oraria da cella orario; se solo "14:00" usa fine = inizio slot successivo nella stessa colonna o +30 min. */
function parseCellTimeRange(timeCell, nextTimeInColumn) {
  const raw = String(timeCell ?? "").trim()
  if (!raw) return null

  if (raw.includes("/")) {
    const parts = raw.split("/")
    const start = cellToStart(parts[0])
    const end = cellToStart(parts[1])
    if (start && end) {
      let endMin = hmToMinutes(end)
      const startMin = hmToMinutes(start)
      if (endMin <= startMin) endMin = startMin + 30
      const endHm = minutesToHm(endMin)
      return { start, end: endHm, title: `Reception · ${start}–${endHm}` }
    }
  }

  const start = cellToStart(raw)
  if (!start) return null
  const startMin = hmToMinutes(start)
  let endHm = nextTimeInColumn
  if (endHm) {
    let endMin = hmToMinutes(endHm)
    if (endMin <= startMin) endHm = null
  }
  if (!endHm) endHm = minutesToHm(startMin + 30)
  return { start, end: endHm, title: `Reception · ${start}–${endHm}` }
}

function headerCellToDow(cell) {
  const h = normToken(cell)
  if (!h) return null
  if (h.startsWith("PRIMA")) return 3
  const map = {
    LUNEDI: 1,
    MARTEDI: 2,
    MERCOLEDI: 3,
    GIOVEDI: 4,
    VENERDI: 5,
    SABATO: 6,
    DOMENICA: 0,
  }
  for (const [k, dow] of Object.entries(map)) {
    if (h === k || h.startsWith(k + " ") || h.startsWith(k + "'")) return dow
  }
  return null
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const row = rows[i] || []
    let n = 0
    for (const cell of row) {
      if (headerCellToDow(cell) != null) n++
    }
    if (n >= 4) return i
  }
  return -1
}

function findDayBlocks(headerRow) {
  /** @type {{ col: number; dow: number }[]} */
  const blocks = []
  for (let c = 0; c < headerRow.length; c++) {
    const dow = headerCellToDow(headerRow[c])
    if (dow == null) continue
    blocks.push({ col: c, dow })
  }
  blocks.sort((a, b) => a.col - b.col)
  return blocks
}

function findNextTimeInColumn(rows, fromRow, col) {
  for (let i = fromRow + 1; i < rows.length; i++) {
    const t = cellToStart(String(rows[i]?.[col] ?? ""))
    if (t) return t
  }
  return null
}

function slug(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "")
    .slice(0, 40)
}

/**
 * @param {unknown[][]} rows
 * @param {string} sheetName
 */
function parseReceptionSheet(rows, sheetName) {
  const hi = findHeaderRow(rows)
  if (hi < 0) return []

  const header = rows[hi] || []
  const blocks = findDayBlocks(header)
  if (!blocks.length) return []

  /** @type {object[]} */
  const events = []
  let emptyRun = 0

  for (let ri = hi + 1; ri < rows.length; ri++) {
    const row = rows[ri] || []
    let rowHasSlot = false

    for (let bi = 0; bi < blocks.length; bi++) {
      const { col, dow } = blocks[bi]
      const nextCol = bi + 1 < blocks.length ? blocks[bi + 1].col : row.length
      const timeCell = String(row[col] ?? "").trim()
      if (!timeCell) continue

      const tr = parseCellTimeRange(timeCell, findNextTimeInColumn(rows, ri, col))
      if (!tr) continue

      rowHasSlot = true
      for (let c = col + 1; c < nextCol; c++) {
        const staffRaw = String(row[c] ?? "").trim()
        if (!isStaffName(staffRaw)) continue

        const staff = staffRaw.toUpperCase()
        const id = `reception-${slug(sheetName)}-d${dow}-${tr.start}-${slug(staff)}-${ri}-c${c}`
          .replace(/_+/g, "_")
          .slice(0, 180)

        events.push({
          id,
          zona: "reception",
          sheet: String(sheetName).slice(0, 80),
          dow,
          start: tr.start,
          title: tr.title,
          staff,
        })
      }
    }

    if (rowHasSlot) emptyRun = 0
    else {
      emptyRun++
      if (emptyRun >= 4) break
    }
  }
  return events
}

function resolveReceptionPath() {
  if (process.env.RECEPTION_XLSX && fs.existsSync(process.env.RECEPTION_XLSX)) return process.env.RECEPTION_XLSX
  for (const p of DEFAULT_RECEPTION_FILES) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function main() {
  if (!fs.existsSync(outFile)) {
    console.error("Manca", outFile, "— eseguire prima build-planning-data.mjs")
    process.exit(1)
  }

  const raw = fs.readFileSync(outFile, "utf8")
  const payload = JSON.parse(raw)

  const rPath = resolveReceptionPath()
  payload.eventsByComparto = payload.eventsByComparto && typeof payload.eventsByComparto === "object" ? payload.eventsByComparto : {}

  if (!rPath) {
    console.warn(
      "[reception] Nessun OrarioReception.xlsx trovato. Copia il file in data/planning-import/OrarioReception.xlsx oppure imposta RECEPTION_XLSX."
    )
    if (!Array.isArray(payload.eventsByComparto.reception)) payload.eventsByComparto.reception = []
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
    return
  }

  const wb = XLSX.readFile(rPath, { cellDates: false, raw: false })
  /** Ogni foglio = una settimana del mese: non unire i lunedì di fogli diversi in un’unica colonna. */
  const all = []

  for (const sheetName of wb.SheetNames) {
    const sh = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" })
    const evs = parseReceptionSheet(rows, sheetName)
    console.log("[reception]", sheetName, "→", evs.length, "eventi")
    all.push(...evs)
  }

  const merged = all.sort((a, b) => {
    const order = (d) => (d === 0 ? 7 : d)
    return (
      String(a.sheet).localeCompare(String(b.sheet)) ||
      order(a.dow) - order(b.dow) ||
      a.start.localeCompare(b.start) ||
      a.staff.localeCompare(b.staff)
    )
  })

  payload.eventsByComparto.reception = merged
  payload.receptionSources = [path.relative(webRoot, rPath).replace(/\\/g, "/")]
  payload.generatedAtReception = new Date().toISOString()

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
  console.log("[reception] Aggiornato", outFile, "eventi reception:", merged.length)
}

main()
