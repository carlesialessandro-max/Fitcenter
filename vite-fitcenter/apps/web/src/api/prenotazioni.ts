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

export type AccessoUtenteRow = {
  idUtente?: string
  cognome?: string
  nome?: string
  dataEntrata?: string
  dataUscita?: string
  raw: Record<string, unknown>
}

export const prenotazioniApi = {
  listPrenotazioni: (giorno?: string) => {
    const qs = giorno ? `?giorno=${encodeURIComponent(giorno)}` : ""
    return api.get<{ rows: PrenotazioneCorsoRow[]; meta?: { fromSql?: boolean; connected?: boolean; sqlError?: string | null; queryError?: string | null; giorno?: string | null; view?: string; dateCol?: string | null; count?: number; dayCount?: number | null; dayCountExpr?: number | null; cols?: string[]; sql?: { server: string | null; database: string | null }; cs?: { server: string | null; database: string | null } } }>(
      `/prenotazioni/prenotazioni${qs}`
    )
  },
  listPrenotazioniRange: (params: { from: string; to: string }) => {
    const qs = `?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`
    return api.get<{ rows: PrenotazioneCorsoRow[]; meta?: { fromSql?: boolean; from?: string; to?: string; days?: number; count?: number } }>(
      `/prenotazioni/prenotazioni-range${qs}`
    )
  },
  listAccessiRange: (params: { from: string; to: string }) => {
    const qs = `?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`
    return api.get<{ rows: AccessoUtenteRow[]; meta?: { fromSql?: boolean; from?: string; to?: string; days?: number; count?: number } }>(
      `/prenotazioni/accessi-range${qs}`
    )
  },
  notifyEmail: (body: { giorno: string; groupKey: string; subject: string; text: string }) =>
    api.post<{ ok: boolean; recipients: number }>("/prenotazioni/notify-email", body),
  listNoShowBlocks: () =>
    api.get<{ rows: { email: string; blockedAt: string; until?: string; reason: string; monthKey: string; count: number }[] }>(
      "/prenotazioni/no-show/blocks"
    ),
  notifyAndBlockNoShow: (body: {
    email: string
    subject: string
    text: string
    monthKey: string
    count: number
    blockDays?: number
    absences?: { day: string; servizio: string; oraInizio?: string; oraFine?: string }[]
  }) =>
    api.post<{
      ok: boolean
      blocked: { email: string; blockedAt: string; until?: string; reason: string; monthKey: string; count: number }
      gestionale?: { ok: boolean; rowsAffected?: number; message?: string }
    }>(
      "/prenotazioni/no-show/notify-and-block",
      body
    ),
  unblockNoShow: (email: string) =>
    api.delete<{ ok: boolean; gestionale?: { ok: boolean; rowsAffected?: number; message?: string } }>(`/prenotazioni/no-show/blocks/${encodeURIComponent(email)}`),
}

