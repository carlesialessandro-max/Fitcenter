import bcrypt from "bcrypt"
import type { Role } from "../types/auth.js"
import { isEmailOtpEnabled, maskEmail, sendLoginOtpEmail } from "../services/mail-otp.js"

export interface User {
  username: string
  nome: string
  role: Role
  consulenteNome?: string
  leadFilter?: "bambini"
}

type UserRecord = User & { password: string; email?: string }

/**
 * Utenti di default (sviluppo). In produzione impostare AUTH_USERS_JSON con password in bcrypt.
 */
const DEFAULT_USERS: UserRecord[] = [
  { username: "admin", password: "admin", nome: "Amministratore", role: "admin" },
  {
    username: "carmen",
    password: "carmen",
    nome: "Carmen Severino",
    role: "operatore",
    consulenteNome: "Carmen Severino",
  },
  {
    username: "ombretta",
    password: "ombretta",
    nome: "Ombretta Zenoni",
    role: "operatore",
    consulenteNome: "Ombretta Zenoni",
  },
  {
    username: "serena",
    password: "serena",
    nome: "Serena Del Prete",
    role: "operatore",
    consulenteNome: "Serena Del Prete",
  },
  {
    username: "irene",
    password: "irene",
    nome: "Irene",
    role: "operatore",
    consulenteNome: "Irene",
    leadFilter: "bambini",
  },
  { username: "corsi", password: "corsi", nome: "Corsi", role: "corsi" },
]

function loadUsersFromEnv(): UserRecord[] | null {
  const raw = process.env.AUTH_USERS_JSON?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const out: UserRecord[] = []
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue
      const o = row as Record<string, unknown>
      const username = String(o.username ?? "").trim()
      const password = String(o.password ?? "")
      const nome = String(o.nome ?? "").trim() || username
      const role = o.role as Role
      if (!username || !password || !["admin", "operatore", "corsi"].includes(role)) continue
      out.push({
        username,
        password,
        nome,
        role,
        consulenteNome: o.consulenteNome != null ? String(o.consulenteNome) : undefined,
        leadFilter: o.leadFilter === "bambini" ? "bambini" : undefined,
        email: o.email != null ? String(o.email).trim() : undefined,
      })
    }
    return out.length ? out : null
  } catch {
    return null
  }
}

function mergeEmails(users: UserRecord[]): UserRecord[] {
  const raw = process.env.AUTH_USER_EMAILS_JSON?.trim()
  if (!raw) return users
  try {
    const map = JSON.parse(raw) as Record<string, string>
    return users.map((u) => ({
      ...u,
      email: map[u.username]?.trim() || u.email,
    }))
  } catch {
    return users
  }
}

function getUsers(): UserRecord[] {
  const fromEnv = loadUsersFromEnv()
  const base = fromEnv ?? DEFAULT_USERS
  return mergeEmails(base)
}

async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const s = stored.trim()
  if (s.startsWith("$2a$") || s.startsWith("$2b$") || s.startsWith("$2y$")) {
    return bcrypt.compare(plain, s)
  }
  return plain === stored
}

const sessions = new Map<string, { user: User; expiresAt: number }>()
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 ore

const otpPending = new Map<
  string,
  { code: string; expiresAt: number; user: User; attempts: number }
>()
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 8

function token(): string {
  return crypto.randomUUID() + "-" + Date.now().toString(36)
}

function toPublicUser(u: UserRecord): User {
  return {
    username: u.username,
    nome: u.nome,
    role: u.role,
    consulenteNome: u.consulenteNome,
    leadFilter: u.leadFilter,
  }
}

function issueSession(user: User): { token: string; user: User } {
  const t = token()
  sessions.set(t, { user, expiresAt: Date.now() + SESSION_TTL_MS })
  return { token: t, user }
}

function randomOtp6(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export type LoginPasswordResult =
  | { kind: "ok"; token: string; user: User }
  | { kind: "needs_otp"; username: string; emailHint: string }
  | { kind: "invalid" }
  | { kind: "otp_mail_failed"; message: string }

export const authStore = {
  get users(): UserRecord[] {
    return getUsers()
  },

  async loginWithPassword(username: string, password: string): Promise<LoginPasswordResult> {
    const users = getUsers()
    const u = users.find((x) => x.username.toLowerCase() === username.toLowerCase().trim())
    if (!u) return { kind: "invalid" }
    const ok = await verifyPassword(password, u.password)
    if (!ok) return { kind: "invalid" }

    const user = toPublicUser(u)

    if (isEmailOtpEnabled() && u.email?.includes("@")) {
      const code = randomOtp6()
      otpPending.set(u.username.toLowerCase(), {
        code,
        expiresAt: Date.now() + OTP_TTL_MS,
        user,
        attempts: 0,
      })
      try {
        await sendLoginOtpEmail(u.email, code)
      } catch (e) {
        otpPending.delete(u.username.toLowerCase())
        console.error("[auth] invio OTP email fallito:", e)
        return { kind: "otp_mail_failed", message: (e as Error).message }
      }
      return { kind: "needs_otp", username: u.username, emailHint: maskEmail(u.email) }
    }

    return { kind: "ok", ...issueSession(user) }
  },

  verifyOtp(username: string, code: string): { token: string; user: User } | null {
    const key = username.toLowerCase().trim()
    const p = otpPending.get(key)
    if (!p || Date.now() > p.expiresAt) {
      otpPending.delete(key)
      return null
    }
    if (p.attempts >= OTP_MAX_ATTEMPTS) {
      otpPending.delete(key)
      return null
    }
    p.attempts += 1
    if (String(code).trim() !== p.code) {
      return null
    }
    otpPending.delete(key)
    return issueSession(p.user)
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
