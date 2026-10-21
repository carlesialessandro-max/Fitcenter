import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Request, Response } from "express"
import crypto from "node:crypto"
import type { User } from "../store/auth.js"
import type {
  CalendarioBaseEvent,
  CalendarioComparto,
  CalendarioDb,
  CalendarioIstruttore,
  CalendarioMergedEvent,
  CalendarioSlotRevision,
} from "../types/calendario.js"
import {
  deleteInstructor,
  deleteRevision,
  readCalendarioDb,
  stableKeyFromParts,
  upsertInstructor,
  upsertRevision,
  writeCalendarioDb,
} from "../store/calendario-db.js"
import { isSmtpConfigured, sendMail } from "../services/mailer.js"

const COMPARTI: CalendarioComparto[] = [
  "corsi",
  "scuola_nuoto",
  "piscina",
  "reception",
  "danza",
  "campus",
  "sala_fitness",
  "acquaticita",
  "spogliatoi",
  "pulizie",
  "consulenti",
]

function isComparto(s: string): s is CalendarioComparto {
  return (COMPARTI as string[]).includes(s)
}

function canReadComparto(u: User, comparto: CalendarioComparto): boolean {
  if (u.role === "admin") return true
  if (u.role === "calendari") return comparto !== "consulenti"
  if (comparto === "corsi") return u.role === "corsi" || u.role === "istruttore"
  if (comparto === "scuola_nuoto") return u.role === "scuola_nuoto"
  if (comparto === "piscina") return u.role === "bagnini"
  if (comparto === "acquaticita" || comparto === "spogliatoi" || comparto === "pulizie") return false
  if (comparto === "danza") return u.role === "danza"
  if (comparto === "campus") return u.role === "campus"
  if (comparto === "reception") return u.role === "operatore" || u.role === "firme"
  if (comparto === "sala_fitness" || comparto === "consulenti") return false
  return false
}

function canWriteComparto(u: User, comparto: CalendarioComparto): boolean {
  if (u.role === "admin") return true
  if (u.role === "calendari") return comparto !== "consulenti"
  return false
}

function canManageInstructors(u: User): boolean {
  return u.role === "admin" || u.role === "calendari"
}

function planningJsonCandidates(): string[] {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return [
    path.join(__dirname, "../../../web/src/data/planning-weekly.json"),
    path.join(process.cwd(), "apps/web/src/data/planning-weekly.json"),
    path.join(process.cwd(), "vite-fitcenter/apps/web/src/data/planning-weekly.json"),
    path.join(process.cwd(), "web/src/data/planning-weekly.json"),
  ]
}

function loadPlanningJson(): {
  events?: CalendarioBaseEvent[]
  eventsByComparto?: Partial<Record<CalendarioComparto, CalendarioBaseEvent[]>>
} | null {
  for (const p of planningJsonCandidates()) {
    try {
      if (!existsSync(p)) continue
      const raw = readFileSync(p, "utf8")
      return JSON.parse(raw) as {
        events?: CalendarioBaseEvent[]
        eventsByComparto?: Partial<Record<CalendarioComparto, CalendarioBaseEvent[]>>
      }
    } catch {
      /* continue */
    }
  }
  return null
}

function baseEventsForComparto(comparto: CalendarioComparto): CalendarioBaseEvent[] {
  const j = loadPlanningJson()
  if (!j) return []
  if (comparto === "corsi") return j.events ?? []
  const rows = j.eventsByComparto?.[comparto] ?? []
  if (comparto === "scuola_nuoto") return rows.filter((e) => !isGhostScuolaNuoto(e))
  return rows
}

const MANUAL_ONLY_COMPARTI: CalendarioComparto[] = ["reception", "piscina", "acquaticita", "spogliatoi", "pulizie"]

/** PISCINAORARIO (S.N. Bambini): import una tantum, poi solo calendario-reparti.json. */
const SERVER_SEEDED_COMPARTI: CalendarioComparto[] = ["scuola_nuoto", "sala_fitness"]

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isoYmdFromDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function normalizeHm(raw: string): string {
  const m = String(raw ?? "")
    .trim()
    .match(/^(\d{1,2})[:.](\d{2})/)
  if (!m) return String(raw ?? "").trim()
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || h > 23 || !Number.isFinite(min) || min > 59) return String(raw ?? "").trim()
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

function hmToMin(raw: string): number | null {
  const n = normalizeHm(raw)
  const m = /^(\d{2}):(\d{2})$/.exec(n)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function minToHm(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

function shiftRangeFromEvent(e: { start: string; title: string }): { sm: number; em: number } {
  const title = String(e.title ?? "")
  const re = /(\d{1,2})[:.](\d{2})\s*[–\-−—]\s*(\d{1,2})[:.](\d{2})/g
  let last: { sm: number; em: number } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(title))) {
    const sm = Number(m[1]) * 60 + Number(m[2])
    const em = Number(m[3]) * 60 + Number(m[4])
    if (Number.isFinite(sm) && Number.isFinite(em) && em > sm) last = { sm, em }
  }
  if (last) return last
  const sm = hmToMin(e.start) ?? 8 * 60
  return { sm, em: sm + 30 }
}

function activityFromShiftTitle(title: string): string {
  const t = String(title ?? "").trim()
  const cut = t.search(/\d{1,2}[:.]\d{2}/)
  const raw = (cut > 0 ? t.slice(0, cut) : t).replace(/[·•.\-–—]+\s*$/, "").trim()
  return raw || "Sala pesi"
}

/** Unisce fette Excel da 30 minuti (anche con buco 08:00 / 09:00) nello stesso giorno e persona. */
function coalesceSalaFitnessShifts(events: CalendarioMergedEvent[]): CalendarioMergedEvent[] {
  const byLane = new Map<string, CalendarioMergedEvent[]>()
  for (const e of events) {
    const staff = String(e.staffOverride ?? e.staff ?? "")
      .trim()
      .toLowerCase()
    const day = String(e.dateIso ?? "").trim() || `dow:${e.dow}`
    const key = `${day}|${staff}`
    const list = byLane.get(key)
    if (list) list.push(e)
    else byLane.set(key, [e])
  }
  const out: CalendarioMergedEvent[] = []
  for (const list of byLane.values()) {
    const sorted = [...list].sort((a, b) => shiftRangeFromEvent(a).sm - shiftRangeFromEvent(b).sm)
    const merged: CalendarioMergedEvent[] = []
    for (const e of sorted) {
      const r = shiftRangeFromEvent(e)
      const last = merged[merged.length - 1]
      if (!last) {
        merged.push({ ...e, mergedStableKeys: e.mergedStableKeys ?? [e.stableKey] })
        continue
      }
      const lr = shiftRangeFromEvent(last)
      if (r.sm <= lr.em + 30) {
        const sm = Math.min(lr.sm, r.sm)
        const em = Math.max(lr.em, r.em)
        const start = minToHm(sm)
        const end = minToHm(em)
        const keys = [...new Set([...(last.mergedStableKeys ?? [last.stableKey]), ...(e.mergedStableKeys ?? [e.stableKey])])]
        last.start = start
        last.title = `${activityFromShiftTitle(last.title)} · ${start}–${end}`
        last.mergedStableKeys = keys
        continue
      }
      merged.push({ ...e, mergedStableKeys: e.mergedStableKeys ?? [e.stableKey] })
    }
    out.push(...merged)
  }
  return out
}

