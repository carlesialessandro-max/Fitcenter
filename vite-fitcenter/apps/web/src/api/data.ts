import type { DashboardStats, Cliente, Abbonamento, BudgetMensile, DettaglioMeseResponse, DettaglioBlocco } from "@/types/gestionale"
import type { Lead } from "@/types/lead"
import { api } from "./client"

function withConsulente(url: string, consulente?: string) {
  if (!consulente) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}consulente=${encodeURIComponent(consulente)}`
}

export const dataApi = {
  getDashboard: (consulente?: string) =>
    api.get<DashboardStats>(withConsulente("/data/dashboard", consulente)),
  getClienti: () => api.get<Cliente[]>("/data/clienti"),
  getAbbonamenti: (consulente?: string) =>
    api.get<Abbonamento[]>(withConsulente("/data/abbonamenti", consulente)),
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
  getTotaliAnni: () =>
    api.get<{ totali: { anno: number; vendite: number; budget: number; percentuale: number }[] }>("/data/totali-anni"),
  getVenditeStorico: (anno: number, consulente?: string) => {
    const params = new URLSearchParams({ anno: String(anno) })
    if (consulente) params.set("consulente", consulente)
    return api.get<{ anno: number; venditePerMese: { mese: string; anno: number; meseNum: number; vendite: number; budget: number; percentuale: number }[] }>(`/data/vendite-storico?${params}`)
  },
  getDettaglioMese: (anno: number, mese: number, giorno?: number, consulente?: string) => {
    const params = new URLSearchParams({ anno: String(anno), mese: String(mese) })
    if (giorno != null) params.set("giorno", String(giorno))
    if (consulente) params.set("consulente", consulente)
    return api.get<DettaglioMeseResponse>(`/data/dettaglio-mese?${params}`)
  },
  getDettaglioAnno: (anno: number) =>
    api.get<{ anno: number; annoLabel: string; dettaglio: DettaglioBlocco }>(`/data/dettaglio-anno?anno=${anno}`),
  getAbbonamentiFollowUp: () =>
    api.get<Record<string, { stato: string; note: string; updatedAt: string }>>("/data/abbonamenti-follow-up"),
  updateAbbonamentiFollowUp: (abbonamentoId: string, body: { stato?: string; note?: string }) =>
    api.patch<{ abbonamentoId: string; stato: string; note: string; updatedAt: string }>(
      `/data/abbonamenti-follow-up/${encodeURIComponent(abbonamentoId)}`,
      body
    ),
  getConvalidazioni: (anno: number, mese: number, consulenteNome: string) =>
    api.get<{ anno: number; mese: number; consulenteNome: string; convalidati: number[] }>(
      `/data/convalidazioni?anno=${anno}&mese=${mese}&consulente=${encodeURIComponent(consulenteNome)}`
    ),
  setConvalidazione: (body: { anno: number; mese: number; giorno: number; convalidato: boolean; consulenteNome: string }) =>
    api.post<{ anno: number; mese: number; giorno: number; convalidato: boolean }>("/data/convalidazioni", body),
}
