import { readJson, writeJson } from "./persist.js"
import crypto from "crypto"

export type PiscinaBooking = {
  id: string
  date: string // YYYY-MM-DD
  seatId: string
  createdAt: string
  createdByUsername: string
}

const FILE = "piscina-bookings.json"

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeDate(s: unknown): string | null {
  const v = String(s ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  return v
}

function normalizeSeatId(s: unknown): string | null {
  const v = String(s ?? "").trim()
  if (!v) return null
  if (v.length > 64) return null
  return v
}

function loadAll(): PiscinaBooking[] {
  const rows = readJson<PiscinaBooking[]>(FILE, [])
  return Array.isArray(rows) ? rows : []
}

function saveAll(rows: PiscinaBooking[]): void {
  writeJson(FILE, rows)
}

export const piscinaBookingsStore = {
  listByDate(date: string): PiscinaBooking[] {
    const d = normalizeDate(date)
    if (!d) return []
    return loadAll().filter((b) => b.date === d)
  },

  create(input: { date: string; seatId: string; createdByUsername: string }): { ok: true; booking: PiscinaBooking } | { ok: false; message: string } {
    const date = normalizeDate(input.date)
    const seatId = normalizeSeatId(input.seatId)
    const createdByUsername = String(input.createdByUsername ?? "").trim()
    if (!date) return { ok: false, message: "Data non valida (usa YYYY-MM-DD)" }
    if (!seatId) return { ok: false, message: "Posto non valido" }
    if (!createdByUsername) return { ok: false, message: "Utente non valido" }

    const all = loadAll()
    const existing = all.find((b) => b.date === date && b.seatId === seatId)
    if (existing) return { ok: false, message: "Posto già prenotato per questa data" }

    const booking: PiscinaBooking = {
      id: crypto.randomUUID(),
      date,
      seatId,
      createdAt: nowIso(),
      createdByUsername,
    }
    all.push(booking)
    saveAll(all)
    return { ok: true, booking }
  },

  remove(id: string): boolean {
    const key = String(id ?? "").trim()
    if (!key) return false
    const all = loadAll()
    const next = all.filter((b) => b.id !== key)
    if (next.length === all.length) return false
    saveAll(next)
    return true
  },
}

