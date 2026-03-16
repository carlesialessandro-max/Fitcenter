import type { Chiamata, ChiamataCreate } from "../types/chiamata.js"

const db = new Map<string, Chiamata>()

function id() {
  return crypto.randomUUID()
}

function now() {
  return new Date().toISOString()
}

export const store = {
  create(input: ChiamataCreate): Chiamata {
    const chiamata: Chiamata = {
      id: id(),
      ...input,
      dataOra: now(),
    }
    db.set(chiamata.id, chiamata)
    return chiamata
  },

  list(filters: { consulenteId?: string; da?: string; a?: string; tipo?: string; clienteId?: string; leadId?: string } = {}): Chiamata[] {
    let list = Array.from(db.values())
    if (filters.consulenteId) {
      list = list.filter((c) => c.consulenteId === filters.consulenteId)
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
      list = list.filter((c) => new Date(c.dataOra) >= da)
    }
    if (filters.a) {
      const a = new Date(filters.a)
      a.setHours(23, 59, 59, 999)
      list = list.filter((c) => new Date(c.dataOra) <= a)
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
    const oggi = all.filter((c) => new Date(c.dataOra) >= startOfToday).length
    const settimana = all.filter((c) => new Date(c.dataOra) >= startOfWeek).length

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
