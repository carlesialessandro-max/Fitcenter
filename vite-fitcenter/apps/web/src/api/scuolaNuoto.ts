import { api } from "./client"

export type ScuolaNuotoParticipant = {
  nome: string | null
  cognome: string | null
  cellulare: string | null
  email: string | null
  eta: number | null
}

export type ScuolaNuotoCorso = {
  key: string
  corso: string
  oraInizio: string | null
  oraFine: string | null
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
  today: () => api.get<ScuolaNuotoTodayResponse>("/scuola-nuoto/today"),
}

