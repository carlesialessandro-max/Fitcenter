import type { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { rowToAbbonamento } from "../data/map-sql-to-types.js"
import { campusStore } from "../store/campus.js"
import { getScopedUser } from "../middleware/auth.js"

function normToken(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function isCampusAbb(a: ReturnType<typeof rowToAbbonamento>): boolean {
  const macro = normToken(a.macroCategoriaDescrizione ?? "")
  const cat = normToken(a.categoriaAbbonamentoDescrizione ?? "")
  // Richiesta: MacroCategoria = CORSI, CategoriaAbbonamenti = CAMPUS SPORTIVI
  return macro.includes("corsi") && cat.includes("campus sportivi")
}

function mondayOf(d: Date): Date {
  const x = new Date(d.getTime())
  const day = x.getDay() // 0=dom
  const diff = (day === 0 ? -6 : 1) - day
  x.setDate(x.getDate() + diff)
  x.setHours(0, 0, 0, 0)
  return x
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function fmtIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}`
}

function computeWeeks(dataInizioIso: string, dataFineIso: string): { key: string; label: string; from: string; to: string }[] {
  const di = new Date(`${dataInizioIso}T12:00:00`)
  const df = new Date(`${dataFineIso}T12:00:00`)
  if (Number.isNaN(di.getTime()) || Number.isNaN(df.getTime())) return []
  let cur = mondayOf(di)
  const end = new Date(df.getTime())
  end.setHours(23, 59, 59, 999)
  const out: { key: string; label: string; from: string; to: string }[] = []
  for (let i = 0; i < 32; i++) {
    const wFrom = new Date(cur.getTime())
    const wTo = new Date(cur.getTime())
    wTo.setDate(wTo.getDate() + 6)
    const fromIso = isoDate(wFrom)
    const toIso = isoDate(wTo)
    const intersects = wTo.getTime() >= di.getTime() && wFrom.getTime() <= df.getTime()
    if (intersects) {
      out.push({ key: fromIso, from: fromIso, to: toIso, label: `${fmtIt(fromIso)}–${fmtIt(toIso)}` })
    }
    cur.setDate(cur.getDate() + 7)
    if (wFrom.getTime() > end.getTime()) break
  }
  return out
}

export async function getCampus(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })

    const rows = await gestionaleSql.queryAbbonamenti(undefined)
    const abbonamenti = rows.map((r) => rowToAbbonamento(r)).filter(isCampusAbb)

    const byCliente = new Map<
      string,
      {
        clienteId: string
        clienteNome: string
        items: { abbonamentoId: string; pianoNome: string; dataInizio: string; dataFine: string; settimane: string[] }[]
      }
    >()
    const weekSet = new Map<string, { key: string; label: string; from: string; to: string }>()

    for (const a of abbonamenti) {
      const weeks = computeWeeks(a.dataInizio, a.dataFine)
      weeks.forEach((w) => weekSet.set(w.key, w))
      const entry = byCliente.get(a.clienteId) ?? { clienteId: a.clienteId, clienteNome: a.clienteNome, items: [] }
      entry.items.push({
        abbonamentoId: a.id,
        pianoNome: a.pianoNome,
        dataInizio: a.dataInizio,
        dataFine: a.dataFine,
        settimane: weeks.map((w) => w.key),
      })
      byCliente.set(a.clienteId, entry)
    }

    const weeks = Array.from(weekSet.values()).sort((a, b) => a.key.localeCompare(b.key))
    const clienti = Array.from(byCliente.values()).sort((a, b) => a.clienteNome.localeCompare(b.clienteNome))

    const payload = {
      weeks,
      clienti: clienti.map((c) => {
        const saved = campusStore.get(c.clienteId)
        return {
          ...c,
          allergie: saved?.allergie ?? "",
          note: saved?.note ?? "",
          weekNotes: saved?.weeks ?? {},
        }
      }),
    }
    res.json(payload)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function patchCampusCliente(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })
    const clienteId = String(req.params.clienteId ?? "").trim()
    if (!clienteId) return res.status(400).json({ message: "clienteId mancante" })
    const body = (req.body ?? {}) as { allergie?: string; note?: string }
    const updated = campusStore.upsertCliente(clienteId, { allergie: body.allergie, note: body.note })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function patchCampusWeekNote(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })
    const clienteId = String(req.params.clienteId ?? "").trim()
    const weekKey = String(req.params.weekKey ?? "").trim()
    if (!clienteId || !weekKey) return res.status(400).json({ message: "parametri mancanti" })
    const body = (req.body ?? {}) as { note?: string }
    const updated = campusStore.upsertWeekNote(clienteId, weekKey, String(body.note ?? ""))
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

