import { api } from "./client"

export type CalendarioComparto =
  | "corsi"
  | "scuola_nuoto"
  | "piscina"
  | "reception"
  | "danza"
  | "campus"
  | "sala_fitness"
  | "acquaticita"
  | "spogliatoi"
  | "consulenti"

export type CalendarioIstruttore = {
  id: string
  nome: string
  cognome: string
  telefono: string
  email: string
  attivitaSvolta?: string
  costoOrario?: number | null
  createdAt: string
  updatedAt: string
}

export type PianoOperativoRepartoDto = {
  comparto: CalendarioComparto
  label: string
  events: CalendarioMergedEventDto[]
}

export type PianoOperativoResponse = {
  dateIso: string
  reparti: PianoOperativoRepartoDto[]
  instructors: CalendarioIstruttore[]
}

export type CalendarioMergedEventDto = {
  id: string
  zona: string
  sheet: string
  dow: number
  /** YYYY-MM-DD: slot solo per quel giorno (calendari server). */
  dateIso?: string | null
  start: string
  title: string
  staff: string
  stableKey: string
  staffDisplay: string
  istruttoreId?: string | null
  staffOverride?: string | null
  note?: string | null
  updatedAt?: string
  updatedBy?: string
}

export type CalendarioCompartoResponse = {
  comparto: CalendarioComparto
  events: CalendarioMergedEventDto[]
  instructors: CalendarioIstruttore[]
}

export type PatchCalendarioSlotBody = {
  /** Obbligatorio salvo `create: true`. */
  stableKey?: string
  create?: boolean
  removed?: boolean
  clear?: boolean
  dow?: number
  dateIso?: string | null
  start?: string
  title?: string
  zona?: string
  istruttoreId?: string | null
  staffOverride?: string | null
  note?: string | null
}

export const calendarioApi = {
  getPianoOperativo: (dateIso: string) =>
    api.get<PianoOperativoResponse>(`/data/calendario/piano-operativo?date=${encodeURIComponent(dateIso)}`),
  getComparto: (comparto: CalendarioComparto) =>
    api.get<CalendarioCompartoResponse>(`/data/calendario/${encodeURIComponent(comparto)}`),
  patchSlot: (comparto: CalendarioComparto, body: PatchCalendarioSlotBody) =>
    api.patch<{ ok: boolean; stableKey?: string }>(`/data/calendario/${encodeURIComponent(comparto)}/slot`, body),
  listInstructors: () => api.get<{ rows: CalendarioIstruttore[] }>("/data/calendario/instructors"),
  postInstructor: (body: {
    nome: string
    cognome: string
    telefono?: string
    email?: string
    attivitaSvolta?: string
    costoOrario?: number | null
  }) => api.post<CalendarioIstruttore>("/data/calendario/instructors", body),
  putInstructor: (
    id: string,
    body: {
      nome?: string
      cognome?: string
      telefono?: string
      email?: string
      attivitaSvolta?: string
      costoOrario?: number | null
    }
  ) =>
    api.put<CalendarioIstruttore>(`/data/calendario/instructors/${encodeURIComponent(id)}`, body),
  deleteInstructor: (id: string) => api.delete<{ ok: boolean }>(`/data/calendario/instructors/${encodeURIComponent(id)}`),
  sendTurniEmail: (comparto: "piscina", body: { istruttoreId: string; weekStart?: string }) =>
    api.post<{ ok: boolean; sent: boolean; to: string }>(
      `/data/calendario/${encodeURIComponent(comparto)}/send-turni`,
      body
    ),
}
