/**
 * Importa gli orari settimanali di acquaticità e spogliatoi nel calendario FitCenter.
 *
 *   pnpm run import:acquaticita-spogliatoi -- --replace
 *   ACQUATICITA_XLSX=... SPOGLIATOI_XLSX=...
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
  console.error("[acq-spo] Pacchetto xlsx non trovato.")
  process.exit(1)
}

const XLSX = loadXlsx()
const importDir = path.join(webRoot, "data", "planning-import")
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

function findDownload(prefix) {
  try {
    const names = fs.readdirSync(downloads)
    const hit = names.find((n) => n.toLowerCase().startsWith(prefix.toLowerCase()) && n.toLowerCase().endsWith(".xlsx"))
    return hit ? path.join(downloads, hit) : null
  } catch {
    return null
  }
}

function norm(s) {
  return String(s ?? "")
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

function rowDow(row) {
  const h = norm(row[0]).replace(/['’`]/g, "")
  if (!h) return null
  for (const [key, dow] of Object.entries(HEADER_TO_DOW)) {
    if (h === key || h.startsWith(key)) return dow
  }
  return null
}

function cellToStart(v) {
  const t = String(v ?? "")
    .trim()
    .replace(",", ".")
  if (!t || t === ".") return null
  const m = t.match(/^(\d{1,2})[.:](\d{2})$/)
  if (m) return `${pad2(Math.min(23, Number(m[1])))}:${m[2]}`
  return null
}

function looksLikeDate(s) {
  const t = String(s ?? "").trim()
  return /^\d{1,2}[-/]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|[A-Za-z]{3,})/i.test(t) || /^\d{1,2}[-/]\d{1,2}/.test(t)
}

function isSkipStaff(s) {
  const t = String(s ?? "").trim()
  if (!t || t === "?" || t === "-" || t === ".") return true
  const u = norm(t)
  if (!u) return true
  if (u.includes("GIRARE") || u.includes("DISPONIBILITA") || u.startsWith("SPOGLIATOIO")) return true
  if (u === "AQ" || /^AQ\s*\d+$/.test(u) || /^AQ\d+$/.test(u.replace(/\s/g, ""))) return true
  if (looksLikeDate(t)) return true
  if (u.length < 3) return true
  return false
}

function isLaneAcq(cell) {
  const n = norm(cell)
  if (!n) return false
  if (/^[A-F]$/.test(n)) return true
  if (n === "AQ") return true
  return /^AQ\s*\d+$/.test(n) || /^AQ\d+$/.test(n.replace(/\s/g, ""))
}

function isLaneSpo(cell) {
  const n = norm(cell)
  return n.includes("SPOGLIATOIO") || n === "M" || n === "F" || /^B\d?$/.test(n)
}

function prettyTitle(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[A-Za-zÀ-ÿ]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

function titleLane(comparto, raw, _colIndex, seen) {
  let t = String(raw ?? "").trim()
  if (comparto === "acquaticita") {
    const n = norm(t).replace(/\s+/g, "")
    if (n === "AQ") t = "AQ"
    else if (/^AQ\d+$/.test(n)) t = `AQ ${n.slice(2)}`
    else if (/^[A-F]$/.test(norm(t))) t = `Corsia ${norm(t)}`
    return t || "Acquaticità"
  }
  if (!t) t = "Spogliatoio"
  t = prettyTitle(t)
  const key = norm(t)
  const n = (seen.get(key) ?? 0) + 1
  seen.set(key, n)
  if (n > 1 && /B$/i.test(key)) return `${t} ${n}`
  return t
}

function matchIstruttore(instructors, abbrev) {
  const a = norm(abbrev)
  if (a.length < 3) return null
  const hits = []
  for (const i of instructors) {
    const cog = norm(i.cognome ?? "")
    const nom = norm(i.nome ?? "")
    const full = `${cog} ${nom}`.trim()
    let score = 0
    if (cog === a || nom === a || full === a) score = 100
    else if (cog.startsWith(a) || a.startsWith(cog)) score = 40 + Math.min(a.length, cog.length)
    else if (nom.startsWith(a)) score = 30 + a.length
    else if (full.startsWith(a) || a.startsWith(full.split(" ")[0])) score = 20 + a.length
    if (score) hits.push({ i, score })
  }
  hits.sort((x, y) => y.score - x.score)
  if (!hits.length) return null
  if (hits.length > 1 && hits[0].score === hits[1].score) return null
  if (hits[0].score < 33) return null
  return hits[0].i
}

function parseWeeklyGrid(rows, comparto) {
  const events = []
  let dow = null
  /** @type {string[]} */
  let labels = []
  const maxCol = 5

  for (const row of rows) {
    const r = row || []
    const dHit = rowDow(r)
    if (dHit !== null) {
      dow = dHit
      labels = []
      continue
    }
    if (dow == null) continue

    const start = cellToStart(r[0])
    const maybeLane = !start && r.slice(1, maxCol).some((c) => (comparto === "acquaticita" ? isLaneAcq(c) : isLaneSpo(c)))
    if (maybeLane) {
      labels = []
      const seen = new Map()
      for (let c = 1; c < maxCol && c < r.length; c++) {
        const raw = String(r[c] ?? "").trim()
        if (!raw) {
          labels[c] = ""
          continue
        }
        if (comparto === "acquaticita" && !isLaneAcq(raw)) break
        if (comparto === "spogliatoi" && !isLaneSpo(raw)) break
        labels[c] = titleLane(comparto, raw, c, seen)
      }
      continue
    }

    if (!start) continue
    for (let c = 1; c < maxCol && c < r.length; c++) {
      const staff = String(r[c] ?? "").trim()
      if (isSkipStaff(staff)) continue
      const title = labels[c] || (comparto === "acquaticita" ? "Acquaticità" : "Spogliatoio")
      events.push({ dow, start, title, staff })
    }
  }
  return events
}

