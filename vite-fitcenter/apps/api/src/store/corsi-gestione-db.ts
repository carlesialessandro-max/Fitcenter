import { readJson, writeJson } from "./persist.js"

const FILE = "corsi-gestione.json"

export type CorsiGestioneDb = {
  /** Chiave es. `v1:servizio__YYYY-MM-DD__…` come in pagina Corsi. */
  courseNotes: Record<string, string>
  /** Override nome istruttore per corso (chiave come courseNotes). */
  courseInstructors: Record<string, string>
  /** Per ogni giorno ISO, override appello `groupKey::participantStableKey` → presente manuale. */
  appelloByDay: Record<string, Record<string, boolean>>
}

const DEFAULT: CorsiGestioneDb = { courseNotes: {}, courseInstructors: {}, appelloByDay: {} }

export function readCorsiGestioneDb(): CorsiGestioneDb {
  const raw = readJson<Partial<CorsiGestioneDb>>(FILE, DEFAULT)
  return {
    courseNotes: raw.courseNotes && typeof raw.courseNotes === "object" ? raw.courseNotes : {},
    courseInstructors: raw.courseInstructors && typeof raw.courseInstructors === "object" ? raw.courseInstructors : {},
    appelloByDay: raw.appelloByDay && typeof raw.appelloByDay === "object" ? raw.appelloByDay : {},
  }
}

export function writeCorsiGestioneDb(db: CorsiGestioneDb): void {
  writeJson(FILE, db)
}
