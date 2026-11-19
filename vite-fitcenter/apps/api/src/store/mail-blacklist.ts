import { readJson, writeJson } from "./persist.js"

const FILE = "mail-blacklist.json"
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type MailBlacklistSource = "link" | "admin" | "reply" | "bounce"

export type MailBlacklistEntry = {
  email: string
  at: string
  source: MailBlacklistSource
  note?: string
  user?: string
}

type StoreShape = { rows: MailBlacklistEntry[] }

function load(): StoreShape {
  const data = readJson<StoreShape>(FILE, { rows: [] })
  if (!Array.isArray(data.rows)) return { rows: [] }
  return data
}

function save(data: StoreShape) {
  writeJson(FILE, data)
}

export function normalizeMailAddr(raw: string): string {
  const t = String(raw ?? "").trim().toLowerCase()
  const m = t.match(/<([^>]+)>/)
  return (m?.[1] ?? t).trim()
}

export function isMailAddrOk(email: string): boolean {
  return EMAIL_OK.test(email)
}

export const mailBlacklistStore = {
  list(): MailBlacklistEntry[] {
    return [...load().rows].sort((a, b) => b.at.localeCompare(a.at))
  },

  has(email: string): boolean {
    const k = normalizeMailAddr(email)
    if (!k) return false
    return load().rows.some((r) => r.email === k)
  },

  add(input: { email: string; source: MailBlacklistSource; note?: string; user?: string }): MailBlacklistEntry {
    const email = normalizeMailAddr(input.email)
    if (!email || !EMAIL_OK.test(email)) {
      throw Object.assign(new Error("Email non valida"), { status: 400 })
    }
    const data = load()
    const existing = data.rows.find((r) => r.email === email)
    if (existing) return existing
    const row: MailBlacklistEntry = {
      email,
      at: new Date().toISOString(),
      source: input.source,
      note: String(input.note ?? "").trim() || undefined,
      user: String(input.user ?? "").trim() || undefined,
    }
    data.rows.unshift(row)
    save(data)
    return row
  },

  addMany(
    emails: string[],
    input: { source: MailBlacklistSource; note?: string; user?: string },
  ): { added: number; skipped: number; emails: string[] } {
    const data = load()
    const have = new Set(data.rows.map((r) => r.email))
    const added: string[] = []
    let skipped = 0
    const at = new Date().toISOString()
    const note = String(input.note ?? "").trim() || undefined
    const user = String(input.user ?? "").trim() || undefined
    for (const raw of emails) {
      const email = normalizeMailAddr(raw)
      if (!email || !EMAIL_OK.test(email)) {
        skipped += 1
        continue
      }
      if (have.has(email)) {
        skipped += 1
        continue
      }
      have.add(email)
      data.rows.unshift({ email, at, source: input.source, note, user })
      added.push(email)
    }
    if (added.length) save(data)
    return { added: added.length, skipped, emails: added }
  },

  remove(email: string): boolean {
    const k = normalizeMailAddr(email)
    if (!k) return false
    const data = load()
    const next = data.rows.filter((r) => r.email !== k)
    if (next.length === data.rows.length) return false
    data.rows = next
    save(data)
    return true
  },
}
