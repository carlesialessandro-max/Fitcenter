/**
 * Parsing poster PDF corsi terra/acqua + Excel scuola nuoto adulti (sostituisce TRAINER).
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)

function loadXlsx() {
  const tryPaths = [
    () => require("xlsx"),
    () => require(path.join(webRoot, "node_modules", "xlsx")),
    () => require(path.join(webRoot, "..", "node_modules", "xlsx")),
  ]
  for (const fn of tryPaths) {
    try {
      const m = fn()
      if (m) return m
    } catch {
      /* next */
    }
  }
  throw new Error("xlsx non trovato")
}

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

function hmFromText(text) {
  const matches = [...String(text).matchAll(/(\d{1,2})[.:](\d{2})/g)]
  if (!matches.length) return null
  const m = matches[matches.length - 1]
  const hh = Math.min(23, Math.max(0, Number(m[1])))
  const mm = Math.min(59, Math.max(0, Number(m[2])))
  return `${pad2(hh)}:${pad2(mm)}`
}

function extractStaff(text) {
  const m = String(text).match(/\(([^)]*)\)\s*$/)
  if (!m) return ""
  return String(m[1] ?? "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim()
    .toUpperCase()
}

function cleanTitle(text, timeHm) {
  let s = String(text)
    .replace(/cod\.?\s*/gi, " ")
    .replace(/\b\d{2}-?\s*\d{3}\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (timeHm) {
    const re = new RegExp(`\\s*${timeHm.replace(":", "[.:]")}\\s*`, "gi")
    s = s.replace(re, " ").replace(/\s+/g, " ").trim()
  }
  s = s.replace(/\s+\d{1,2}[.:]\d{2}\s*/g, " ").replace(/\s+/g, " ").trim()
  s = s.replace(/\b(111|280)\b/g, " ").replace(/\s+/g, " ").trim()
  return s.slice(0, 120)
}

function isNoise(text) {
  const u = String(text)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  if (!u || u.length < 3) return true
  if (/^PLANNING CORSI/.test(u)) return true
  if (/^LUNEDI|^MARTEDI|^MERCOLEDI|^GIOVEDI|^VENERDI|^SABATO|^DOMENICA$/.test(u)) return true
  if (/^SALA (ORANGE|GREY|DANZA)/.test(u)) return true
  if (/^CORSO FITNESS VASCA/.test(u)) return true
  if (/^RIF\.?DELIBERA/.test(u)) return true
  if (/^PILLOLA 20 MIN$/.test(u)) return true
  if (/^CARDIO$|^OLISTICO$|^COREOGRAFICO$|^TONIFICAZIONE$/.test(u) && u.length < 16) return false
  return false
}

function eventId(zona, sheet, dow, start, title, staff) {
  const raw = `${zona}|${sheet}|${dow}|${start}|${title}|${staff}`
  const h = createHash("sha1").update(raw).digest("hex").slice(0, 8)
  return `${zona}-${sheet}-${dow}-${start}-${title}-${h}`.replace(/\s+/g, "_").slice(0, 180)
}

async function pdfItems(fp) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const buf = new Uint8Array(fs.readFileSync(fp))
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const page = await doc.getPage(1)
  const tc = await page.getTextContent()
  return tc.items
    .map((it) => {
      const t = it.transform
      return { x: t[4], y: t[5], s: String(it.str ?? "").replace(/\s+/g, " ").trim() }
    })
    .filter((i) => i.s)
}

function dayHeaders(items) {
  const found = []
  for (const it of items) {
    const dow = HEADER_TO_DOW[normDayHeader(it.s)]
    if (dow === undefined) continue
    if (it.s.length > 12) continue
    found.push({ dow, x: it.x, y: it.y })
  }
  found.sort((a, b) => a.x - b.x)
  const byDow = new Map()
  for (const h of found) {
    if (!byDow.has(h.dow)) byDow.set(h.dow, h)
  }
  return [...byDow.values()].sort((a, b) => a.x - b.x)
}

function assignDow(x, headers, text = "") {
  if (!headers.length) return null
  const minX = Math.min(...headers.map((h) => h.x))
  const looksCourse = /[A-Za-zÀ-ÿ]{4,}/.test(text) && !/^\d{1,2}[.:]\d{2}\s*$/.test(text.trim())
  if (x < minX - 55) {
    if (looksCourse) return headers[0].dow
    return null
  }
  let best = headers[0]
  let bestD = Math.abs(x - best.x)
  for (const h of headers) {
    const d = Math.abs(x - h.x)
    if (d < bestD) {
      best = h
      bestD = d
    }
  }
  return best.dow
}

