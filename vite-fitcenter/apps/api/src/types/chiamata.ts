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
  /** Esito gestionale (es. 07. Appuntamento). */
  esitoCrm?: string
  /** Data/ora evasione (telefonata fatta). */
  evasoAt?: string
  /** Testo storico CRM. */
  note?: string
  attivita?: string
  azione?: string
  /** ID riga gestionale (RVW_CRMUtenti). */
  crmId?: string
  /** Origine record: gestionale o registrazione app. */
  origine?: "crm" | "app"
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
  attivita?: string
  azione?: string
  esitoCrm?: string
  evasoAt?: string
}

export const TELEFONATA_ATTIVITA_DEFAULT = "3. Telefonica"
export const TELEFONATA_AZIONE_DEFAULT = "14. Commerciale"

export interface ChiamateStats {
  oggi: number
  settimana: number
  perConsulente: { consulenteNome: string; count: number }[]
}
