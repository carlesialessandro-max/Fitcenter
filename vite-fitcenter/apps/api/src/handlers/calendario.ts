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
  if (comparto === "danza") return u.role === "danza"
  if (comparto === "campus") return u.role === "campus"
  if (comparto === "reception" || comparto === "acquaticita" || comparto === "spogliatoi" || comparto === "consulenti") return false
  return false
}

function canWriteComparto(u: User, comparto: CalendarioComparto): boolean {
  if (u.role === "admin") return true
  if (comparto === "corsi") return u.role === "corsi" || u.role === "istruttore"
  if (comparto === "scuola_nuoto") return u.role === "scuola_nuoto"
  if (comparto === "piscina") return u.role === "bagnini"
  if (comparto === "danza") return u.role === "danza"
  if (comparto === "campus") return u.role === "campus"
  if (comparto === "reception" || comparto === "acquaticita" || comparto === "spogliatoi" || comparto === "consulenti") return u.role === "admin"
  return false
}

function canManageInstructors(u: User): boolean {
  return u.role === "admin" || u.role === "corsi"
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

function loadPlanningBaseEvents(): CalendarioBaseEvent[] {
  for (const p of planningJsonCandidates()) {
    try {
      if (!existsSync(p)) continue
      const raw = readFileSync(p, "utf8")
      const j = JSON.parse(raw) as { events?: CalendarioBaseEvent[] }
      if (Array.isArray(j.events)) return j.events
    } catch {
      /* continue */
    }
  }
  return []
}

function mergeForComparto(comparto: CalendarioComparto, db: CalendarioDb): CalendarioMergedEvent[] {
  const revByKey = new Map<string, CalendarioSlotRevision>()
  for (const r of db.revisions) {
    if (r.comparto === comparto) revByKey.set(r.stableKey, r)
  }

  if (comparto !== "corsi") {
    return []
  }

  const base = loadPlanningBaseEvents()
  return base.map((e) => {
    const sk = stableKeyFromParts(e.zona, e.dow, e.start, e.title)
    const r = revByKey.get(sk)
    return {
      ...e,
      stableKey: sk,
      istruttoreId: r?.istruttoreId ?? null,
      staffOverride: r?.staffOverride ?? null,
      note: r?.note ?? null,
      updatedAt: r?.updatedAt,
      updatedBy: r?.updatedBy,
    }
  })
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
    dow?: number
    start?: string
    title?: string
    zona?: string
    istruttoreId?: string | null
    staffOverride?: string | null
    note?: string | null
    clear?: boolean
  }

  const stableKey = String(body.stableKey ?? "").trim()
  if (!stableKey) return res.status(400).json({ message: "stableKey obbligatorio" })

  let db = readCalendarioDb()

  if (body.clear) {
    db = deleteRevision(db, raw, stableKey)
    writeCalendarioDb(db)
    return res.json({ ok: true })
  }

  const dow = Number(body.dow)
  const start = String(body.start ?? "").trim()
  const title = String(body.title ?? "").trim()
  if (!Number.isFinite(dow) || dow < 0 || dow > 6 || !start || !title) {
    return res.status(400).json({ message: "dow, start, title obbligatori per salvataggio" })
  }

  const now = new Date().toISOString()
  const rev: CalendarioSlotRevision = {
    comparto: raw,
    stableKey,
    dow,
    start,
    title,
    zona: body.zona != null ? String(body.zona) : undefined,
    istruttoreId: body.istruttoreId === undefined ? undefined : body.istruttoreId,
    staffOverride: body.staffOverride === undefined ? undefined : body.staffOverride,
    note: body.note === undefined ? undefined : body.note,
    updatedAt: now,
    updatedBy: u.nome || u.username,
  }

  const excelStaff = loadPlanningBaseEvents().find((e) => stableKeyFromParts(e.zona, e.dow, e.start, e.title) === stableKey)?.staff.trim() ?? ""
  const staffOverrideTrim = rev.staffOverride != null ? String(rev.staffOverride).trim() : ""
  const sameStaffAsExcel = !rev.istruttoreId && (!staffOverrideTrim || staffOverrideTrim === excelStaff)
  const noteTrim = rev.note != null ? String(rev.note).trim() : ""
  if (sameStaffAsExcel && !noteTrim) {
    db = deleteRevision(db, raw, stableKey)
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
    u.role === "campus"
  if (!allow) return res.status(403).json({ message: "Permessi insufficienti" })
  const db = readCalendarioDb()
  res.json({ rows: db.instructors })
}

export function postCalendarioInstructor(req: Request, res: Response) {
  const u = req.user!
  if (!canManageInstructors(u)) return res.status(403).json({ message: "Solo admin o utente corsi" })

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
  if (!canManageInstructors(u)) return res.status(403).json({ message: "Solo admin o utente corsi" })

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
  if (!canManageInstructors(u)) return res.status(403).json({ message: "Solo admin o utente corsi" })
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
