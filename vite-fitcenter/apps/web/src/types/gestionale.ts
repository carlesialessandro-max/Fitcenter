export interface Cliente {
  id: string
  nome: string
  cognome: string
  email: string
  telefono: string
  citta: string
  codiceFiscale?: string
  abbonamentiAttivi: number
  stato: "attivo" | "inattivo"
}

export type CategoriaAbbonamento = "palestra" | "piscina" | "spa" | "corsi" | "full_premium"

export interface Abbonamento {
  id: string
  clienteId: string
  clienteNome: string
  pianoId: string
  pianoNome: string
  categoria: CategoriaAbbonamento
  prezzo: number
  dataInizio: string
  dataFine: string
  stato: "attivo" | "scaduto"
  consulenteNome?: string
}

export interface BudgetMensile {
  anno: number
  mese: number
  budget: number
  vendite?: number
}

export interface DashboardStats {
  leadTotali: number
  leadVinti: number
  leadPersi: number
  abbonamentiAttivi: number
  abbonamentiInScadenza: number
  entrateMese: number
  percentualeBudget: number
  budgetMese: number
  tassoConversione: number
  clientiAttivi: number
  venditePerMese: { mese: string; vendite: number; budget: number }[]
  leadPerFonte: { fonte: string; count: number }[]
  abbonamentiPerCategoria: { categoria: string; count: number }[]
  abbonamentiInScadenzaLista: { clienteNome: string; piano: string; dataFine: string }[]
}
