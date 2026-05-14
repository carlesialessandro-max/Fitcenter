/**
 * Importa l'orario reception da OrarioReception.xlsx in `eventsByComparto.reception`.
 * Eseguire dopo build-planning-piscina.mjs e build-planning-bagnini.mjs (catena `pnpm run build:planning`).
 *
 * Formato atteso (come in OrarioReception.xlsx):
 * - Una riga intestazione con nomi giorno (LUNEDI, MARTEDI, …, DOMENICA) e numeri data sotto.
 * - Sotto: per ogni colonna giorno, cella orario (es. "08:00/08:30" o "14:00") e celle successive con nomi staff.
 * - Fogli multipli (es. settimane 11–17, 18–24, 25–31): stesso dow/orario viene sovrascritto dal foglio successivo (ultima settimana vince).
 *
 * File (scegline uno):
 *   - apps/web/data/planning-import/OrarioReception.xlsx
 *   - oppure RECEPTION_XLSX=percorso\assoluto\file.xlsx
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

function normToken(cell) {
  return String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^['"]+|['"]+$/g, "")
}

/** Primo orario HH:mm in una cella (es. "08:00/08:30" → 08:00). */
function cellToStart(text) {
  const s = String(text ?? "").trim()
  if (!s) return null
  const m = s.match(/(\d{1,2})[:.](\d{2})/)
  if (!m) return null
  const hh = Math.min(23, Math.max(0, Number(m[1])))
  const mm = Math.min(59, Math.max(0, Number(m[2])))
  return `${pad2(hh)}:${pad2(mm)}`
}

/** Titolo stabile per stableKey: include fascia oraria originale. */
function titleFromTimeCell(timeCell, startHm) {
  const raw = String(timeCell ?? "").trim().replace(/\s+/g, "")
  if (raw.includes("/")) {
    const parts = raw.split("/").map((p) => cellToStart(p.replace(/-/g, ":")))
    if (parts[0] && parts[1]) return `Reception · ${parts[0]}–${parts[1]}`
  }
  return `Reception · ${startHm}`
}

/** Mappa intestazione giorno → dow (JS: domenica=0). */
function headerCellToDow(cell) {
  const h = normToken(cell)
  if (!h) return null
  /** "PRIMA " troncato da Excel per MERCOLEDI. */
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

/** Colonne inizio blocco giorno (stessa colonna del nome giorno = cella orario nelle righe dati). */
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

  for (let ri = hi + 1; ri < rows.length; ri++) {
    const row = rows[ri] || []
    for (let bi = 0; bi < blocks.length; bi++) {
      const { col, dow } = blocks[bi]
      const nextCol = bi + 1 < blocks.length ? blocks[bi + 1].col : row.length
      const timeCell = String(row[col] ?? "").trim()
      const start = cellToStart(timeCell)
      if (!start) continue

      /** Staff: colonne dopo l'orario fino al prossimo blocco (esclusi valori che sembrano solo orari). */
      const staffParts = []
      for (let c = col + 1; c < nextCol; c++) {
        const raw = String(row[c] ?? "").trim()
        if (!raw || raw.length < 2) continue
        if (cellToStart(raw) === raw) continue
        staffParts.push(raw)
      }
      const staff = staffParts.length ? staffParts.join(" · ") : "—"
      const title = titleFromTimeCell(timeCell, start)

      const id = `reception-${slug(sheetName)}-d${dow}-${start}-${slug(staff)}-${ri}`.replace(/_+/g, "_").slice(0, 180)
      events.push({
        id,
        zona: "reception",
        sheet: String(sheetName).slice(0, 80),
        dow,
        start,
        title,
        staff,
      })
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
  /** Ultimo foglio processato vince su stesso dow+start+titolo (settimane successive nel mese). */
  const byKey = new Map()

  for (const sheetName of wb.SheetNames) {
    const sh = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" })
    const evs = parseReceptionSheet(rows, sheetName)
    console.log("[reception]", sheetName, "→", evs.length, "eventi")
    for (const e of evs) {
      const k = `${e.dow}|${e.start}|${e.title}`
      byKey.set(k, e)
    }
  }

  const merged = [...byKey.values()].sort((a, b) => {
    const order = (d) => (d === 0 ? 7 : d)
    return order(a.dow) - order(b.dow) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
  })

  payload.eventsByComparto.reception = merged
  payload.receptionSources = [path.relative(webRoot, rPath).replace(/\\/g, "/")]
  payload.generatedAtReception = new Date().toISOString()

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
  console.log("[reception] Aggiornato", outFile, "eventi reception:", merged.length)
}

main()
