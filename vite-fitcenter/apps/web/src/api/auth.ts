import { api } from "./client"
import { setAuthToken } from "./client"

export type Role = "admin" | "operatore" | "corsi"

export interface User {
  username: string
  nome: string
  role: Role
  consulenteNome?: string
  /** Se "bambini": vede solo CRM con lead BAMBINI; nav solo CRM Vendita. */
  leadFilter?: "bambini"
}

export interface LoginResponse {
  token: string
  user: User
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { username, password }),

  me: () => api.get<{ user: User }>("/auth/me"),

  logout: async () => {
    try {
      await api.post("/auth/logout", {})
    } finally {
      setAuthToken(null)
    }
  },
}
