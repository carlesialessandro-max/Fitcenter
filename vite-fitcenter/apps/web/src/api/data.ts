import type { DashboardStats, Cliente, Abbonamento, BudgetMensile, DettaglioMeseResponse } from "@/types/gestionale"
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
  getBudget: () => api.get<BudgetMensile[]>("/data/budget"),
  setBudget: (anno: number, mese: number, budget: number) =>
    api.post<{ anno: number; mese: number; budget: number }>("/data/budget", { anno, mese, budget }),
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
}
