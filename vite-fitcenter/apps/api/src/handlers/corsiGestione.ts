import type { Request, Response } from "express"
import type { User } from "../store/auth.js"
import { readCorsiGestioneDb, writeCorsiGestioneDb, type CorsiGestioneDb } from "../store/corsi-gestione-db.js"

function canCorsiGestione(u: User): boolean {
  return u.role === "admin" || u.role === "corsi" || u.role === "istruttore"
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** Note corso: la chiave contiene `__giorno__` (formato gruppo Corsi). */
function filterCourseKeysForDay(map: Record<string, string>, giorno: string): Record<string, string> {
  const needle = `__${giorno}__`
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (k.includes(needle)) out[k] = v
  }
  return out
}

function filterCourseNotesForDay(db: CorsiGestioneDb, giorno: string): Record<string, string> {
  return filterCourseKeysForDay(db.courseNotes, giorno)
}

function filterCourseInstructorsForDay(db: CorsiGestioneDb, giorno: string): Record<string, string> {
  return filterCourseKeysForDay(db.courseInstructors ?? {}, giorno)
}

function filterCourseNotesForRange(db: CorsiGestioneDb, from: string, to: string): Record<string, string> {
  if (from > to) return {}
  const out: Record<string, string> = {}
  const cur = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getFullYear()
    const mo = String(cur.getMonth() + 1).padStart(2, "0")
    const d = String(cur.getDate()).padStart(2, "0")
    const giorno = `${y}-${mo}-${d}`
    Object.assign(out, filterCourseNotesForDay(db, giorno))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function filterCourseInstructorsForRange(db: CorsiGestioneDb, from: string, to: string): Record<string, string> {
  if (from > to) return {}
  const out: Record<string, string> = {}
  const cur = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getFullYear()
    const mo = String(cur.getMonth() + 1).padStart(2, "0")
    const d = String(cur.getDate()).padStart(2, "0")
    const giorno = `${y}-${mo}-${d}`
    Object.assign(out, filterCourseInstructorsForDay(db, giorno))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function sliceAppelloRange(db: CorsiGestioneDb, from: string, to: string): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {}
  for (const [day, m] of Object.entries(db.appelloByDay)) {
    if (day >= from && day <= to && m && typeof m === "object") out[day] = { ...m }
  }
  return out
}

/** GET: ?giorno= oppure ?from=&to= (mese assenze). */
export function getCorsiGestione(req: Request, res: Response) {
  const u = req.user!
  if (!canCorsiGestione(u)) return res.status(403).json({ message: "Permessi insufficienti" })

  const giorno = String(req.query.giorno ?? "").trim()
  const from = String(req.query.from ?? "").trim()
  const to = String(req.query.to ?? "").trim()

  const db = readCorsiGestioneDb()

  if (from && to) {
    if (!isYmd(from) || !isYmd(to)) return res.status(400).json({ message: "from e to devono essere YYYY-MM-DD" })
    return res.json({
      courseNotes: filterCourseNotesForRange(db, from, to),
      courseInstructors: filterCourseInstructorsForRange(db, from, to),
      appelloByDay: sliceAppelloRange(db, from, to),
    })
  }

  if (giorno) {
    if (!isYmd(giorno)) return res.status(400).json({ message: "giorno deve essere YYYY-MM-DD" })
    return res.json({
      courseNotes: filterCourseNotesForDay(db, giorno),
      courseInstructors: filterCourseInstructorsForDay(db, giorno),
      appello: db.appelloByDay[giorno] && typeof db.appelloByDay[giorno] === "object" ? { ...db.appelloByDay[giorno] } : {},
    })
  }

  return res.status(400).json({ message: "Specificare giorno oppure from e to" })
}

const MAX_NOTE = 12_000
const MAX_INSTRUCTOR = 200
const MAX_KEY = 400

export function patchCorsiGestione(req: Request, res: Response) {
  const u = req.user!
  if (!canCorsiGestione(u)) return res.status(403).json({ message: "Permessi insufficienti" })

  const body = req.body as {
    courseNote?: { key?: string; text?: string | null }
    courseInstructor?: { key?: string; name?: string | null }
    appello?: { giorno?: string; merge?: Record<string, boolean> }
  }

  let db = readCorsiGestioneDb()
  let changed = false

  if (body.courseNote) {
    const key = String(body.courseNote.key ?? "").trim()
    if (!key || key.length > MAX_KEY) return res.status(400).json({ message: "courseNote.key non valida" })
    const textRaw = body.courseNote.text
    const text = textRaw == null ? "" : String(textRaw)
    if (text.length > MAX_NOTE) return res.status(400).json({ message: "Nota troppo lunga" })

    if (!text.trim()) {
      if (db.courseNotes[key] !== undefined) {
        const next = { ...db.courseNotes }
        delete next[key]
        db = { ...db, courseNotes: next }
        changed = true
      }
    } else {
      db = { ...db, courseNotes: { ...db.courseNotes, [key]: text } }
      changed = true
    }
  }

  if (body.courseInstructor) {
    if (u.role !== "admin" && u.role !== "corsi") {
      return res.status(403).json({ message: "Solo responsabile corsi può modificare l'istruttore" })
    }
    const key = String(body.courseInstructor.key ?? "").trim()
    if (!key || key.length > MAX_KEY) return res.status(400).json({ message: "courseInstructor.key non valida" })
    const nameRaw = body.courseInstructor.name
    const name = nameRaw == null ? "" : String(nameRaw).trim()
    if (name.length > MAX_INSTRUCTOR) return res.status(400).json({ message: "Nome istruttore troppo lungo" })
    const prevMap = db.courseInstructors ?? {}
    if (!name) {
      if (prevMap[key] !== undefined) {
        const next = { ...prevMap }
        delete next[key]
        db = { ...db, courseInstructors: next }
        changed = true
      }
    } else {
      db = { ...db, courseInstructors: { ...prevMap, [key]: name } }
      changed = true
    }
  }

  if (body.appello) {
    const giorno = String(body.appello.giorno ?? "").trim()
    const merge = body.appello.merge
    if (!isYmd(giorno)) return res.status(400).json({ message: "appello.giorno deve essere YYYY-MM-DD" })
    if (!merge || typeof merge !== "object") return res.status(400).json({ message: "appello.merge obbligatorio" })
    const prev = db.appelloByDay[giorno] && typeof db.appelloByDay[giorno] === "object" ? { ...db.appelloByDay[giorno] } : {}
    for (const [k, v] of Object.entries(merge)) {
      const kk = String(k).trim()
      if (!kk || kk.length > MAX_KEY) continue
      if (typeof v === "boolean") prev[kk] = v
    }
    db = { ...db, appelloByDay: { ...db.appelloByDay, [giorno]: prev } }
    changed = true
  }

  if (!changed) {
    if ((body.courseNote || body.courseInstructor) && !body.appello) return res.json({ ok: true })
    return res.status(400).json({ message: "Nessun aggiornamento richiesto" })
  }
  writeCorsiGestioneDb(db)
  res.json({ ok: true })
}
