/**
 * Importa gli orari nel calendario FitCenter dal formato reale dei file:
 *   - ottobre 2026.xlsx (VICTORIA/SIMO/ALE/IRE/ALBA, 08:00/08:30) → reception
 *   - INVERNALE 2026-2027.xlsx (FLO/CADDEO/CED, griglia 30 min) → piscina
 * Il parser si sceglie dal contenuto del foglio; il reparto è quello sopra.
 *
 *   pnpm run import:reception -- --replace
 *   pnpm run import:desk-bagnini -- --replace
 *   pnpm run import:desk-bagnini -- --only reception --replace
 *   File in apps/api/data/planning-import/  (fallback Downloads)
 *   DESK_XLSX=... BAGNINI_XLSX=...
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
  console.error("[desk-bagnini] Pacchetto xlsx non trovato.")
  process.exit(1)
}

const XLSX = loadXlsx()
const apiImportDir = path.join(apiRoot, "data", "planning-import")
const webImportDir = path.join(webRoot, "data", "planning-import")
const downloads = "C:\\Users\\aless\\Downloads"

function pad2(n) {
  return String(n).padStart(2, "0")
}

function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dataDirCandidates() {
  return [path.join(apiRoot, "data"), path.resolve(process.cwd(), "data"), path.resolve(process.cwd(), "apps/api/data")]
}

function resolveDataDir() {
  const dir = dataDirCandidates().find((d) => fs.existsSync(d)) ?? path.join(apiRoot, "data")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function normHeader(cell) {
  return String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
}

const DOW_HEADERS = [
  ["DOMENICA", 0],
  ["DOM", 0],
  ["LUNEDI", 1],
  ["LUN", 1],
  ["MARTEDI", 2],
  ["MAR", 2],
  ["MERCOLEDI", 3],
  ["MER", 3],
  ["GIOVEDI", 4],
  ["GIO", 4],
  ["VENERDI", 5],
  ["VEN", 5],
  ["SABATO", 6],
  ["SAB", 6],
]

function headerToDow(cell) {
  const h = normHeader(cell).replace(/[^A-Z]/g, "")
  if (!h) return null
  for (const [k, v] of DOW_HEADERS) {
    if (h === k || h.startsWith(k)) return v
  }
  return null
}

function cellToStart(v) {
  const t = String(v ?? "")
    .trim()
    .replace(",", ".")
  const m = t.match(/(?:^|[\sT])(\d{1,2})[.:](\d{2})(?!\d)/) || t.match(/^(\d{1,2})[.:](\d{2})(?!\d)/)
  if (m) {
    const h = Number(m[1])
    if (h < 6 || h > 23) return null
    return `${pad2(h)}:${m[2]}`
  }
  const m2 = t.match(/^(\d{1,2})$/)
  if (m2) {
    const h = Number(m2[1])
    if (h >= 6 && h <= 23) return `${pad2(h)}:00`
  }
  return null
}

function hmToMin(hm) {
  const [h, m] = String(hm).split(":").map(Number)
  return h * 60 + m
}

function minToHm(total) {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`
}

function addMin(hm, n) {
  return minToHm(hmToMin(hm) + n)
}

function parseRange(timeCell) {
  const raw = String(timeCell ?? "").trim()
  if (!raw) return null
  if (raw.includes("/")) {
    const start = cellToStart(raw.split("/")[0])
    const end = cellToStart(raw.split("/")[1])
    if (start && end) return { start, end: hmToMin(end) <= hmToMin(start) ? addMin(start, 30) : end }
  }
  const start = cellToStart(raw)
  if (!start) return null
  return { start, end: addMin(start, 30) }
}

function isStaffName(raw) {
  const t = String(raw ?? "").trim()
  if (!t || t.length < 2 || t.length > 24) return false
  if (parseRange(t) || cellToStart(t) === t) return false
  const u = t.toUpperCase()
  if (/TOTALE|SETTIMANA|TOT SETT|ORE\b|NON VIENE|MALATA|^NO /.test(u)) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return false
  return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'\s-]{1,20}$/u.test(t)
}

function mergeRuns(slots) {
  const groups = new Map()
  for (const s of slots) {
    const k = `${s.dateIso}|${s.staff}`
    const arr = groups.get(k) ?? []
    arr.push(s)
    groups.set(k, arr)
  }
  const out = []
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.start.localeCompare(b.start))
    const merged = []
    for (const s of arr) {
      const prev = merged[merged.length - 1]
      if (prev && prev.end === s.start) prev.end = s.end
      else merged.push({ ...s })
    }
    out.push(...merged)
  }
  return out
}

function deskYearMonthFromName(filePath) {
  const n = path
    .basename(filePath)
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  const y = n.match(/(20\d{2})/)
  const year = y ? Number(y[1]) : 2026
  const months = [
    ["GENNAIO", 0],
    ["FEBBRAIO", 1],
    ["MARZO", 2],
    ["APRILE", 3],
    ["MAGGIO", 4],
    ["GIUGNO", 5],
    ["LUGLIO", 6],
    ["AGOSTO", 7],
    ["SETTEMBRE", 8],
    ["OTTOBRE", 9],
    ["NOVEMBRE", 10],
    ["DICEMBRE", 11],
  ]
  for (const [label, mi] of months) {
    if (n.includes(label)) return { year, month: mi }
  }
  return { year, month: 9 }
}

function looksLikeHoursTableRow(row) {
  const first = String(row[0] ?? "").trim()
  if (!first) return false
  if (parseRange(first) || cellToStart(first)) return false
  const u = first.toUpperCase()
  if (/^TOTALE/.test(u)) return true
  const nums = (row || []).filter((c) => /^\d+([.,]\d+)?$/.test(String(c).trim()))
  return isStaffName(first) && nums.length >= 1
}

function rowsLookLikeCoverage(rows) {
  const h = rows[0] || []
  for (let c = 0; c < h.length; c++) {
    if (headerToDow(h[c]) == null) continue
    const n = Number(String(h[c + 1] ?? "").trim())
    if (Number.isFinite(n) && n >= 1 && n <= 31) return true
  }
  return false
}

function rowsLookLikeDeskTurni(rows) {
  const h0 = rows[0] || []
  const h1 = rows[1] || []
  const h = h0.some((c) => headerToDow(c) != null) ? h0 : h1
  let n = 0
  const seen = new Set()
  for (let c = 0; c < h.length; c++) {
    const d = headerToDow(h[c])
    if (d == null || seen.has(d)) continue
    seen.add(d)
    n++
  }
  return n >= 5
}

/** Bagnini: 5 colonne/giorno, fascia 08:00/08:30, fino a 4 nominativi. */
function parseCoverageSheet(sh, year, month) {
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: false })
  if (!rows.length) return []
  const header = rows[0] || []
  const days = []
  for (let c = 0; c < header.length; c++) {
    const dow = headerToDow(header[c])
    if (dow == null) continue
    const dayNum = Number(String(header[c + 1] ?? "").trim())
    if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) continue
    const date = new Date(year, month, dayNum)
    days.push({ col: c, dow, dateIso: ymd(date) })
  }
  if (!days.length) return []
  const raw = []
  const lastEnd = new Map()
  function staffLaterOnDay(fromRi, d, name) {
    for (let rj = fromRi + 1; rj < rows.length; rj++) {
      const later = rows[rj] || []
      if (looksLikeHoursTableRow(later)) return false
      if (!String(later[d.col] ?? "").trim()) continue
      for (let k = 1; k <= 4; k++) {
        if (String(later[d.col + k] ?? "").trim().toUpperCase() === name) return true
      }
    }
    return false
  }
  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri] || []
    if (looksLikeHoursTableRow(row)) break
    for (const d of days) {
      const timeCell = String(row[d.col] ?? "").trim()
      const slash = timeCell.includes("/") ? parseRange(timeCell) : null
      const bare = timeCell.includes("/") ? null : cellToStart(timeCell)
      if (!slash && !bare) continue
      for (let k = 1; k <= 4; k++) {
        const staff = String(row[d.col + k] ?? "").trim()
        if (!isStaffName(staff)) continue
        const name = staff.toUpperCase()
        const key = `${d.dateIso}|${name}`
        const prevEnd = lastEnd.get(key)
        let start
        let end
        if (slash) {
          start = slash.start
          end = slash.end
        } else if (bare && prevEnd === bare && !staffLaterOnDay(ri, d, name)) {
          continue
        } else if (bare && prevEnd && hmToMin(bare) === hmToMin(prevEnd) + 30) {
          start = prevEnd
          end = bare
        } else if (bare) {
          start = bare
          end = addMin(bare, 30)
        } else {
          continue
        }
        raw.push({ dateIso: d.dateIso, dow: d.dow, start, end, staff: name })
        lastEnd.set(key, end)
      }
    }
  }
  return mergeRuns(raw)
}

