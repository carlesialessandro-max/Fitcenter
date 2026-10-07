/**
 * Importa ORARIO SETT. PULIZIE.xlsx nel calendario FitCenter (comparto pulizie).
 *
 *   pnpm run import:pulizie -- --replace
 *   PULIZIE_XLSX=... pnpm run import:pulizie -- --replace
 *
 * Cerca il file su:
 *   \\ls220d3b7\share\societa\CONDIVISA\PULIZIE\ORARIO SETT. PULIZIE.xlsx
 *   apps/api/data/planning-import/
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
  console.error("[pulizie] Pacchetto xlsx non trovato.")
  process.exit(1)
}

const XLSX = loadXlsx()
const apiImportDir = path.join(apiRoot, "data", "planning-import")
const downloads = "C:\\Users\\aless\\Downloads"

function pad2(n) {
  return String(n).padStart(2, "0")
}

function dataDirCandidates() {
  return [path.join(apiRoot, "data"), path.resolve(process.cwd(), "data"), path.resolve(process.cwd(), "apps/api/data")]
}

function resolveDataDir() {
  const dir = dataDirCandidates().find((d) => fs.existsSync(d)) ?? path.join(apiRoot, "data")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function firstExisting(paths) {
  for (const p of paths) {
    if (!p) continue
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* next */
    }
  }
  return null
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

function findByName(dir, re) {
  return listXlsxIn(dir).find((p) => re.test(path.basename(p)))
}

function resolveXlsx() {
  const named = [
    process.env.PULIZIE_XLSX,
    "\\\\ls220d3b7\\share\\societa\\CONDIVISA\\PULIZIE\\ORARIO SETT. PULIZIE.xlsx",
    path.join(apiImportDir, "ORARIO SETT. PULIZIE.xlsx"),
    path.join(apiImportDir, "ORARIO SETT PULIZIE.xlsx"),
    findByName(apiImportDir, /puliz/i),
    findByName(path.join(webRoot, "data", "planning-import"), /puliz/i),
    findByName(downloads, /puliz/i),
    "C:\\FitCenter\\vite-fitcenter\\vite-fitcenter\\apps\\api\\data\\planning-import\\ORARIO SETT. PULIZIE.xlsx",
    "C:\\fitcenter\\vite-fitcenter\\vite-fitcenter\\apps\\api\\data\\planning-import\\ORARIO SETT. PULIZIE.xlsx",
  ]
  return firstExisting(named)
}

function copyIntoImportDir(src) {
  fs.mkdirSync(apiImportDir, { recursive: true })
  const dest = path.join(apiImportDir, "ORARIO SETT. PULIZIE.xlsx")
  try {
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest)
  } catch (err) {
    console.warn("[pulizie] Copia locale non riuscita:", err.message)
    return src
  }
  return dest
}

function norm(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
}

const STAFF_ALIASES = {
  VERIONICA: "VERONICA",
}

const HEADER_TO_DOW = [
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
  const h = norm(cell).replace(/[^A-Z]/g, "")
  if (!h) return null
  for (const [k, v] of HEADER_TO_DOW) {
    if (h === k || h.startsWith(k)) return v
  }
  return null
}

function rowDow(row) {
  return headerToDow(row?.[0])
}

function excelSerialToHm(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n >= 1.5) return null
  const total = Math.round(((n % 1) + 1) * 24 * 60) % (24 * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h < 5 || h > 23) return null
  return `${pad2(h)}:${pad2(m)}`
}

