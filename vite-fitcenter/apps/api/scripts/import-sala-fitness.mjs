/**
 * Importa ORARIO SALA 2026.xlsx nel calendario FitCenter (comparto sala_fitness).
 * Ogni foglio = una settimana; il colore della cella orario è l'istruttore (leggenda a destra).
 *
 * Uso (root del monorepo oppure apps/api):
 *   pnpm run import:sala-fitness
 *   pnpm run import:sala-fitness -- --replace
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, "..")
const webRoot = path.resolve(apiRoot, "..", "web")
const req = createRequire(path.resolve(webRoot, "scripts/build-planning-data.mjs"))

function loadXlsx() {
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
  console.error("[sala] Pacchetto xlsx non trovato. Esegui pnpm install dalla root.")
  process.exit(1)
}

const XLSX = loadXlsx()

const DEFAULT_FILES = [
  process.env.SALA_XLSX,
  "\\\\ls220d3b7\\share\\societa\\CONDIVISA\\Sala Fitness\\ORARIO SALA 2026.xlsx",
  path.join(webRoot, "data", "planning-import", "ORARIO SALA 2026.xlsx"),
].filter(Boolean)

function dataDirCandidates() {
  return [
    path.join(apiRoot, "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "apps/api/data"),
  ]
}

function resolveDataDir() {
  const dir = dataDirCandidates().find((d) => fs.existsSync(d)) ?? path.join(apiRoot, "data")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function resolveXlsx() {
  for (const p of DEFAULT_FILES) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch {
      /* next */
    }
  }
  return null
}

function pad2(n) {
  return String(n).padStart(2, "0")
}

function cellToStart(v) {
  const t = String(v ?? "")
    .trim()
    .replace(",", ".")
  const m = t.match(/(\d{1,2})[.:](\d{2})/)
  if (!m) return null
  return `${pad2(Math.min(23, Number(m[1])))}:${m[2]}`
}

function cellColor(cell) {
  const s = cell?.s || {}
  return String(s.fgColor?.rgb || s.bgColor?.rgb || s.fill?.fgColor?.rgb || "")
    .replace(/^FF/i, "")
    .toUpperCase()
}

function isIgnoredColor(c) {
  return !c || c === "FFFFFF" || c === "000000" || c === "FFFF00" || c === "FFF200" || c === "FFFF66"
}

function looksLikePerson(v) {
  const t = String(v ?? "").trim()
  if (t.length < 2 || t.length > 24) return false
  const u = t.toUpperCase()
  if (/TOTALE|GG\/OP|CORSI|SETT|TRAINER|PERSONAL|ADDOMINALI|GIRARE|^TOT\.?$/.test(u)) return false
  if (cellToStart(t)) return false
  if (/^\$/.test(t) || /^\d+([.,]\d+)?$/.test(t)) return false
  return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\s-]{1,20}$/u.test(t)
}

function headerDowAndDay(cell) {
  const t = String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
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
    if (!t.startsWith(k)) continue
    const dm = t.match(/(\d{1,2})\s*$/)
    return { dow, day: dm ? Number(dm[1]) : null }
  }
  return null
}

function ymdFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return x
}

const COLOR_ALIASES = {
  "99FF66": "ANDREA",
  "92D050": "ANDREA",
  "00B050": "ANDREA",
  "00A933": "ANDREA",
  ED7D31: "ALE",
  F4B084: "ALE",
  FF8000: "ALE",
  FF0000: "MAX",
  FF3333: "MAX",
  BFBFBF: "ALBERTO",
  B2B2B2: "ALBERTO",
  AEAAAA: "ALBERTO",
  A6A6A6: "ALBERTO",
  AFABAB: "ALBERTO",
  "8EA9DB": "BALDI",
  BDD7EE: "BALDI",
  DEEBF7: "BALDI",
  "7030A0": "EDOARDO",
  "00B0F0": "JACOPO",
}

function readLegend(sh) {
  const map = { ...COLOR_ALIASES }
  const range = XLSX.utils.decode_range(sh["!ref"] || "A1:Z40")
  for (let R = 0; R <= Math.min(range.e.r, 40); R++) {
    for (let C = 13; C <= Math.min(range.e.c, 30); C++) {
      const cell = sh[XLSX.utils.encode_cell({ r: R, c: C })]
      const v = String(cell?.w ?? cell?.v ?? "").trim()
      const col = cellColor(cell)
      if (looksLikePerson(v) && col && !isIgnoredColor(col)) map[col] = v.toUpperCase()
    }
  }
  return map
}

function staffFromColor(col, legend) {
  if (!col || isIgnoredColor(col)) return null
  if (legend[col]) return legend[col]
  const close = Object.keys(legend).find((k) => k.slice(0, 4) === col.slice(0, 4))
  return close ? legend[close] : null
}