function parseCoverageWorkbook(xlsxPath) {
  const { year, month } = deskYearMonthFromName(xlsxPath)
  const wb = XLSX.readFile(xlsxPath, { raw: false })
  const all = []
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    if (!sh) continue
    const events = parseCoverageSheet(sh, year, month)
    if (events.length) {
      console.log("[reception]", name, "→", events.length, "slot")
      all.push(...events)
    }
  }
  return all
}

function looksLikeStaffAbbrev(s) {
  const t = String(s ?? "").trim()
  if (t.length < 2 || t.length > 24) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return false
  if (cellToStart(t)) return false
  if (headerToDow(t) != null) return false
  if (/SETTIMANA|TOTALE|TOT SETT/.test(t.toUpperCase())) return false
  return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'\s-]*$/u.test(t)
}

/** Desk invernale: 4 colonne/giorno, orario in col 0 o col 2, nominativo in col 1. */
function parseDeskTurniSheet(sh, monday) {
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: false })
  if (!rows.length) return []
  let headerRow = -1
  let hits = []
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const found = []
    const seen = new Set()
    const row = rows[r] || []
    for (let c = 0; c < row.length; c++) {
      const dow = headerToDow(row[c])
      if (dow == null || seen.has(dow)) continue
      seen.add(dow)
      found.push({ c, dow })
    }
    if (found.length >= 5) {
      headerRow = r
      hits = found
      break
    }
  }
  if (headerRow < 0) return []
  const have = new Set(hits.map((h) => h.dow))
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const row = rows[r] || []
    for (let c = 0; c < row.length; c++) {
      const dow = headerToDow(row[c])
      if (dow == null || have.has(dow)) continue
      have.add(dow)
      hits.push({ c, dow })
    }
  }
  const ven = hits.find((h) => h.dow === 5)
  if (ven) {
    if (!have.has(6)) {
      hits.push({ c: ven.c + 4, dow: 6 })
      have.add(6)
    }
    if (!have.has(0)) hits.push({ c: ven.c + 8, dow: 0 })
  }
  const raw = []
  for (const h of hits) {
    const offset = h.dow === 0 ? 6 : h.dow - 1
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset)
    for (let ri = headerRow + 1; ri < rows.length; ri++) {
      const row = rows[ri] || []
      const block = [row[h.c], row[h.c + 1], row[h.c + 2], row[h.c + 3]]
        .map((c) => String(c ?? "").trim())
        .join(" ")
        .toUpperCase()
      if (ri > headerRow + 8 && /SETTIMANA|TOT SETT|TOTALE ORE/.test(block)) break
      const staffRaw = String(row[h.c + 1] ?? "").trim()
      if (!looksLikeStaffAbbrev(staffRaw)) continue
      const t = cellToStart(row[h.c]) || cellToStart(row[h.c + 2])
      if (!t) continue
      raw.push({
        dateIso: ymd(date),
        dow: date.getDay(),
        start: t,
        end: addMin(t, 30),
        staff: staffRaw.toUpperCase(),
      })
    }
  }
  return mergeRuns(raw)
}

