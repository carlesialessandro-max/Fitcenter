import type { Chiamata, ChiamataCreate } from "../types/chiamata.js"
import type { CrmAppuntamentoRow } from "../services/gestionale-sql.js"
import { TELEFONATA_ATTIVITA_DEFAULT, TELEFONATA_AZIONE_DEFAULT } from "../types/chiamata.js"
import { readJson, writeJson } from "./persist.js"

const db = new Map<string, Chiamata>()
const PERSIST_FILE = "chiamate.json"

function loadPersisted() {
  const list = readJson<Chiamata[]>(PERSIST_FILE, [])
  if (!Array.isArray(list)) return
  for (const item of list) {
    if (item && typeof item === "object" && typeof (item as Chiamata).id === "string") {
      db.set((item as Chiamata).id, item as Chiamata)
    }
  }
}

function persist() {
  writeJson(PERSIST_FILE, Array.from(db.values()))
}

loadPersisted()

function id() {
  return crypto.randomUUID()
}

function now() {
  return new Date().toISOString()
}

function chiamataQuando(c: Chiamata): Date {
  return new Date(c.evasoAt ?? c.dataOra)
}

function telDigits(t: string): string {
  return (t ?? "").replace(/\D/g, "").slice(-9)
}

function consulenteMatch(stored: string, filter: string): boolean {
  const a = stored.trim().toLowerCase()
  const b = filter.trim().toLowerCase()
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

function evasoToIso(raw: string): string {
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? now() : d.toISOString()
}

function findDuplicateCrmImport(params: {
  crmId?: string
  telefono: string
  evasoDay: string
  consulente: string
}): boolean {
  const tel = telDigits(params.telefono)
  return Array.from(db.values()).some((c) => {
    if (params.crmId && c.crmId === params.crmId) return true
    if (!tel || telDigits(c.telefono) !== tel) return false
    const day = (c.evasoAt ?? c.dataOra).slice(0, 10)
    if (day !== params.evasoDay) return false
    return consulenteMatch(c.consulenteNome ?? c.consulenteId, params.consulente)
  })
}

export const store = {
  create(input: ChiamataCreate): Chiamata {
    const evasoAt = input.evasoAt?.trim() || now()
    const consulente = (input.consulenteNome ?? input.consulenteId ?? "").trim()
    if (
      findDuplicateCrmImport({
        telefono: input.telefono,
        evasoDay: evasoAt.slice(0, 10),
        consulente,
      })
    ) {
      const hit = Array.from(db.values()).find((c) => {
        if (telDigits(c.telefono) !== telDigits(input.telefono)) return false
        const day = (c.evasoAt ?? c.dataOra).slice(0, 10)
        if (day !== evasoAt.slice(0, 10)) return false
        return consulenteMatch(c.consulenteNome ?? c.consulenteId, consulente)
      })
      if (hit) return hit
    }
    const chiamata: Chiamata = {
      id: id(),
      ...input,
      origine: "app",
      dataOra: now(),
      evasoAt,
    }
    db.set(chiamata.id, chiamata)
    persist()
    return chiamata
  },

  /** Telefonate evase nel gestionale → registro locale (idempotente). */
  importFromCrm(rows: CrmAppuntamentoRow[], consulenteLabel: string): number {
    const label = consulenteLabel.trim()
    if (!label) return 0
    let added = 0
    for (const r of rows) {
      if (!r.dataEvasione?.trim()) continue
      const crmId = r.crmId?.trim() || undefined
      const evasoAt = evasoToIso(r.dataEvasione)
      const evasoDay = evasoAt.slice(0, 10)
      const consulente = label
      if (
        findDuplicateCrmImport({
          crmId,
          telefono: r.telefono ?? "",
          evasoDay,
          consulente,
        })
      ) {
        continue
      }
      const nome =
        [r.nome, r.cognome].filter(Boolean).join(" ").trim() ||
        (r.crmDescrizione?.slice(0, 80).trim() || "CRM")
      const chiamata: Chiamata = {
        id: id(),
        crmId,
        origine: "crm",
        consulenteId: consulente,
        consulenteNome: consulente,
        tipo: "cliente",
        nomeContatto: nome,
        telefono: (r.telefono ?? "").trim() || "—",
        dataOra: evasoAt,
        evasoAt,
        esitoCrm: r.esitoDescrizione?.trim() || undefined,
        note: r.crmDescrizione?.trim() || undefined,
        attivita: r.attivitaDescrizione?.trim() || TELEFONATA_ATTIVITA_DEFAULT,
        azione: r.tipoDescrizione?.trim() || TELEFONATA_AZIONE_DEFAULT,
      }
      db.set(chiamata.id, chiamata)
      added++
    }
    if (added > 0) persist()
    return added
  },

  list(filters: { consulenteId?: string; da?: string; a?: string; tipo?: string; clienteId?: string; leadId?: string } = {}): Chiamata[] {
    let list = Array.from(db.values())
    if (filters.consulenteId) {
      const want = filters.consulenteId.trim()
      list = list.filter(
        (c) =>
          consulenteMatch(c.consulenteId ?? "", want) || consulenteMatch(c.consulenteNome ?? "", want)
      )
    }
    if (filters.tipo) {
      list = list.filter((c) => c.tipo === filters.tipo)
    }
    if (filters.clienteId) {
      list = list.filter((c) => c.clienteId === filters.clienteId)
    }
    if (filters.leadId) {
      list = list.filter((c) => c.leadId === filters.leadId)
    }
    if (filters.da) {
      const da = new Date(filters.da)
      list = list.filter((c) => chiamataQuando(c) >= da)
    }
    if (filters.a) {
      const a = new Date(filters.a)
      a.setHours(23, 59, 59, 999)
      list = list.filter((c) => chiamataQuando(c) <= a)
    }
    list.sort((a, b) => new Date(b.dataOra).getTime() - new Date(a.dataOra).getTime())
    return list
  },

  get(id: string): Chiamata | undefined {
    return db.get(id)
  },

  stats(): { oggi: number; settimana: number; perConsulente: { consulenteNome: string; count: number }[] } {
    const nowDate = new Date()
    const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
    const startOfWeek = new Date(startOfToday)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())

    const all = Array.from(db.values())
    const oggi = all.filter((c) => chiamataQuando(c) >= startOfToday).length
    const settimana = all.filter((c) => chiamataQuando(c) >= startOfWeek).length

    const byConsulente = new Map<string, number>()
    all.forEach((c) => {
      const key = c.consulenteNome || c.consulenteId
      byConsulente.set(key, (byConsulente.get(key) ?? 0) + 1)
    })
    const perConsulente = Array.from(byConsulente.entries()).map(([consulenteNome, count]) => ({
      consulenteNome,
      count,
    })).sort((a, b) => b.count - a.count)

    return { oggi, settimana, perConsulente }
  },
}
