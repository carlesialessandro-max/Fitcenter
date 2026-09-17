import { api } from "./client"

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

/** Risposta GET ?giorno=YYYY-MM-DD */
export type CorsiGestioneDayDto = {
  courseNotes: Record<string, string>
  courseInstructors?: Record<string, string>
  appello: Record<string, boolean>
  walkIns?: CorsiWalkIn[]
}

/** Risposta GET ?from=&to= (es. mese assenze) */
export type CorsiGestioneRangeDto = {
  courseNotes: Record<string, string>
  courseInstructors?: Record<string, string>
  appelloByDay: Record<string, Record<string, boolean>>
  walkInsByDay?: Record<string, CorsiWalkIn[]>
}

export type CorsiGestionePatchBody = {
  courseNote?: { key: string; text: string | null }
  courseInstructor?: { key: string; name: string | null }
  appello?: { giorno: string; merge: Record<string, boolean> }
  walkIn?: {
    giorno: string
    add?: {
      id?: string
      groupKey: string
      servizio: string
      oraInizio?: string
      oraFine?: string
      idUtente?: string
      cognome: string
      nome: string
      email?: string
      sms?: string
    }
    removeId?: string
  }
}

export type CorsiClienteSearchHit = {
  id: string
  cognome: string
  nome: string
  email?: string
  telefono?: string
  tessera?: string
}

export const corsiGestioneApi = {
  getByDay: (giorno: string) =>
    api.get<CorsiGestioneDayDto>(`/data/corsi/gestione?giorno=${encodeURIComponent(giorno)}`),
  getByRange: (from: string, to: string) =>
    api.get<CorsiGestioneRangeDto>(
      `/data/corsi/gestione?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  searchClienti: (q: string) =>
    api.get<{ rows: CorsiClienteSearchHit[] }>(
      `/data/corsi/clienti-search?q=${encodeURIComponent(q)}`,
    ),
  patch: (body: CorsiGestionePatchBody) => api.patch<{ ok: boolean }>("/data/corsi/gestione", body),
}