function weekMondayFromSheet(name, seasonStartYear) {
  const n = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  const m = n.match(/\b(SETT?|OTT|NOV|DIC|GEN|FEB|MAR|APR|MAG|GIU)\b.*?(\d{1,2})\s*[-–]\s*(\d{1,2})/)
  if (!m) return null
  const monthIdx = { SET: 8, SETT: 8, OTT: 9, NOV: 10, DIC: 11, GEN: 0, FEB: 1, MAR: 2, APR: 3, MAG: 4, GIU: 5 }[m[1]]
  if (monthIdx == null) return null
  const year = monthIdx >= 8 ? seasonStartYear : seasonStartYear + 1
  return new Date(year, monthIdx, Number(m[2]))
}

function seasonYearFromName(filePath) {
  const n = path.basename(filePath)
  const m = n.match(/(20\d{2})\s*[-–]\s*(20\d{2})/)
  if (m) return Number(m[1])
  const y = n.match(/(20\d{2})/)
  return y ? Number(y[1]) : 2026
}

function parseDeskTurniWorkbook(xlsxPath) {
  const seasonStartYear = seasonYearFromName(xlsxPath)
  const wb = XLSX.readFile(xlsxPath, { raw: false })
  const all = []
  for (const name of wb.SheetNames) {
    if (/TURNAZIONE|FOGLIO2|ROBOT|IDROPULITRICE/i.test(name)) continue
    const monday = weekMondayFromSheet(name, seasonStartYear)
    if (!monday) {
      console.log("[piscina] skip foglio", name)
      continue
    }
    const sh = wb.Sheets[name]
    if (!sh) continue
    const events = parseDeskTurniSheet(sh, monday)
    if (events.length) {
      const perDay = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
      for (const e of events) perDay[e.dow]++
      const label = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"].map((k, i) => `${k}:${perDay[i]}`).join(" ")
      console.log("[piscina]", name, "→", events.length, "fasce", ymd(monday), "|", label)
      if (perDay[0] === 0 && perDay[6] === 0) {
        console.warn("[piscina]", name, "nessun turno sabato/domenica (controlla colonne weekend nel foglio)")
      }
      all.push(...events)
    }
  }
  return all
}

