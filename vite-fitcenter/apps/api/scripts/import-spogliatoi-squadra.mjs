/**
 * Importa orari 2027 spogliatoi (assistenza) e squadra.
 *
 *   pnpm --filter api run import:spogliatoi-squadra -- --replace
 *   SPOGLIATOI_XLSX=... SQUADRA_XLSX=...
 *
 * Scrive anche JSON bundled in src/planning/ (usati dal server se il DB è vuoto).
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
  console.error("[spo-sq] Pacchetto xlsx non trovato.")
  process.exit(1)
}

const XLSX = loadXlsx()
const downloads = "C:\\Users\\aless\\Downloads"
const bundledDir = path.join(apiRoot, "src", "planning")

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

function prettyTitle(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[A-Za-zÀ-ÿ]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

function hm(h, m) {
  return `${pad2(Math.min(23, Number(h)))}:${pad2(Number(m))}`
}

function cellToStart(v) {
  const t = String(v ?? "")
    .trim()
    .replace(",", ".")
  if (!t || t === ".") return null
  const m = t.match(/^(\d{1,2})[.:](\d{2})$/)
  if (m) return hm(m[1], m[2])
  return null
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
  if (looksLikeDate(t)) return true
  if (u.length < 3) return true
  return false
}

function isLaneSpo(cell) {
  const n = norm(cell)
  return n.includes("SPOGLIATOIO") || n === "M" || n === "F" || /^B\d?$/.test(n)
}

function titleLaneSpo(raw, seen) {
  let t = prettyTitle(raw) || "Spogliatoio"
  const key = norm(t)
  const n = (seen.get(key) ?? 0) + 1
  seen.set(key, n)
  if (n > 1 && /B$/i.test(key)) return `${t} ${n}`
  return t
}

function parseSpogliatoi(rows) {
  const events = []
  let dow = null
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
    const maybeLane = !start && r.slice(1, maxCol).some((c) => isLaneSpo(c))
    if (maybeLane) {
      labels = []
      const seen = new Map()
      for (let c = 1; c < maxCol && c < r.length; c++) {
        const raw = String(r[c] ?? "").trim()
        if (!raw) {
          labels[c] = ""
          continue
        }
        if (!isLaneSpo(raw)) break
        labels[c] = titleLaneSpo(raw, seen)
      }
      continue
    }
    if (!start) continue
    for (let c = 1; c < maxCol && c < r.length; c++) {
      const staff = String(r[c] ?? "").trim()
      if (isSkipStaff(staff)) continue
      events.push({ dow, start, title: labels[c] || "Spogliatoio", staff })
    }
  }
  return events
}

const DAY_NAME_TO_DOW = {
  LUNEDI: 1,
  MARTEDI: 2,
  MERCOLEDI: 3,
  GIOVEDI: 4,
  VENERDI: 5,
  SABATO: 6,
  DOMENICA: 0,
}

function parseDayTime(s) {
  const t = String(s ?? "").trim()
  if (!t) return null
  const n = norm(t).replace(/['’`]/g, "")
  const m = n.match(
    /^(LUNEDI|MARTEDI|MERCOLEDI|GIOVEDI|VENERDI|SABATO|DOMENICA)\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/
  )
  if (!m) return null
  const dow = DAY_NAME_TO_DOW[m[1]]
  if (dow == null) return null
  return { dow, start: hm(m[2], m[3]), end: hm(m[4], m[5]) }
}

function parseTimeRangeExtra(s) {
  const t = String(s ?? "").trim()
  if (!t) return null
  const m = t.match(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})(?:\s*\(([^)]+)\))?/)
  if (!m) return null
  const extra = prettyTitle(m[5] ?? "") || "Palestra"
  return { start: hm(m[1], m[2]), end: hm(m[3], m[4]), extra }
}

function parseMd(s) {
  const t = String(s ?? "").trim()
  const m = t.match(/(\d{1,2})\s*[-/]\s*(\d{1,2})/)
  if (!m) return null
  return `${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`
}

function splitTrainers(s) {
  return String(s ?? "")
    .split("/")
    .map((x) => x.trim())
    .filter((x) => x && x !== "-" && x !== "?")
}

function isGroupName(s) {
  const n = norm(s)
  if (!n) return false
  if (DAY_NAME_TO_DOW[n.split(" ")[0]]) return false
  if (n.startsWith("INIZIO") || n.startsWith("FINE")) return false
  if (n.includes("ALLENAMENT")) return false
  if (n === "ABBONAMENTO" || n === "RATE" || n === "ALLENATORI" || n === "STAGIONE") return false
  return n.length >= 4
}

function parseSquadra(rows) {
  const groups = []
  let cur = null
  const flush = () => {
    if (cur) groups.push(cur)
    cur = null
  }
  for (const row of rows) {
    const r = row || []
    const c0 = String(r[0] ?? "").trim()
    const c1 = String(r[1] ?? "").trim()
    const c2 = String(r[2] ?? "").trim()
    const c3 = String(r[3] ?? "").trim()
    const c6 = String(r[6] ?? "").trim()
    const c7 = String(r[7] ?? "").trim()
    const groupCell = isGroupName(c1) ? c1 : isGroupName(c0) ? c0 : ""
    if (groupCell) {
      flush()
      cur = {
        group: prettyTitle(groupCell),
        trainers: splitTrainers(c6),
        from: /inizio/i.test(c7) ? parseMd(c7) : null,
        to: /fine/i.test(c7) ? parseMd(c7) : null,
        slots: [],
      }
    }
    if (!cur) continue
    if (c6) {
      const extraTr = splitTrainers(c6)
      if (extraTr.length) cur.trainers = extraTr
    }
    if (/inizio/i.test(c7)) cur.from = parseMd(c7) ?? cur.from
    if (/fine/i.test(c7)) cur.to = parseMd(c7) ?? cur.to
    const acqua = parseDayTime(c2)
    const palestra = parseTimeRangeExtra(c3)
    if (acqua) cur.slots.push({ acqua, palestra })
  }
  flush()
  const events = []
  for (const g of groups) {
    const seasonal = g.from && g.to ? { from: g.from, to: g.to } : undefined
    const staffList = g.trainers.length ? g.trainers : ["—"]
    for (const slot of g.slots) {
      for (const staff of staffList) {
        events.push({
          dow: slot.acqua.dow,
          start: slot.acqua.start,
          title: `${slot.acqua.start}–${slot.acqua.end} · ${g.group}`,
          staff,
          ...(seasonal ? { seasonal } : {}),
        })
        if (slot.palestra) {
          events.push({
            dow: slot.acqua.dow,
            start: slot.palestra.start,
            title: `${slot.palestra.start}–${slot.palestra.end} · ${g.group} · ${slot.palestra.extra}`,
            staff,
            ...(seasonal ? { seasonal } : {}),
          })
        }
      }
    }
  }
  return events
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
    else if (nom.startsWith(a) || a.startsWith(nom)) score = 35 + Math.min(a.length, nom.length)
    else if (full.startsWith(a) || a.startsWith(full.split(" ")[0])) score = 20 + a.length
    if (score) hits.push({ i, score })
  }
  hits.sort((x, y) => y.score - x.score)
  if (!hits.length) return null
  if (hits.length > 1 && hits[0].score === hits[1].score) return null
  if (hits[0].score < 33) return null
  return hits[0].i
}

function upsertWeekly(db, comparto, events, replace, now) {
  const kept = replace
    ? db.revisions.filter((r) => r.comparto !== comparto || String(r.stableKey ?? "").startsWith("manual-"))
    : db.revisions
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
      ...(e.seasonal ? { seasonal: e.seasonal } : {}),
      start: e.start,
      title: e.title,
      zona: comparto,
      staffOverride: ins ? `${ins.cognome} ${ins.nome}`.trim() : e.staff,
      istruttoreId: ins?.id ?? null,
      note: null,
      updatedAt: now,
      updatedBy: "import-spogliatoi-squadra",
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

function writeBundled(name, events) {
  fs.mkdirSync(bundledDir, { recursive: true })
  const dest = path.join(bundledDir, name)
  fs.writeFileSync(dest, `${JSON.stringify(events, null, 2)}\n`, "utf8")
  console.log("[bundled]", dest, events.length)
}

function main() {
  const replace = process.argv.includes("--replace")
  const spoPath = firstExisting([
    process.env.SPOGLIATOI_XLSX,
    findDownload("orario spogliatoi"),
    findDownload("ORARIO 2026-27 spogliatoi"),
    path.join(apiRoot, "data", "planning-import", "orario-spogliatoi-2027.xlsx"),
  ])
  const sqPath = firstExisting([
    process.env.SQUADRA_XLSX,
    findDownload("orario squadra"),
    path.join(apiRoot, "data", "planning-import", "orario-squadra-2027.xlsx"),
  ])

  const dataDir = resolveDataDir()
  const dbPath = path.join(dataDir, "calendario-reparti.json")
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf8")) : { instructors: [], revisions: [] }
  db.revisions = Array.isArray(db.revisions) ? db.revisions : []
  db.instructors = Array.isArray(db.instructors) ? db.instructors : []
  const now = new Date().toISOString()

  if (spoPath) {
    console.log("[spogliatoi] File:", spoPath)
    const wb = XLSX.readFile(spoPath, { cellDates: false, raw: false })
    const all = []
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false })
      const events = parseSpogliatoi(rows)
      console.log("[spogliatoi]", name, "→", events.length, "slot |", summarize(events))
      all.push(...events)
    }
    writeBundled("spogliatoi-weekly.json", all)
    const added = upsertWeekly(db, "spogliatoi", all, replace, now)
    console.log("[spogliatoi] Aggiunti:", added, "| totale", db.revisions.filter((r) => r.comparto === "spogliatoi").length)
  } else {
    console.warn("[spogliatoi] File non trovato.")
  }

  if (sqPath) {
    console.log("[squadra] File:", sqPath)
    const wb = XLSX.readFile(sqPath, { cellDates: false, raw: false })
    const all = []
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false })
      const events = parseSquadra(rows)
      console.log("[squadra]", name, "→", events.length, "slot |", summarize(events))
      all.push(...events)
    }
    writeBundled("squadra-weekly.json", all)
    const added = upsertWeekly(db, "squadra", all, replace, now)
    console.log("[squadra] Aggiunti:", added, "| totale", db.revisions.filter((r) => r.comparto === "squadra").length)
  } else {
    console.warn("[squadra] File non trovato.")
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8")
  console.log("[spo-sq] Salvato:", dbPath)
}

main()
