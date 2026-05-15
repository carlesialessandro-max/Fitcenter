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
  if (comparto === "acquaticita" || comparto === "spogliatoi") return u.role === "bagnini"
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
  if (comparto === "piscina" || comparto === "acquaticita" || comparto === "spogliatoi") return u.role === "bagnini"
  if (comparto === "danza") return u.role === "danza"
  if (comparto === "campus") return u.role === "campus"
  if (comparto === "reception") return u.role === "operatore" || u.role === "firme"
  /** Admin già gestito sopra: qui restano solo non-admin → nessuna scrittura su questi comparti. */
  if (comparto === "sala_fitness" || comparto === "consulenti") return false
  return false
}

function canManageInstructors(u: User): boolean {
  return u.role === "admin" || u.role === "corsi" || u.role === "operatore" || u.role === "firme"
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

/** Reception: solo slot creati/modificati sul server (nessun Excel in build). */
function mergeReceptionFromDb(db: CalendarioDb): CalendarioMergedEvent[] {
  const out: CalendarioMergedEvent[] = []
  for (const r of db.revisions) {
    if (r.comparto !== "reception") continue
    if (!r.stableKey.startsWith("manual-")) continue
    if (r.removed) continue
    out.push({
      id: r.stableKey,
      zona: r.zona ?? "reception",
      sheet: "Calendario",
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
  const order = (d: number) => (d === 0 ? 7 : d)
  return out.sort(
    (a, b) => order(a.dow) - order(b.dow) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
  )
}

function mergeForComparto(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  if (comparto === "reception") return mergeReceptionFromDb(db)

  const revByKey = new Map<string, CalendarioSlotRevision>()
  for (const r of db.revisions) {
    if (r.comparto === comparto) revByKey.set(r.stableKey, r)
  }

  const compartiConPlanning: CalendarioComparto[] = [
    "corsi",
    "scuola_nuoto",
    "piscina",
    "acquaticita",
    "spogliatoi",
  ]
  if (!compartiConPlanning.includes(comparto)) {
    return []
  }

  const base = baseEventsForComparto(comparto)
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
      zona: r.zona ?? (comparto === "piscina" ? "invernale" : "terra"),
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
    if (raw !== "corsi" && raw !== "piscina" && raw !== "reception") {
      return res.status(400).json({
        message: "Aggiunta slot manuale solo per corsi, piscina (bagnini) o reception",
      })
    }
    const dow = Number(body.dow)
    const start = String(body.start ?? "").trim()
    const defaultZona = raw === "piscina" ? "invernale" : raw === "reception" ? "reception" : "terra"
    const titleIn = String(body.title ?? "").trim()
    const title = titleIn || (raw === "piscina" ? "Copertura" : raw === "reception" ? "Sportello" : "")
    const zona = String(body.zona ?? defaultZona).trim() || defaultZona
    if (!Number.isFinite(dow) || dow < 0 || dow > 6 || !start || !title) {
      return res.status(400).json({ message: "dow, start, title obbligatori" })
    }
    const staffOverride = body.staffOverride != null ? String(body.staffOverride).trim() : ""
    const hasIns = body.istruttoreId != null && String(body.istruttoreId).trim() !== ""
    if (!staffOverride && !hasIns) return res.status(400).json({ message: "Inserire istruttore da anagrafica o nome testuale" })
    const stableKey = `manual-${crypto.randomUUID()}`
    const rev: CalendarioSlotRevision = {
      comparto: raw,
      stableKey,
      dow,
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

  if (!baseEv && !stableKey.startsWith("manual-")) {
    return res.status(404).json({ message: "Slot non trovato" })
  }

  const dow = Number(body.dow ?? baseEv?.dow ?? prevRev?.dow)
  const start = String(body.start ?? baseEv?.start ?? prevRev?.start ?? "").trim()
  const title = String(body.title ?? baseEv?.title ?? prevRev?.title ?? "").trim()
  if (!Number.isFinite(dow) || dow < 0 || dow > 6 || !start || !title) {
    return res.status(400).json({ message: "dow, start, title obbligatori per salvataggio" })
  }

  const rev: CalendarioSlotRevision = {
    comparto: raw,
    stableKey,
    dow,
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

  if (baseEv) {
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
    u.role === "firme"
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
