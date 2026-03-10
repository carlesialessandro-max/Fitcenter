export type LeadSource =
  | "website"
  | "facebook"
  | "google"
  | "sql_server"

export type LeadStatus =
  | "nuovo"
  | "contattato"
  | "appuntamento"
  | "tour"
  | "proposta"
  | "chiuso_vinto"
  | "chiuso_perso"

export type InteresseLead = "palestra" | "piscina" | "spa" | "corsi" | "full_premium"

export interface Lead {
  id: string
  nome: string
  cognome: string
  email: string
  telefono: string
  fonte: LeadSource
  fonteDettaglio?: string
  stato: LeadStatus
  interesse?: InteresseLead
  consulenteId?: string
  consulenteNome?: string
  note?: string
  createdAt: string
  updatedAt: string
  abbonamentoId?: string
}

export interface LeadCreate {
  nome: string
  cognome: string
  email: string
  telefono: string
  fonte: LeadSource
  fonteDettaglio?: string
  interesse?: InteresseLead
  note?: string
}

export interface LeadUpdate {
  stato?: LeadStatus
  interesse?: InteresseLead
  consulenteId?: string
  note?: string
}

export interface LeadFilters {
  fonte?: LeadSource
  stato?: LeadStatus
  consulenteId?: string
  search?: string
}
