import type {
  DashboardStats,
  Cliente,
  Abbonamento,
  BudgetMensile,
  DettaglioMeseResponse,
  DettaglioBlocco,
  AbbAttiviAnalisiResponse,
} from "@/types/gestionale"
import type { Lead } from "@/types/lead"
import { api } from "./client"

export type ReferralPresentatiItem = {
  clienteId: string
  cognome: string
  nome: string
  email: string | null
  telefono: string | null
  /** Utente socio che ha presentato (IDPresentatore). */
  presentatoDaId: string | null
  presentatoDaNome: string | null
  idIscrizione: string | null
  abbonamento: string | null
  /** Presente se sul DB esiste la colonna DataPresentazione (mese report su questa data). */
  dataPresentazione: string | null
  dataInizioAbb: string | null
  dataFineAbb: string | null
  /** Importo pagato (ImportoPagato/Pagato/…), non solo listino. */
  importoPagato: number
  /** Somma importi pagati nel mese per quel cliente (solo abbonamenti utili). */
  totaleMese: number
}

export type ReferralPresentatiResponse = {
  items: ReferralPresentatiItem[]
  totaleEuro: number
  /** Numero clienti referral nella lista (stesso mese / filtri). */
  totaleClienti: number
  venditoreIdsResolved?: number[]
  tuttiIVenditori?: boolean
  range?: { year: number; month: number; from: string; to: string }
  hint?: string
}