function detectWorkbookKind(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath, { raw: false })
  for (const name of wb.SheetNames) {
    if (/TURNAZIONE|FOGLIO2|ROBOT|IDROPULITRICE/i.test(name)) continue
    const sh = wb.Sheets[name]
    if (!sh) continue
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: false })
    if (rowsLookLikeCoverage(rows)) return "coverage"
    if (rowsLookLikeDeskTurni(rows)) return "desk"
  }
  return null
}

const STAFF_ALIASES = {
  FLO: ["FIORETTI"],
  REBE: ["REBECCA"],
  NAD: ["NADIA"],
  BERNA: ["BERNARDI", "BERNARDINI"],
}

function matchIstruttore(instructors, abbrev) {
  const a = String(abbrev ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  if (a.length < 3) return null
  const aliases = STAFF_ALIASES[a] ?? []
  const hits = []
  for (const i of instructors) {
    const cog = String(i.cognome ?? "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
    const nom = String(i.nome ?? "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
    const full = `${cog} ${nom}`.trim()
    let score = 0
    if (cog === a || nom === a) score = 100
    else if (aliases.some((al) => cog === al || nom === al || cog.startsWith(al) || nom.startsWith(al))) score = 80
    else if (cog.startsWith(a)) score = 40 + a.length
    else if (nom.startsWith(a)) score = 30 + a.length
    else if (full.startsWith(a)) score = 20 + a.length
    if (score) hits.push({ i, score })
  }
  hits.sort((x, y) => y.score - x.score)
  if (!hits.length) return null
  if (hits.length > 1 && hits[0].score === hits[1].score) return null
  if (hits[0].score < 33) return null
  return hits[0].i
}

function upsertComparto(db, comparto, zona, titlePrefix, events, replace, now) {
  const prefix = `${comparto}|`
  const kept = replace
    ? db.revisions.filter((r) => !(r.comparto === comparto && String(r.stableKey).startsWith(prefix)))
    : db.revisions
  const existing = new Set(kept.filter((r) => r.comparto === comparto).map((r) => r.stableKey))
  let added = 0
  const next = [...kept]
  for (const e of events) {
    const stableKey = `${comparto}|${e.dateIso}|${e.start}|${e.staff}`
    if (existing.has(stableKey)) continue
    const ins = matchIstruttore(db.instructors, e.staff)
    next.push({
      comparto,
      stableKey,
      dow: e.dow,
      dateIso: e.dateIso,
      start: e.start,
      title: `${titlePrefix} · ${e.start}–${e.end}`,
      zona,
      staffOverride: ins ? `${ins.cognome} ${ins.nome}`.trim() : e.staff,
      istruttoreId: ins?.id ?? null,
      note: null,
      updatedAt: now,
      updatedBy: "import-desk-bagnini",
    })
    existing.add(stableKey)
    added++
  }
  db.revisions = next
  return added
}

function listXlsxIn(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /\.xlsx$/i.test(n) && !n.startsWith("~$"))
      .map((n) => path.join(dir, n))
  } catch {
    return []
  }
}

function searchDirs() {
  const cwd = process.cwd()
  return [
    apiImportDir,
    webImportDir,
    path.join(cwd, "apps", "api", "data", "planning-import"),
    path.join(cwd, "apps", "web", "data", "planning-import"),
    path.join(cwd, "data", "planning-import"),
    downloads,
    "C:\\FitCenter\\vite-fitcenter\\vite-fitcenter\\apps\\api\\data\\planning-import",
    "C:\\FitCenter\\vite-fitcenter\\vite-fitcenter\\apps\\web\\data\\planning-import",
    "C:\\Fitcenter\\vite-fitcenter\\vite-fitcenter\\apps\\api\\data\\planning-import",
    "C:\\Fitcenter\\vite-fitcenter\\vite-fitcenter\\apps\\web\\data\\planning-import",
  ]
}

function copyIntoImportDir(src, destName) {
  fs.mkdirSync(apiImportDir, { recursive: true })
  const dest = path.join(apiImportDir, destName)
  try {
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest)
  } catch (err) {
    console.warn("[desk-bagnini] Copia non riuscita:", dest, err.message)
    return src
  }
  return dest
}

