/** Fonti dei lead: moduli sito web, Facebook, Google, import da SQL Server */
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

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Sito web",
  facebook: "Facebook Ads",
  google: "Google Ads",
  sql_server: "Microsoft SQL Server",
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  nuovo: "Nuovo",
  contattato: "Contattato",
  appuntamento: "Appuntamento",
  tour: "Tour",
  proposta: "Proposta",
  chiuso_vinto: "Chiuso Vinto",
  chiuso_perso: "Chiuso Perso",
}

export const INTERESSE_LABELS: Record<InteresseLead, string> = {
  palestra: "Palestra",
  piscina: "Piscina",
  spa: "Spa",
  corsi: "Corsi",
  full_premium: "Full Premium",
}
