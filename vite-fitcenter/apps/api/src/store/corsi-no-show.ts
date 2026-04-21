import { readJson, writeJson } from "./persist.js"

export type NoShowBlock = {
  email: string
  blockedAt: string
  /** Blocco prenotazioni fino a (YYYY-MM-DD), se applicabile */
  until?: string
  reason: string
  monthKey: string
  count: number
}

const FILE = "corsi-no-show-blocks.json"

function normalizeEmail(s: string): string | null {
  const t = String(s ?? "").trim().toLowerCase()
  if (!t || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null
  return t
}

export const corsiNoShowStore = {
  normalizeEmail,

  list(): NoShowBlock[] {
    const rows = readJson<NoShowBlock[]>(FILE, [])
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => (a.blockedAt < b.blockedAt ? 1 : -1))
  },

  isBlocked(email: string): NoShowBlock | null {
    const e = normalizeEmail(email)
    if (!e) return null
    return corsiNoShowStore.list().find((r) => normalizeEmail(r.email) === e) ?? null
  },

  block(input: { email: string; reason: string; monthKey: string; count: number }): NoShowBlock {
    const e = normalizeEmail(input.email)
    if (!e) throw new Error("Email non valida")
    const now = new Date().toISOString()
    const rows = corsiNoShowStore.list()
    const existingIdx = rows.findIndex((r) => normalizeEmail(r.email) === e)
    const next: NoShowBlock = {
      email: e,
      blockedAt: now,
      reason: String(input.reason ?? "").trim().slice(0, 500) || "No-show ripetuti",
      monthKey: String(input.monthKey ?? "").trim().slice(0, 16) || "—",
      count: Math.max(0, Math.floor(Number(input.count ?? 0) || 0)),
    }
    if (existingIdx >= 0) rows[existingIdx] = next
    else rows.push(next)
    writeJson(FILE, rows)
    return next
  },

  unblock(email: string): boolean {
    const e = normalizeEmail(email)
    if (!e) return false
    const rows = corsiNoShowStore.list()
    const next = rows.filter((r) => normalizeEmail(r.email) !== e)
    if (next.length === rows.length) return false
    writeJson(FILE, next)
    return true
  },
}

