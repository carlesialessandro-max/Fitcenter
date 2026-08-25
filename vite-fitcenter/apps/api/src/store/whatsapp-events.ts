import { readJson, writeJson } from "./persist.js"

const FILE = "whatsapp-events.json"
const MAX = 2000

export type WhatsappEventKind = "message_in" | "message_out" | "status" | "booking" | "other"

export interface WhatsappStoredEvent {
  id: string
  kind: WhatsappEventKind
  at: string
  from?: string
  to?: string
  waMessageId?: string
  text?: string
  status?: string
  raw: unknown
}

type StoreShape = { events: WhatsappStoredEvent[] }

function load(): StoreShape {
  return readJson<StoreShape>(FILE, { events: [] })
}

function save(data: StoreShape) {
  writeJson(FILE, data)
}

function phoneDigits(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "")
}

function phonesLooseMatch(a?: string, b?: string): boolean {
  let x = phoneDigits(a ?? "")
  let y = phoneDigits(b ?? "")
  if (x.startsWith("39") && x.length > 10) x = x.slice(2)
  if (y.startsWith("39") && y.length > 10) y = y.slice(2)
  if (x.startsWith("0")) x = x.slice(1)
  if (y.startsWith("0")) y = y.slice(1)
  if (!x || !y) return false
  return x === y || x.endsWith(y) || y.endsWith(x)
}

export type WhatsappEventsFilter = {
  limit?: number
  phone?: string
  kind?: string
  q?: string
}

export const whatsappEventsStore = {
  list(limit = 100): WhatsappStoredEvent[] {
    const n = Math.min(Math.max(1, limit), MAX)
    return load().events.slice(0, n)
  },

  listFiltered(filters: WhatsappEventsFilter = {}): {
    events: WhatsappStoredEvent[]
    total: number
    limit: number
  } {
    const limit = Math.min(Math.max(1, Number(filters.limit) || 200), MAX)
    const phone = String(filters.phone ?? "").trim()
    const kind = String(filters.kind ?? "").trim().toLowerCase()
    const q = String(filters.q ?? "").trim().toLowerCase()

    let rows = load().events
    if (phone) {
      rows = rows.filter((e) => phonesLooseMatch(e.from, phone) || phonesLooseMatch(e.to, phone))
    }
    if (kind && kind !== "all") {
      rows = rows.filter((e) => e.kind === kind)
    } else {
      // Default log conversazione: niente ricevute Meta (delivered/read) né "other"
      rows = rows.filter(
        (e) => e.kind === "message_in" || e.kind === "message_out" || e.kind === "booking"
      )
    }
    if (q) {
      rows = rows.filter((e) => {
        const blob = `${e.text ?? ""} ${e.status ?? ""} ${e.from ?? ""} ${e.to ?? ""} ${e.kind}`.toLowerCase()
        return blob.includes(q)
      })
    }
    return { events: rows.slice(0, limit), total: rows.length, limit }
  },

  append(ev: Omit<WhatsappStoredEvent, "id" | "at"> & { id?: string; at?: string }): WhatsappStoredEvent {
    const data = load()
    const row: WhatsappStoredEvent = {
      id: ev.id ?? `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: ev.at ?? new Date().toISOString(),
      kind: ev.kind,
      from: ev.from,
      to: ev.to,
      waMessageId: ev.waMessageId,
      text: ev.text,
      status: ev.status,
      raw: ev.raw,
    }
    data.events.unshift(row)
    if (data.events.length > MAX) data.events = data.events.slice(0, MAX)
    save(data)
    return row
  },
}
