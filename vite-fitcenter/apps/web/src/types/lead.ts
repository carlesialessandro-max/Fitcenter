/** Fonti dei lead: sito web, Facebook, Google, tour spontanei (inserimento manuale), Zapier (webhook). */
export type LeadSource =
  | "website"
  | "facebook"
  | "google"
  | "tour_spontaneo"
  | "sql_server" /** @deprecated solo per storico, non più usato */
  | "zapier"

export type LeadStatus =
  | "nuovo"
  | "contattato"
  | "appuntamento"
  | "tour"
  | "proposta"
  | "chiuso_vinto"
  | "chiuso_perso"

export type InteresseLead = "palestra" | "piscina" | "spa" | "corsi" | "full_premium"

/** "bambini" = visibile solo a consulente bambini (Irene). */
export type LeadCategoria = "bambini" | "generale"

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
  /** Testo libero (es. "offerta marzo") quando interesse non è un valore predefinito. */
  interesseDettaglio?: string
  categoria?: LeadCategoria
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
  categoria?: LeadCategoria
  note?: string
}

export interface LeadUpdate {
  stato?: LeadStatus
  interesse?: InteresseLead
  consulenteId?: string
  consulenteNome?: string
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
  tour_spontaneo: "Tour spontaneo",
  sql_server: "SQL Server (storico)",
  zapier: "Zapier",
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
