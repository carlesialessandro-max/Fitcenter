import { readJson, writeJson } from "./persist.js"

export type CampusWeekNote = {
  weekKey: string
  note?: string
}

export type CampusRecord = {
  clienteId: string
  gruppo?: string
  genitore?: string
  liv?: string
  allergie?: string
  note?: string
  weeks?: Record<string, { note?: string }>
  updatedAt: string
}

const PERSIST_FILE = "campus.json"
const db = new Map<string, CampusRecord>()

function nowIso() {
  return new Date().toISOString()
}

function persist() {
  writeJson(PERSIST_FILE, Array.from(db.values()))
}

function loadPersisted() {
  const list = readJson<CampusRecord[]>(PERSIST_FILE, [])
  db.clear()
  list.forEach((r) => {
    if (r && r.clienteId) db.set(String(r.clienteId), r)
  })
}

export const campusStore = {
  get(clienteId: string): CampusRecord | null {
    const id = String(clienteId ?? "").trim()
    if (!id) return null
    return db.get(id) ?? null
  },

  upsertCliente(
    clienteId: string,
    patch: { gruppo?: string; genitore?: string; liv?: string; allergie?: string; note?: string }
  ): CampusRecord {
    const id = String(clienteId ?? "").trim()
    const curr = db.get(id)
    const next: CampusRecord = {
      clienteId: id,
      gruppo: patch.gruppo != null ? String(patch.gruppo) : (curr?.gruppo ?? ""),
      genitore: patch.genitore != null ? String(patch.genitore) : (curr?.genitore ?? ""),
      liv: patch.liv != null ? String(patch.liv) : (curr?.liv ?? ""),
      allergie: patch.allergie != null ? String(patch.allergie) : (curr?.allergie ?? ""),
      note: patch.note != null ? String(patch.note) : (curr?.note ?? ""),
      weeks: curr?.weeks ?? {},
      updatedAt: nowIso(),
    }
    db.set(id, next)
    persist()
    return next
  },

  upsertWeekNote(clienteId: string, weekKey: string, note: string): CampusRecord {
    const id = String(clienteId ?? "").trim()
    const wk = String(weekKey ?? "").trim()
    const curr = db.get(id)
    const weeks = { ...(curr?.weeks ?? {}) }
    weeks[wk] = { ...(weeks[wk] ?? {}), note: String(note ?? "") }
    const next: CampusRecord = {
      clienteId: id,
      gruppo: curr?.gruppo ?? "",
      genitore: curr?.genitore ?? "",
      liv: curr?.liv ?? "",
      allergie: curr?.allergie ?? "",
      note: curr?.note ?? "",
      weeks,
      updatedAt: nowIso(),
    }
    db.set(id, next)
    persist()
    return next
  },
}

loadPersisted()

