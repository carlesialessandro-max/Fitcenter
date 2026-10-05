import crypto from "crypto"
import bcrypt from "bcrypt"
import { readJson, writeJson } from "./persist.js"
import { listPersonale, nominativo, type LpagaPersonale, type LpagaRuolo } from "./libro-paga-db.js"
import { findDumpFile, parseMysqlTable, readDumpSql } from "../services/libro-paga-dump.js"

const SECRETS_FILE = "libro-paga-secrets.json"
const SESSIONS_FILE = "libro-paga-sessions.json"
const TTL_MS = 12 * 60 * 60 * 1000
const BCRYPT_ROUNDS = 12

export type LpagaSessionUser = {
  id: string
  username: string
  nome: string
  cognome?: string
  ruolo: LpagaRuolo
  livelloId?: string
  nominativo: string
}

type SecretRow = { id: string; username: string; hash: string; algo: "md5" | "bcrypt" }
type SessionRow = { token: string; personaleId: string; expiresAt: number }

function md5hex(s: string): string {
  return crypto.createHash("md5").update(s, "utf8").digest("hex")
}

function timingEqualHex(a: string, b: string): boolean {
  const aa = Buffer.from(a.toLowerCase())
  const bb = Buffer.from(b.toLowerCase())
  if (aa.length !== 32 || bb.length !== 32) return false
  return crypto.timingSafeEqual(aa, bb)
}

export function saveDumpPasswords(rows: { id: string; username: string; hash: string }[]): void {
  const cur = readJson<SecretRow[]>(SECRETS_FILE, [])
  const byId = new Map(cur.map((r) => [r.id, r]))
  for (const r of rows) {
    const hash = String(r.hash ?? "").trim()
    if (!hash || hash.toUpperCase() === "NULL") continue
    const existing = byId.get(r.id)
    if (existing?.algo === "bcrypt") continue
    const algo: SecretRow["algo"] = hash.startsWith("$2") ? "bcrypt" : "md5"
    byId.set(r.id, {
      id: String(r.id),
      username: String(r.username ?? "").trim().toLowerCase(),
      hash: algo === "md5" ? hash.toLowerCase() : hash,
      algo,
    })
  }
  writeJson(SECRETS_FILE, [...byId.values()])
}

function loadDumpPassword(username: string): SecretRow | null {
  const dump = findDumpFile()
  if (!dump) return null
  const users = parseMysqlTable(readDumpSql(dump), "users")
  const u = users.find((r) => String(r.username ?? "").trim().toLowerCase() === username)
  if (!u) return null
  const hash = String(u.password ?? "").trim()
  if (!/^[a-fA-F0-9]{32}$/.test(hash)) return null
  const row: SecretRow = {
    id: String(u.id ?? ""),
    username,
    hash: hash.toLowerCase(),
    algo: "md5",
  }
  if (!row.id) return row
  const all = readJson<SecretRow[]>(SECRETS_FILE, [])
  if (!all.some((x) => x.id === row.id && x.algo === "bcrypt")) {
    writeJson(SECRETS_FILE, [...all.filter((x) => x.id !== row.id), row])
  }
  return row
}

function toPublic(p: LpagaPersonale): LpagaSessionUser {
  return {
    id: p.id,
    username: p.username ?? "",
    nome: p.nome,
    ...(p.cognome ? { cognome: p.cognome } : {}),
    ruolo: p.ruolo,
    ...(p.livelloId ? { livelloId: p.livelloId } : {}),
    nominativo: nominativo(p),
  }
}

export async function loginLpaga(
  usernameRaw: string,
  password: string
): Promise<{ token: string; user: LpagaSessionUser } | null> {
  const username = usernameRaw.trim().toLowerCase()
  if (!username || !password) return null
  const persone = await listPersonale()
  const p = persone.find((x) => (x.username ?? "").toLowerCase() === username && x.attivo !== false)
  if (!p) return null
  let secrets = readJson<SecretRow[]>(SECRETS_FILE, [])
  let sec = secrets.find((s) => s.id === p.id) ?? secrets.find((s) => s.username === username)
  if (!sec) sec = loadDumpPassword(username) ?? undefined
  if (!sec) return null
  const ok =
    sec.algo === "bcrypt"
      ? await bcrypt.compare(password, sec.hash)
      : timingEqualHex(md5hex(password), sec.hash)
  if (!ok) return null
  if (sec.algo === "md5") {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    secrets = readJson<SecretRow[]>(SECRETS_FILE, [])
    const row: SecretRow = { id: p.id, username, hash, algo: "bcrypt" }
    const i = secrets.findIndex((s) => s.id === p.id)
    if (i >= 0) secrets[i] = row
    else secrets.push(row)
    writeJson(SECRETS_FILE, secrets)
  }
  const token = crypto.randomBytes(32).toString("hex")
  const sessions = readJson<SessionRow[]>(SESSIONS_FILE, []).filter((s) => s.expiresAt > Date.now())
  sessions.push({ token, personaleId: p.id, expiresAt: Date.now() + TTL_MS })
  writeJson(SESSIONS_FILE, sessions)
  return { token, user: toPublic(p) }
}

export function logoutLpaga(token: string): void {
  writeJson(
    SESSIONS_FILE,
    readJson<SessionRow[]>(SESSIONS_FILE, []).filter((s) => s.token !== token)
  )
}

export async function meLpaga(token: string): Promise<LpagaSessionUser | null> {
  const sessions = readJson<SessionRow[]>(SESSIONS_FILE, [])
  const s = sessions.find((x) => x.token === token)
  if (!s || s.expiresAt < Date.now()) return null
  const p = (await listPersonale()).find((x) => x.id === s.personaleId && x.attivo !== false)
  return p ? toPublic(p) : null
}

export function bearerLpaga(req: { headers: { authorization?: string } }): string | null {
  const h = req.headers.authorization
  if (!h?.startsWith("Bearer ")) return null
  return h.slice(7).trim() || null
}
