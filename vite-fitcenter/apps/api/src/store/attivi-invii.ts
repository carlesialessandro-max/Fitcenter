import { readJson, writeJson } from "./persist.js"

const FILE = "attivi-invii.json"
const MAX = 80

export type AttiviInvioEsito = "sent" | "failed" | "skipped"

export type AttiviInvioRecipient = {
  clienteId: string
  nome: string
  dest: string | null
  esito: AttiviInvioEsito
}

export type AttiviInvio = {
  id: string
  at: string
  user: string
  channel: "email" | "sms"
  subject: string
  text: string
  segmento?: string
  piani?: string[]
  destinatari: number
  sent: number
  failed: number
  skipped: number
  errors: string[]
  recipients: AttiviInvioRecipient[]
}

type StoreShape = { invii: AttiviInvio[] }

function load(): StoreShape {
  const data = readJson<StoreShape>(FILE, { invii: [] })
  if (!Array.isArray(data.invii)) return { invii: [] }
  return data
}

function save(data: StoreShape) {
  writeJson(FILE, data)
}

export const attiviInviiStore = {
  list(limit = 40): AttiviInvio[] {
    const n = Math.min(Math.max(1, limit), MAX)
    return load().invii.slice(0, n)
  },

  get(id: string): AttiviInvio | undefined {
    return load().invii.find((x) => x.id === id)
  },

  append(row: Omit<AttiviInvio, "id" | "at"> & { id?: string; at?: string }): AttiviInvio {
    const data = load()
    const saved: AttiviInvio = {
      ...row,
      id: row.id ?? `invio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: row.at ?? new Date().toISOString(),
    }
    data.invii.unshift(saved)
    if (data.invii.length > MAX) data.invii = data.invii.slice(0, MAX)
    save(data)
    return saved
  },
}
