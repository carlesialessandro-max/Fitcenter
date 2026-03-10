import { api } from "./client"

export type TipoContatto = "lead" | "cliente"
export type EsitoChiamata = "risposto" | "non_risposto" | "occupato" | "altro"

export interface Chiamata {
  id: string
  consulenteId: string
  consulenteNome: string
  tipo: TipoContatto
  leadId?: string
  clienteId?: string
  nomeContatto: string
  telefono: string
  dataOra: string
  durataSecondi?: number
  esito?: EsitoChiamata
  note?: string
}

export interface ChiamataCreate {
  consulenteId: string
  consulenteNome: string
  tipo: TipoContatto
  leadId?: string
  clienteId?: string
  nomeContatto: string
  telefono: string
  durataSecondi?: number
  esito?: EsitoChiamata
  note?: string
}

export interface ChiamateStats {
  oggi: number
  settimana: number
  perConsulente: { consulenteNome: string; count: number }[]
}

export const chiamateApi = {
  list: (params?: { consulenteId?: string; da?: string; a?: string; tipo?: string }) => {
    const q = new URLSearchParams()
    if (params?.consulenteId) q.set("consulenteId", params.consulenteId)
    if (params?.da) q.set("da", params.da)
    if (params?.a) q.set("a", params.a)
    if (params?.tipo) q.set("tipo", params.tipo)
    const query = q.toString()
    return api.get<Chiamata[]>(`/chiamate${query ? `?${query}` : ""}`)
  },
  create: (data: ChiamataCreate) => api.post<Chiamata>("/chiamate", data),
  getStats: () => api.get<ChiamateStats>("/chiamate/stats"),
}
