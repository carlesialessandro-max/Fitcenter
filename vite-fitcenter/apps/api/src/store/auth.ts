import bcrypt from "bcrypt"
import type { Role } from "../types/auth.js"
import { isEmailOtpEnabled, maskEmail, sendLoginOtpEmail } from "../services/mail-otp.js"
import { readJson, writeJson } from "./persist.js"
import { sanitizePages } from "./pages.js"
import crypto from "crypto"

export interface User {
  username: string
  nome: string
  role: Role
  consulenteNome?: string
  leadFilter?: "bambini"
  /** Operatore speciale: Incassi e Andamento come l'admin (totali di tutto il centro). */
  vedeTotaliCentro?: boolean
  /** Sottoinsieme del menu del ruolo. Se assente, vede tutte le pagine del ruolo. */
  pages?: string[]
  email?: string
}

type UserRecord = User & { password: string }

export type AdminUserView = Omit<User, "email"> & { email?: string }

export const VALID_ROLES: Role[] = [
  "admin",
  "operatore",
  "firme",
  "corsi",
  "istruttore",
  "campus",
  "scuola_nuoto",
  "bagnini",
  "danza",
  "crm",
]

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
 *   scuola_nuoto → H2Fc.ScuolaNuoto.9!v
 *   bagnini   → H2Fc.Bagnini.9!w
 *   danza     → H2Fc.Danza.9!y
 *   meta_review → H2Fc.MetaRev.26!k  (solo CRM vendita, per review Meta)
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
  {
    username: "scuola_nuoto",
    password: "$2b$12$78jreNZqA2G6GWgumOSeE.DB4axGGdjTD9NYFw8sG2bzv8sGQHOgW",
    nome: "Scuola Nuoto",
    role: "scuola_nuoto",
  },
  {
    username: "bagnini",
    password: "$2b$12$2.FJCdUc/K7N8NHw6fGAZO/VtFmVkmAD6Y2m1qqgO7ctmsO8lHJ5G",
    nome: "Bagnini",
    role: "bagnini",
  },
  {
    username: "danza",
    password: "$2b$12$yJwj5G4QeWY8wol4TcBxQ.P2FeZ1og0GqicMfVjFk0jOPPfv7XCGe",
    nome: "Danza",
    role: "danza",
  },
  {
    username: "meta_review",
    password: "$2b$12$2SmhAxrJBieuzEnLrnezXOVXNIuf0eEJuAwLqaxIeSJviWsAREKDO",
    nome: "Meta App Review",
    role: "crm",
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
      if (
        !username ||
        !password ||
        !VALID_ROLES.includes(role)
      ) {
        continue
      }
      out.push({
        username,
        password,
        nome,
        role,
        consulenteNome: o.consulenteNome != null ? String(o.consulenteNome) : undefined,
        leadFilter: o.leadFilter === "bambini" ? "bambini" : undefined,
        vedeTotaliCentro: role === "operatore" && o.vedeTotaliCentro === true ? true : undefined,
        email: o.email != null ? String(o.email).trim() : undefined,
        pages: sanitizePages(o.pages, role),
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

const USERS_FILE = "auth-users.json"
const BCRYPT_ROUNDS = 12
const USERNAME_RE = /^[a-zA-Z0-9._-]{2,40}$/

let usersCache: UserRecord[] | null = null

function parseStoredUser(row: unknown): UserRecord | null {
  if (!row || typeof row !== "object") return null
  const o = row as Record<string, unknown>
  const username = String(o.username ?? "").trim()
  const password = String(o.password ?? "")
  const nome = String(o.nome ?? "").trim() || username
  const role = o.role as Role
  if (!username || !password || !VALID_ROLES.includes(role)) return null
  return {
    username,
    password,
    nome,
    role,
    consulenteNome: o.consulenteNome != null ? String(o.consulenteNome) : undefined,
    leadFilter: o.leadFilter === "bambini" ? "bambini" : undefined,
    vedeTotaliCentro: role === "operatore" && o.vedeTotaliCentro === true ? true : undefined,
    email: o.email != null ? String(o.email).trim() || undefined : undefined,
    pages: sanitizePages(o.pages, role),
  }
}

function loadUsersFromFile(): UserRecord[] | null {
  const rows = readJson<unknown>(USERS_FILE, null)
  if (!Array.isArray(rows)) return null
  const out: UserRecord[] = []
  for (const row of rows) {
    const u = parseStoredUser(row)
    if (u) out.push(u)
  }
  return out.length ? out : null
}

function persistUsers(users: UserRecord[]): void {
  usersCache = users
  writeJson(USERS_FILE, users)
}

function getUsers(): UserRecord[] {
  if (usersCache) return usersCache
  const fromFile = loadUsersFromFile()
  if (fromFile) {
    usersCache = mergeEmails(fromFile)
    return usersCache
  }
  const fromEnv = loadUsersFromEnv()
  const seeded = mergeEmails(fromEnv ?? DEFAULT_USERS)
  persistUsers(seeded)
  return seeded
}

export class AuthHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

function normalizeUsername(raw: string): string {
  return raw.trim()
}

function findUserIndex(users: UserRecord[], username: string): number {
  const key = username.toLowerCase()
  return users.findIndex((x) => x.username.toLowerCase() === key)
}

function adminCount(users: UserRecord[]): number {
  return users.filter((u) => u.role === "admin").length
}

function invalidateSessionsFor(username: string): void {
  const key = username.toLowerCase()
  let changed = false
  for (const [tok, s] of sessions.entries()) {
    if (s.user.username.toLowerCase() === key) {
      sessions.delete(tok)
      changed = true
    }
  }
  if (changed) saveSessionsToDisk()
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
    vedeTotaliCentro: u.vedeTotaliCentro,
    pages: u.pages,
  }
}

function toAdminUser(u: UserRecord): AdminUserView {
  return {
    ...toPublicUser(u),
    email: u.email,
  }
}

export type CreateUserInput = {
  username: string
  password: string
  nome: string
  role: Role
  consulenteNome?: string
  leadFilter?: "bambini" | ""
  vedeTotaliCentro?: boolean
  email?: string
  pages?: string[]
}

export type UpdateUserInput = {
  nome?: string
  role?: Role
  consulenteNome?: string | null
  leadFilter?: "bambini" | "" | null
  vedeTotaliCentro?: boolean | null
  email?: string | null
  pages?: string[] | null
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
    const live = getUsers().find((x) => x.username.toLowerCase() === s.user.username.toLowerCase())
    if (!live) {
      sessions.delete(tokenValue)
      saveSessionsToDisk()
      return null
    }
    const user = toPublicUser(live)
    s.user = user
    return user
  },

  logout(tokenValue: string): void {
    sessions.delete(tokenValue)
    saveSessionsToDisk()
  },

  listUsers(): AdminUserView[] {
    return getUsers().map(toAdminUser)
  },

  async createUser(input: CreateUserInput): Promise<AdminUserView> {
    const username = normalizeUsername(input.username)
    if (!USERNAME_RE.test(username)) {
      throw new AuthHttpError(400, "Username non valido (2-40 caratteri: lettere, numeri, . _ -)")
    }
    const password = String(input.password ?? "")
    if (password.length < 8) {
      throw new AuthHttpError(400, "Password di almeno 8 caratteri")
    }
    const nome = String(input.nome ?? "").trim()
    if (!nome) throw new AuthHttpError(400, "Nome obbligatorio")
    if (!VALID_ROLES.includes(input.role)) throw new AuthHttpError(400, "Ruolo non valido")
    if (Array.isArray(input.pages) && input.pages.length === 0) {
      throw new AuthHttpError(400, "Seleziona almeno una pagina visibile")
    }

    const users = getUsers()
    if (findUserIndex(users, username) >= 0) {
      throw new AuthHttpError(409, "Username già esistente")
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const rec: UserRecord = {
      username,
      password: hash,
      nome,
      role: input.role,
      consulenteNome: input.consulenteNome?.trim() || undefined,
      leadFilter: input.leadFilter === "bambini" ? "bambini" : undefined,
      vedeTotaliCentro: input.role === "operatore" && input.vedeTotaliCentro === true ? true : undefined,
      email: input.email?.trim() || undefined,
      pages: sanitizePages(input.pages, input.role),
    }
    persistUsers([...users, rec])
    return toAdminUser(rec)
  },

  async updateUser(usernameRaw: string, input: UpdateUserInput, actorUsername?: string): Promise<AdminUserView> {
    const users = [...getUsers()]
    const idx = findUserIndex(users, usernameRaw)
    if (idx < 0) throw new AuthHttpError(404, "Utente non trovato")
    const current = users[idx]!
    const nextRole = input.role ?? current.role
    if (input.role && !VALID_ROLES.includes(input.role)) throw new AuthHttpError(400, "Ruolo non valido")
    if (Array.isArray(input.pages) && input.pages.length === 0) {
      throw new AuthHttpError(400, "Seleziona almeno una pagina visibile")
    }

    if (current.role === "admin" && nextRole !== "admin" && adminCount(users) <= 1) {
      throw new AuthHttpError(400, "Non puoi togliere l'ultimo amministratore")
    }

    const nome = input.nome != null ? String(input.nome).trim() : current.nome
    if (!nome) throw new AuthHttpError(400, "Nome obbligatorio")

    const rec: UserRecord = {
      ...current,
      nome,
      role: nextRole,
      consulenteNome:
        input.consulenteNome === null
          ? undefined
          : input.consulenteNome != null
            ? input.consulenteNome.trim() || undefined
            : current.consulenteNome,
      leadFilter:
        input.leadFilter === null || input.leadFilter === ""
          ? undefined
          : input.leadFilter === "bambini"
            ? "bambini"
            : current.leadFilter,
      vedeTotaliCentro:
        nextRole !== "operatore"
          ? undefined
          : input.vedeTotaliCentro === true
            ? true
            : input.vedeTotaliCentro === false || input.vedeTotaliCentro === null
              ? undefined
              : current.vedeTotaliCentro,
      email:
        input.email === null
          ? undefined
          : input.email != null
            ? input.email.trim() || undefined
            : current.email,
      pages: sanitizePages(input.pages ?? current.pages, nextRole),
    }
    if (input.pages === null) rec.pages = undefined

    const actor = (actorUsername ?? "").trim().toLowerCase()
    if (
      actor &&
      actor === rec.username.toLowerCase() &&
      rec.role === "admin" &&
      rec.pages?.length &&
      !rec.pages.includes("/utenti")
    ) {
      throw new AuthHttpError(400, "Non puoi toglierti la pagina Utenti e accessi")
    }

    users[idx] = rec
    persistUsers(users)
    return toAdminUser(rec)
  },

  async setPassword(usernameRaw: string, password: string): Promise<void> {
    if (String(password ?? "").length < 8) {
      throw new AuthHttpError(400, "Password di almeno 8 caratteri")
    }
    const users = [...getUsers()]
    const idx = findUserIndex(users, usernameRaw)
    if (idx < 0) throw new AuthHttpError(404, "Utente non trovato")
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    users[idx] = { ...users[idx]!, password: hash }
    persistUsers(users)
    invalidateSessionsFor(users[idx]!.username)
  },

  deleteUser(usernameRaw: string, actorUsername: string): void {
    const username = normalizeUsername(usernameRaw)
    if (username.toLowerCase() === actorUsername.toLowerCase()) {
      throw new AuthHttpError(400, "Non puoi eliminare il tuo utente")
    }
    const users = getUsers()
    const idx = findUserIndex(users, username)
    if (idx < 0) throw new AuthHttpError(404, "Utente non trovato")
    const target = users[idx]!
    if (target.role === "admin" && adminCount(users) <= 1) {
      throw new AuthHttpError(400, "Non puoi eliminare l'ultimo amministratore")
    }
    persistUsers(users.filter((_, i) => i !== idx))
    invalidateSessionsFor(target.username)
  },
}
