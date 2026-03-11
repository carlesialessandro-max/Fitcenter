import type { Role } from "../types/auth.js"

export interface User {
  username: string
  nome: string
  role: Role
  /** Solo per operatore: nome consulente (es. Luca Ferrari) */
  consulenteNome?: string
}

/**
 * Utenti per accesso (in produzione usare variabili d'ambiente e hash password).
 * Credenziali: admin/admin, luca/luca, anna/anna
 */
const USERS: (User & { password: string })[] = [
  { username: "admin", password: "admin", nome: "Amministratore", role: "admin" },
  { username: "luca", password: "luca", nome: "Luca Ferrari", role: "operatore", consulenteNome: "Luca Ferrari" },
  { username: "anna", password: "anna", nome: "Anna Bianchi", role: "operatore", consulenteNome: "Anna Bianchi" },
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
