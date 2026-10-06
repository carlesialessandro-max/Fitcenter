/**
 * Importa orario desk (ottobre 2026.xlsx) e bagnini (INVERNALE 2026-2027.xlsx)
 * nel calendario FitCenter (reception + piscina), slot per giorno.
 *
 *   pnpm run import:desk-bagnini -- --replace
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
const importDir = path.join(webRoot, "data", "planning-import")

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

function normHeader(cell) {
  return String(cell ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
}

const DOW = {
  LUNEDI: 1,
  MARTEDI: 2,
  MERCOLEDI: 3,
  GIOVEDI: 4,
  VENERDI: 5,
  SABATO: 6,
  DOMENICA: 0,
}

function headerToDow(cell) {
  const h = normHeader(cell)
  if (!h) return null
  for (const [k, v] of Object.entries(DOW)) {
    if (h === k || h.startsWith(k + " ")) return v
  }
  return null
}

function cellToStart(v) {
  const t = String(v ?? "")
    .trim()
    .replace(",", ".")
  const m = t.match(/(\d{1,2})[.:](\d{2})/)
  if (m) return `${pad2(Math.min(23, Number(m[1])))}:${m[2]}`
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

function parseDeskSheet(sh, year, month) {
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
  const raw = []
  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri] || []
    const first = String(row[0] ?? "").trim()
    if (first && !parseRange(first) && !cellToStart(first) && isStaffName(first)) break
    let any = false
    for (const d of days) {
      const rng = parseRange(row[d.col])
      if (!rng) continue
      any = true
      for (let k = 1; k <= 3; k++) {
        const staff = String(row[d.col + k] ?? "").trim()
        if (!isStaffName(staff)) continue
        raw.push({ dateIso: d.dateIso, dow: d.dow, start: rng.start, end: rng.end, staff: staff.toUpperCase() })
      }
    }
    if (!any && ri > 8) {
      const joined = row.map((c) => String(c).trim()).join("")
      if (!joined) continue
    }
  }
  return mergeRuns(raw)
}

function parseDeskWorkbook(xlsxPath) {
  const { year, month } = deskYearMonthFromName(xlsxPath)
  const wb = XLSX.readFile(xlsxPath, { raw: false })
  const all = []
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    if (!sh) continue
    const events = parseDeskSheet(sh, year, month)
    if (events.length) {
      console.log("[desk]", name, "→", events.length, "slot")
      all.push(...events)
    }
  }
  return all
}

function rowSlotStart(row, timeCol, timeRightCol) {
  const tL = cellToStart(row[timeCol])
  const tR = cellToStart(row[timeRightCol])
  if (tL && tR) return hmToMin(tL) <= hmToMin(tR) ? tL : tR
  return tL ?? tR
}

function looksLikeStaffAbbrev(s) {
  const t = String(s ?? "").trim()
  if (t.length < 2 || t.length > 24) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return false
  if (headerToDow(t) != null) return false
  if (/SETTIMANA|TOTALE|TOT SETT/.test(t.toUpperCase())) return false
  return /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'\s-]*$/u.test(t)
}

function parseBagniniDayBlock(rows, timeCol, staffCol, timeRightCol, startRow) {
  const out = []
  let curStaff = null
  let curStart = null
  let lastTime = null
  let emptyRun = 0
  for (let ri = startRow; ri < rows.length; ri++) {
    const row = rows[ri] || []
    const joined = row.map((c) => String(c ?? "").toUpperCase()).join(" ")
    if (ri > startRow + 6 && /SETTIMANA|TOT SETT|TOTALE ORE/.test(joined)) break
    const t = rowSlotStart(row, timeCol, timeRightCol)
    const staffRaw = String(row[staffCol] ?? "").trim()
    const staff = looksLikeStaffAbbrev(staffRaw) ? staffRaw.toUpperCase() : ""
    if (staff) {
      if (curStaff && curStaff !== staff && curStart) {
        out.push({ start: curStart, end: t || addMin(lastTime || curStart, 30), staff: curStaff })
      }
      if (curStaff !== staff) {
        curStaff = staff
        curStart = t ?? lastTime ?? "07:00"
      }
      if (t) lastTime = t
      emptyRun = 0
    } else if (t && curStaff) {
      lastTime = t
      emptyRun = 0
    } else {
      emptyRun++
      if (emptyRun > 20) break
    }
  }
  if (curStaff && curStart) out.push({ start: curStart, end: addMin(lastTime || curStart, 30), staff: curStaff })
  return out
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

function parseBagniniWorkbook(xlsxPath) {
  const seasonStartYear = seasonYearFromName(xlsxPath)
  const wb = XLSX.readFile(xlsxPath, { raw: false })
  const all = []
  for (const name of wb.SheetNames) {
    if (/TURNAZIONE|FOGLIO2|ROBOT|IDROPULITRICE/i.test(name)) continue
    const monday = weekMondayFromSheet(name, seasonStartYear)
    if (!monday) {
      console.log("[bagnini] skip foglio", name)
      continue
    }
    const sh = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: false })
    let headerRow = -1
    const hits = []
    for (let r = 0; r < Math.min(8, rows.length); r++) {
      const row = rows[r] || []
      const found = []
      for (let c = 0; c < row.length; c++) {
        const dow = headerToDow(row[c])
        if (dow != null) found.push({ c, dow })
      }
      if (found.length > hits.length) {
        hits.length = 0
        hits.push(...found)
        headerRow = r
      }
    }
    if (headerRow < 0 || hits.length < 5) continue
    hits.sort((a, b) => a.c - b.c)
    const daySlots = []
    for (const h of hits) {
      const offset = h.dow === 0 ? 6 : h.dow - 1
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset)
      const parsed = parseBagniniDayBlock(rows, h.c, h.c + 1, h.c + 2, headerRow + 1)
      for (const s of parsed) {
        daySlots.push({ dateIso: ymd(date), dow: date.getDay(), start: s.start, end: s.end, staff: s.staff })
      }
    }
    if (daySlots.length) {
      console.log("[bagnini]", name, "→", daySlots.length, "slot", ymd(monday))
      all.push(...daySlots)
    }
  }
  return all
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
    next.push({
      comparto,
      stableKey,
      dow: e.dow,
      dateIso: e.dateIso,
      start: e.start,
      title: `${titlePrefix} · ${e.start}–${e.end}`,
      zona,
      staffOverride: e.staff,
      istruttoreId: null,
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

function main() {
  const replace = process.argv.includes("--replace")
  const deskPath = firstExisting([
    process.env.DESK_XLSX,
    "C:\\Users\\aless\\Downloads\\ottobre 2026.xlsx",
    path.join(importDir, "ottobre 2026.xlsx"),
    path.join(importDir, "OrarioReception.xlsx"),
  ])
  const bagPath = firstExisting([
    process.env.BAGNINI_XLSX,
    "C:\\Users\\aless\\Downloads\\INVERNALE 2026-2027.xlsx",
    path.join(importDir, "INVERNALE 2026-2027.xlsx"),
    path.join(importDir, "INVERNALE 2025-2026.xlsx"),
  ])

  const dataDir = resolveDataDir()
  const dbPath = path.join(dataDir, "calendario-reparti.json")
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, "utf8")) : { instructors: [], revisions: [] }
  db.revisions = Array.isArray(db.revisions) ? db.revisions : []
  db.instructors = Array.isArray(db.instructors) ? db.instructors : []
  const now = new Date().toISOString()

  if (deskPath) {
    console.log("[desk] File:", deskPath)
    const events = parseDeskWorkbook(deskPath)
    const added = upsertComparto(db, "reception", "reception", "Sportello", events, replace, now)
    const dates = events.map((e) => e.dateIso).sort()
    console.log("[desk] Aggiunti:", added, "| periodo", dates[0] ?? "—", "→", dates[dates.length - 1] ?? "—")
  } else {
    console.warn("[desk] File non trovato (DESK_XLSX o ottobre 2026.xlsx).")
  }

  if (bagPath) {
    console.log("[bagnini] File:", bagPath)
    const events = parseBagniniWorkbook(bagPath)
    const added = upsertComparto(db, "piscina", "invernale", "Copertura", events, replace, now)
    const dates = events.map((e) => e.dateIso).sort()
    console.log("[bagnini] Aggiunti:", added, "| periodo", dates[0] ?? "—", "→", dates[dates.length - 1] ?? "—")
  } else {
    console.warn("[bagnini] File non trovato (BAGNINI_XLSX o INVERNALE 2026-2027.xlsx).")
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8")
  console.log("[desk-bagnini] Salvato:", dbPath)
}

main()