function seasonScore(filePath) {
  const n = path.basename(filePath)
  const range = n.match(/(20\d{2})\s*[-–]\s*(20\d{2})/)
  if (range) return Number(range[1]) * 100 + Number(range[2])
  const y = n.match(/(20\d{2})/)
  return y ? Number(y[1]) * 100 : 0
}

function pickNewest(files) {
  if (!files.length) return null
  return [...files].sort((a, b) => seasonScore(b) - seasonScore(a) || a.localeCompare(b))[0]
}

function collectCandidates() {
  const named = [process.env.DESK_XLSX, process.env.BAGNINI_XLSX]
  const scanned = []
  for (const dir of searchDirs()) {
    scanned.push(...listXlsxIn(dir))
  }
  const byBase = new Map()
  for (const p of [...named, ...scanned]) {
    if (!p || !fs.existsSync(p)) continue
    const b = path.basename(p).toLowerCase()
    if (!/^(ottobre\s+20\d{2}|invernale\s+20\d{2})/i.test(b)) continue
    const prev = byBase.get(b)
    const preferApi = p.includes(`${path.sep}api${path.sep}`) && p.includes("planning-import")
    if (!prev || preferApi) byBase.set(b, p)
  }
  return [...byBase.values()]
}

function parseOnlyArg() {
  const raw = process.argv.find((a) => a.startsWith("--only=")) || (process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "")
  const v = String(raw ?? "")
    .replace(/^--only=?/, "")
    .trim()
    .toLowerCase()
  if (v === "reception" || v === "desk") return "reception"
  if (v === "piscina" || v === "bagnini") return "piscina"
  return "all"
}

