import { readJson, writeJson } from "./persist.js"

/** Stato follow-up rinnovo abbonamento (come pipeline CRM). */
export type RinnovoStato =
  | "da_contattare"
  | "contattato"
  | "appuntamento"
  | "rinnovo_confermato"
  | "non_rinnova"
  | "chiuso"

export interface AbbonamentoFollowUp {
  abbonamentoId: string
  stato: RinnovoStato
  note: string
  updatedAt: string
}

const db = new Map<string, AbbonamentoFollowUp>()
const PERSIST_FILE = "abbonamenti-follow-up.json"

function loadPersisted() {
  const all = readJson<Record<string, Omit<AbbonamentoFollowUp, "abbonamentoId">>>(PERSIST_FILE, {})
  if (!all || typeof all !== "object") return
  for (const [id, v] of Object.entries(all)) {
    if (!id || !v || typeof v !== "object") continue
    db.set(id, {
      abbonamentoId: id,
      stato: (v.stato as RinnovoStato) ?? "da_contattare",
      note: typeof v.note === "string" ? v.note : "",
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString(),
    })
  }
}

function persist() {
  writeJson(PERSIST_FILE, store.getAll())
}

loadPersisted()

function now() {
  return new Date().toISOString()
}

export const store = {
  getAll(): Record<string, Omit<AbbonamentoFollowUp, "abbonamentoId">> {
    const out: Record<string, Omit<AbbonamentoFollowUp, "abbonamentoId">> = {}
    db.forEach((v, k) => {
      out[k] = { stato: v.stato, note: v.note, updatedAt: v.updatedAt }
    })
    return out
  },

  get(abbonamentoId: string): AbbonamentoFollowUp | undefined {
    return db.get(abbonamentoId)
  },

  set(abbonamentoId: string, input: { stato?: RinnovoStato; note?: string }): AbbonamentoFollowUp {
    const cur = db.get(abbonamentoId)
    const stato = input.stato ?? cur?.stato ?? "da_contattare"
    const note = input.note !== undefined ? input.note : (cur?.note ?? "")
    const updatedAt = now()
    const entry: AbbonamentoFollowUp = { abbonamentoId, stato, note, updatedAt }
    db.set(abbonamentoId, entry)
    persist()
    return entry
  },
}
