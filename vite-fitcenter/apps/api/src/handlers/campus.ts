import type { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { rowToAbbonamento, rowToCliente } from "../data/map-sql-to-types.js"
import { campusStore } from "../store/campus.js"
import { getScopedUser } from "../middleware/auth.js"
import XLSX from "xlsx"

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

const EXCEL_WEEK_HEADERS: Record<string, string> = {
  "2026-06-15": "15 - 19 GIUGNO",
  "2026-06-22": "22 - 26 GIUGNO",
  "2026-06-29": "29  GIUGNO - 03 LUGLIO",
  "2026-07-06": " 06 - 10 LUGLIO",
  "2026-07-13": "13 - 17 LUGLIO",
  "2026-07-20": "20 - 24 LUGLIO",
  "2026-07-27": "27   - 31 LUGLIO",
  "2026-08-03": "03 - 07 AGOSTO",
  "2026-08-10": "10 - 14 AGOSTO",
  "2026-08-17": "17 - 21 AGOSTO",
  "2026-08-24": "24 - 28 AGOSTO",
  "2026-08-31": "31 AGOSTO - 04 SETTEMBRE",
  "2026-09-07": "07 - 11 SETTEMBRE",
}

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

function pickFirstNonEmpty(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = (row as any)[k]
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return ""
}

export async function getCampus(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })

    const rangeFrom = String(req.query.from ?? DEFAULT_RANGE_FROM).trim() || DEFAULT_RANGE_FROM
    const rangeTo = String(req.query.to ?? DEFAULT_RANGE_TO).trim() || DEFAULT_RANGE_TO

    const rows = await gestionaleSql.queryAbbonamenti(undefined)
    // Da RVW_AbbonamentiUtenti: genitore = PaganteNome, telefono = SMS
    const paganteByClienteId = new Map<string, string>()
    const smsByClienteId = new Map<string, string>()

    const campusAbbonamenti = rows
      .map((r) => {
        const clienteId = String((r as any).IDUtente ?? (r as any).IdUtente ?? (r as any).idUtente ?? (r as any).ClienteId ?? "").trim()
        const paganteNome = pickFirstNonEmpty(r, ["PaganteNome", "Pagante", "Pagante_Nome"])
        const sms = pickFirstNonEmpty(r, ["SMS", "Sms", "sms", "Cellulare", "cellulare", "Telefono", "telefono", "Telefono_1", "Telefono1"])
        if (clienteId) {
          if (paganteNome && !paganteByClienteId.has(clienteId)) paganteByClienteId.set(clienteId, paganteNome)
          if (sms && !smsByClienteId.has(clienteId)) smsByClienteId.set(clienteId, sms)
        }
        return rowToAbbonamento(r)
      })
      .filter(isCampusAbb)
      .filter((a) => overlapsRange(a.dataInizio, a.dataFine, rangeFrom, rangeTo))

    const byCliente = new Map<
      string,
      {
        clienteId: string
        clienteNome: string
        clienteEta?: number
        cellulare?: string
        genitoreSql?: string
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
      const entry =
        byCliente.get(a.clienteId) ??
        {
          clienteId: a.clienteId,
          clienteNome: a.clienteNome,
          clienteEta: a.clienteEta,
          cellulare: smsByClienteId.get(a.clienteId) || undefined,
          genitoreSql: paganteByClienteId.get(a.clienteId) || undefined,
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
          genitore: saved?.genitore ?? c.genitoreSql ?? "",
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
    const body = (req.body ?? {}) as { note?: string; gruppo?: string }
    const updated = campusStore.upsertWeek(clienteId, weekKey, { note: body.note, gruppo: body.gruppo })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

function normNameKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function pickRowVal(row: Record<string, unknown>, key: string): string {
  const v = (row as any)[key]
  if (v == null) return ""
  return String(v).trim()
}

export async function importCampusPlanningExcel(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })
    const file = (req as any).file as { buffer?: Buffer } | undefined
    const buf = file?.buffer
    if (!buf || buf.length === 0) return res.status(400).json({ message: "File mancante" })

    // Costruisco mappa nome->clienteId dagli attuali campus in range.
    const rows = await gestionaleSql.queryAbbonamenti(undefined)
    const rangeFrom = DEFAULT_RANGE_FROM
    const rangeTo = DEFAULT_RANGE_TO
    const campusAbbonamenti = rows
      .map((r) => rowToAbbonamento(r))
      .filter(isCampusAbb)
      .filter((a) => overlapsRange(a.dataInizio, a.dataFine, rangeFrom, rangeTo))
    const nameToClienteId = new Map<string, string>()
    campusAbbonamenti.forEach((a) => {
      const k = normNameKey(a.clienteNome)
      if (k && !nameToClienteId.has(k)) nameToClienteId.set(k, a.clienteId)
    })

    const wb = XLSX.read(buf, { type: "buffer" })
    const sheetName = wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as Record<string, unknown>[]
    if (json.length === 0) return res.status(400).json({ message: "Foglio vuoto" })

    // Trovo la riga header che contiene 'gruppo' (sotto le settimane) per mappare weekHeader -> groupCol.
    const headerRow = json.find((r) => Object.values(r).some((v) => String(v).toLowerCase().includes("gruppo")))
    const keys = Object.keys(json[0] ?? {})
    const groupColByWeekStart = new Map<string, string>()
    if (headerRow) {
      for (const [weekStart, headerLabel] of Object.entries(EXCEL_WEEK_HEADERS)) {
        const idx = keys.indexOf(headerLabel)
        if (idx > 0) {
          const prevKey = keys[idx - 1]
          const prevVal = String((headerRow as any)[prevKey] ?? "").trim().toLowerCase()
          if (prevVal === "gruppo") groupColByWeekStart.set(weekStart, prevKey)
        }
      }
    }

    let updated = 0
    let skipped = 0

    for (const r of json) {
      const nome = pickRowVal(r, "COGNOME E NOME")
      const liv = pickRowVal(r, "LIV")
      const allergie = pickRowVal(r, "ALLERGIE")
      const genitore = pickRowVal(r, "GENITORE")
      const note = pickRowVal(r, "note")

      // Salta righe intestazione/vuote.
      const idxRaw = String((r as any).__EMPTY ?? "").trim()
      const idxNum = Number(idxRaw)
      if (!nome || !Number.isFinite(idxNum) || idxNum <= 0) continue

      const clienteId = nameToClienteId.get(normNameKey(nome))
      if (!clienteId) {
        skipped += 1
        continue
      }

      // Gruppo globale: primo gruppo trovato nelle settimane.
      let gruppoGlobal = ""
      for (const [weekStart, colKey] of groupColByWeekStart.entries()) {
        const v = pickRowVal(r, colKey)
        if (v) {
          gruppoGlobal = v
          // Salvo gruppo anche per la settimana specifica.
          campusStore.upsertWeek(clienteId, weekStart, { gruppo: v })
        }
      }

      campusStore.upsertCliente(clienteId, {
        liv: liv || undefined,
        allergie: allergie || undefined,
        genitore: genitore || undefined,
        note: note || undefined,
        gruppo: gruppoGlobal || undefined,
      })
      updated += 1
    }

    res.json({ ok: true, updated, skipped })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

