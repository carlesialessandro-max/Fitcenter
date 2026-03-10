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