function cellToStart(v) {
  if (typeof v === "number") return excelSerialToHm(v)
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${pad2(v.getHours())}:${pad2(v.getMinutes())}`
  }
  let t = String(v ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.-/g, ".")
    .replace(/-\./g, ".")
    .replace(",", ".")
  if (!t || t === "." || t === "-" || t === "/") return null
  const withMin = t.match(/^(\d{1,2})[.:](\d{1,2})$/)
  if (withMin) {
    const h = Number(withMin[1])
    const min = Number(withMin[2].padEnd(2, "0").slice(0, 2))
    if (h > 23 || min > 59) return null
    return `${pad2(h)}:${pad2(min)}`
  }
  const m2 = t.match(/^(\d{1,2})$/)
  if (m2) {
    const h = Number(m2[1])
    if (h >= 5 && h <= 23) return `${pad2(h)}:00`
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

function parseRange(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const start = `${pad2(v.getHours())}:${pad2(v.getMinutes())}`
    return { start, end: minToHm(hmToMin(start) + 30) }
  }
  if (typeof v === "number") {
    const start = excelSerialToHm(v)
    if (!start) return null
    return { start, end: minToHm(hmToMin(start) + 30) }
  }
  let raw = String(v ?? "").trim()
  if (!raw) return null
  if (/^(MATTINA|POM|POMERIGGIO|SERA)$/i.test(norm(raw))) return null
  raw = raw.replace(/\.-/g, ".").replace(/-\./g, ".")
  const parts = raw.split(/\s*(?:--+|[–−—]|\/)\s*/)
  if (parts.length === 1 && /^\d/.test(raw) && raw.includes("-")) {
    const alt = raw.split(/\s*-\s*/).filter(Boolean)
    if (alt.length >= 2) parts.splice(0, 1, ...alt)
  }
  if (parts.length >= 2) {
    const start = cellToStart(parts[0])
    const end = cellToStart(parts[parts.length - 1])
    if (start && end && hmToMin(end) > hmToMin(start)) return { start, end }
  }
  return null
}

function isSkipToken(s) {
  const u = norm(s)
  if (!u) return true
  return /^(X|XX|SI|OK|RIPOSO|OFF|FERIE|MALATTIA|MALATA|NO|TOTALE|ORE|SETT|SETTIMANA|TOT)$/.test(u)
}

function looksLikeZone(raw) {
  const u = norm(raw)
  return /SPOGLIATO|PALESTRA|SALA|UFFIC|BAGN|PISCINA|RECEPT|INGRESS|CORRIDO|SCALE|VETR|FITNESS|CAMPUS|DANZA|BAR|WC|TOILET|ATRIE|ATRIO|ESTERNO|INTERNO/.test(
    u
  )
}

function looksLikePerson(raw) {
  const t = String(raw ?? "").trim()
  if (t.length < 2 || t.length > 40) return false
  if (parseRange(t) && /^\d/.test(t)) return false
  const u = norm(t)
  if (isSkipToken(t)) return false
  if (looksLikeZone(t)) return false
  if (/TOTALE|SETTIMANA|ORE\b|PULIZIE|ORARIO|TURNI|ZONA|AREA/.test(u) && u.split(" ").length <= 2) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return false
  return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'/\s-]{1,38}$/u.test(t)
}

function splitStaff(raw) {
  return String(raw ?? "")
    .split(/[/+;,\n]+/)
    .map((s) => s.trim())
    .filter((s) => looksLikePerson(s) && !isSkipToken(s))
    .map((s) => STAFF_ALIASES[norm(s)] || s)
}

function findDayHeader(rows) {
  for (let ri = 0; ri < Math.min(rows.length, 12); ri++) {
    const row = rows[ri] || []
    const days = []
    const seen = new Set()
    for (let c = 0; c < row.length; c++) {
      const d = headerToDow(row[c])
      if (d == null || seen.has(d)) continue
      seen.add(d)
      days.push({ col: c, dow: d })
    }
    if (days.length >= 5) return { ri, days }
  }
  return null
}

function looksLikeHoursTableRow(row) {
  const first = String(row[0] ?? "").trim()
  if (!first) return false
  const u = first.toUpperCase()
  if (/^TOTALE/.test(u)) return true
  const nums = (row || []).filter((c) => /^\d+([.,]\d+)?$/.test(String(c).trim()))
  return looksLikePerson(first) && nums.length >= 3 && nums.length >= (row.length - 2) / 2
}

/** Persone in colonna A, fasce orarie sotto i giorni. */
function parseStaffRows(rows) {
  const hdr = findDayHeader(rows)
  if (!hdr) return []
  const events = []
  for (let ri = hdr.ri + 1; ri < rows.length; ri++) {
    const row = rows[ri] || []
    if (looksLikeHoursTableRow(row)) break
    let staffCell = ""
    let staffCol = 0
    for (let c = 0; c < hdr.days[0].col; c++) {
      const t = String(row[c] ?? "").trim()
      if (looksLikePerson(t)) {
        staffCell = t
        staffCol = c
        break
      }
    }
    if (!staffCell) continue
    const zone = staffCol > 0 ? String(row[0] ?? "").trim() : ""
    for (const d of hdr.days) {
      const range = parseRange(row[d.col])
      if (!range) continue
      if (hmToMin(range.end) - hmToMin(range.start) < 30) continue
      for (const staff of splitStaff(staffCell)) {
        events.push({
          dow: d.dow,
          start: range.start,
          end: range.end,
          staff,
          title: looksLikeZone(zone) ? String(zone).trim() : "Pulizie",
        })
      }
    }
  }
  return events
}

/** Orario in colonna A, nomi sotto i giorni. */
function parseTimeRows(rows) {
  const hdr = findDayHeader(rows)
  if (!hdr) return []
  const events = []
  for (let ri = hdr.ri + 1; ri < rows.length; ri++) {
    const row = rows[ri] || []
    if (looksLikeHoursTableRow(row)) break
    const range = parseRange(row[0])
    if (!range) continue
    for (const d of hdr.days) {
      for (const staff of splitStaff(row[d.col])) {
        events.push({
          dow: d.dow,
          start: range.start,
          end: range.end,
          staff,
          title: "Pulizie",
        })
      }
    }
  }
  return events
}

/** Blocchi per giorno (LUNEDI in col A, poi orari). */
function parseDowGroups(rows) {
  const events = []
  let dow = null
  for (const row of rows) {
    const r = row || []
    const dHit = rowDow(r)
    if (dHit !== null) {
      dow = dHit
      continue
    }
    if (dow == null) continue
    const range = parseRange(r[0])
    if (!range) continue
    for (let c = 1; c < r.length && c < 8; c++) {
      for (const staff of splitStaff(r[c])) {
        events.push({
          dow,
          start: range.start,
          end: range.end,
          staff,
          title: "Pulizie",
        })
      }
    }
  }
  return events
}

function mergeRuns(slots) {
  const groups = new Map()
  for (const s of slots) {
    const k = `${s.dow}|${s.staff}|${s.title}`
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

function parseSheet(rows) {
  const candidates = [
    parseStaffRows(rows),
    parseTimeRows(rows),
    parseDowGroups(rows),
  ]
  candidates.sort((a, b) => b.length - a.length)
  return mergeRuns(candidates[0] ?? [])
}

function dumpSheet(name, rows) {
  console.log(`[pulizie] foglio «${name}» ${rows.length} righe`)
  const max = Math.min(rows.length, 18)
  for (let i = 0; i < max; i++) {
    const cells = (rows[i] || []).slice(0, 10).map((c) => String(c ?? "").replace(/\s+/g, " ").slice(0, 24))
    console.log(`  r${i}:`, cells.join(" | "))
  }
}

function matchIstruttore(instructors, abbrev) {
  const a = STAFF_ALIASES[norm(abbrev)] || norm(abbrev)
  if (a.length < 3) return null
  const hits = []
  for (const i of instructors) {
    const cog = norm(i.cognome ?? "")
    const nom = norm(i.nome ?? "")
    const full = `${cog} ${nom}`.trim()
    let score = 0
    if (cog === a || nom === a || full === a) score = 100
    else if (cog.startsWith(a) || a.startsWith(cog)) score = 40 + Math.min(a.length, cog.length)
    else if (nom.startsWith(a) || a.startsWith(nom)) score = 30 + a.length
    if (score) hits.push({ i, score })
  }
  hits.sort((x, y) => y.score - x.score)
  if (!hits.length) return null
  if (hits.length > 1 && hits[0].score === hits[1].score) return null
  if (hits[0].score < 33) return null
  return hits[0].i
}

function upsertWeekly(db, events, replace, now) {
  const kept = replace ? db.revisions.filter((r) => r.comparto !== "pulizie") : db.revisions
  const existing = new Set(kept.filter((r) => r.comparto === "pulizie").map((r) => r.stableKey))
  let added = 0
  const next = [...kept]
  for (const e of events) {
    const stableKey = `pulizie|${e.dow}|${e.start}|${e.end}|${e.staff}|${e.title}`
    if (existing.has(stableKey)) continue
    const ins = matchIstruttore(db.instructors, e.staff)
    next.push({
      comparto: "pulizie",
      stableKey,
      dow: e.dow,
      dateIso: null,
      start: e.start,
      title: `${e.title} · ${e.start}–${e.end}`,
      zona: "pulizie",
      staffOverride: ins ? `${ins.cognome} ${ins.nome}`.trim() : e.staff,
      istruttoreId: ins?.id ?? null,
      note: null,
      updatedAt: now,
      updatedBy: "import-pulizie",
    })
    existing.add(stableKey)
    added++
  }
  db.revisions = next
  return added
}

function summarize(events) {
  const by = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  for (const e of events) by[e.dow] += 1
  return ["dom", "lun", "mar", "mer", "gio", "ven", "sab"].map((k, i) => `${k}:${by[i]}`).join(" ")
}

function main() {
  const replace = process.argv.includes("--replace")
  const src = resolveXlsx()
  if (!src) {
    console.error(
      "[pulizie] File non trovato. Copialo in:\n  " +
        apiImportDir +
        "\noppure imposta PULIZIE_XLSX. Origine attesa:\n  \\\\ls220d3b7\\share\\societa\\CONDIVISA\\PULIZIE\\ORARIO SETT. PULIZIE.xlsx"
    )
    process.exit(1)
  }
  const xlsxPath = copyIntoImportDir(src)
  console.log("[pulizie] File:", xlsxPath)

  const wb = XLSX.readFile(xlsxPath, { cellDates: true, raw: false })
  const all = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false })
    dumpSheet(name, rows)
    const events = parseSheet(rows)
    console.log("[pulizie]", name, "→", events.length, "slot |", summarize(events))
    all.push(...events)
  }

  if (!all.length) {
    console.error("[pulizie] Nessun turno letto: controlla il dump delle prime righe e adatta il parser.")
    process.exit(1)
  }

  const dataDir = resolveDataDir()
  const dbPath = path.join(dataDir, "calendario-reparti.json")
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf8")) : { instructors: [], revisions: [] }
  db.revisions = Array.isArray(db.revisions) ? db.revisions : []
  db.instructors = Array.isArray(db.instructors) ? db.instructors : []
  const now = new Date().toISOString()
  const added = upsertWeekly(db, all, replace, now)
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8")
  console.log("[pulizie] Aggiunti:", added, "| totale", db.revisions.filter((r) => r.comparto === "pulizie").length)
  console.log("[pulizie] Salvato:", dbPath)
}

main()