function withConsulente(url: string, consulente?: string) {
  if (!consulente) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}consulente=${encodeURIComponent(consulente)}`
}

/** Allineato al gestionale IT: 1° marzo anno corrente → oggi (Europe/Rome). Esportato per queryKey React Query. */
export function campusDateRangeParts(): { from: string; to: string } {
  const tz = "Europe/Rome"
  const to = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const year = to.slice(0, 4)
  return { from: `${year}-03-01`, to }
}

function campusDateRangeQuery(): string {
  const { from, to } = campusDateRangeParts()
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

export const dataApi = {
  getDashboard: (consulente?: string, asOf?: string) => {
    const params = new URLSearchParams()
    if (asOf) params.set("asOf", asOf)
    const base = withConsulente("/data/dashboard", consulente)
    const url = params.toString() ? `${base}${base.includes("?") ? "&" : "?"}${params}` : base
    return api.get<DashboardStats>(url)
  },
  getClienti: () => api.get<Cliente[]>("/data/clienti"),
  getAbbonamentiAttiviAnalisi: (asOf?: string) => {
    const q = asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""
    return api.get<AbbAttiviAnalisiResponse>(`/data/abbonamenti-attivi-analisi${q}`)
  },
  getAbbonamenti: (consulente?: string, inScadenza?: 30 | 60) => {
    let url = withConsulente("/data/abbonamenti", consulente)
    if (inScadenza != null) url += (url.includes("?") ? "&" : "?") + "inScadenza=" + inScadenza
    return api.get<Abbonamento[]>(url)
  },
  getReferralPresentati: (opts?: {
    year?: number
    month?: number
    /** Intervallo inclusivo (es. Stampa report Dal/Al). Ha priorità su year/month. */
    from?: string
    to?: string
    /** Admin: nome consulente (budget). Ignorato se tutti è true. */
    consulente?: string
    /** Admin: nessun filtro ID venditore. */
    tutti?: boolean
  }) => {
    const params = new URLSearchParams()
    if (opts?.from && opts?.to) {
      params.set("from", opts.from)
      params.set("to", opts.to)
    } else if (opts?.year != null && opts?.month != null) {
      params.set("year", String(opts.year))
      params.set("month", String(opts.month))
    }
    if (opts?.consulente) params.set("consulente", opts.consulente)
    if (opts?.tutti) params.set("tutti", "1")
    const q = params.toString()
    return api.get<ReferralPresentatiResponse>(`/data/referral-presentati${q ? `?${q}` : ""}`)
  },
  getBudget: (anno?: number) =>
    api.get<{
      list: BudgetMensile[]
      perConsulente: { anno: number; mese: number; consulenteLabel: string; budget: number }[]
      consulenti: string[]
      storico?: {
        anno: number
        mese: number
        totale: number
        salvato: boolean
        perConsulente: Record<string, number>
      }[]
      anniDisponibili?: number[]
    }>(`/data/budget${anno != null ? `?anno=${anno}` : ""}`),
  setBudget: (anno: number, mese: number, budget: number, consulenteLabel?: string) =>
    api.post<{ anno: number; mese: number; budget?: number; consulenteLabel?: string }>("/data/budget", {
      anno,
      mese,
      budget,
      consulenteLabel,
    }),
  getLeads: () => api.get<Lead[]>("/data/leads"),
  assignLeadToMe: (id: string) => api.post<Lead>(`/data/leads/${encodeURIComponent(id)}/assign-me`, {}),
  /** Periodo Campus: 1 marzo (anno calendario Europe/Rome) → oggi (stesso fuso del browser). */
  getCampus: () =>
    api.get<{
      range: { from: string; to: string }
      weeks: { key: string; label: string; from: string; to: string }[]
      bambini: {
        clienteId: string
        clienteNome: string
        cognomeNome: string
        eta?: number
        cellulare?: string
        email?: string
        gruppo: string
        genitore: string
        consensoWhatsapp?: boolean | null
        liv: string
        allergie: string
        note: string
        totaleVenduto: number
        totalePagato: number
        totaleDaPagare?: number
        weekNotes: Record<string, { note?: string; gruppo?: string }>
        items: { abbonamentoId: string; pianoNome: string; dataInizio: string; dataFine: string; settimane: string[]; prezzo: number }[]
      }[]
    }>(`/data/campus${campusDateRangeQuery()}`),
  patchCampusCliente: (clienteId: string, body: { gruppo?: string; genitore?: string; consensoWhatsapp?: boolean; liv?: string; allergie?: string; note?: string }) =>
    api.patch(`/data/campus/${encodeURIComponent(clienteId)}`, body),
  patchCampusWeekNote: (clienteId: string, weekKey: string, body: { note?: string; gruppo?: string }) =>
    api.patch(`/data/campus/${encodeURIComponent(clienteId)}/weeks/${encodeURIComponent(weekKey)}`, body),
  importCampusPlanning: (file: File) => {
    const form = new FormData()
    form.append("file", file)
    return api.post<{ ok: true; updated: number; skipped: number }>("/data/campus/import-planning", form)
  },
  getTotaliAnni: () =>
    api.get<{ totali: { anno: number; vendite: number; budget: number; percentuale: number }[] }>("/data/totali-anni"),
  getVenditeStorico: (anno: number, consulente?: string) => {
    const params = new URLSearchParams({ anno: String(anno) })
    if (consulente) params.set("consulente", consulente)
    return api.get<{ anno: number; venditePerMese: { mese: string; anno: number; meseNum: number; vendite: number; budget: number; percentuale: number }[] }>(`/data/vendite-storico?${params}`)
  },
  getVenditeMovimentiCategoriaDurata: (params: { months?: number; consulente?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.months != null) q.set("months", String(params.months))
    if (params.consulente) q.set("consulente", params.consulente)
    const query = q.toString()
    return api.get<{
      from: string
      to: string
      totalCount: number
      totalEuro: number
      crossEuro?: number
      rows: { categoria: string; durataMesi: number | null; count: number; totalEuro?: number }[]
    }>(
      `/data/vendite-movimenti-andamento${query ? `?${query}` : ""}`
    )
  },
  getVenditeCross: (params: { anno: number; mese: number; consulente?: string }) => {
    const q = new URLSearchParams({ anno: String(params.anno), mese: String(params.mese) })
    if (params.consulente) q.set("consulente", params.consulente)
    return api.get<{
      from: string
      to: string
      totale: number
      consulente: string | null
      rows: {
        idIscrizione: number
        dataCross: string
        cliente: string
        abbonamento: string
        ratePagateMese: number
        rateFuture: number
        movimentoU: number
        totale: number
      }[]
    }>(`/data/vendite-cross?${q}`)
  },
  getDettaglioMese: (anno: number, mese: number, giorno?: number, consulente?: string, asOf?: string) => {
    const params = new URLSearchParams({ anno: String(anno), mese: String(mese) })
    if (giorno != null) params.set("giorno", String(giorno))
    if (consulente) params.set("consulente", consulente)
    if (asOf) params.set("asOf", asOf)
    return api.get<DettaglioMeseResponse>(`/data/dettaglio-mese?${params}`)
  },
  getDettaglioAnno: (anno: number, asOf?: string) => {
    const params = new URLSearchParams({ anno: String(anno) })
    if (asOf) params.set("asOf", asOf)
    return api.get<{ anno: number; annoLabel: string; dettaglio: DettaglioBlocco }>(`/data/dettaglio-anno?${params}`)
  },
  getAbbonamentiFollowUp: () =>
    api.get<Record<string, { stato: string; note: string; updatedAt: string }>>("/data/abbonamenti-follow-up"),
  updateAbbonamentiFollowUp: (abbonamentoId: string, body: { stato?: string; note?: string }) =>
    api.patch<{ abbonamentoId: string; stato: string; note: string; updatedAt: string }>(
      `/data/abbonamenti-follow-up/${encodeURIComponent(abbonamentoId)}`,
      body
    ),
  getCrmAppuntamenti: (params: {
    nomeVenditore: string
    cognome: string
    nome: string
    nomeOperatore: string
  }) => {
    const q = new URLSearchParams()
    q.set("nomeVenditore", params.nomeVenditore)
    q.set("cognome", params.cognome)
    q.set("nome", params.nome)
    q.set("nomeOperatore", params.nomeOperatore)
    return api.get<CrmAppuntamento[]>(`/data/crm-appuntamenti?${q}`)
  },
  getCrmAppuntamentiOperatore: (params?: {
    consulente?: string
    from?: string
    to?: string
    soloTelefonate?: boolean
    includeCompletate?: boolean
  }) => {
    const q = new URLSearchParams()
    if (params?.consulente) q.set("consulente", params.consulente)
    if (params?.from) q.set("from", params.from)
    if (params?.to) q.set("to", params.to)
    if (params?.soloTelefonate) q.set("soloTelefonate", "1")
    if (params?.includeCompletate) q.set("includeCompletate", "1")
    const query = q.toString()
    return api.get<{ from: string; to: string; rows: CrmAppuntamento[] }>(`/data/crm-appuntamenti-operatore${query ? `?${query}` : ""}`)
  },
  getCrmAppuntamentiCliente: (params: { cognome: string; nome: string; from?: string; to?: string }) => {
    const q = new URLSearchParams()
    q.set("cognome", params.cognome)
    q.set("nome", params.nome)
    if (params.from) q.set("from", params.from)
    if (params.to) q.set("to", params.to)
    return api.get<{ from: string; to: string; rows: CrmAppuntamento[] }>(`/data/crm-appuntamenti-cliente?${q}`)
  },
  getConvalidazioni: (anno: number, mese: number, consulenteNome: string) =>
    api.get<{ anno: number; mese: number; consulenteNome: string; convalidati: number[] }>(
      `/data/convalidazioni?anno=${anno}&mese=${mese}&consulente=${encodeURIComponent(consulenteNome)}`
    ),
  getConvalidazioniAdminAll: (anno: number, mese: number) =>
    api.get<{ anno: number; mese: number; all: Record<string, number[]> }>(`/data/convalidazioni-admin-all?anno=${anno}&mese=${mese}`),
  setConvalidazione: (body: { anno: number; mese: number; giorno: number; convalidato: boolean; consulenteNome: string }) =>
    api.post<{ anno: number; mese: number; giorno: number; convalidato: boolean }>("/data/convalidazioni", body),
  getOreLavorate: (params?: { consulente?: string; anno?: number; mese?: number }) => {
    const search = new URLSearchParams()
    if (params?.consulente) search.set("consulente", params.consulente)
    if (params?.anno != null) search.set("anno", String(params.anno))
    if (params?.mese != null) search.set("mese", String(params.mese))
    const q = search.toString()
    return api.get<OraLavorata[]>(`/data/ore-lavorate${q ? `?${q}` : ""}`)
  },
  postOraLavorata: (body: { consulenteNome: string; giorno: string; oraInizio: string; oraFine: string }) =>
    api.post<OraLavorata>("/data/ore-lavorate", body),
  deleteOraLavorata: (id: string) => api.delete(`/data/ore-lavorate/${encodeURIComponent(id)}`),
  getDebugConsulenti: () => api.get<{ consulenti: { nome: string; id: string }[] }>("/data/debug-consulenti"),
  getReportConsulenti: (params?: {
    periodo?: "week" | "month" | "year"
    asOf?: string
    from?: string
    to?: string
    consulenti?: string[]
  }) => {
    const q = new URLSearchParams()
    if (params?.periodo) q.set("periodo", params.periodo)
    if (params?.asOf) q.set("asOf", params.asOf)
    if (params?.from) q.set("from", params.from)
    if (params?.to) q.set("to", params.to)
    if (params?.consulenti?.length) q.set("consulenti", params.consulenti.join(","))
    const query = q.toString()
    return api.get<ReportConsulentiResponse>(`/data/report-consulenti${query ? `?${query}` : ""}`)
  },
  getCassaMovimentiUtenti: (params?: { asOf?: string; windowMinutes?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.asOf) q.set("asOf", params.asOf)
    if (params?.windowMinutes != null) q.set("windowMinutes", String(params.windowMinutes))
    if (params?.limit != null) q.set("limit", String(params.limit))
    const query = q.toString()
    return api.get<CassaMovimentiUtentiResponse>(`/data/cassa-movimenti-utenti${query ? `?${query}` : ""}`)
  },
  getRicevuteUtenti: (params?: { asOf?: string; windowMinutes?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.asOf) q.set("asOf", params.asOf)
    if (params?.windowMinutes != null) q.set("windowMinutes", String(params.windowMinutes))
    if (params?.limit != null) q.set("limit", String(params.limit))
    const query = q.toString()
    return api.get<RicevuteUtentiResponse>(`/data/ricevute-utenti${query ? `?${query}` : ""}`)
  },
  inviaScontrino: (body: { ricevutaId: string; channel: "email" | "sms"; email?: string; phone?: string }) =>
    api.post<{ ok: boolean; channel: string; sent: boolean; to?: string; toMasked?: string }>(
      "/data/ricevute-utenti/invia",
      body
    ),
}

export interface CassaMovimentoUtenteRow {
  movimentoId?: string | null
  clienteId: string | null
  nome: string | null
  cognome: string | null
  email: string | null
  sms: string | null
  codiceFiscale?: string | null
  paganteNome?: string | null
  paganteCodiceFiscale?: string | null
  asiTesseraCustom2?: string | null
  tipoServizioDescrizione?: string | null
  causale: string | null
  iscrizioneTotale?: number | null
  importo: number
  dataOperazioneIso: string | null
  sesso?: string | null
  luogoNascita?: string | null
  dataNascita?: string | null
  professione?: string | null
  indirizzoVia?: string | null
  indirizzoNumero?: string | null
  indirizzoCap?: string | null
  indirizzoCitta?: string | null
  indirizzoProvincia?: string | null
  telefono1?: string | null
  telefono2?: string | null
  documento?: string | null
  primaIscrizione?: string | null
}

export interface CassaMovimentiUtentiGroup {
  key: string
  clienteId: string | null
  nome: string | null
  cognome: string | null
  email: string | null
  sms: string | null
  totalImporto: number
  rows: CassaMovimentoUtenteRow[]
  anagrafica: Omit<CassaMovimentoUtenteRow, "causale" | "importo" | "dataOperazioneIso">
}

export interface CassaMovimentiUtentiResponse {
  view: string | null
  dateCol: string | null
  importoCol: string | null
  causaleCol: string | null
  fromIso: string
  toIso: string
  groups: CassaMovimentiUtentiGroup[]
}

export interface RicevutaUtenteRiga {
  rigaId: string | null
  descrizione: string | null
  qta: number
  prezzoUnitario: number
  iva: number | null
  totaleRiga: number
  tipoRiga: string | null
}

export interface RicevutaUtenteGroup {
  ricevutaId: string
  numeroRicevuta: string | null
  dataRicevutaIso: string | null
  cliente: string | null
  cognome: string | null
  nome: string | null
  email: string | null
  sms: string | null
  idUtente: string | null
  idCassaMovimento: string | null
  categoriaDescrizione: string | null
  senzaNominativo: boolean
  tipoPagamento: string | null
  tipoRicevuta: string | null
  annullata: boolean
  noteGenerali: string | null
  operatore: string | null
  azienda: {
    nome: string | null
    indirizzoVia: string | null
    indirizzoCap: string | null
    indirizzoCitta: string | null
    indirizzoPv: string | null
    telefono: string | null
    email: string | null
    piva: string | null
  }
  righe: RicevutaUtenteRiga[]
  totale: number
}

export interface RicevuteUtentiResponse {
  view: string | null
  dateCol: string | null
  fromIso: string
  toIso: string
  ricevute: RicevutaUtenteGroup[]
}

export interface OraLavorata {
  id: string
  consulenteNome: string
  giorno: string
  oraInizio: string
  oraFine: string
  createdAt: string
}

export interface ReportConsulenteRow {
  consulenteNome: string
  vendite: number
  /** Stesso conteggio di Andamento vendite (iscrizioni distinte nel periodo). */
  movimentiAndamento: number
  /** Budget mese intero salvato. */
  budgetMese: number
  budget: number
  percentualeBudget: number
  telefonate: number
  clientiNuovi: number
  rinnovi: number
  invitoClienti: number
  /** Passaggi a CROSS (elenco vendite cross). */
  crossAbbonamenti: number
  crossTotaleEuro: number
  oreLavorate: number
  oreAttese: number
  percentualeOre: number
  giorniConvalidati: number
  giorniConvalidatiLista: string
  dettaglioOreLavorate?: ReportOreDettaglioRow[]
  dettaglioClientiNuovi?: ReportMovimentoDettaglioRow[]
  dettaglioRinnovi?: ReportMovimentoDettaglioRow[]
  dettaglioInvito?: ReportMovimentoDettaglioRow[]
  dettaglioCross?: ReportCrossDettaglioRow[]
  totaleEuroClientiNuovi?: number
  totaleEuroRinnovi?: number
}

export interface ReportMovimentoDettaglioRow {
  data: string
  cliente: string
  abbonamento: string
  importo: number
}

export interface ReportCrossDettaglioRow {
  data: string
  cliente: string
  abbonamento: string
  totale: number
}

export interface ReportOreDettaglioRow {
  giorno: string
  oraInizio: string
  oraFine: string
  ore: number
  convalidato: boolean
}

export interface ReportConsulentiTotals {
  movimentiAndamento: number
  vendite: number
  budgetMese: number
  budget: number
  scostamento: number
  percentualeBudget: number
  telefonate: number
  clientiNuovi: number
  rinnovi: number
  invitoClienti: number
  crossAbbonamenti: number
  crossTotaleEuro: number
  totaleEuroClientiNuovi: number
  totaleEuroRinnovi: number
  oreLavorate: number
  oreAttese: number
  percentualeOre: number
  giorniConvalidati: number
}

export interface ReportConsulentiResponse {
  periodo: string
  from: string
  to: string
  /** Timestamp risposta (verifica che non sia cache vecchia). */
  computedAt?: string
  rows: ReportConsulenteRow[]
  totals: ReportConsulentiTotals
}

export interface CrmAppuntamento {
  dataAppuntamento: string
  tipoDescrizione: string
  esitoDescrizione: string
  crmDescrizione: string
  attivitaDescrizione?: string
  consulenteNome?: string
  dataEvasione?: string
  crmId?: string
  nome?: string
  cognome?: string
  telefono?: string
}
