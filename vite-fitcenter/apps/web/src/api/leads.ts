import type {
  Lead,
  LeadCreate,
  LeadUpdate,
  LeadFilters,
} from "@/types/lead"
import { api } from "./client"

function searchParams(filters: LeadFilters): string {
  const p = new URLSearchParams()
  if (filters.fonte) p.set("fonte", filters.fonte)
  if (filters.stato) p.set("stato", filters.stato)
  if (filters.consulenteId) p.set("consulenteId", filters.consulenteId)
  if (filters.search) p.set("search", filters.search)
  const q = p.toString()
  return q ? `?${q}` : ""
}

export const leadsApi = {
  list: (filters: LeadFilters = {}) =>
    api.get<Lead[]>(`/leads${searchParams(filters)}`),
  get: (id: string) => api.get<Lead>(`/leads/${id}`),
  create: (data: LeadCreate) => api.post<Lead>("/leads", data),
  update: (id: string, data: LeadUpdate) =>
    api.put<Lead>(`/leads/${id}`, data),
  delete: (id: string) => api.delete<void>(`/leads/${id}`),
  /** Importa lead da SQL Server (backend esegue query e crea lead) */
  importFromSql: (payload: {
    connectionString: string
    query: string
    mapping: Record<string, string>
  }) => api.post<{ imported: number; errors: string[] }>("/leads/import-sql", payload),
}
