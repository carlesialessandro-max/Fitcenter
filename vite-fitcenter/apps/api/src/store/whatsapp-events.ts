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
  /** Motivo italiano se Meta non ha consegnato. */
  errorIt?: string
  raw: unknown
}

/** Codice Meta → cosa fare. Non è detto che abbiano bloccato il numero. */
export function explainWhatsappDeliveryError(raw: unknown, fallback?: string): string | undefined {
  const blob = JSON.stringify(raw ?? "")
  const fallbackText = String(fallback ?? "").trim()
  const codeMatch = blob.match(/\b(13\d{4}|130429|13200\d)\b/) || fallbackText.match(/\b(13\d{4}|130429|13200\d)\b/)
  const code = codeMatch?.[1]
  const details =
    (raw && typeof raw === "object"
      ? String(
          (raw as { deliveryError?: string }).deliveryError ??
            (raw as { error?: string }).error ??
            (raw as { errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> }).errors?.[0]
              ?.error_data?.details ??
            (raw as { errors?: Array<{ title?: string; message?: string }> }).errors?.[0]?.message ??
            (raw as { errors?: Array<{ title?: string }> }).errors?.[0]?.title ??
            ""
        )
      : "") || fallbackText
  const lower = `${details} ${blob}`.toLowerCase()

  if (code === "131047" || lower.includes("24 hour") || lower.includes("re-engage")) {
    return "Fuori finestra 24 ore: il cliente non ha scritto al WhatsApp FitCenter di recente. Il testo libero non arriva (non è un blocco)."
  }
  if (code === "131026" || lower.includes("undeliverable")) {
    return "Non recapitabile: numero non su WhatsApp, sbagliato, o l’app non accetta messaggi da aziende. Controlla il cellulare in anagrafica (non è detto che abbia bloccato H2Sport)."
  }
  if (code === "131048" || lower.includes("spam")) {
    return "Meta l’ha tenuto fermo (spam / troppi invii). Non è un blocco del cliente."
  }
  if (code === "130429") {
    return "Troppi messaggi in poco tempo. Riprova più tardi."
  }
  if (code === "132001" || lower.includes("template name")) {
    return "Template Meta non trovato o non approvato."
  }
  if (code === "131051") {
    return "Tipo di messaggio non supportato su quel WhatsApp."
  }
  if (code === "131031") {
    return "Account WhatsApp Business con limitazioni. Controlla Meta Manager."
  }
  if (!details && !code) return undefined
  return `Errore WhatsApp${code ? ` ${code}` : ""}: ${details || "consegna rifiutata da Meta"}`
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

/** Frasi usate solo nelle prove interne (Alessandro): intera chat di quel numero. */
export const WHATSAPP_TEST_LOG_RE: RegExp[] = [
  /lo lavo io o lo lavate voi/i,
  /scusami la 25\s*mt/i,
  /tutti i pomeriggi ore 17/i,
  /prenota prova mercoled[iì']?\s*16\s*settembre\s*ore\s*16[.:]45/i,
  /prova scuola_nuoto mercoled/i,
]

export function isWhatsappTestLogText(text?: string): boolean {
  const t = String(text ?? "")
  if (!t) return false
  return WHATSAPP_TEST_LOG_RE.some((re) => re.test(t))
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

  /** Telefono normalizzato (senza 39/0) per confronto. */
  phoneKey(raw?: string): string {
    let x = phoneDigits(raw ?? "")
    if (x.startsWith("39") && x.length > 10) x = x.slice(2)
    if (x.startsWith("0")) x = x.slice(1)
    return x
  },

  findPhonesWithTestLogs(): string[] {
    const keys = new Set<string>()
    for (const e of load().events) {
      if (!isWhatsappTestLogText(e.text)) continue
      // Solo il cellulare cliente, mai il numero WhatsApp H2Sport
      const customer = e.kind === "message_out" ? this.phoneKey(e.to) : this.phoneKey(e.from)
      if (customer) keys.add(customer)
    }
    return [...keys]
  },

  removeByPhones(phones: string[]): { removed: number; phones: string[] } {
    const keys = new Set(phones.map((p) => this.phoneKey(p)).filter(Boolean))
    if (keys.size === 0) return { removed: 0, phones: [] }
    const data = load()
    const before = data.events.length
    data.events = data.events.filter((e) => {
      const a = this.phoneKey(e.from)
      const b = this.phoneKey(e.to)
      return !(keys.has(a) || keys.has(b))
    })
    const removed = before - data.events.length
    if (removed > 0) save(data)
    return { removed, phones: [...keys] }
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
      errorIt: ev.errorIt,
      raw: ev.raw,
    }
    data.events.unshift(row)
    if (data.events.length > MAX) data.events = data.events.slice(0, MAX)
    save(data)
    return row
  },

  /** Aggiorna l'esito reale Meta (failed/delivered) sul messaggio in uscita. */
  markOutboundStatus(waMessageId: string, status: string, errorText?: string): void {
    const id = String(waMessageId ?? "").trim()
    if (!id) return
    const data = load()
    const row = data.events.find((e) => e.kind === "message_out" && e.waMessageId === id)
    if (!row) return
    const st = status.toLowerCase()
    if (st === "failed" || st === "undelivered") {
      row.status = "error"
      row.errorIt = explainWhatsappDeliveryError(
        { ...(typeof row.raw === "object" && row.raw ? row.raw : {}), deliveryError: errorText },
        errorText
      )
      if (errorText) {
        const raw = row.raw && typeof row.raw === "object" ? (row.raw as Record<string, unknown>) : {}
        row.raw = { ...raw, deliveryError: errorText }
      }
    } else if (st === "delivered" || st === "read" || st === "sent") {
      if (row.status !== "error") row.status = st
    }
    save(data)
  },
}
