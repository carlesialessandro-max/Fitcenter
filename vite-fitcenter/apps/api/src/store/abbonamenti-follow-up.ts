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
    return entry
  },
}
