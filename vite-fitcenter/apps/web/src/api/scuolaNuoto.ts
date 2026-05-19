import { api } from "./client"

export type ScuolaNuotoParticipant = {
  key: string
  idUtente: number | null
  idIscrizione: number | null
  nome: string | null
  cognome: string | null
  cellulare: string | null
  email: string | null
  eta: number | null
}

export type ScuolaNuotoCorso = {
  key: string
  baseKey: string
  idCorso: number | null
  corso: string
  oraInizio: string | null
  oraFine: string | null
  corsia: string | null
  periodo: string | null
  livello: string | null
  istruttore: string | null
  vasca: string | null
  servizio: string | null
  maxPartecipanti: number | null
  utenti: ScuolaNuotoParticipant[]
}

export type ScuolaNuotoTodayResponse = {
  today: string
  weekday: string
  countRows: number
  countMatched: number
  corsi: ScuolaNuotoCorso[]
  debug?: any
}

export type ScuolaNuotoNotesPeriod = "current_week" | "previous_week" | "month"

export type ScuolaNuotoArchivedNote = {
  date: string
  weekday: string
  kind: "course" | "child"
  baseKey: string
  childKey?: string
  note: string
  updatedAt?: string
}

export type ScuolaNuotoNotesArchiveResponse = {
  period: ScuolaNuotoNotesPeriod
  from: string
  to: string
  label: string
  rows: ScuolaNuotoArchivedNote[]
}

export const scuolaNuotoApi = {
  today: (params?: { day?: string; date?: string; debug?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.day) qs.set("day", params.day)
    if (params?.date) qs.set("date", params.date)
    if (params?.debug) qs.set("debug", "1")
    const s = qs.toString()
    return api.get<ScuolaNuotoTodayResponse>(`/scuola-nuoto/today${s ? `?${s}` : ""}`)
  },
  overrides: (day?: string) =>
    api.get<{ day: string | null; courseNotes: Record<string, string>; childNotes: Record<string, string>; levelOverrides: Record<string, string> }>(
      `/scuola-nuoto/overrides${day ? `?day=${encodeURIComponent(day)}` : ""}`
    ),
  notesArchive: (period: ScuolaNuotoNotesPeriod) =>
    api.get<ScuolaNuotoNotesArchiveResponse>(`/scuola-nuoto/notes?period=${encodeURIComponent(period)}`),
  setCourseNote: (baseKey: string, note: string, day?: string, date?: string) =>
    api.post<{ ok: true }>(`/scuola-nuoto/course-note`, { baseKey, note, day, date }),
  setChildNote: (childKey: string, baseKey: string, note: string, day?: string, date?: string) =>
    api.post<{ ok: true }>(`/scuola-nuoto/child-note`, { childKey, baseKey, note, day, date }),
  setLevelOverride: (childKey: string, baseKey: string, livello: string, day?: string) =>
    api.post<{ ok: true }>(`/scuola-nuoto/level-override`, { childKey, baseKey, livello, day }),
  moveIscrizione: (body: { idIscrizione: number; targetIdCorso: number; idUtente?: number | null }) =>
    api.post<{ ok: true; rowsAffected: number }>(`/scuola-nuoto/move-iscrizione`, body),
}

