import type { DashboardStats, Cliente, Abbonamento, BudgetMensile } from "@/types/gestionale"
import type { Lead } from "@/types/lead"
import { api } from "./client"

export const dataApi = {
  getDashboard: () => api.get<DashboardStats>("/data/dashboard"),
  getClienti: () => api.get<Cliente[]>("/data/clienti"),
  getAbbonamenti: () => api.get<Abbonamento[]>("/data/abbonamenti"),
  getBudget: () => api.get<BudgetMensile[]>("/data/budget"),
  getLeads: () => api.get<Lead[]>("/data/leads"),
}
