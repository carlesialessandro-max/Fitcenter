import { api } from "./client"

export type PrenotazioneCorsoRow = {
  giorno?: string
  servizio?: string
  oraInizio?: string
  oraFine?: string
  partecipanti?: number
  raw: Record<string, unknown>
}

export const prenotazioniApi = {
  listPrenotazioni: (giorno?: string) => {
    const qs = giorno ? `?giorno=${encodeURIComponent(giorno)}` : ""
    return api.get<{ rows: PrenotazioneCorsoRow[]; meta?: { fromSql?: boolean; giorno?: string | null } }>(
      `/prenotazioni/prenotazioni${qs}`
    )
  },
}

