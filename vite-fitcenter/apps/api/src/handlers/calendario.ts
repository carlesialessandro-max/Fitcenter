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
  "consulenti",
]

function isComparto(s: string): s is CalendarioComparto {
  return (COMPARTI as string[]).includes(s)
}

function canReadComparto(u: User, comparto: CalendarioComparto): boolean {
  if (u.role === "admin") return true
  if (comparto === "corsi") return u.role === "corsi" || u.role === "istruttore"
  if (comparto === "scuola_nuoto") return u.role === "scuola_nuoto"
  if (comparto === "piscina") return u.role === "bagnini"
  if (comparto === "acquaticita" || comparto === "spogliatoi") return false
  if (comparto === "danza") return u.role === "danza"
  if (comparto === "campus") return u.role === "campus"
  if (comparto === "reception") return u.role === "operatore" || u.role === "firme"
  if (comparto === "sala_fitness" || comparto === "consulenti") return false
  return false
}

function canWriteComparto(u: User, comparto: CalendarioComparto): boolean {
  if (u.role === "admin") return true
  if (comparto === "corsi") return u.role === "corsi" || u.role === "istruttore"
  if (comparto === "scuola_nuoto") return u.role === "scuola_nuoto"
  if (comparto === "piscina") return u.role === "bagnini"
  if (comparto === "acquaticita" || comparto === "spogliatoi") return false
  if (comparto === "danza") return u.role === "danza"
  if (comparto === "campus") return u.role === "campus"
  if (comparto === "reception") return u.role === "operatore" || u.role === "firme"
  /** Admin già gestito sopra: qui restano solo non-admin → nessuna scrittura su questi comparti. */
  if (comparto === "sala_fitness") return false
  if (comparto === "consulenti") return false
  return false
}

function canManageInstructors(u: User): boolean {
  return (
    u.role === "admin" ||
    u.role === "corsi" ||
    u.role === "operatore" ||
    u.role === "firme" ||
    u.role === "bagnini"
  )
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
  return j.eventsByComparto?.[comparto] ?? []
}

const MANUAL_ONLY_COMPARTI: CalendarioComparto[] = ["reception", "piscina", "sala_fitness", "acquaticita", "spogliatoi"]

