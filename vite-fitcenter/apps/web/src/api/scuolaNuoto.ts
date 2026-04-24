import { api } from "./client"

export type ScuolaNuotoParticipant = {
  key: string
  nome: string | null
  cognome: string | null
  cellulare: string | null
  email: string | null
  eta: number | null
}

export type ScuolaNuotoCorso = {
  key: string
  baseKey: string
  corso: string
  oraInizio: string | null
  oraFine: string | null
  corsia: string | null
  periodo: string | null
  livello: string | null
  istruttore: string | null
  vasca: string | null
  servizio: string | null
  utenti: ScuolaNuotoParticipant[]
}

export type ScuolaNuotoTodayResponse = {
  today: string
  weekday: string
  countRows: number
  countMatched: number
  corsi: ScuolaNuotoCorso[]
}

export const scuolaNuotoApi = {
  today: (day?: string) => api.get<ScuolaNuotoTodayResponse>(`/scuola-nuoto/today${day ? `?day=${encodeURIComponent(day)}` : ""}`),
  overrides: (day?: string) => api.get<{ day: string | null; courseNotes: Record<string, string>; childNotes: Record<string, string>; levelOverrides: Record<string, string> }>(
    `/scuola-nuoto/overrides${day ? `?day=${encodeURIComponent(day)}` : ""}`
  ),
  setCourseNote: (baseKey: string, note: string, day?: string) => api.post<{ ok: true }>(`/scuola-nuoto/course-note`, { baseKey, note, day }),
  setChildNote: (childKey: string, baseKey: string, note: string, day?: string) => api.post<{ ok: true }>(`/scuola-nuoto/child-note`, { childKey, baseKey, note, day }),
  setLevelOverride: (childKey: string, baseKey: string, livello: string, day?: string) =>
    api.post<{ ok: true }>(`/scuola-nuoto/level-override`, { childKey, baseKey, livello, day }),
}

