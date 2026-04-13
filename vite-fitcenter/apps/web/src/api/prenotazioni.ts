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
  email?: string
  sms?: string
  dataUltimoAcesso?: string
  inAttesa?: boolean
  raw: Record<string, unknown>
}

export const prenotazioniApi = {
  listPrenotazioni: (giorno?: string) => {
    const qs = giorno ? `?giorno=${encodeURIComponent(giorno)}` : ""
    return api.get<{ rows: PrenotazioneCorsoRow[]; meta?: { fromSql?: boolean; connected?: boolean; sqlError?: string | null; queryError?: string | null; giorno?: string | null; view?: string; dateCol?: string | null; count?: number; dayCount?: number | null; dayCountExpr?: number | null; cols?: string[]; sql?: { server: string | null; database: string | null }; cs?: { server: string | null; database: string | null } } }>(
      `/prenotazioni/prenotazioni${qs}`
    )
  },
  notifyEmail: (body: { giorno: string; groupKey: string; subject: string; text: string }) =>
    api.post<{ ok: boolean; recipients: number }>("/prenotazioni/notify-email", body),
}

