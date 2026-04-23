import bcrypt from "bcrypt"
import type { Role } from "../types/auth.js"
import { isEmailOtpEnabled, maskEmail, sendLoginOtpEmail } from "../services/mail-otp.js"
import { readJson, writeJson } from "./persist.js"
import crypto from "crypto"

export interface User {
  username: string
  nome: string
  role: Role
  consulenteNome?: string
  leadFilter?: "bambini"
}

type UserRecord = User & { password: string; email?: string }

/**
 * Utenti di default (solo se AUTH_USERS_JSON non è impostato).
 * Password in bcrypt (min. ~12 caratteri, maiuscole, minuscole, cifre, simboli).
 * In produzione: definire AUTH_USERS_JSON con hash propri (vedi scripts/hash-password.ts).
 *
 * Credenziali predefinite (cambiarle sul server con variabile d'ambiente):
 *   admin     → H2Fc.Admin2026!xK
 *   carmen    → H2Fc.Carmen.9!m
 *   ombretta  → H2Fc.Ombre.9!n
 *   serena    → H2Fc.Serena.9!p
 *   irene     → H2Fc.Irene.9!q
 *   reception → H2Fc.Firme.9!u
 *   corsi     → H2Fc.Corsi.9!r
 *   istruttore→ H2Fc.Istruttore.9!s
 *   campus    → H2Fc.Campus.9!t
 */
const DEFAULT_USERS: UserRecord[] = [
  {
    username: "admin",
    password: "$2b$12$6o6BHuCJOkLxC0ai54MQ1ut3zX312HXzaOWuSQXqxEqh8Fd35Ybw2",
    nome: "Amministratore",
    role: "admin",
  },
  {
    username: "carmen",
    password: "$2b$12$4bIWZxR28y64K5.CI/vQsOQaejrLU2N4rr77Jhtkd4Je5shT/u1Ka",
    nome: "Carmen Severino",
    role: "operatore",
    consulenteNome: "Carmen Severino",
  },
  {
    username: "ombretta",
    password: "$2b$12$YcdQvhAMqmmS9GYfn2JMcuWVXEZceUE3S7I7Y19lz4rzGAOh.QqI.",
    nome: "Ombretta Zenoni",
    role: "operatore",
    consulenteNome: "Ombretta Zenoni",
  },
  {
    username: "serena",
    password: "$2b$12$p9u11pWi3BR.e/Psugsvie19AusSRX6KjQqGVv6/ZVkxYloW6ccDu",
    nome: "Serena Del Prete",
    role: "operatore",
    consulenteNome: "Serena Del Prete",
  },
  {
    username: "irene",
    password: "$2b$12$ub/3cJrBpy.ZG/35yMux..1UQ0pl2sIv6NRSECR/aO897DhbEQWqq",
    nome: "Irene",
    role: "operatore",
    consulenteNome: "Irene",
    leadFilter: "bambini",
  },
  {
    username: "reception",
    password: "$2b$12$EX0yJEfWwKmIBXoeO0ikHOeZVQcZorFqpmG17dbhdLuOr71f7kNJC",
    nome: "Reception (Firme)",
    role: "firme",
  },
  {
    username: "corsi",
    password: "$2b$12$pM0JZcrvtqNxxW7g/A4ps.5VWYFGGZrZ6ohxK5pv3p4Vz2.fKex/m",
    nome: "Corsi",
    role: "corsi",
  },
  {
    username: "istruttore",
    password: "$2b$12$TS74XYRwEV7wYCFdol8miuJY//CfFpgOdVamG.eH4tOlRYnwfpMEa",
    nome: "Istruttore",
    role: "istruttore",
  },
  {
    username: "campus",
    password: "$2b$12$KRXwT4q1fCroDg9n7tmDE.EZP83P8w5ldXdFJgvLWm0y8Rj0Ac5/m",
    nome: "Campus",
    role: "campus",
  },
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
      if (!username || !password || !["admin", "operatore", "firme", "corsi", "istruttore", "campus"].includes(role)) continue
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

const SESSIONS_FILE = "auth-sessions.json"

type SessionRow = { token: string; user: User; expiresAt: number }

function loadSessionsFromDisk(): Map<string, { user: User; expiresAt: number }> {
  const rows = readJson<SessionRow[]>(SESSIONS_FILE, [])
  const m = new Map<string, { user: User; expiresAt: number }>()
  const now = Date.now()
  for (const r of Array.isArray(rows) ? rows : []) {
    const token = String((r as any)?.token ?? "").trim()
    const expiresAt = Number((r as any)?.expiresAt ?? 0)
    const user = (r as any)?.user as User | undefined
    if (!token || !user || !Number.isFinite(expiresAt)) continue
    if (expiresAt <= now) continue
    m.set(token, { user, expiresAt })
  }
  return m
}

function saveSessionsToDisk(): void {
  const rows: SessionRow[] = []
  for (const [token, s] of sessions.entries()) {
    rows.push({ token, user: s.user, expiresAt: s.expiresAt })
  }
  writeJson(SESSIONS_FILE, rows)
}

const sessions = loadSessionsFromDisk()
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
  saveSessionsToDisk()
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
      saveSessionsToDisk()
      return null
    }
    return s.user
  },

  logout(tokenValue: string): void {
    sessions.delete(tokenValue)
    saveSessionsToDisk()
  },
}
