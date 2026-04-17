import type { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { rowToAbbonamento, rowToCliente } from "../data/map-sql-to-types.js"
import { campusStore } from "../store/campus.js"
import { getScopedUser } from "../middleware/auth.js"

const DEFAULT_RANGE_FROM = "2026-03-01"
const DEFAULT_RANGE_TO = "2026-09-13"

const CAMPUS_WEEKS_2026: { from: string; to: string }[] = [
  { from: "2026-06-15", to: "2026-06-19" },
  { from: "2026-06-22", to: "2026-06-26" },
  { from: "2026-06-29", to: "2026-07-03" },
  { from: "2026-07-06", to: "2026-07-10" },
  { from: "2026-07-13", to: "2026-07-17" },
  { from: "2026-07-20", to: "2026-07-24" },
  { from: "2026-07-27", to: "2026-07-31" },
  { from: "2026-08-03", to: "2026-08-07" },
  { from: "2026-08-10", to: "2026-08-14" },
  { from: "2026-08-17", to: "2026-08-21" },
  { from: "2026-08-24", to: "2026-08-28" },
  { from: "2026-08-31", to: "2026-09-04" },
  { from: "2026-09-07", to: "2026-09-11" },
]

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

function fmtIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}`
}

function parseIsoDate(iso: string): Date | null {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function overlapsRange(aFrom: string, aTo: string, rangeFrom: string, rangeTo: string): boolean {
  const af = parseIsoDate(aFrom)
  const at = parseIsoDate(aTo)
  const rf = parseIsoDate(rangeFrom)
  const rt = parseIsoDate(rangeTo)
  if (!af || !at || !rf || !rt) return false
  return at.getTime() >= rf.getTime() && af.getTime() <= rt.getTime()
}

function weeksForAbbonamento(aFrom: string, aTo: string, weeks: { from: string; to: string }[]): string[] {
  const out: string[] = []
  for (const w of weeks) {
    if (overlapsRange(aFrom, aTo, w.from, w.to)) out.push(w.from)
  }
  return out
}

export async function getCampus(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })

    const rangeFrom = String(req.query.from ?? DEFAULT_RANGE_FROM).trim() || DEFAULT_RANGE_FROM
    const rangeTo = String(req.query.to ?? DEFAULT_RANGE_TO).trim() || DEFAULT_RANGE_TO

    const rows = await gestionaleSql.queryAbbonamenti(undefined)
    const campusAbbonamenti = rows
      .map((r) => rowToAbbonamento(r))
      .filter(isCampusAbb)
      .filter((a) => overlapsRange(a.dataInizio, a.dataFine, rangeFrom, rangeTo))

    // Anagrafica: telefono/città/email da Utenti
    const clientiRows = await gestionaleSql.queryClienti()
    const abbonamentiCount = new Map<string, number>()
    const clienti = clientiRows.map((r) => rowToCliente(r, abbonamentiCount))
    const clienteById = new Map(clienti.map((c) => [c.id, c]))

    const byCliente = new Map<
      string,
      {
        clienteId: string
        clienteNome: string
        clienteEta?: number
        cellulare?: string
        items: { abbonamentoId: string; pianoNome: string; dataInizio: string; dataFine: string; settimane: string[]; prezzo: number }[]
        totaleVenduto: number
        totalePagato: number
      }
    >()

    // Pagato: somma Importo per IDIscrizione nel range e poi aggrega per cliente.
    const pagatoRows = await gestionaleSql.queryMovimentiVendutoSumByIscrizione(rangeFrom, rangeTo)
    const pagatoByIscrizione = new Map<string, number>()
    pagatoRows.forEach((r) => {
      const id = String((r as any).IDIscrizione ?? (r as any).idIscrizione ?? "").trim()
      const tot = Number((r as any).Totale ?? (r as any).totale ?? 0) || 0
      if (id) pagatoByIscrizione.set(id, tot)
    })

    for (const a of campusAbbonamenti) {
      const weeks = weeksForAbbonamento(a.dataInizio, a.dataFine, CAMPUS_WEEKS_2026)
      const cli = clienteById.get(a.clienteId)
      const entry =
        byCliente.get(a.clienteId) ??
        {
          clienteId: a.clienteId,
          clienteNome: a.clienteNome,
          clienteEta: a.clienteEta,
          cellulare: cli?.telefono || undefined,
          items: [],
          totaleVenduto: 0,
          totalePagato: 0,
        }
      entry.items.push({
        abbonamentoId: a.id,
        pianoNome: a.pianoNome,
        dataInizio: a.dataInizio,
        dataFine: a.dataFine,
        settimane: weeks,
        prezzo: a.prezzo,
      })
      entry.totaleVenduto += a.prezzo || 0
      entry.totalePagato += pagatoByIscrizione.get(a.id) ?? 0
      byCliente.set(a.clienteId, entry)
    }

    const weeks = CAMPUS_WEEKS_2026.map((w) => ({
      key: w.from,
      from: w.from,
      to: w.to,
      label: `${fmtIt(w.from)}–${fmtIt(w.to)}`,
    }))
    const bambini = Array.from(byCliente.values()).sort((a, b) => a.clienteNome.localeCompare(b.clienteNome))

    const payload = {
      range: { from: rangeFrom, to: rangeTo },
      weeks,
      bambini: bambini.map((c) => {
        const saved = campusStore.get(c.clienteId)
        return {
          ...c,
          cognomeNome: c.clienteNome,
          eta: c.clienteEta,
          allergie: saved?.allergie ?? "",
          note: saved?.note ?? "",
          gruppo: saved?.gruppo ?? "",
          genitore: saved?.genitore ?? "",
          liv: saved?.liv ?? "",
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
    const body = (req.body ?? {}) as { gruppo?: string; genitore?: string; liv?: string; allergie?: string; note?: string }
    const updated = campusStore.upsertCliente(clienteId, {
      gruppo: body.gruppo,
      genitore: body.genitore,
      liv: body.liv,
      allergie: body.allergie,
      note: body.note,
    })
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

