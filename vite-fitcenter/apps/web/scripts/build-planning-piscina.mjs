/**
 * Legge PISCINAORARIO *.xlsx (scuola nuoto, acquaticità, spogliatoi, bambini estate)
 * e aggiorna planning-weekly.json con `eventsByComparto`.
 *
 * File atteso (scegline uno):
 *   - apps/web/data/planning-import/piscina-orario-2025-2026.xlsx
 *   - oppure imposta PISCINA_XLSX=percorso\assoluto\file.xlsx
 *
 * Esegui dopo build-planning-data.mjs:  pnpm run build:planning
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

const DEFAULT_PISCINA_FILES = [
  path.join(importDir, "piscina-orario-2025-2026.xlsx"),
  path.join(importDir, "PISCINAORARIO 2025-2026.xlsx"),
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

/** Foglio Excel → comparto API. */
function sheetToComparto(sheetName) {
  const n = String(sheetName)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
  if (n.includes("BAMBINI") && n.includes("ESTATE")) return "piscina"
  if ((/S\.?\s*N/.test(sheetName) || n.includes("SCUOLA")) && n.includes("BAMBINI")) return "scuola_nuoto"
  if (n.includes("ACQUAT")) return "acquaticita"
  if (n.includes("SPOGLIAT")) return "spogliatoi"
  return null
}

function findDowInRow(row) {
  for (const cell of row) {
    const h = normDayHeader(cell)
    for (const [key, dow] of Object.entries(HEADER_TO_DOW)) {
      if (h === key || h.startsWith(key + " ") || h.startsWith(key + "'")) return dow
    }
  }
  return null
}

/** Estrae orario da cella (16.15, 17, "16.00", numero Excel frazione giorno). */
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

const SKIP_STAFF_UPPER = new Set([
  "PROVE",
  "RESP",
  "SOSTITUZIONI",
  "DISPONIBILITA",
  "CORSI BAMBINI",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "AQ",
  "AQ1",
  "AQ2",
  "AQ3",
  "A++",
  "B++",
])

function isStaffName(s) {
  const t = String(s ?? "").trim()
  if (t.length < 3) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return false
  if (t.length > 42) return false
  const up = t.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "")
  if (SKIP_STAFF_UPPER.has(up)) return false
  if (/^SPOGLIATOIO/i.test(t)) return false
  if (/^TURNI\s+DAL/i.test(t)) return false
  return true
}

function labelRowScore(row) {
  let n = 0
  for (let c = 1; c < Math.min(row.length, 24); c++) {
    const t = String(row[c] ?? "").trim()
    if (t.length >= 2 && !cellToStart(t)) n++
  }
  return n
}

/**
 * @param {unknown[][]} rows
 * @param {string} comparto
 * @param {string} sheetName
 */
function parsePiscinaSheet(rows, comparto, sheetName) {
  /** @type {object[]} */
  const events = []
  let dow = 1
  /** @type {string[]} */
  let lastLabels = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    const dHit = findDowInRow(row)
    if (dHit !== null) {
      dow = dHit
      lastLabels = []
      continue
    }

    const t0 = cellToStart(row[0])
    if (t0) {
      const maxC = Math.max(row.length, lastLabels.length, 20)
      while (lastLabels.length < maxC) lastLabels.push("")
      for (let c = 1; c < row.length; c++) {
        const staff = String(row[c] ?? "").trim()
        if (!isStaffName(staff)) continue
        const lab = String(lastLabels[c] ?? "").trim()
        const title = (lab ? `${lab} · ` : "") + sheetName.trim()
        const titleShort = title.slice(0, 120)
        events.push({
          id: `${comparto}-${sheetName}-${i}-${c}-${t0}-${staff}`.replace(/\s+/g, "_").slice(0, 180),
          zona: comparto,
          sheet: sheetName,
          dow,
          start: t0,
          title: titleShort,
          staff,
        })
      }
    } else if (labelRowScore(row) >= 2 && !cellToStart(row[1])) {
      lastLabels = row.map((x) => String(x ?? "").trim())
    }
  }

  return events
}

function resolvePiscinaPath() {
  if (process.env.PISCINA_XLSX && fs.existsSync(process.env.PISCINA_XLSX)) return process.env.PISCINA_XLSX
  for (const p of DEFAULT_PISCINA_FILES) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function main() {
  const piscinaPath = resolvePiscinaPath()
  if (!fs.existsSync(outFile)) {
    console.error("Manca", outFile, "— eseguire prima build-planning-data.mjs")
    process.exit(1)
  }

  const raw = fs.readFileSync(outFile, "utf8")
  const payload = JSON.parse(raw)

  if (!piscinaPath) {
    console.warn(
      "[piscina] Nessun file Excel trovato. Copia PISCINAORARIO…xlsx in data/planning-import/piscina-orario-2025-2026.xlsx oppure imposta PISCINA_XLSX."
    )
    payload.eventsByComparto = payload.eventsByComparto ?? {}
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
    return
  }

  const wb = XLSX.readFile(piscinaPath)
  /** @type {Record<string, object[]>} */
  const byComparto = {}

  for (const sheetName of wb.SheetNames) {
    const comparto = sheetToComparto(sheetName)
    if (!comparto) {
      console.warn("[piscina] Foglio non mappato, skip:", sheetName)
      continue
    }
    const sh = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" })
    const ev = parsePiscinaSheet(rows, comparto, sheetName)
    if (!byComparto[comparto]) byComparto[comparto] = []
    byComparto[comparto] = byComparto[comparto].concat(ev)
    console.log("[piscina]", sheetName, "→", comparto, ev.length, "eventi")
  }

  payload.eventsByComparto = byComparto
  payload.piscinaSources = [path.relative(webRoot, piscinaPath).replace(/\\/g, "/")]
  payload.generatedAtPiscina = new Date().toISOString()

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
  const tot = Object.values(byComparto).reduce((a, v) => a + v.length, 0)
  console.log("[piscina] Aggiornato", outFile, "eventi piscina totali:", tot)
}

main()
