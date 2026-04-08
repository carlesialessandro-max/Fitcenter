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

function withConsulente(url: string, consulente?: string) {
  if (!consulente) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}consulente=${encodeURIComponent(consulente)}`
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
  getBudget: (anno?: number) =>
    api.get<{
      list: BudgetMensile[]
      perConsulente: { anno: number; mese: number; consulenteLabel: string; budget: number }[]
      consulenti: string[]
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
      rows: { categoria: string; durataMesi: number | null; count: number; totalEuro?: number }[]
    }>(
      `/data/vendite-movimenti-andamento${query ? `?${query}` : ""}`
    )
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
  getCrmAppuntamentiOperatore: (params?: { consulente?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams()
    if (params?.consulente) q.set("consulente", params.consulente)
    if (params?.from) q.set("from", params.from)
    if (params?.to) q.set("to", params.to)
    const query = q.toString()
    return api.get<{ from: string; to: string; rows: CrmAppuntamento[] }>(`/data/crm-appuntamenti-operatore${query ? `?${query}` : ""}`)
  },
  getConvalidazioni: (anno: number, mese: number, consulenteNome: string) =>
    api.get<{ anno: number; mese: number; consulenteNome: string; convalidati: number[] }>(
      `/data/convalidazioni?anno=${anno}&mese=${mese}&consulente=${encodeURIComponent(consulenteNome)}`
    ),
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
  budget: number
  percentualeBudget: number
  telefonate: number
  clientiNuovi: number
  rinnovi: number
  invitoClienti: number
  oreLavorate: number
  oreAttese: number
  percentualeOre: number
}

export interface ReportConsulentiTotals {
  movimentiAndamento: number
  vendite: number
  budget: number
  scostamento: number
  percentualeBudget: number
  telefonate: number
  clientiNuovi: number
  rinnovi: number
  invitoClienti: number
  oreLavorate: number
  oreAttese: number
  percentualeOre: number
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
  nome?: string
  cognome?: string
  telefono?: string
}
