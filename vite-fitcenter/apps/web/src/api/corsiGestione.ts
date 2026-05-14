import { api } from "./client"

/** Risposta GET ?giorno=YYYY-MM-DD */
export type CorsiGestioneDayDto = {
  courseNotes: Record<string, string>
  appello: Record<string, boolean>
}

/** Risposta GET ?from=&to= (es. mese assenze) */
export type CorsiGestioneRangeDto = {
  courseNotes: Record<string, string>
  appelloByDay: Record<string, Record<string, boolean>>
}

export type CorsiGestionePatchBody = {
  courseNote?: { key: string; text: string | null }
  appello?: { giorno: string; merge: Record<string, boolean> }
}

export const corsiGestioneApi = {
  getByDay: (giorno: string) =>
    api.get<CorsiGestioneDayDto>(`/data/corsi/gestione?giorno=${encodeURIComponent(giorno)}`),
  getByRange: (from: string, to: string) =>
    api.get<CorsiGestioneRangeDto>(
      `/data/corsi/gestione?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  patch: (body: CorsiGestionePatchBody) => api.patch<{ ok: boolean }>("/data/corsi/gestione", body),
}