function parseSheet(sh, monday) {
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: false })
  if (!rows.length) return []
  const header = rows[0] || []
  const days = []
  for (let c = 0; c <= 12; c += 2) {
    const h = headerDowAndDay(header[c])
    if (!h) continue
    const offset = h.dow === 0 ? 6 : h.dow - 1
    const date = addDays(monday, offset)
    days.push({ col: c, dow: h.dow, dateIso: ymdFromDate(date) })
  }
  if (days.length < 5) return []

  const legend = readLegend(sh)
  const rawSlots = []
  for (let ri = 1; ri < Math.min(rows.length, 34); ri++) {
    const row = rows[ri] || []
    const rowLabel = String(row[0] ?? "").toUpperCase()
    if (rowLabel.includes("PERSONAL") || rowLabel.includes("TRAINER")) break
    for (const d of days) {
      const timeCell = String(row[d.col] ?? "").trim()
      const staffCell = String(row[d.col + 1] ?? "")
        .trim()
        .toUpperCase()
      if (staffCell === "CORSO" || timeCell.toUpperCase() === "CORSO") continue
      const start = cellToStart(timeCell)
      if (!start) continue
      const addr = XLSX.utils.encode_cell({ r: ri, c: d.col })
      const staff = staffFromColor(cellColor(sh[addr]), legend)
      if (!staff) continue
      rawSlots.push({ dateIso: d.dateIso, dow: d.dow, start, staff })
    }
  }

  rawSlots.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.start.localeCompare(b.start) || a.staff.localeCompare(b.staff))
  const merged = []
  for (const s of rawSlots) {
    const prev = merged[merged.length - 1]
    if (prev && prev.dateIso === s.dateIso && prev.staff === s.staff) {
      const [ph, pm] = prev.start.split(":").map(Number)
      const [nh, nm] = s.start.split(":").map(Number)
      if (nh * 60 + nm - (ph * 60 + pm) <= 30) continue
    }
    merged.push(s)
  }
  return merged
}

function main() {
  const replace = process.argv.includes("--replace")
  const xlsxPath = resolveXlsx()
  if (!xlsxPath) {
    console.error("[sala] File orario non trovato. Copia ORARIO SALA 2026.xlsx in data/planning-import/ o imposta SALA_XLSX.")
    process.exit(1)
  }
  console.log("[sala] File:", xlsxPath)
  const wb = XLSX.readFile(xlsxPath, { cellStyles: true, cellDates: false, raw: false })
  let monday = new Date(2024, 3, 1)
  const all = []
  for (const sheetName of wb.SheetNames) {
    const sh = wb.Sheets[sheetName]
    if (!sh) continue
    const events = parseSheet(sh, monday)
    if (events.length) {
      const last = events[events.length - 1]?.dateIso
      console.log("[sala]", sheetName, "→", events.length, "slot", ymdFromDate(monday), "…", last)
      all.push(...events)
    }
    monday = addDays(monday, 7)
  }

  const datesExcel = all.map((e) => e.dateIso).sort()
  const lastIso = datesExcel[datesExcel.length - 1]
  const today = new Date()
  const horizon = ymdFromDate(new Date(today.getFullYear(), today.getMonth() + 18, 1))
  if (lastIso && lastIso < horizon) {
    const minSource = (() => {
      const d = new Date(Number(lastIso.slice(0, 4)), Number(lastIso.slice(5, 7)) - 1, Number(lastIso.slice(8, 10)))
      d.setDate(d.getDate() - 52 * 7)
      return ymdFromDate(d)
    })()
    const seen = new Set(all.map((e) => `${e.dateIso}|${e.start}|${e.staff}`))
    const projected = []
    for (const e of all) {
      if (e.dateIso < minSource) continue
      const d0 = new Date(Number(e.dateIso.slice(0, 4)), Number(e.dateIso.slice(5, 7)) - 1, Number(e.dateIso.slice(8, 10)))
      for (let n = 0; n < 4; n++) {
        d0.setDate(d0.getDate() + 52 * 7)
        const next = ymdFromDate(d0)
        if (next <= lastIso) continue
        if (next > horizon) break
        const k = `${next}|${e.start}|${e.staff}`
        if (seen.has(k)) continue
        seen.add(k)
        projected.push({ dateIso: next, dow: d0.getDay(), start: e.start, staff: e.staff })
      }
    }
    console.log("[sala] Ripetuti oltre", lastIso, "(da", minSource, ") →", projected.length, "slot fino a", horizon)
    all.push(...projected)
  }

  const dataDir = resolveDataDir()
  const dbPath = path.join(dataDir, "calendario-reparti.json")
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf8")) : { instructors: [], revisions: [] }
  db.revisions = Array.isArray(db.revisions) ? db.revisions : []
  db.instructors = Array.isArray(db.instructors) ? db.instructors : []
  const now = new Date().toISOString()
  const kept = replace ? db.revisions.filter((r) => r.comparto !== "sala_fitness") : db.revisions
  const existing = new Set(kept.filter((r) => r.comparto === "sala_fitness").map((r) => r.stableKey))
  let added = 0
  const nextRevs = [...kept]
  for (const e of all) {
    const stableKey = `sala_fitness|${e.dateIso}|${e.start}|${e.staff}`
    if (existing.has(stableKey)) continue
    nextRevs.push({
      comparto: "sala_fitness",
      stableKey,
      dow: e.dow,
      dateIso: e.dateIso,
      start: e.start,
      title: "Sala pesi",
      zona: "sala_fitness",
      staffOverride: e.staff,
      istruttoreId: null,
      note: null,
      updatedAt: now,
      updatedBy: "import-sala-fitness",
    })
    existing.add(stableKey)
    added++
  }
  db.revisions = nextRevs
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8")
  const dates = all.map((e) => e.dateIso).sort()
  console.log("[sala] Aggiunti:", added, "| totale sala_fitness:", db.revisions.filter((r) => r.comparto === "sala_fitness").length)
  console.log("[sala] Periodo:", dates[0] ?? "—", "→", dates[dates.length - 1] ?? "—")
  console.log("[sala] Salvato:", dbPath)
}

main()
