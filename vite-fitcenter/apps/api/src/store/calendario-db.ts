import { readJson, writeJson } from "./persist.js"
import type { CalendarioDb, CalendarioComparto, CalendarioIstruttore, CalendarioSlotRevision } from "../types/calendario.js"

const FILE = "calendario-reparti.json"

const DEFAULT: CalendarioDb = { instructors: [], revisions: [] }

export function readCalendarioDb(): CalendarioDb {
  return readJson<CalendarioDb>(FILE, DEFAULT)
}

export function writeCalendarioDb(db: CalendarioDb): void {
  writeJson(FILE, db)
}

export function stableKeyFromParts(zona: string, dow: number, start: string, title: string): string {
  const t = title.trim().replace(/\s+/g, " ")
  return `${zona}|${dow}|${start}|${t}`
}

export function upsertRevision(db: CalendarioDb, rev: CalendarioSlotRevision): CalendarioDb {
  const next = { ...db, revisions: db.revisions.filter((r) => !(r.comparto === rev.comparto && r.stableKey === rev.stableKey)) }
  next.revisions.push(rev)
  return next
}

export function deleteRevision(db: CalendarioDb, comparto: CalendarioComparto, stableKey: string): CalendarioDb {
  return {
    ...db,
    revisions: db.revisions.filter((r) => !(r.comparto === comparto && r.stableKey === stableKey)),
  }
}

export function upsertInstructor(db: CalendarioDb, row: CalendarioIstruttore): CalendarioDb {
  const others = db.instructors.filter((x) => x.id !== row.id)
  return { ...db, instructors: [...others, row].sort((a, b) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome)) }
}

export function deleteInstructor(db: CalendarioDb, id: string): CalendarioDb {
  return { ...db, instructors: db.instructors.filter((x) => x.id !== id) }
}
