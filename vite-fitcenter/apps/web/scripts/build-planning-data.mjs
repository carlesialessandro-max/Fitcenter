/**
 * Legge i planning Excel (TERRA / ACQUA) dalla cartella data/planning-import
 * e genera src/data/planning-weekly.json per il calendario web.
 *
 * Uso: da apps/web →  node scripts/build-planning-data.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")

/** xlsx: risoluzione robusta (pnpm / script in sottocartella / dipendenze non installate). */
function loadXlsx() {
  const req = createRequire(import.meta.url)
  const tryPaths = [
    () => req("xlsx"),
    () => req(path.join(webRoot, "node_modules", "xlsx")),
    () => req(path.join(webRoot, "..", "node_modules", "xlsx")),
    () => req(path.join(webRoot, "..", "api", "node_modules", "xlsx")),
  ]
  for (const fn of tryPaths) {
    try {
      const m = fn()
      if (m) return m
    } catch {
      /* prova successivo */
    }
  }
  console.error(
    "\n[xlsx] Pacchetto non trovato. Dalla root del monorepo (cartella con pnpm-workspace.yaml) esegui:\n  pnpm install\n"
  )
  process.exit(1)
}

const XLSX = loadXlsx()
const importDir = path.join(webRoot, "data", "planning-import")
const outFile = path.join(webRoot, "src", "data", "planning-weekly.json")

function pad2(n) {
  return String(n).padStart(2, "0")
}

/** Normalizza intestazione giorno (Excel senza accenti). */
function normDayHeader(cell) {
  return String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
}

/** Lunedì=1 … Domenica=0 (allineato a getDay JS dove domenica=0). */
const HEADER_TO_DOW = {
  LUNEDI: 1,
  MARTEDI: 2,
  MERCOLEDI: 3,
  GIOVEDI: 4,
  VENERDI: 5,
  SABATO: 6,
  DOMENICA: 0,
}

function extractTimeFromCell(text) {
  const beforeCod = String(text).split(/cod\.?\s*/i)[0] ?? ""
  const matches = [...beforeCod.matchAll(/(\d{1,2})[.:](\d{2})/g)]
  if (!matches.length) return null
  const m = matches[matches.length - 1]
  const hh = Math.min(23, Math.max(0, Number(m[1])))
  const mm = Math.min(59, Math.max(0, Number(m[2])))
  return `${pad2(hh)}:${pad2(mm)}`
}

function extractStaff(text) {
  const m = String(text).match(/\(([^)]+)\)\s*$/)
  return m ? m[1].trim() : ""
}

function cleanTitle(text, timeHm) {
  let s = String(text).split(/cod\.?\s*/i)[0] ?? ""
  s = s.replace(/\s+/g, " ").trim()
  // toglie ultima occorrenza orario tipo " 9.30" o " 09:30"
  const re = new RegExp(`\\s*${timeHm.replace(":", "[.:]")}\\s*$`, "i")
  s = s.replace(re, "").trim()
  s = s.replace(/\s+\d{1,2}[.:]\d{2}\s*$/i, "").trim()
  return s.slice(0, 120) || "Corso"
}

function parseSheet(rows, zona, sheetName) {
  let headerIdx = -1
  /** @type {{ col: number; dow: number }[]} */
  let dayCols = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const found = []
    for (let j = 0; j < row.length; j++) {
      const h = normDayHeader(row[j])
      const dow = HEADER_TO_DOW[h]
      if (dow !== undefined) found.push({ col: j, dow })
    }
    if (found.length >= 4) {
      headerIdx = i
      dayCols = found.sort((a, b) => a.col - b.col)
      break
    }
  }
  if (headerIdx < 0 || !dayCols.length) return []

  /** @type {object[]} */
  const events = []
  /** ultimo orario letto dalla colonna A (per righe senza orario in A) */
  let lastRowTime = null

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const a0 = String(row[0] ?? "").trim()
    const m0 = a0.match(/^(\d{1,2})[.:](\d{2})\s*$/)
    if (m0) {
      lastRowTime = `${pad2(Number(m0[1]))}:${pad2(Number(m0[2]))}`
    }

    for (const { col, dow } of dayCols) {
      const cell = String(row[col] ?? "").trim()
      if (!cell || cell.length < 6) continue
      if (/planning\s+corsi/i.test(cell)) continue
      if (/^LUNEDI|^MARTEDI|^MERCOLEDI|^GIOVEDI|^VENERDI|^SABATO|^DOMENICA/i.test(normDayHeader(cell))) continue

      const tCell = extractTimeFromCell(cell)
      const start = tCell || lastRowTime
      if (!start) continue

      const staff = extractStaff(cell)
      const title = cleanTitle(cell, start)
      events.push({
        id: `${zona}-${sheetName}-${i}-${col}-${start}-${title}`.replace(/\s+/g, "_").slice(0, 180),
        zona,
        sheet: sheetName,
        dow,
        start,
        title,
        staff,
      })
    }
  }

  return events
}

function dedupe(arr) {
  const seen = new Set()
  const out = []
  for (const e of arr) {
    const k = `${e.zona}|${e.dow}|${e.start}|${e.title}|${e.staff}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

function main() {
  const includeAll = process.env.PLANNING_INCLUDE_ALL === "1"

  function useSheet(zona, sheetName) {
    if (includeAll) return true
    const n = sheetName.toUpperCase()
    if (zona === "terra") return n.includes("DAL 15")
    if (zona === "acqua") return n.includes("PLANNING SETTEMBRE") && !n.includes("1 AL 14")
    return true
  }

  const files = [
    { path: path.join(importDir, "terra-2025-26.xlsx"), zona: "terra" },
    { path: path.join(importDir, "acqua-2025-26.xlsx"), zona: "acqua" },
  ]

  /** @type {object[]} */
  let all = []

  for (const { path: fp, zona } of files) {
    if (!fs.existsSync(fp)) {
      console.warn("Manca file:", fp)
      continue
    }
    const wb = XLSX.readFile(fp)
    for (const sheetName of wb.SheetNames) {
      if (!useSheet(zona, sheetName)) {
        console.log(zona, sheetName, "→ skip (PLANNING_INCLUDE_ALL=1 per includere)")
        continue
      }
      const sh = wb.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" })
      const ev = parseSheet(rows, zona, sheetName)
      all = all.concat(ev)
      console.log(zona, sheetName, "→", ev.length, "eventi")
    }
  }

  all = dedupe(all)

  const payload = {
    generatedAt: new Date().toISOString(),
    planningNote: includeAll
      ? "Inclusi tutti i fogli Excel (possibili sovrapposizioni tra periodi)."
      : "Solo foglio principale: Terra «dal 15 settembre», Acqua «PLANNING SETTEMBRE» (senza 1–14). PLANNING_INCLUDE_ALL=1 per tutti i fogli.",
    sources: files.map((f) => path.relative(webRoot, f.path)).filter((p) => fs.existsSync(path.join(webRoot, p))),
    events: all.sort((a, b) => {
      const order = (d) => (d === 0 ? 7 : d)
      return order(a.dow) - order(b.dow) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
    }),
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8")
  console.log("Scritto", outFile, "totale", payload.events.length)
}

main()
