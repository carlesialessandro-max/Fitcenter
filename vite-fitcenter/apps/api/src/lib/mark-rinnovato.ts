import type { Abbonamento } from "../types/gestionale.js"

function parseDateToTime(s: string): number {
  if (!s || !s.trim()) return 0
  const t = s.trim()
  const iso = /^\d{4}-\d{2}-\d{2}/.test(t)
  if (iso) return new Date(t).getTime()
  const it = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (it) return new Date(+it[3], +it[2] - 1, +it[1]).getTime()
  const d = new Date(t).getTime()
  return Number.isNaN(d) ? 0 : d
}

/** Marca rinnovato=true se esiste un altro abbonamento dello stesso cliente con dataInizio > dataFine di questo. */
export function markRinnovato(list: Abbonamento[]): void {
  type Top = { time: number; id: string | null }
  const topsByCliente = new Map<string, { top1: Top; top2: Top }>()

  for (const a of list) {
    const cliente = String(a.clienteId ?? "").trim()
    if (!cliente) continue
    const id = String(a.id ?? "").trim() || null
    const inizioT = parseDateToTime(a.dataInizio ?? "")
    const entry = topsByCliente.get(cliente)
    if (!entry) {
      topsByCliente.set(cliente, { top1: { time: inizioT, id }, top2: { time: 0, id: null } })
      continue
    }
    if (inizioT > entry.top1.time) {
      entry.top2 = entry.top1
      entry.top1 = { time: inizioT, id }
    } else if (id !== entry.top1.id && inizioT > entry.top2.time) {
      entry.top2 = { time: inizioT, id }
    }
  }

  for (const a of list) {
    const cliente = String(a.clienteId ?? "").trim()
    if (!cliente) continue
    const id = String(a.id ?? "").trim() || null
    const dataFineA = parseDateToTime(a.dataFine ?? "")
    if (!dataFineA) continue
    const entry = topsByCliente.get(cliente)
    if (!entry) {
      a.rinnovato = false
      continue
    }
    const maxOther = entry.top1.id !== id ? entry.top1.time : entry.top2.time
    a.rinnovato = maxOther > dataFineA
  }
}
