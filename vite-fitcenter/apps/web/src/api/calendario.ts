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
  createdAt: string
  updatedAt: string
}

export type CalendarioMergedEventDto = {
  id: string
  zona: string
  sheet: string
  dow: number
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
  stableKey: string
  clear?: boolean
  dow?: number
  start?: string
  title?: string
  zona?: string
  istruttoreId?: string | null
  staffOverride?: string | null
  note?: string | null
}

export const calendarioApi = {
  getComparto: (comparto: CalendarioComparto) =>
    api.get<CalendarioCompartoResponse>(`/data/calendario/${encodeURIComponent(comparto)}`),
  patchSlot: (comparto: CalendarioComparto, body: PatchCalendarioSlotBody) =>
    api.patch<{ ok: boolean }>(`/data/calendario/${encodeURIComponent(comparto)}/slot`, body),
  listInstructors: () => api.get<{ rows: CalendarioIstruttore[] }>("/data/calendario/instructors"),
  postInstructor: (body: { nome: string; cognome: string; telefono?: string; email?: string }) =>
    api.post<CalendarioIstruttore>("/data/calendario/instructors", body),
  putInstructor: (id: string, body: { nome?: string; cognome?: string; telefono?: string; email?: string }) =>
    api.put<CalendarioIstruttore>(`/data/calendario/instructors/${encodeURIComponent(id)}`, body),
  deleteInstructor: (id: string) => api.delete<{ ok: boolean }>(`/data/calendario/instructors/${encodeURIComponent(id)}`),
}