function upsertWeekly(db, comparto, events, replace, now) {
  const kept = replace ? db.revisions.filter((r) => r.comparto !== comparto) : db.revisions
  const existing = new Set(kept.filter((r) => r.comparto === comparto).map((r) => r.stableKey))
  let added = 0
  const next = [...kept]
  for (const e of events) {
    const stableKey = `${comparto}|${e.dow}|${e.start}|${e.title}|${e.staff}`
    if (existing.has(stableKey)) continue
    const ins = matchIstruttore(db.instructors, e.staff)
    next.push({
      comparto,
      stableKey,
      dow: e.dow,
      dateIso: null,
      start: e.start,
      title: e.title,
      zona: comparto,
      staffOverride: ins ? `${ins.cognome} ${ins.nome}`.trim() : e.staff,
      istruttoreId: ins?.id ?? null,
      note: null,
      updatedAt: now,
      updatedBy: "import-acquaticita-spogliatoi",
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
  const acqPath = firstExisting([
    process.env.ACQUATICITA_XLSX,
    findDownload("ORARIO 2026-27 acquatic"),
    path.join(importDir, "ORARIO 2026-27 acquaticità.xlsx"),
  ])
  const spoPath = firstExisting([
    process.env.SPOGLIATOI_XLSX,
    findDownload("ORARIO 2026-27 spogliatoi"),
    path.join(importDir, "ORARIO 2026-27 spogliatoi.xlsx"),
  ])

  const dataDir = resolveDataDir()
  const dbPath = path.join(dataDir, "calendario-reparti.json")
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf8")) : { instructors: [], revisions: [] }
  db.revisions = Array.isArray(db.revisions) ? db.revisions : []
  db.instructors = Array.isArray(db.instructors) ? db.instructors : []
  const now = new Date().toISOString()

  if (acqPath) {
    console.log("[acquaticita] File:", acqPath)
    const wb = XLSX.readFile(acqPath, { cellDates: false, raw: false })
    const all = []
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false })
      const events = parseWeeklyGrid(rows, "acquaticita")
      console.log("[acquaticita]", name, "→", events.length, "slot |", summarize(events))
      all.push(...events)
    }
    const added = upsertWeekly(db, "acquaticita", all, replace, now)
    console.log("[acquaticita] Aggiunti:", added, "| totale", db.revisions.filter((r) => r.comparto === "acquaticita").length)
  } else {
    console.warn("[acquaticita] File non trovato (ACQUATICITA_XLSX).")
  }

  if (spoPath) {
    console.log("[spogliatoi] File:", spoPath)
    const wb = XLSX.readFile(spoPath, { cellDates: false, raw: false })
    const all = []
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false })
      const events = parseWeeklyGrid(rows, "spogliatoi")
      console.log("[spogliatoi]", name, "→", events.length, "slot |", summarize(events))
      all.push(...events)
    }
    const added = upsertWeekly(db, "spogliatoi", all, replace, now)
    console.log("[spogliatoi] Aggiunti:", added, "| totale", db.revisions.filter((r) => r.comparto === "spogliatoi").length)
  } else {
    console.warn("[spogliatoi] File non trovato (SPOGLIATOI_XLSX).")
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8")
  console.log("[acq-spo] Salvato:", dbPath)
}

main()
