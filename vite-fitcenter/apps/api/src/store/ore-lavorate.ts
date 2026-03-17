import { readJson, writeJson } from "./persist.js"

export interface OraLavorata {
  id: string
  consulenteNome: string
  /** Data giorno YYYY-MM-DD */
  giorno: string
  /** Ora inizio HH:mm */
  oraInizio: string
  /** Ora fine HH:mm */
  oraFine: string
  createdAt: string
}

const db = new Map<string, OraLavorata>()
const PERSIST_FILE = "ore-lavorate.json"

function loadPersisted() {
  const list = readJson<OraLavorata[]>(PERSIST_FILE, [])
  db.clear()
  list.forEach((r) => {
    if (r?.id && r.consulenteNome && r.giorno && r.oraInizio != null && r.oraFine != null) db.set(r.id, r)
  })
}
loadPersisted()

function persist() {
  writeJson(PERSIST_FILE, Array.from(db.values()))
}

function id() {
  return crypto.randomUUID()
}

function now() {
  return new Date().toISOString()
}

export const store = {
  list(filters: { consulenteNome?: string; anno?: number; mese?: number }): OraLavorata[] {
    let out = Array.from(db.values())
    if (filters.consulenteNome?.trim()) {
      const want = filters.consulenteNome.trim().toLowerCase()
      out = out.filter((r) => (r.consulenteNome ?? "").toLowerCase() === want)
    }
    if (filters.anno != null && !Number.isNaN(filters.anno)) {
      out = out.filter((r) => {
        const y = r.giorno.slice(0, 4)
        return y === String(filters.anno)
      })
    }
    if (filters.mese != null && !Number.isNaN(filters.mese)) {
      out = out.filter((r) => {
        const m = r.giorno.slice(5, 7)
        return m === String(filters.mese).padStart(2, "0")
      })
    }
    return out.sort((a, b) => (b.giorno + b.oraInizio).localeCompare(a.giorno + a.oraInizio))
  },

  create(input: Omit<OraLavorata, "id" | "createdAt">): OraLavorata {
    const row: OraLavorata = {
      ...input,
      id: id(),
      createdAt: now(),
    }
    db.set(row.id, row)
    persist()
    return row
  },

  delete(id: string): boolean {
    const ok = db.delete(id)
    if (ok) persist()
    return ok
  },
}
