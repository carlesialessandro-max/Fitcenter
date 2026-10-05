import { api } from "./client"

export type LpagaLivello = {
  id: string
  nome: string
  retribuzione: number
  fissa: boolean
  attivo: boolean
}

export type LpagaPersonale = {
  id: string
  nome: string
  iban?: string
  attivo: boolean
}

export type LpagaTurnoRow = {
  id: string
  personaleId: string
  livelloId: string
  giorno: string
  quantita: number
  importo: number
  note?: string
  creatoDa: string
  createdAt: string
  personaleNome: string
  livelloNome: string
  presenzaValore: number | null
  presenzaDa: string | null
  presenzaAt: string | null
}

export type LpagaMensilitaRow = {
  personaleId: string
  personaleNome: string
  iban: string
  mese: string
  ore: number
  importo: number
  presenzaOre: number
  nTurni: number
  nControllati: number
  bonifico: number
  nota: string
  chiuso: boolean
}

export type LibroPagaSnapshot = {
  storage: "sql" | "json"
  mese: string
  livelli: LpagaLivello[]
  personale: LpagaPersonale[]
  turni: LpagaTurnoRow[]
  mensilita: LpagaMensilitaRow[]
}

export const libroPagaApi = {
  get: (mese: string) => api.get<LibroPagaSnapshot>(`/libro-paga?mese=${encodeURIComponent(mese)}`),
  createLivello: (body: { nome: string; retribuzione: number; fissa: boolean; attivo?: boolean }) =>
    api.post<{ livello: LpagaLivello }>("/libro-paga/livelli", body),
  patchLivello: (id: string, body: Partial<Pick<LpagaLivello, "nome" | "retribuzione" | "fissa" | "attivo">>) =>
    api.patch<{ livello: LpagaLivello }>(`/libro-paga/livelli/${encodeURIComponent(id)}`, body),
  deleteLivello: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/livelli/${encodeURIComponent(id)}`),
  createPersonale: (body: { nome: string; iban?: string; attivo?: boolean }) =>
    api.post<{ personale: LpagaPersonale }>("/libro-paga/personale", body),
  patchPersonale: (id: string, body: Partial<Pick<LpagaPersonale, "nome" | "iban" | "attivo">>) =>
    api.patch<{ personale: LpagaPersonale }>(`/libro-paga/personale/${encodeURIComponent(id)}`, body),
  deletePersonale: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/personale/${encodeURIComponent(id)}`),
  createTurno: (body: { personaleId: string; livelloId: string; giorno: string; quantita: number; note?: string }) =>
    api.post<{ turno: unknown }>("/libro-paga/turni", body),
  deleteTurno: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/turni/${encodeURIComponent(id)}`),
  putPresenza: (turnoId: string, valore: number) =>
    api.put<{ presenza: unknown }>(`/libro-paga/turni/${encodeURIComponent(turnoId)}/presenza`, { valore }),
  putMensilita: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) =>
    api.put<{ mensilita: unknown }>("/libro-paga/mensilita", body),
}
