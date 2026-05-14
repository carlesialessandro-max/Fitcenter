import { readJson, writeJson } from "./persist.js"

const FILE = "corsi-gestione.json"

export type CorsiGestioneDb = {
  /** Chiave es. `v1:servizio__YYYY-MM-DD__…` come in pagina Corsi. */
  courseNotes: Record<string, string>
  /** Per ogni giorno ISO, override appello `groupKey::participantStableKey` → presente manuale. */
  appelloByDay: Record<string, Record<string, boolean>>
}

const DEFAULT: CorsiGestioneDb = { courseNotes: {}, appelloByDay: {} }

export function readCorsiGestioneDb(): CorsiGestioneDb {
  return readJson<CorsiGestioneDb>(FILE, DEFAULT)
}

export function writeCorsiGestioneDb(db: CorsiGestioneDb): void {
  writeJson(FILE, db)
}
