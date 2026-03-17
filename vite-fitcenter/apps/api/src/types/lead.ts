export type LeadSource =
  | "website"
  | "facebook"
  | "google"
  | "tour_spontaneo"
  | "sql_server"
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

/** Per filtro consulente bambini: solo lead con categoria "bambini" vengono mostrati a Irene. */
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
  /** Testo libero da Zapier/form (es. "offerta marzo") quando interesse non è uno dei valori predefiniti. */
  interesseDettaglio?: string
  /** "bambini" = visibile solo a consulente bambini (Irene); assente o "generale" = visibile a tutti. */
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
  interesseDettaglio?: string
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
  categoria?: LeadCategoria
}
