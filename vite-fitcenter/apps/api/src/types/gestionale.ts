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

export type CategoriaAbbonamento =
  | "palestra"
  | "piscina"
  | "spa"
  | "corsi"
  | "full_premium"

export interface Abbonamento {
  id: string
  clienteId: string
  clienteNome: string
  /** Età anni dal gestionale (colonna Eta / Età nella view abbonamenti), se presente */
  clienteEta?: number
  pianoId: string
  pianoNome: string
  categoria: CategoriaAbbonamento
  prezzo: number
  /** Durata stimata in mesi (da IDDurata o DurataMesi nella view). */
  durataMesi?: number
  dataInizio: string
  dataFine: string
  stato: "attivo" | "scaduto"
  consulenteNome?: string
  /** true se esiste un altro abbonamento dello stesso cliente con dataInizio > questa dataFine (già rinnovato) */
  rinnovato?: boolean
   /** CategoriaAbbonamentoDescrizione dalla view (per colonna Categoria in UI) */
  categoriaAbbonamentoDescrizione?: string
  /** AbbonamentoDescrizione dalla view (per colonna Abbonamento in UI) */
  abbonamentoDescrizione?: string
  /** Descrizione macro categoria (es. ASI + ISCRIZIONE) per colonna Categoria in UI */
  macroCategoriaDescrizione?: string
  /** true se tesseramento da escludere (IDCategoria=VARIE, IDAbbonamento=TESSERAMENTI, IDMacroCategoria=ASI+ISCRIZIONE) */
  isTesseramento?: boolean
}

export interface PianoAbbonamento {
  id: string
  nome: string
  categoria: CategoriaAbbonamento
  prezzo: number
  durataMesi?: number
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
  abbonamentiInScadenza60: number
  entrateMese: number
  percentualeBudget: number
  budgetMese: number
  budgetAnno: number
  tassoConversione: number
  clientiAttivi: number
  venditePerMese: { mese: string; anno: number; meseNum: number; vendite: number; budget: number; percentuale: number }[]
  leadPerFonte: { fonte: string; count: number }[]
  abbonamentiPerCategoria: { categoria: string; count: number }[]
  abbonamentiInScadenzaLista: { clienteNome: string; piano: string; dataFine: string }[]
  abbonamentiInScadenza60Lista: { clienteNome: string; piano: string; dataFine: string }[]
}

/** Riga dettaglio per consulente (giorno o mese) */
export interface DettaglioConsulente {
  consulente: string
  budget: number
  budgetProgressivo: number
  consuntivo: number
  scostamento: number
  assenze: number
  improduttivi: number
  trend: number
}

/** Blocco KPI + tabella per giorno o mese */
export interface DettaglioBlocco {
  budget: number
  budgetProgressivo: number
  consuntivo: number
  scostamento: number
  assenze: number
  improduttivi: number
  trend: number
  perConsulente: DettaglioConsulente[]
}

export interface DettaglioMeseResponse {
  anno: number
  mese: number
  meseLabel: string
  giorno?: number
  giornoLabel?: string
  giorniNelMese: number
  /** Dettaglio del giorno (se giorno specificato) */
  dettaglioGiorno: DettaglioBlocco
  /** Dettaglio del mese (progressivo fino al giorno se specificato) */
  dettaglioMese: DettaglioBlocco
}
