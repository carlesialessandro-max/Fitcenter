import { api } from "./client"
import { setAuthToken } from "./client"

export type Role = "admin" | "operatore" | "firme" | "corsi" | "istruttore" | "campus" | "scuola_nuoto" | "bagnini" | "danza" | "crm"

export interface User {
  username: string
  nome: string
  role: Role
  consulenteNome?: string
  /** Se "bambini": vede solo CRM con lead BAMBINI; nav solo CRM Vendita. */
  leadFilter?: "bambini"
  /** Operatore speciale: Incassi e Andamento di tutto il centro. */
  vedeTotaliCentro?: boolean
  /** Sottoinsieme del menu del ruolo. Se assente, vede tutte le pagine del ruolo. */
  pages?: string[]
  email?: string
}

export interface LoginResponse {
  token: string
  user: User
}

export interface LoginNeedsOtp {
  needsOtp: true
  username: string
  emailHint: string
}

export type LoginStep1Response = LoginResponse | LoginNeedsOtp

export type PageDef = { path: string; label: string; group: string }

export type PagesCatalog = {
  catalog: PageDef[]
  roleDefaults: Record<Role, string[]>
  roles: Role[]
}

export type UpsertUserBody = {
  username?: string
  password?: string
  nome: string
  role: Role
  consulenteNome?: string | null
  leadFilter?: "bambini" | "" | null
  vedeTotaliCentro?: boolean | null
  email?: string | null
  pages?: string[] | null
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginStep1Response>("/auth/login", { username, password }),

  loginOtp: (username: string, code: string) =>
    api.post<LoginResponse>("/auth/login/otp", { username, code }),

  me: () => api.get<{ user: User }>("/auth/me"),

  logout: async () => {
    try {
      await api.post("/auth/logout", {})
    } finally {
      setAuthToken(null)
    }
  },

  listUsers: () => api.get<{ users: User[] }>("/auth/users"),

  pagesCatalog: () => api.get<PagesCatalog>("/auth/pages"),

  createUser: (body: UpsertUserBody & { username: string; password: string }) =>
    api.post<{ user: User }>("/auth/users", body),

  updateUser: (username: string, body: UpsertUserBody) =>
    api.patch<{ user: User }>(`/auth/users/${encodeURIComponent(username)}`, body),

  setPassword: (username: string, password: string) =>
    api.put<{ ok: true }>(`/auth/users/${encodeURIComponent(username)}/password`, { password }),

  deleteUser: (username: string) =>
    api.delete<{ ok: true }>(`/auth/users/${encodeURIComponent(username)}`),
}
