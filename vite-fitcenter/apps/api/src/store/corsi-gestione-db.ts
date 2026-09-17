import { readJson, writeJson } from "./persist.js"

const FILE = "corsi-gestione.json"

export type CorsiWalkIn = {
  id: string
  groupKey: string
  servizio: string
  oraInizio?: string
  oraFine?: string
  idUtente?: string
  cognome: string
  nome: string
  email?: string
  sms?: string
  addedAt: string
  addedBy?: string
}

export type CorsiGestioneDb = {
  /** Chiave es. `v1:servizio__YYYY-MM-DD__…` come in pagina Corsi. */
  courseNotes: Record<string, string>
  /** Override nome istruttore per corso (chiave come courseNotes). */
  courseInstructors: Record<string, string>
  /** Per ogni giorno ISO, override appello `groupKey::participantStableKey` → presente manuale. */
  appelloByDay: Record<string, Record<string, boolean>>
  /** Ingressi senza prenotazione, per giorno ISO. */
  walkInsByDay: Record<string, CorsiWalkIn[]>
}

const DEFAULT: CorsiGestioneDb = {
  courseNotes: {},
  courseInstructors: {},
  appelloByDay: {},
  walkInsByDay: {},
}

function sanitizeWalkIn(raw: unknown): CorsiWalkIn | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = String(r.id ?? "").trim()
  const groupKey = String(r.groupKey ?? "").trim()
  const cognome = String(r.cognome ?? "").trim()
  const nome = String(r.nome ?? "").trim()
  const servizio = String(r.servizio ?? "").trim()
  if (!id || !groupKey || (!cognome && !nome)) return null
  const out: CorsiWalkIn = {
    id,
    groupKey,
    servizio,
    cognome,
    nome,
    addedAt: String(r.addedAt ?? "").trim() || new Date().toISOString(),
  }
  const oraInizio = String(r.oraInizio ?? "").trim()
  const oraFine = String(r.oraFine ?? "").trim()
  const idUtente = String(r.idUtente ?? "").trim()
  const email = String(r.email ?? "").trim()
  const sms = String(r.sms ?? "").trim()
  const addedBy = String(r.addedBy ?? "").trim()
  if (oraInizio) out.oraInizio = oraInizio
  if (oraFine) out.oraFine = oraFine
  if (idUtente) out.idUtente = idUtente
  if (email) out.email = email
  if (sms) out.sms = sms
  if (addedBy) out.addedBy = addedBy
  return out
}

export function readCorsiGestioneDb(): CorsiGestioneDb {
  const raw = readJson<Partial<CorsiGestioneDb>>(FILE, DEFAULT)
  const walkInsByDay: Record<string, CorsiWalkIn[]> = {}
  if (raw.walkInsByDay && typeof raw.walkInsByDay === "object") {
    for (const [day, list] of Object.entries(raw.walkInsByDay)) {
      if (!Array.isArray(list)) continue
      const cleaned = list.map(sanitizeWalkIn).filter((x): x is CorsiWalkIn => x != null)
      if (cleaned.length) walkInsByDay[day] = cleaned
    }
  }
  return {
    courseNotes: raw.courseNotes && typeof raw.courseNotes === "object" ? raw.courseNotes : {},
    courseInstructors: raw.courseInstructors && typeof raw.courseInstructors === "object" ? raw.courseInstructors : {},
    appelloByDay: raw.appelloByDay && typeof raw.appelloByDay === "object" ? raw.appelloByDay : {},
    walkInsByDay,
  }
}

export function writeCorsiGestioneDb(db: CorsiGestioneDb): void {
  writeJson(FILE, db)
}
