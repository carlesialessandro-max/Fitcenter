import { readJson, writeJson } from "./persist.js"

const FILE = "whatsapp-events.json"
const MAX = 500

export type WhatsappEventKind = "message_in" | "status" | "other"

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

export const whatsappEventsStore = {
  list(limit = 100): WhatsappStoredEvent[] {
    const n = Math.min(Math.max(1, limit), MAX)
    return load().events.slice(0, n)
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