function main() {
  const replace = process.argv.includes("--replace")
  const only = parseOnlyArg()
  const files = collectCandidates()
  const coverageFiles = []
  const deskFiles = []
  for (const f of files) {
    const kind = detectWorkbookKind(f)
    if (kind === "coverage") coverageFiles.push(f)
    else if (kind === "desk") deskFiles.push(f)
    else console.warn("[desk-bagnini] Ignoro (formato diverso):", f)
  }

  const coverage = pickNewest(coverageFiles)
  const desk = pickNewest(deskFiles)
  const wantReception = only === "all" || only === "reception"
  const wantPiscina = only === "all" || only === "piscina"
  if (wantPiscina && desk && /2025\s*[-–]\s*2026/i.test(path.basename(desk))) {
    console.error(
      "[piscina] Trovato solo INVERNALE 2025-2026 (maggio). Serve INVERNALE 2026-2027.xlsx — copialo in:\n  " +
        apiImportDir
    )
    process.exit(1)
  }
  if (wantReception && !coverage) {
    console.error("[reception] Manca ottobre 2026.xlsx — copialo in:\n  " + apiImportDir)
    process.exit(1)
  }
  if (wantPiscina && !desk) {
    console.error("[piscina] Manca INVERNALE 2026-2027.xlsx — copialo in:\n  " + apiImportDir)
    process.exit(1)
  }

  const coveragePath = wantReception ? copyIntoImportDir(coverage, path.basename(coverage)) : null
  const deskPath = wantPiscina ? copyIntoImportDir(desk, path.basename(desk)) : null

  const dataDir = resolveDataDir()
  const dbPath = path.join(dataDir, "calendario-reparti.json")
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf8")) : { instructors: [], revisions: [] }
  db.revisions = Array.isArray(db.revisions) ? db.revisions : []
  db.instructors = Array.isArray(db.instructors) ? db.instructors : []
  const now = new Date().toISOString()

  if (wantReception) {
    console.log("[reception] File:", coveragePath, "→ reception / desk (Victoria/Simona/ALE/Irene/Alba)")
    const recEvents = parseCoverageWorkbook(coveragePath)
    const recAdded = upsertComparto(db, "reception", "reception", "Sportello", recEvents, replace, now)
    const recDates = recEvents.map((e) => e.dateIso).sort()
    const recWeekend = recEvents.filter((e) => e.dow === 0 || e.dow === 6).length
    console.log("[reception] Aggiunti:", recAdded, "| periodo", recDates[0] ?? "—", "→", recDates[recDates.length - 1] ?? "—")
    console.log("[reception] Turni sabato/domenica:", recWeekend)
  }

  if (wantPiscina) {
    console.log("[piscina] File:", deskPath, "→ piscina (Florenzi/Caddeo/Cedrola)")
    const poolEvents = parseDeskTurniWorkbook(deskPath)
    const poolAdded = upsertComparto(db, "piscina", "invernale", "Copertura", poolEvents, replace, now)
    const poolDates = poolEvents.map((e) => e.dateIso).sort()
    console.log("[piscina] Aggiunti:", poolAdded, "| periodo", poolDates[0] ?? "—", "→", poolDates[poolDates.length - 1] ?? "—")
    const weekend = poolEvents.filter((e) => e.dow === 0 || e.dow === 6).length
    console.log("[piscina] Turni sabato/domenica:", weekend)
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8")
  console.log("[desk-bagnini] Salvato:", dbPath)
}

main()
