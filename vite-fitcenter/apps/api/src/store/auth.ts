import type { Role } from "../types/auth.js"

export interface User {
  username: string
  nome: string
  role: Role
  /** Solo per operatore: nome consulente (es. Luca Ferrari) */
  consulenteNome?: string
}

/**
 * Utenti: admin + 3 consulenti (username/password in produzione usare env e hash).
 * Nel DB IDUtente (tabella Utenti) è la chiave in tutte le tabelle; filtro venditore tramite IDVenditore = IDUtente consulente.
 */
const USERS: (User & { password: string })[] = [
  { username: "admin", password: "admin", nome: "Amministratore", role: "admin" },
  { username: "carmen", password: "carmen", nome: "Carmen Severino", role: "operatore", consulenteNome: "Carmen Severino" },
  { username: "ombretta", password: "ombretta", nome: "Ombretta Zenoni", role: "operatore", consulenteNome: "Ombretta Zenoni" },
  { username: "serena", password: "serena", nome: "Serena Del Prete", role: "operatore", consulenteNome: "Serena Del Prete" },
]

const sessions = new Map<string, { user: User; expiresAt: number }>()
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 ore

function token(): string {
  return crypto.randomUUID() + "-" + Date.now().toString(36)
}

export const authStore = {
  login(username: string, password: string): { token: string; user: User } | null {
    const u = USERS.find(
      (x) => x.username.toLowerCase() === username.toLowerCase() && x.password === password
    )
    if (!u) return null
    const user: User = {
      username: u.username,
      nome: u.nome,
      role: u.role,
      consulenteNome: u.consulenteNome,
    }
    const t = token()
    sessions.set(t, { user, expiresAt: Date.now() + SESSION_TTL_MS })
    return { token: t, user }
  },

  me(tokenValue: string): User | null {
    const s = sessions.get(tokenValue)
    if (!s) return null
    if (Date.now() > s.expiresAt) {
      sessions.delete(tokenValue)
      return null
    }
    return s.user
  },

  logout(tokenValue: string): void {
    sessions.delete(tokenValue)
  },
}