function parsePdfCorsi(items, zona, sheet, legendYMax) {
  const headers = dayHeaders(items)
  const headerY = headers[0]?.y ?? 9999
  const inCol = items.filter((it) => {
    if (it.y > headerY - 8) return false
    if (it.y < legendYMax) return false
    const dow = assignDow(it.x, headers, it.s)
    if (dow == null) return false
    if (isNoise(it.s) && !extractStaff(it.s) && !hmFromText(it.s)) return false
    return true
  })

  /** @type {Map<number, { y: number; parts: string[] }[]>} */
  const byDow = new Map()
  const sorted = [...inCol].sort((a, b) => b.y - a.y || a.x - b.x)
  for (const it of sorted) {
    const dow = assignDow(it.x, headers, it.s)
    if (dow == null) continue
    const list = byDow.get(dow) ?? []
    const last = list[list.length - 1]
    if (last && Math.abs(last.y - it.y) <= 14) {
      last.parts.push(it.s)
      last.y = (last.y + it.y) / 2
    } else {
      list.push({ y: it.y, parts: [it.s] })
    }
    byDow.set(dow, list)
  }

  const events = []
  for (const [dow, clusters] of byDow) {
    clusters.sort((a, b) => b.y - a.y)
    for (const c of clusters) {
      const blob = c.parts.join(" ").replace(/\s+/g, " ").trim()
      if (isNoise(blob) && !extractStaff(blob)) continue
      if (/^cod\.?\s*[\d.\-]*$/i.test(blob)) continue
      const staff = extractStaff(blob)
      const start = hmFromText(blob)
      if (!start) continue
      const title = cleanTitle(blob, start)
      if (!title || title.length < 3) continue
      if (/^(CARDIO|OLISTICO|COREOGRAFICO|FUNZIONALE|GABBIA)$/i.test(title) && c.y < legendYMax + 40) continue
      events.push({
        id: eventId(zona, sheet, dow, start, title, staff),
        zona,
        sheet,
        dow,
        start,
        title,
        staff: staff || "TRAINER",
      })
    }
  }
  return events
}

function parseExcelNuotoAdulti(xlsxPath) {
  const XLSX = loadXlsx()
  const wb = XLSX.readFile(xlsxPath)
  const sheetName = wb.SheetNames.find((n) => /AGO|2026|ADULTI|DAL/i.test(n) && !/estiv/i.test(n)) ?? wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" })
  let headerIdx = -1
  /** @type {{ col: number; dow: number }[]} */
  let dayCols = []
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const found = []
    const row = rows[i] || []
    for (let j = 0; j < row.length; j++) {
      const dow = HEADER_TO_DOW[normDayHeader(row[j])]
      if (dow !== undefined) found.push({ col: j, dow })
    }
    if (found.length >= 4) {
      headerIdx = i
      dayCols = found
      break
    }
  }
  if (headerIdx < 0) return []

  const events = []
  let lastTime = null
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const a0 = String(row[0] ?? "").trim()
    const t0 = hmFromText(a0)
    if (t0 && a0.length <= 6) lastTime = t0
    if (!lastTime) continue
    for (const { col, dow } of dayCols) {
      const cell = String(row[col] ?? "").replace(/\s+/g, " ").trim()
      if (!cell || cell.length < 8) continue
      if (!/nuoto/i.test(cell)) continue
      const staff = extractStaff(cell)
      if (!staff) continue
      let title = cleanTitle(cell, lastTime)
      title = title.replace(/\bINTEMEDIO\b/gi, "INTERMEDIO")
      if (!/NUOTO\s+ADULTI/i.test(title)) title = `NUOTO ADULTI ${title}`.trim()
      events.push({
        id: eventId("acqua", "SCUOLA NUOTO ADULTI", dow, lastTime, title, staff),
        zona: "acqua",
        sheet: "SCUOLA NUOTO ADULTI",
        dow,
        start: lastTime,
        title,
        staff,
      })
    }
  }
  return collapseSameStaffNuoto(events)
}

function collapseSameStaffNuoto(events) {
  /** @type {Map<string, typeof events>} */
  const g = new Map()
  for (const e of events) {
    const k = `${e.dow}|${e.start}|${e.staff}`
    const list = g.get(k) ?? []
    list.push(e)
    g.set(k, list)
  }
  const out = []
  for (const list of g.values()) {
    const levels = [
      ...new Set(
        list
          .map((e) => {
            const m = String(e.title).match(/\b(START|PRINCIPIANTI|INTERMEDIO|AVANZATO)\b/i)
            return m ? m[1].toUpperCase() : ""
          })
          .filter(Boolean)
      ),
    ]
    const order = ["START", "PRINCIPIANTI", "INTERMEDIO", "AVANZATO"]
    levels.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    const base = list[0]
    const title =
      levels.length <= 1
        ? levels[0]
          ? `NUOTO ADULTI ${levels[0]}`
          : "NUOTO ADULTI"
        : levels.length >= 3
          ? "NUOTO ADULTI"
          : `NUOTO ADULTI ${levels.join("/")}`
    out.push({
      ...base,
      title,
      id: eventId(base.zona, base.sheet, base.dow, base.start, title, base.staff),
    })
  }
  return out
}

export async function buildCorsiFromPdfAndExcel({ terraPdf, acquaPdf, nuotoXlsx }) {
  const terraItems = await pdfItems(terraPdf)
  const acquaItems = await pdfItems(acquaPdf)
  const terra = parsePdfCorsi(terraItems, "terra", "DAL 14 SETTEMBRE 2026", 205)
  const acquaPdfEvents = parsePdfCorsi(acquaItems, "acqua", "DAL 14 SETTEMBRE 2026", 118)
  const acquaSenzaNuotoAdulti = acquaPdfEvents.filter((e) => !/nuoto\s+adulti/i.test(e.title))
  const nuoto = fs.existsSync(nuotoXlsx) ? parseExcelNuotoAdulti(nuotoXlsx) : []
  const all = [...terra, ...acquaSenzaNuotoAdulti, ...nuoto]
  const seen = new Set()
  const out = []
  for (const e of all) {
    const k = `${e.zona}|${e.dow}|${e.start}|${e.title}|${e.staff}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  const order = (d) => (d === 0 ? 7 : d)
  out.sort((a, b) => order(a.dow) - order(b.dow) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
  return { terra: terra.length, acquaPdf: acquaPdfEvents.length, nuoto: nuoto.length, events: out }
}
