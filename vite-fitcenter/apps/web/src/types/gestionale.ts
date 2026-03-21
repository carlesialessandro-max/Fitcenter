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
  /** Età anni dal gestionale, se la view la espone */
  clienteEta?: number
  pianoId: string
  pianoNome: string
  categoria: CategoriaAbbonamento
  prezzo: number
  durataMesi?: number
  dataInizio: string
  dataFine: string
  stato: "attivo" | "scaduto"
  consulenteNome?: string
  /** true se esiste un altro abbonamento dello stesso cliente con dataInizio > dataFine (già rinnovato) */
  rinnovato?: boolean
  /** CategoriaAbbonamentoDescrizione dalla view (per colonna Categoria in UI) */
  categoriaAbbonamentoDescrizione?: string
  /** AbbonamentoDescrizione dalla view (per colonna Abbonamento in UI) */
  abbonamentoDescrizione?: string
  /** Descrizione macro categoria (es. ASI + ISCRIZIONE) per colonna Categoria in UI */
  macroCategoriaDescrizione?: string
  /** true se tesseramento da escludere dalla lista in scadenza */
  isTesseramento?: boolean
}

export interface BudgetMensile {
  anno: number
  mese: number
  budget: number
  vendite?: number
}

export interface AbbAttiviDurataBucket {
  durata: string
  count: number
}

export interface AbbAttiviSegmentoAnalisi {
  totale: number
  byDurata: AbbAttiviDurataBucket[]
}

/** Risposta GET /data/abbonamenti-attivi-analisi (admin) */
export interface AbbAttiviAnalisiResponse {
  asOf: string
  /** Anni: sotto questa età = segmento bambini (se clienteEta valorizzata) */
  sogliaEtaAdulti: number
  /** Quanti attivi hanno età dal gestionale */
  attiviConEta: number
  totaleAttivi: number
  adulti: AbbAttiviSegmentoAnalisi
  bambini: AbbAttiviSegmentoAnalisi
  notaClassificazione: string
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
  venditePerMese: { mese: string; anno?: number; meseNum?: number; vendite: number; budget: number; percentuale?: number }[]
  leadPerFonte: { fonte: string; count: number }[]
  abbonamentiPerCategoria: { categoria: string; count: number }[]
  abbonamentiInScadenzaLista: { clienteNome: string; piano: string; dataFine: string }[]
  abbonamentiInScadenza60Lista: { clienteNome: string; piano: string; dataFine: string }[]
}

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
  dettaglioGiorno: DettaglioBlocco
  dettaglioMese: DettaglioBlocco
}
