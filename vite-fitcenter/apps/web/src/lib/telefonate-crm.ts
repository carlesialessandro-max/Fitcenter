/** Valori allineati al gestionale CRM (storico telefonata commerciale). */
export const TELEFONATA_ATTIVITA = "3. Telefonica"
export const TELEFONATA_AZIONE = "14. Commerciale"

/** Esiti come nel gestionale (campo Esito). */
export const ESITI_TELEFONATA_CRM = [
  "07. Appuntamento",
  "Positivo",
  "Negativo",
  "Non risposto",
  "Richiamare",
  "Altro",
] as const

export type EsitoTelefonataCrm = (typeof ESITI_TELEFONATA_CRM)[number]

export const ESITO_TELEFONATA_DEFAULT: EsitoTelefonataCrm = "07. Appuntamento"
