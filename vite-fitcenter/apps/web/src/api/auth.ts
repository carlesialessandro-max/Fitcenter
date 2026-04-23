import { api } from "./client"
import { setAuthToken } from "./client"

export type Role = "admin" | "operatore" | "firme" | "corsi" | "istruttore" | "campus" | "scuola_nuoto"

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

export interface LoginNeedsOtp {
  needsOtp: true
  username: string
  emailHint: string
}

export type LoginStep1Response = LoginResponse | LoginNeedsOtp

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
}