function shiftRangeStartForSort(e: { start: string; title: string }): string {
  const re = /(\d{1,2})[:.](\d{2})\s*[–\-−—]\s*(\d{1,2})[:.](\d{2})/g
  let last: string | null = null
  let m: RegExpExecArray | null
  const title = String(e.title ?? "")
  while ((m = re.exec(title))) {
    last = `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`
  }
  return last ?? normalizeHm(e.start)
}

function eventDateIso(e: { dateIso?: string | null }): string {
  return String(e.dateIso ?? "").trim()
}

function eventsMatchingCalendarDay(events: CalendarioMergedEvent[], d: Date): CalendarioMergedEvent[] {
  const iso = isoYmdFromDate(d)
  const monthDay = iso.slice(5)
  const seasonal = events.filter(
    (e) =>
      e.seasonal &&
      e.dow === d.getDay() &&
      monthDay >= e.seasonal.from &&
      monthDay <= e.seasonal.to,
  )
  const dated = events.filter((e) => eventDateIso(e) === iso)
  if (dated.length) return [...dated, ...seasonal]
  return [...events.filter((e) => !eventDateIso(e) && !e.seasonal && e.dow === d.getDay()), ...seasonal]
}

function parseCostoOrario(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(String(v).replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

const QUALIFICHE_PERSONALE = [
  "sicurezza_luogo_lavoro",
  "antincendio",
  "primo_soccorso",
  "rls",
  "responsabile_piscina",
  "blsd",
  "brevetto_assistente_bagnante",
] as const

function parseTesseramentoScadenza(v: unknown): string | null {
  const t = String(v ?? "").trim()
  if (!t) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

function parseQualifiche(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const allowed = new Set<string>(QUALIFICHE_PERSONALE)
  const out: string[] = []
  for (const raw of v) {
    const id = String(raw ?? "").trim()
    if (allowed.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

const COMPARTO_LABELS: Record<CalendarioComparto, string> = {
  corsi: "Corsi (terra + acqua)",
  scuola_nuoto: "Scuola nuoto",
  piscina: "Bagnini",
  reception: "Reception",
  danza: "Danza",
  campus: "Campus",
  sala_fitness: "Sala fitness",
  acquaticita: "Acquaticità",
  spogliatoi: "Spogliatoi",
  pulizie: "Pulizie",
  consulenti: "Consulenti",
}

const PIANO_OPERATIVO_COMPARTI: CalendarioComparto[] = [
  "reception",
  "corsi",
  "scuola_nuoto",
  "piscina",
  "acquaticita",
  "spogliatoi",
  "pulizie",
  "sala_fitness",
  "campus",
  "danza",
]

function defaultZonaManual(comparto: CalendarioComparto): string {
  if (comparto === "reception") return "reception"
  if (comparto === "sala_fitness") return "sala_fitness"
  if (comparto === "acquaticita") return "acquaticita"
  if (comparto === "spogliatoi") return "spogliatoi"
  if (comparto === "pulizie") return "pulizie"
  if (comparto === "scuola_nuoto") return "acqua"
  return "invernale"
}

function defaultZonaSeeded(comparto: CalendarioComparto): string {
  if (comparto === "scuola_nuoto") return "scuola_nuoto"
  return defaultZonaManual(comparto)
}

function revisionToMergedEvent(comparto: CalendarioComparto, r: CalendarioSlotRevision): CalendarioMergedEvent {
  const staff = r.staffOverride?.trim() || "—"
  return {
    id: r.stableKey,
    zona: r.zona ?? defaultZonaSeeded(comparto),
    sheet: r.stableKey.startsWith("manual-") ? "Manuale" : "Calendario",
    dow: r.dow,
    dateIso: r.dateIso ?? null,
    seasonal: r.seasonal,
    start: r.start,
    title: r.title,
    staff,
    stableKey: r.stableKey,
    istruttoreId: r.istruttoreId ?? null,
    staffOverride: r.staffOverride ?? null,
    note: r.note ?? null,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
  }
}

function addDaysIso(iso: string, days: number): string | null {
  const d = parseIsoLocal(iso)
  if (!d) return null
  d.setDate(d.getDate() + days)
  return isoYmdFromDate(d)
}

function mondayIsoOfToday(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const js = d.getDay()
  d.setDate(d.getDate() - (js === 0 ? 6 : js - 1))
  return isoYmdFromDate(d)
}

/** Chiave scritta dall'import Excel, non da «Aggiungi turno» / duplica. */
function isExcelSalaStableKey(stableKey: string): boolean {
  return /^sala_fitness\|\d{4}-\d{2}-\d{2}\|/.test(String(stableKey ?? ""))
}

function salaManualStableKey(e: {
  zona?: string
  start: string
  title: string
  dateIso: string
  staff: string
}): string {
  const zona = String(e.zona ?? "sala_fitness").trim() || "sala_fitness"
  return stableKeyFromParts(zona, 0, e.start, `${e.title}|${e.dateIso}|${e.staff}`)
}

/** L'Excel sala pesi termina ad aprile 2026: ripete l'ultimo anno, ma non dalla settimana attuale in poi. */
function projectDatedEventsForward(events: CalendarioMergedEvent[], beforeIso?: string): CalendarioMergedEvent[] {
  const dated = events.filter((e) => isIsoDate(String(e.dateIso ?? "")))
  if (!dated.length) return events
  const maxIso = dated.map((e) => String(e.dateIso)).sort()[dated.length - 1]!
  const cutIso = beforeIso && isIsoDate(beforeIso) ? beforeIso : mondayIsoOfToday()
  if (maxIso >= cutIso) return events
  const minSourceIso = addDaysIso(maxIso, -52 * 7) ?? maxIso
  const existing = new Set(
    dated.map((e) => `${e.dateIso}|${e.start}|${String(e.staffOverride ?? e.staff ?? "").trim()}`)
  )
  const extra: CalendarioMergedEvent[] = []
  for (const e of dated) {
    const src = String(e.dateIso)
    if (src < minSourceIso) continue
    let iso = src
    for (let n = 0; n < 4; n++) {
      const next = addDaysIso(iso, 52 * 7)
      if (!next) break
      iso = next
      if (next <= maxIso) continue
      if (next >= cutIso) break
      const staff = String(e.staffOverride ?? e.staff ?? "").trim()
      const key = `${next}|${e.start}|${staff}`
      if (existing.has(key)) continue
      existing.add(key)
      const day = parseIsoLocal(next)
      extra.push({
        ...e,
        id: `sala_fitness|${next}|${e.start}|${staff}`,
        stableKey: `sala_fitness|${next}|${e.start}|${staff}`,
        dateIso: next,
        dow: day ? day.getDay() : e.dow,
        sheet: "Orario (ripetuto)",
      })
    }
  }
  return extra.length ? [...events, ...extra] : events
}

/** Trasforma la settimana in corso in turni reali (modificabili) e toglie l'Excel da oggi in poi. */
function materializeCurrentSalaFitnessWeek(db: CalendarioDb): CalendarioDb {
  const monday = mondayIsoOfToday()
  const nextMonday = addDaysIso(monday, 7)
  if (!nextMonday) return db
  const sentinel = `sala_fitness|cutoff|${monday}`
  const existingCutoff = db.revisions
    .filter((r) => r.comparto === "sala_fitness" && String(r.stableKey).startsWith("sala_fitness|cutoff|"))
    .map((r) => String(r.dateIso ?? "").trim())
    .filter((d) => isIsoDate(d))
    .sort()[0]
  const alreadyCut = Boolean(existingCutoff)
  const source = alreadyCut
    ? []
    : coalesceSalaFitnessShifts(
        projectDatedEventsForward(mergeServerSeededFromDb("sala_fitness", db), nextMonday),
      )
  let next = db
  let changed = false
  const now = new Date().toISOString()

  if (!alreadyCut) {
  for (let i = 0; i < 7; i++) {
    const iso = addDaysIso(monday, i)
    if (!iso) continue
    for (const e of source.filter((x) => eventDateIso(x) === iso)) {
      const staff = String(e.staffOverride ?? e.staff ?? "").trim()
      if (!staff || staff === "—") continue
      const start = normalizeHm(e.start)
      const title = String(e.title ?? "Sala pesi").trim() || "Sala pesi"
      const zona = String(e.zona ?? "sala_fitness").trim() || "sala_fitness"
      const stableKey = salaManualStableKey({ zona, start, title, dateIso: iso, staff })
      if (next.revisions.some((r) => r.comparto === "sala_fitness" && r.stableKey === stableKey && !r.removed)) continue
      next = upsertRevision(next, {
        comparto: "sala_fitness",
        stableKey,
        dow: e.dow,
        dateIso: iso,
        start,
        title,
        zona,
        istruttoreId: e.istruttoreId ?? null,
        staffOverride: staff,
        note: e.note ?? null,
        updatedAt: now,
        updatedBy: "sala-fitness-materialize",
      })
      changed = true
    }
  }
  }

  const kept = next.revisions.filter((r) => {
    if (r.comparto !== "sala_fitness") return true
    if (r.stableKey === sentinel) return true
    const d = String(r.dateIso ?? "").trim()
    const from = existingCutoff && existingCutoff < monday ? existingCutoff : monday
    if (!d || d < from) return true
    return !isExcelSalaStableKey(r.stableKey)
  })
  if (kept.length !== next.revisions.length) {
    next = { ...next, revisions: kept }
    changed = true
  }
  if (!alreadyCut && !next.revisions.some((r) => r.comparto === "sala_fitness" && r.stableKey === sentinel)) {
    next = upsertRevision(next, {
      comparto: "sala_fitness",
      stableKey: sentinel,
      dow: 1,
      dateIso: monday,
      start: "00:00",
      title: "cutoff",
      zona: "sala_fitness",
      updatedAt: now,
      updatedBy: "sala-fitness-materialize",
    })
    changed = true
  }
  if (changed) writeCalendarioDb(next)
  return next
}

/** Tutte le revisioni del comparto (scuola nuoto dopo import una tantum). */
function isGhostScuolaNuoto(r: { title?: string }): boolean {
  return /^BIANCO\b/i.test(String(r.title ?? "").trim())
}

function mergeServerSeededFromDb(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  const out: CalendarioMergedEvent[] = []
  for (const r of db.revisions) {
    if (r.comparto !== comparto || r.removed) continue
    if (comparto === "scuola_nuoto" && isGhostScuolaNuoto(r)) continue
    if (comparto === "sala_fitness" && String(r.stableKey).startsWith("sala_fitness|cutoff|")) continue
    out.push(revisionToMergedEvent(comparto, r))
  }
  const order = (d: number) => (d === 0 ? 7 : d)
  return out.sort(
    (a, b) => order(a.dow) - order(b.dow) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
  )
}

function seedCompartoFromPlanning(comparto: CalendarioComparto, db: CalendarioDb): CalendarioDb {
  const base = baseEventsForComparto(comparto)
  if (!base.length) return db
  const now = new Date().toISOString()
  let next = db
  for (const e of base) {
    const zona = e.zona ?? defaultZonaSeeded(comparto)
    const staff = String(e.staff ?? "").trim()
    const sk = stableKeyFromParts(zona, e.dow, e.start, e.title, staff)
    if (next.revisions.some((r) => r.comparto === comparto && r.stableKey === sk)) continue
    const rev: CalendarioSlotRevision = {
      comparto,
      stableKey: sk,
      dow: e.dow,
      start: e.start,
      title: e.title,
      zona,
      staffOverride: staff && staff !== "—" ? staff : null,
      istruttoreId: null,
      updatedAt: now,
      updatedBy: "import-planning-auto",
    }
    next = upsertRevision(next, rev)
  }
  return next
}

/** Turni da JSON server (import Excel desk/bagnini o inserimento web). */
function mergeManualOnlyFromDb(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  const out: CalendarioMergedEvent[] = []
  for (const r of db.revisions) {
    if (r.comparto !== comparto) continue
    if (r.removed) continue
    out.push({
      id: r.stableKey,
      zona: r.zona ?? defaultZonaManual(comparto),
      sheet: "Calendario",
      dow: r.dow,
      dateIso: r.dateIso ?? null,
      seasonal: r.seasonal,
      start: r.start,
      title: r.title,
      staff: r.staffOverride?.trim() || "—",
      stableKey: r.stableKey,
      istruttoreId: r.istruttoreId ?? null,
      staffOverride: r.staffOverride ?? null,
      note: r.note ?? null,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    })
  }
  const order = (d: number) => (d === 0 ? 7 : d)
  return out.sort(
    (a, b) => order(a.dow) - order(b.dow) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
  )
}

const SUMMER_POOL_SEED_KEY = "piscina|seed|summer-defaults"

function ensureSummerPoolShifts(db: CalendarioDb): CalendarioDb {
  if (db.revisions.some((r) => r.comparto === "piscina" && r.stableKey === SUMMER_POOL_SEED_KEY)) return db

  const now = new Date().toISOString()
  let next = db
  const shifts = [
    { start: "08:30", end: "14:00" },
    { start: "14:30", end: "19:30" },
  ]

  for (let dow = 0; dow < 7; dow++) {
    for (const shift of shifts) {
      const stableKey = `piscina|summer|${dow}|esterna|${shift.start}`
      if (next.revisions.some((r) => r.comparto === "piscina" && r.stableKey === stableKey)) continue
      next = upsertRevision(next, {
        comparto: "piscina",
        stableKey,
        dow,
        seasonal: { from: "06-01", to: "09-15" },
        start: shift.start,
        title: `Copertura · ${shift.start}–${shift.end}`,
        zona: "esterna",
        staffOverride: null,
        istruttoreId: null,
        updatedAt: now,
        updatedBy: "seed-turni-estivi",
      })
    }
  }

  next = upsertRevision(next, {
    comparto: "piscina",
    stableKey: SUMMER_POOL_SEED_KEY,
    dow: 0,
    dateIso: null,
    start: "00:00",
    title: "Turni estivi inizializzati",
    zona: "esterna",
    removed: true,
    updatedAt: now,
    updatedBy: "seed-turni-estivi",
  })
  writeCalendarioDb(next)
  return next
}

function mergeForComparto(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  if (MANUAL_ONLY_COMPARTI.includes(comparto)) {
    const manualDb = comparto === "piscina" ? ensureSummerPoolShifts(db) : db
    return mergeManualOnlyFromDb(comparto, manualDb)
  }

  if (SERVER_SEEDED_COMPARTI.includes(comparto)) {
    let seededDb = db
    let events = mergeServerSeededFromDb(comparto, seededDb)
    if (events.length === 0) {
      seededDb = seedCompartoFromPlanning(comparto, seededDb)
      events = mergeServerSeededFromDb(comparto, seededDb)
      if (events.length > 0) writeCalendarioDb(seededDb)
    }
    if (comparto === "sala_fitness") {
      seededDb = materializeCurrentSalaFitnessWeek(seededDb)
      events = coalesceSalaFitnessShifts(
        projectDatedEventsForward(mergeServerSeededFromDb(comparto, seededDb), mondayIsoOfToday()),
      )
    }
    return events
  }

  if (comparto !== "corsi") return []

  const revByKey = new Map<string, CalendarioSlotRevision>()
  for (const r of db.revisions) {
    if (r.comparto === comparto) revByKey.set(r.stableKey, r)
  }

  const base = baseEventsForComparto("corsi")
  const baseKeys = new Set<string>()
  const out: CalendarioMergedEvent[] = []

  for (const e of base) {
    const sk = stableKeyFromParts(e.zona, e.dow, e.start, e.title)
    baseKeys.add(sk)
    const r = revByKey.get(sk)
    if (r?.removed) continue
    out.push({
      ...e,
      dow: r?.dow ?? e.dow,
      dateIso: r?.dateIso ?? null,
      start: r?.start ?? e.start,
      title: r?.title ?? e.title,
      zona: r?.zona ?? e.zona,
      stableKey: sk,
      istruttoreId: r?.istruttoreId ?? null,
      staffOverride: staffOverrideFromRevision(r?.staffOverride, e.staff),
      note: r?.note ?? null,
      updatedAt: r?.updatedAt,
      updatedBy: r?.updatedBy,
    })
  }

  for (const r of db.revisions) {
    if (r.comparto !== comparto) continue
    if (!r.stableKey.startsWith("manual-")) continue
    if (r.removed) continue
    if (baseKeys.has(r.stableKey)) continue
    out.push({
      id: r.stableKey,
      zona: r.zona ?? "terra",
      sheet: "Manuale",
      dow: r.dow,
      start: r.start,
      title: r.title,
      staff: r.staffOverride?.trim() || "—",
      stableKey: r.stableKey,
      istruttoreId: r.istruttoreId ?? null,
      staffOverride: r.staffOverride ?? null,
      note: r.note ?? null,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    })
  }

  return out
}

function isPlaceholderStaff(s: string | null | undefined): boolean {
  const u = String(s ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  return !u || u === "—" || u === "-" || u === "TRAINER" || u === "TRAINING" || u === "TRAINERS"
}

function staffOverrideFromRevision(rev: string | null | undefined, baseStaff: string): string | null {
  const r = rev != null ? String(rev).trim() : ""
  const b = String(baseStaff ?? "").trim()
  if (isPlaceholderStaff(r) && b && !isPlaceholderStaff(b)) return null
  return r || null
}

function displayStaff(e: CalendarioMergedEvent, instructors: CalendarioIstruttore[]): string {
  const libero = e.staffOverride != null ? String(e.staffOverride).trim() : ""
  if (libero && !isPlaceholderStaff(libero)) return libero
  if (e.istruttoreId) {
    const ins = instructors.find((x) => x.id === e.istruttoreId)
    if (ins) return `${ins.cognome} ${ins.nome}`.trim()
  }
  return e.staff.trim() || "—"
}

const CONVALIDA_COMPARTI: CalendarioComparto[] = [
  "corsi",
  "scuola_nuoto",
  "sala_fitness",
  "piscina",
  "reception",
  "acquaticita",
  "pulizie",
  "campus",
]

/** Eventi calendario (orari + istruttore) per confrontare i turni Libro paga. */
export function listCalendarioPerConvalida(): {
  instructors: CalendarioIstruttore[]
  events: (CalendarioMergedEvent & { comparto: CalendarioComparto; staffDisplay: string })[]
} {
  const db = readCalendarioDb()
  const events: (CalendarioMergedEvent & { comparto: CalendarioComparto; staffDisplay: string })[] = []
  for (const comparto of CONVALIDA_COMPARTI) {
    for (const e of mergeForComparto(comparto, db)) {
      events.push({ ...e, comparto, staffDisplay: displayStaff(e, db.instructors) })
    }
  }
  return { instructors: db.instructors, events }
}

export function getCalendarioPianoOperativo(req: Request, res: Response) {
  const u = req.user!
  if (u.role !== "admin" && u.role !== "calendari") return res.status(403).json({ message: "Permessi insufficienti" })

  const dateRaw = String(req.query.date ?? "").trim()
  const date = dateRaw && isIsoDate(dateRaw) ? parseIsoLocal(dateRaw) : new Date()
  if (!date) return res.status(400).json({ message: "Data non valida (YYYY-MM-DD)" })

  const dateIso = isoYmdFromDate(date)
  const db = readCalendarioDb()
  const reparti = PIANO_OPERATIVO_COMPARTI.map((comparto) => {
    const events = eventsMatchingCalendarDay(mergeForComparto(comparto, db), date)
      .map((e) => ({
        ...e,
        staffDisplay: displayStaff(e, db.instructors),
      }))
      .sort(
        (a, b) =>
          shiftRangeStartForSort(a).localeCompare(shiftRangeStartForSort(b)) ||
          a.title.localeCompare(b.title) ||
          a.staffDisplay.localeCompare(b.staffDisplay, "it")
      )
    return {
      comparto,
      label: COMPARTO_LABELS[comparto],
      events,
    }
  })

  res.json({ dateIso, reparti, instructors: db.instructors })
}

export function getCalendarioComparto(req: Request, res: Response) {
  const u = req.user!
  const raw = normalizeCompartoParam(String(req.params.comparto ?? ""))
  if (!isComparto(raw)) return res.status(400).json({ message: "Comparto non valido" })
  if (!canReadComparto(u, raw)) return res.status(403).json({ message: "Permessi insufficienti" })

  const db = readCalendarioDb()
  const events = mergeForComparto(raw, db)
  const withDisplay = events.map((e) => ({
    ...e,
    staffDisplay: displayStaff(e, db.instructors),
  }))
  res.json({ comparto: raw, events: withDisplay, instructors: db.instructors })
}

export function patchCalendarioSlot(req: Request, res: Response) {
  const u = req.user!
  const raw = normalizeCompartoParam(String(req.params.comparto ?? ""))
  if (!isComparto(raw)) return res.status(400).json({ message: "Comparto non valido" })
  if (!canWriteComparto(u, raw)) return res.status(403).json({ message: "Permessi insufficienti" })

  const body = req.body as {
    stableKey?: string
    create?: boolean
    removed?: boolean
    dow?: number
    dateIso?: string | null
    start?: string
    title?: string
    zona?: string
    istruttoreId?: string | null
    staffOverride?: string | null
    note?: string | null
    clear?: boolean
    mergedStableKeys?: string[]
  }

  let db = readCalendarioDb()

  if (body.clear) {
    const stableKey = String(body.stableKey ?? "").trim()
    if (!stableKey) return res.status(400).json({ message: "stableKey obbligatorio" })
    const extra = Array.isArray(body.mergedStableKeys) ? body.mergedStableKeys : []
    const keys = [...new Set([stableKey, ...extra.map((k) => String(k ?? "").trim()).filter(Boolean)])]
    for (const k of keys) db = deleteRevision(db, raw, k)
    writeCalendarioDb(db)
    return res.json({ ok: true })
  }

  const now = new Date().toISOString()
  const by = u.nome || u.username

  if (body.create === true) {
    const canCreate =
      raw === "corsi" || MANUAL_ONLY_COMPARTI.includes(raw) || SERVER_SEEDED_COMPARTI.includes(raw)
    if (!canCreate) {
      return res.status(400).json({
        message: "Aggiunta slot manuale non consentita per questo comparto",
      })
    }
    const dow = Number(body.dow)
    const start = normalizeHm(String(body.start ?? "").trim())
    const dateIsoRaw = body.dateIso != null ? String(body.dateIso).trim() : ""
    const dateIso = dateIsoRaw && isIsoDate(dateIsoRaw) ? dateIsoRaw : null
    if ((MANUAL_ONLY_COMPARTI.includes(raw) || raw === "sala_fitness") && !dateIso) {
      return res.status(400).json({ message: "dateIso obbligatorio (YYYY-MM-DD) per slot su un giorno specifico" })
    }
    const defaultZona =
      raw === "corsi" ? "terra" : raw === "scuola_nuoto" ? "scuola_nuoto" : defaultZonaManual(raw)
    const titleIn = String(body.title ?? "").trim()
    const title =
      titleIn ||
      (raw === "corsi" || raw === "scuola_nuoto"
        ? ""
        : raw === "reception"
          ? "Sportello"
          : raw === "sala_fitness"
            ? "Sala pesi"
            : raw === "acquaticita"
              ? "Acquaticità"
              : raw === "spogliatoi"
                ? "Spogliatoi"
                : raw === "pulizie"
                  ? "Pulizie"
                  : "Copertura")
    const zona = String(body.zona ?? defaultZona).trim() || defaultZona
    if (!Number.isFinite(dow) || dow < 0 || dow > 6 || !start || !title) {
      return res.status(400).json({ message: "dow, start, title obbligatori" })
    }
    const staffOverride = body.staffOverride != null ? String(body.staffOverride).trim() : ""
    const hasIns = body.istruttoreId != null && String(body.istruttoreId).trim() !== ""
    if (!staffOverride && !hasIns) return res.status(400).json({ message: "Inserire istruttore da anagrafica o nome testuale" })
    const stableKey =
      raw === "scuola_nuoto"
        ? stableKeyFromParts(zona, dow, start, title, staffOverride)
        : raw === "sala_fitness"
          ? stableKeyFromParts(zona, dateIso ? 0 : dow, start, `${title}|${dateIso ?? ""}|${staffOverride}`)
          : `manual-${crypto.randomUUID()}`
    const rev: CalendarioSlotRevision = {
      comparto: raw,
      stableKey,
      dow,
      dateIso: dateIso,
      start,
      title,
      zona,
      istruttoreId: hasIns ? String(body.istruttoreId).trim() : null,
      staffOverride: staffOverride || null,
      note: body.note === undefined ? undefined : body.note,
      updatedAt: now,
      updatedBy: by,
    }
    db = upsertRevision(db, rev)
    writeCalendarioDb(db)
    return res.json({ ok: true, stableKey })
  }

  const stableKey = String(body.stableKey ?? "").trim()
  if (!stableKey) return res.status(400).json({ message: "stableKey obbligatorio" })

  const baseEv = baseEventsForComparto(raw).find((e) => stableKeyFromParts(e.zona, e.dow, e.start, e.title) === stableKey)
  const prevRev = db.revisions.find((r) => r.comparto === raw && r.stableKey === stableKey)

  if (body.removed === true) {
    const deleteFromDb =
      stableKey.startsWith("manual-") || MANUAL_ONLY_COMPARTI.includes(raw) || SERVER_SEEDED_COMPARTI.includes(raw)
    if (deleteFromDb) {
      if (!prevRev && !stableKey.startsWith("manual-") && raw !== "sala_fitness") {
        return res.status(404).json({ message: "Slot non trovato" })
      }
      const extra = Array.isArray(body.mergedStableKeys) ? body.mergedStableKeys : []
      const keys = [...new Set([stableKey, ...extra.map((k) => String(k ?? "").trim()).filter(Boolean)])]
      for (const k of keys) db = deleteRevision(db, raw, k)
      writeCalendarioDb(db)
      return res.json({ ok: true })
    }
    if (!baseEv) return res.status(404).json({ message: "Slot non trovato" })
    const rev: CalendarioSlotRevision = {
      comparto: raw,
      stableKey,
      dow: baseEv.dow,
      start: baseEv.start,
      title: baseEv.title,
      zona: baseEv.zona,
      removed: true,
      updatedAt: now,
      updatedBy: by,
    }
    db = upsertRevision(db, rev)
    writeCalendarioDb(db)
    return res.json({ ok: true })
  }

  if (!baseEv && !prevRev && !stableKey.startsWith("manual-") && !SERVER_SEEDED_COMPARTI.includes(raw)) {
    return res.status(404).json({ message: "Slot non trovato" })
  }

  if (SERVER_SEEDED_COMPARTI.includes(raw) && !prevRev && !stableKey.startsWith("manual-") && raw !== "sala_fitness") {
    return res.status(404).json({ message: "Slot non trovato" })
  }

  const dow = Number(body.dow ?? baseEv?.dow ?? prevRev?.dow)
  const start = normalizeHm(String(body.start ?? baseEv?.start ?? prevRev?.start ?? "").trim())
  const title = String(body.title ?? baseEv?.title ?? prevRev?.title ?? "").trim()
  const dateIsoBody = body.dateIso !== undefined ? String(body.dateIso ?? "").trim() : undefined
  const dateIso =
    dateIsoBody !== undefined
      ? dateIsoBody && isIsoDate(dateIsoBody)
        ? dateIsoBody
        : null
      : prevRev?.dateIso ?? (baseEv as { dateIso?: string | null } | undefined)?.dateIso ?? null
  if (!Number.isFinite(dow) || dow < 0 || dow > 6 || !start || !title) {
    return res.status(400).json({ message: "dow, start, title obbligatori per salvataggio" })
  }

  const zonaOut = String(body.zona ?? baseEv?.zona ?? prevRev?.zona ?? defaultZonaManual(raw))
  const istruttoreIdOut = body.istruttoreId === undefined ? prevRev?.istruttoreId ?? null : body.istruttoreId
  const staffOverrideOut = body.staffOverride === undefined ? prevRev?.staffOverride : body.staffOverride

  if (raw === "sala_fitness") {
    if (!dateIso) return res.status(400).json({ message: "dateIso obbligatorio" })
    const staffName = String(staffOverrideOut ?? "").trim() || String(prevRev?.staffOverride ?? "").trim()
    const staffForKey = staffName || String(istruttoreIdOut ?? "").trim() || "turno"
    const nextKey = salaManualStableKey({ zona: zonaOut, start, title, dateIso, staff: staffForKey })
    const extra = Array.isArray(body.mergedStableKeys) ? body.mergedStableKeys : []
    const stale = [...new Set([stableKey, ...extra.map((k) => String(k ?? "").trim()).filter(Boolean)])].filter(
      (k) => k !== nextKey,
    )
    for (const k of stale) db = deleteRevision(db, raw, k)
    db = upsertRevision(db, {
      comparto: raw,
      stableKey: nextKey,
      dow,
      dateIso,
      start,
      title,
      zona: zonaOut,
      istruttoreId: istruttoreIdOut,
      staffOverride: staffName || null,
      note: body.note === undefined ? prevRev?.note : body.note,
      removed: false,
      updatedAt: now,
      updatedBy: by,
    })
    writeCalendarioDb(db)
    return res.json({ ok: true, stableKey: nextKey })
  }

  const rev: CalendarioSlotRevision = {
    comparto: raw,
    stableKey,
    dow,
    dateIso:
      MANUAL_ONLY_COMPARTI.includes(raw) ||
      (stableKey.startsWith("manual-") && !SERVER_SEEDED_COMPARTI.includes(raw))
        ? dateIso
        : SERVER_SEEDED_COMPARTI.includes(raw)
          ? null
          : undefined,
    seasonal: prevRev?.seasonal,
    start,
    title,
    zona: zonaOut,
    istruttoreId: istruttoreIdOut,
    staffOverride: staffOverrideOut,
    note: body.note === undefined ? prevRev?.note : body.note,
    removed: false,
    updatedAt: now,
    updatedBy: by,
  }

  if (baseEv && !SERVER_SEEDED_COMPARTI.includes(raw)) {
    const excelStaff = baseEv.staff.trim()
    const staffOverrideTrim = rev.staffOverride != null ? String(rev.staffOverride).trim() : ""
    const sameStaffAsExcel = !rev.istruttoreId && (!staffOverrideTrim || staffOverrideTrim === excelStaff)
    const noteTrim = rev.note != null ? String(rev.note).trim() : ""
    const samePosAsExcel =
      dow === baseEv.dow && start === baseEv.start && title === baseEv.title && String(rev.zona ?? baseEv.zona) === String(baseEv.zona)
    if (sameStaffAsExcel && !noteTrim && samePosAsExcel) {
      db = deleteRevision(db, raw, stableKey)
    } else {
      db = upsertRevision(db, rev)
    }
  } else {
    db = upsertRevision(db, rev)
  }
  writeCalendarioDb(db)
  res.json({ ok: true })
}

function mondayIsoFrom(iso: string): string | null {
  const d = parseIsoLocal(iso)
  if (!d) return null
  const js = d.getDay()
  d.setDate(d.getDate() - (js === 0 ? 6 : js - 1))
  return isoYmdFromDate(d)
}

function slotCopyFingerprint(e: {
  start: string
  title: string
  zona?: string
  istruttoreId?: string | null
  staffOverride?: string | null
  staff?: string
}): string {
  const staff = String(e.istruttoreId || e.staffOverride || e.staff || "")
    .trim()
    .toLowerCase()
  return `${normalizeHm(e.start)}|${String(e.title ?? "").trim()}|${String(e.zona ?? "").trim()}|${staff}`
}

const DUPLICABLE_COMPARTI: CalendarioComparto[] = [...MANUAL_ONLY_COMPARTI, "sala_fitness"]

/** Normalizza il comparto dal parametro URL (Express decodifica underscore come spazio). */
function normalizeCompartoParam(raw: string): string {
  return raw.trim().replace(/\s+/g, "_")
}

/** Copia tutti i turni di un giorno o di una settimana su un'altra data. */
export function postCalendarioDuplica(req: Request, res: Response) {
  const u = req.user!
  const raw = normalizeCompartoParam(String(req.params.comparto ?? ""))
  if (!isComparto(raw)) return res.status(400).json({ message: "Comparto non valido" })
  if (!canWriteComparto(u, raw)) return res.status(403).json({ message: "Permessi insufficienti" })
  if (!DUPLICABLE_COMPARTI.includes(raw)) {
    return res.status(400).json({
      message: "La duplicazione è disponibile sui calendari a data (reception, bagnini, sala fitness, acquaticità, spogliatoi, pulizie)",
    })
  }

  const body = req.body as { mode?: string; fromIso?: string; toIso?: string }
  const mode = body.mode === "week" ? "week" : body.mode === "day" ? "day" : null
  const fromIso = String(body.fromIso ?? "").trim()
  const toIso = String(body.toIso ?? "").trim()
  if (!mode) return res.status(400).json({ message: "mode: day o week" })
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) {
    return res.status(400).json({ message: "fromIso e toIso obbligatori (YYYY-MM-DD)" })
  }

  const pairs: { src: string; dest: string }[] = []
  if (mode === "day") {
    if (fromIso === toIso) return res.status(400).json({ message: "Scegli un giorno di destinazione diverso" })
    pairs.push({ src: fromIso, dest: toIso })
  } else {
    const srcMon = mondayIsoFrom(fromIso)
    const destMon = mondayIsoFrom(toIso)
    if (!srcMon || !destMon) return res.status(400).json({ message: "Date non valide" })
    if (srcMon === destMon) return res.status(400).json({ message: "Scegli una settimana di destinazione diversa" })
    for (let i = 0; i < 7; i++) {
      const src = addDaysIso(srcMon, i)
      const dest = addDaysIso(destMon, i)
      if (!src || !dest) return res.status(400).json({ message: "Date non valide" })
      pairs.push({ src, dest })
    }
  }

  let db = readCalendarioDb()
  const events = mergeForComparto(raw, db)
  db = readCalendarioDb()
  const now = new Date().toISOString()
  const by = u.nome || u.username
  let copied = 0
  let skipped = 0

  for (const { src, dest } of pairs) {
    const srcDate = parseIsoLocal(src)
    const destDate = parseIsoLocal(dest)
    if (!srcDate || !destDate) continue
    const destDow = destDate.getDay()
    // Per duplicazione: usa solo eventi con data specifica, niente fallback per giorno della settimana
    const srcEvents = events.filter((e) => eventDateIso(e) === src)
    if (raw === "sala_fitness") {
      db = {
        ...db,
        revisions: db.revisions.filter(
          (r) => !(r.comparto === raw && r.dateIso === dest && isExcelSalaStableKey(r.stableKey)),
        ),
      }
    }
    const destKeys = new Set(
      events
        .filter((e) => eventDateIso(e) === dest && (raw !== "sala_fitness" || !isExcelSalaStableKey(e.stableKey)))
        .map(slotCopyFingerprint),
    )

    for (const e of srcEvents) {
      const fp = slotCopyFingerprint(e)
      if (destKeys.has(fp)) {
        skipped++
        continue
      }
      const start = normalizeHm(e.start)
      const title = String(e.title ?? "").trim()
      const zona = String(e.zona ?? defaultZonaManual(raw)).trim() || defaultZonaManual(raw)
      if (!start || !title) {
        skipped++
        continue
      }
      const istruttoreId = String(e.istruttoreId ?? "").trim() || null
      const staffOverride = istruttoreId
        ? String(e.staffOverride ?? "").trim() || null
        : String(e.staffOverride ?? e.staff ?? "").trim()
      if (!istruttoreId && !staffOverride) {
        skipped++
        continue
      }
      const stableKey =
        raw === "sala_fitness"
          ? stableKeyFromParts(zona, 0, start, `${title}|${dest}|${staffOverride ?? ""}`)
          : `manual-${crypto.randomUUID()}`
      if (db.revisions.some((r) => r.comparto === raw && r.stableKey === stableKey)) {
        skipped++
        continue
      }
      const rev: CalendarioSlotRevision = {
        comparto: raw,
        stableKey,
        dow: destDow,
        dateIso: dest,
        start,
        title,
        zona,
        istruttoreId,
        staffOverride: staffOverride || null,
        note: e.note ?? null,
        updatedAt: now,
        updatedBy: by,
      }
      db = upsertRevision(db, rev)
      destKeys.add(fp)
      copied++
    }
  }

  writeCalendarioDb(db)
  res.json({ ok: true, copied, skipped })
}

export function listCalendarioInstructors(req: Request, res: Response) {
  const u = req.user!
  const allow =
    u.role === "admin" ||
    u.role === "corsi" ||
    u.role === "istruttore" ||
    u.role === "scuola_nuoto" ||
    u.role === "bagnini" ||
    u.role === "danza" ||
    u.role === "campus" ||
    u.role === "operatore" ||
    u.role === "firme" ||
    u.role === "calendari"
  if (!allow) return res.status(403).json({ message: "Permessi insufficienti" })
  const db = readCalendarioDb()
  res.json({ rows: db.instructors })
}

export function postCalendarioInstructor(req: Request, res: Response) {
  const u = req.user!
  if (!canManageInstructors(u)) return res.status(403).json({ message: "Permessi insufficienti per modificare l'anagrafica" })

  const b = req.body as {
    nome?: string
    cognome?: string
    telefono?: string
    email?: string
    attivitaSvolta?: string
    costoOrario?: unknown
    tesseramento?: string
    tesseramentoScadenza?: string | null
    qualifiche?: unknown
  }
  const nome = String(b.nome ?? "").trim()
  const cognome = String(b.cognome ?? "").trim()
  const telefono = String(b.telefono ?? "").trim()
  const email = String(b.email ?? "").trim().toLowerCase()
  const attivitaSvolta = String(b.attivitaSvolta ?? "").trim()
  const costoOrario = parseCostoOrario(b.costoOrario)
  const tesseramento = String(b.tesseramento ?? "").trim()
  const tesseramentoScadenza = parseTesseramentoScadenza(b.tesseramentoScadenza)
  const qualifiche = parseQualifiche(b.qualifiche)
  if (!nome || !cognome) return res.status(400).json({ message: "Nome e cognome obbligatori" })

  const now = new Date().toISOString()
  const row: CalendarioIstruttore = {
    id: crypto.randomUUID(),
    nome,
    cognome,
    telefono,
    email,
    attivitaSvolta,
    costoOrario,
    tesseramento,
    tesseramentoScadenza,
    qualifiche,
    createdAt: now,
    updatedAt: now,
  }
  let db = readCalendarioDb()
  db = upsertInstructor(db, row)
  writeCalendarioDb(db)
  res.status(201).json(row)
}

export function putCalendarioInstructor(req: Request, res: Response) {
  const u = req.user!
  if (!canManageInstructors(u)) return res.status(403).json({ message: "Permessi insufficienti per modificare l'anagrafica" })

  const id = String(req.params.id ?? "").trim()
  const db = readCalendarioDb()
  const prev = db.instructors.find((x) => x.id === id)
  if (!prev) return res.status(404).json({ message: "Personale non trovato" })

  const b = req.body as {
    nome?: string
    cognome?: string
    telefono?: string
    email?: string
    attivitaSvolta?: string
    costoOrario?: unknown
    tesseramento?: string
    tesseramentoScadenza?: string | null
    qualifiche?: unknown
  }
  const nome = b.nome !== undefined ? String(b.nome).trim() : prev.nome
  const cognome = b.cognome !== undefined ? String(b.cognome).trim() : prev.cognome
  const telefono = b.telefono !== undefined ? String(b.telefono).trim() : prev.telefono
  const email = b.email !== undefined ? String(b.email).trim().toLowerCase() : prev.email
  const attivitaSvolta = b.attivitaSvolta !== undefined ? String(b.attivitaSvolta).trim() : (prev.attivitaSvolta ?? "")
  const costoOrario = b.costoOrario !== undefined ? parseCostoOrario(b.costoOrario) : (prev.costoOrario ?? null)
  const tesseramento = b.tesseramento !== undefined ? String(b.tesseramento).trim() : (prev.tesseramento ?? "")
  const tesseramentoScadenza =
    b.tesseramentoScadenza !== undefined
      ? parseTesseramentoScadenza(b.tesseramentoScadenza)
      : (prev.tesseramentoScadenza ?? null)
  const qualifiche = b.qualifiche !== undefined ? parseQualifiche(b.qualifiche) : (prev.qualifiche ?? [])
  if (!nome || !cognome) return res.status(400).json({ message: "Nome e cognome obbligatori" })

  const row: CalendarioIstruttore = {
    ...prev,
    nome,
    cognome,
    telefono,
    email,
    attivitaSvolta,
    costoOrario,
    tesseramento,
    tesseramentoScadenza,
    qualifiche,
    updatedAt: new Date().toISOString(),
  }
  const next = upsertInstructor(db, row)
  writeCalendarioDb(next)
  res.json(row)
}

const IT_DOW_FULL = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"] as const

function parseIsoLocal(s: string): Date | null {
  if (!isIsoDate(s)) return null
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(y!, m! - 1, d!, 0, 0, 0, 0)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const off = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - off)
  return x
}

function fmtItDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

function parseShiftRange(title: string, start: string): { start: string; end: string } {
  const m = String(title ?? "").match(/(\d{1,2})[:.](\d{2})\s*[–\-]\s*(\d{1,2})[:.](\d{2})/)
  if (!m) return { start, end: start }
  const pad = (h: string, min: string) => `${String(Number(h)).padStart(2, "0")}:${min}`
  return { start: pad(m[1]!, m[2]!), end: pad(m[3]!, m[4]!) }
}

function zonaLabelPiscina(z: string): string {
  const z0 = String(z ?? "").trim().toLowerCase()
  if (z0 === "invernale") return "Piscina invernale"
  if (z0 === "interna") return "Piscina interna"
  if (z0 === "esterna") return "Piscina esterna"
  return z0 || "—"
}

function formatTurnoLine(e: CalendarioMergedEvent): string {
  const { start, end } = parseShiftRange(e.title, e.start)
  const activity = String(e.title ?? "")
    .replace(/\s*·\s*\d{1,2}[:.]\d{2}\s*[–\-]\s*\d{1,2}[:.]\d{2}.*$/i, "")
    .trim()
  return `${start}–${end} · ${activity || e.title} · ${zonaLabelPiscina(e.zona)}`
}

/** Invia via email i turni settimana tipo al bagnino (solo calendario piscina). */
export async function postCalendarioSendTurni(req: Request, res: Response) {
  const u = req.user!
  const raw = normalizeCompartoParam(String(req.params.comparto ?? ""))
  if (raw !== "piscina") return res.status(400).json({ message: "Invio email disponibile solo per il calendario bagnini" })
  if (!canWriteComparto(u, "piscina")) return res.status(403).json({ message: "Permessi insufficienti" })

  const body = req.body as { istruttoreId?: string; weekStart?: string }
  const istruttoreId = String(body.istruttoreId ?? "").trim()
  if (!istruttoreId) return res.status(400).json({ message: "istruttoreId obbligatorio" })

  const db = readCalendarioDb()
  const ins = db.instructors.find((x) => x.id === istruttoreId)
  if (!ins) return res.status(404).json({ message: "Bagnino non trovato in anagrafica" })
  const to = String(ins.email ?? "").trim().toLowerCase()
  if (!to) {
    return res.status(400).json({ message: "Email mancante per questo bagnino. Aggiungila in Anagrafica istruttori." })
  }

  const anchor = body.weekStart ? parseIsoLocal(String(body.weekStart).trim()) : new Date()
  if (body.weekStart && !anchor) return res.status(400).json({ message: "weekStart non valido (YYYY-MM-DD)" })
  const monday = startOfWeekMonday(anchor ?? new Date())
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  const weekLabel = `${fmtItDate(monday)} – ${fmtItDate(sunday)}`

  const events = mergeManualOnlyFromDb("piscina", db).filter((e) => e.istruttoreId === istruttoreId)
  const lines: string[] = []
  for (let dow = 0; dow <= 6; dow++) {
    const daySlots = events
      .filter((e) => e.dow === dow)
      .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    if (daySlots.length === 0) continue
    lines.push(`${IT_DOW_FULL[dow]}`)
    for (const e of daySlots) lines.push(`  - ${formatTurnoLine(e)}`)
    lines.push("")
  }
  if (lines.length === 0) {
    return res.status(400).json({ message: "Nessun turno assegnato a questo bagnino nel calendario" })
  }

  const nome = ins.nome.trim() || ins.cognome
  const text =
    `Ciao ${nome},\n\n` +
    `Ecco i tuoi turni bagnino (settimana tipo ${weekLabel}):\n\n` +
    `${lines.join("\n").trim()}\n\n` +
    `— FitCenter / H2 Sport`

  const subject = `Turni bagnino · settimana ${weekLabel}`
  const { sent } = await sendMail({ to, subject, text })
  if (!sent && !isSmtpConfigured()) {
    return res.status(503).json({
      message: "SMTP non configurato sul server (SMTP_HOST, SMTP_USER, SMTP_PASS).",
    })
  }
  res.json({ ok: true, sent, to })
}

export function deleteCalendarioInstructor(req: Request, res: Response) {
  const u = req.user!
  if (!canManageInstructors(u)) return res.status(403).json({ message: "Permessi insufficienti per modificare l'anagrafica" })
  const id = String(req.params.id ?? "").trim()
  let db = readCalendarioDb()
  if (!db.instructors.some((x) => x.id === id)) return res.status(404).json({ message: "Istruttore non trovato" })
  db = deleteInstructor(db, id)
  db = {
    ...db,
    revisions: db.revisions.map((r) => (r.istruttoreId === id ? { ...r, istruttoreId: null } : r)),
  }
  writeCalendarioDb(db)
  res.json({ ok: true })
}
