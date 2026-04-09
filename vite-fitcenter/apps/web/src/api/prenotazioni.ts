import { api } from "./client"

export type PrenotazioneCorsoRow = {
  giorno?: string
  servizio?: string
  oraInizio?: string
  oraFine?: string
  partecipanti?: number
  cognome?: string
  nome?: string
  prenotatoIl?: string
  note?: string
  raw: Record<string, unknown>
}

export const prenotazioniApi = {
  listPrenotazioni: (giorno?: string) => {
    const qs = giorno ? `?giorno=${encodeURIComponent(giorno)}` : ""
    return api.get<{ rows: PrenotazioneCorsoRow[]; meta?: { fromSql?: boolean; connected?: boolean; sqlError?: string | null; giorno?: string | null; view?: string; dateCol?: string | null; count?: number; cols?: string[]; sql?: { server: string | null; database: string | null } } }>(
      `/prenotazioni/prenotazioni${qs}`
    )
  },
}