/** PISCINAORARIO (S.N. Bambini): import una tantum, poi solo calendario-reparti.json. */
const SERVER_SEEDED_COMPARTI: CalendarioComparto[] = ["scuola_nuoto"]

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function defaultZonaManual(comparto: CalendarioComparto): string {
  if (comparto === "reception") return "reception"
  if (comparto === "sala_fitness") return "sala_fitness"
  if (comparto === "acquaticita") return "acquaticita"
  if (comparto === "spogliatoi") return "spogliatoi"
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

/** Tutte le revisioni del comparto (scuola nuoto dopo import una tantum). */
function mergeServerSeededFromDb(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  const out: CalendarioMergedEvent[] = []
  for (const r of db.revisions) {
    if (r.comparto !== comparto || r.removed) continue
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
    const sk = stableKeyFromParts(zona, e.dow, e.start, e.title)
    if (next.revisions.some((r) => r.comparto === comparto && r.stableKey === sk)) continue
    const staff = String(e.staff ?? "").trim()
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

/** Turni solo da calendario web (nessun Excel in build). */
function mergeManualOnlyFromDb(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  const out: CalendarioMergedEvent[] = []
  for (const r of db.revisions) {
    if (r.comparto !== comparto) continue
    if (!r.stableKey.startsWith("manual-")) continue
    if (r.removed) continue
    out.push({
      id: r.stableKey,
      zona: r.zona ?? defaultZonaManual(comparto),
      sheet: "Calendario",
      dow: r.dow,
      dateIso: r.dateIso ?? null,
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

function mergeForComparto(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  if (MANUAL_ONLY_COMPARTI.includes(comparto)) return mergeManualOnlyFromDb(comparto, db)

  if (SERVER_SEEDED_COMPARTI.includes(comparto)) {
    let seededDb = db
    let events = mergeServerSeededFromDb(comparto, seededDb)
    if (events.length === 0) {
      seededDb = seedCompartoFromPlanning(comparto, seededDb)
      events = mergeServerSeededFromDb(comparto, seededDb)
      if (events.length > 0) writeCalendarioDb(seededDb)
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
      staffOverride: r?.staffOverride ?? null,
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

function displayStaff(e: CalendarioMergedEvent, instructors: CalendarioIstruttore[]): string {
  if (e.istruttoreId) {
    const ins = instructors.find((x) => x.id === e.istruttoreId)
    if (ins) return `${ins.cognome} ${ins.nome}`.trim()
  }
  if (e.staffOverride != null && String(e.staffOverride).trim()) return String(e.staffOverride).trim()
  return e.staff.trim() || "—"
}

export function getCalendarioComparto(req: Request, res: Response) {
  const u = req.user!
  const raw = String(req.params.comparto ?? "").trim()
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
  const raw = String(req.params.comparto ?? "").trim()
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
  }

  let db = readCalendarioDb()

  if (body.clear) {
    const stableKey = String(body.stableKey ?? "").trim()
    if (!stableKey) return res.status(400).json({ message: "stableKey obbligatorio" })
    db = deleteRevision(db, raw, stableKey)
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
    const start = String(body.start ?? "").trim()
    const dateIsoRaw = body.dateIso != null ? String(body.dateIso).trim() : ""
    const dateIso = dateIsoRaw && isIsoDate(dateIsoRaw) ? dateIsoRaw : null
    if (MANUAL_ONLY_COMPARTI.includes(raw) && !dateIso) {
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
            ? "Turno sala"
            : raw === "acquaticita"
              ? "Acquaticità"
              : raw === "spogliatoi"
                ? "Spogliatoi"
                : "Copertura")
    const zona = String(body.zona ?? defaultZona).trim() || defaultZona
    if (!Number.isFinite(dow) || dow < 0 || dow > 6 || !start || !title) {
      return res.status(400).json({ message: "dow, start, title obbligatori" })
    }
    const staffOverride = body.staffOverride != null ? String(body.staffOverride).trim() : ""
    const hasIns = body.istruttoreId != null && String(body.istruttoreId).trim() !== ""
    if (!staffOverride && !hasIns) return res.status(400).json({ message: "Inserire istruttore da anagrafica o nome testuale" })
    const stableKey =
      SERVER_SEEDED_COMPARTI.includes(raw) && raw === "scuola_nuoto"
        ? stableKeyFromParts(zona, dow, start, title)
        : `manual-${crypto.randomUUID()}`
    const rev: CalendarioSlotRevision = {
      comparto: raw,
      stableKey,
      dow,
      dateIso: MANUAL_ONLY_COMPARTI.includes(raw) ? dateIso : null,
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
    if (stableKey.startsWith("manual-")) {
      db = deleteRevision(db, raw, stableKey)
      writeCalendarioDb(db)
      return res.json({ ok: true })
    }
    if (SERVER_SEEDED_COMPARTI.includes(raw)) {
      if (!prevRev) return res.status(404).json({ message: "Slot non trovato" })
      db = deleteRevision(db, raw, stableKey)
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

  if (!baseEv && !stableKey.startsWith("manual-") && !SERVER_SEEDED_COMPARTI.includes(raw)) {
    return res.status(404).json({ message: "Slot non trovato" })
  }

  if (SERVER_SEEDED_COMPARTI.includes(raw) && !prevRev && !stableKey.startsWith("manual-")) {
    return res.status(404).json({ message: "Slot non trovato" })
  }

  const dow = Number(body.dow ?? baseEv?.dow ?? prevRev?.dow)
  const start = String(body.start ?? baseEv?.start ?? prevRev?.start ?? "").trim()
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

  const rev: CalendarioSlotRevision = {
    comparto: raw,
    stableKey,
    dow,
    dateIso:
      MANUAL_ONLY_COMPARTI.includes(raw) || (stableKey.startsWith("manual-") && !SERVER_SEEDED_COMPARTI.includes(raw))
        ? dateIso
        : SERVER_SEEDED_COMPARTI.includes(raw)
          ? null
          : undefined,
    start,
    title,
    zona: String(
      body.zona ??
        baseEv?.zona ??
        prevRev?.zona ??
        (raw === "piscina" ? "invernale" : raw === "reception" ? "reception" : "terra")
    ),
    istruttoreId: body.istruttoreId === undefined ? prevRev?.istruttoreId ?? null : body.istruttoreId,
    staffOverride: body.staffOverride === undefined ? prevRev?.staffOverride : body.staffOverride,
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
    u.role === "bagnini"
  if (!allow) return res.status(403).json({ message: "Permessi insufficienti" })
  const db = readCalendarioDb()
  res.json({ rows: db.instructors })
}

export function postCalendarioInstructor(req: Request, res: Response) {
  const u = req.user!
  if (!canManageInstructors(u)) return res.status(403).json({ message: "Permessi insufficienti per modificare l'anagrafica" })

  const b = req.body as { nome?: string; cognome?: string; telefono?: string; email?: string }
  const nome = String(b.nome ?? "").trim()
  const cognome = String(b.cognome ?? "").trim()
  const telefono = String(b.telefono ?? "").trim()
  const email = String(b.email ?? "").trim().toLowerCase()
  if (!nome || !cognome) return res.status(400).json({ message: "Nome e cognome obbligatori" })

  const now = new Date().toISOString()
  const row: CalendarioIstruttore = {
    id: crypto.randomUUID(),
    nome,
    cognome,
    telefono,
    email,
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
  if (!prev) return res.status(404).json({ message: "Istruttore non trovato" })

  const b = req.body as { nome?: string; cognome?: string; telefono?: string; email?: string }
  const nome = b.nome !== undefined ? String(b.nome).trim() : prev.nome
  const cognome = b.cognome !== undefined ? String(b.cognome).trim() : prev.cognome
  const telefono = b.telefono !== undefined ? String(b.telefono).trim() : prev.telefono
  const email = b.email !== undefined ? String(b.email).trim().toLowerCase() : prev.email
  if (!nome || !cognome) return res.status(400).json({ message: "Nome e cognome obbligatori" })

  const row: CalendarioIstruttore = {
    ...prev,
    nome,
    cognome,
    telefono,
    email,
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
  const raw = String(req.params.comparto ?? "").trim()
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
