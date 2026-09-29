import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getScopedUser } from "../middleware/auth.js"

type IncassiSeg = "all" | "adulti" | "bambini" | "danza" | "ticket" | "altro"
const DETAIL_SEGS: Exclude<IncassiSeg, "all">[] = ["adulti", "bambini", "danza", "ticket", "altro"]

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function segFromRaw(s: string): IncassiSeg {
  const t = s.trim().toLowerCase()
  if (t === "adulti") return "adulti"
  if (t === "bambini") return "bambini"
  if (t === "danza") return "danza"
  if (t === "ticket" || t === "ticketing" || t === "tickets") return "ticket"
  if (t === "altro") return "altro"
  return "all"
}

function parseMoney(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const s0 = String(v).trim()
  if (!s0) return 0
  const s1 = s0
    .replace(/[€\s]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")
  const n = Number(s1)
  return Number.isFinite(n) ? n : 0
}

function amountOf(r: any): number {
  const x = r?.CassaMovimentiImporto ?? r?.Importo ?? r?.Totale ?? r?.importo ?? r?.totale ?? 0
  return parseMoney(x)
}

function rowId(r: any): string | null {
  const candidates = [
    "IdCassaMovimento",
    "IDCassaMovimento",
    "idCassaMovimento",
    "CassaMovimentiID",
    "CassaMovimentiId",
    "IDCassaMovimenti",
    "IdCassaMovimenti",
    "IDMovimento",
    "IdMovimento",
    "MovimentoID",
    "MovimentoId",
    "ID",
    "Id",
  ]
  for (const k of candidates) {
    const v = r?.[k]
    const s = String(v ?? "").trim()
    if (s && s !== "0" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") return `${k}:${s}`
  }
  return null
}

function rowKeyFallback(r: any): string {
  const dtRaw = String(r?.CassaMovimentiDataOperazione ?? r?.CassaMovimentiData ?? r?.DataOperazione ?? r?.Data ?? "").trim()
  const dtSec = (() => {
    if (!dtRaw) return ""
    const iso = dtRaw.replace(" ", "T")
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso)
    if (m) return `${m[1]}T${m[2]}`
    return dtRaw.replace(/\.\d+Z?$/i, "").replace(/\.\d+$/i, "")
  })()
  const imp = amountOf(r).toFixed(2)
  const cognome = String(r?.Cognome ?? r?.cognome ?? "").trim().toLowerCase()
  const nome = String(r?.Nome ?? r?.nome ?? "").trim().toLowerCase()
  const caus = String(r?.CassaMovimentiCausale ?? r?.Causale ?? "").trim().toLowerCase()
  return [dtSec, imp, cognome, nome, caus].join("|")
}

function hasCategoria(r: any): boolean {
  const s = String(r?.CategoriaDescrizione ?? "").trim()
  return Boolean(s) && s !== "—"
}

function dedupeIncassi(allRows: Record<string, unknown>[]): Record<string, unknown>[] {
  const nonZero = allRows.filter((r) => amountOf(r) !== 0)
  const bestByKey = new Map<string, any>()
  for (const r of nonZero) {
    const k = rowId(r) ?? rowKeyFallback(r)
    const prev = bestByKey.get(k)
    if (!prev) {
      bestByKey.set(k, r)
      continue
    }
    const prevHas = hasCategoria(prev)
    const curHas = hasCategoria(r)
    if (!prevHas && curHas) {
      bestByKey.set(k, r)
      continue
    }
    if (prevHas === curHas) {
      const score = (x: any) => {
        const fields = [
          x?.NomeVenditore,
          x?.VenditoreNome,
          x?.Venditore,
          x?.Operatore,
          x?.Cognome,
          x?.Nome,
          x?.CassaMovimentiCausale,
        ]
        return fields.reduce((s: number, v: any) => s + (String(v ?? "").trim() ? 1 : 0), 0)
      }
      if (score(r) > score(prev)) bestByKey.set(k, r)
    }
  }
  return Array.from(bestByKey.values())
}

function emptySegTotals(): Record<Exclude<IncassiSeg, "all">, { total: number; count: number }> {
  return {
    adulti: { total: 0, count: 0 },
    bambini: { total: 0, count: 0 },
    danza: { total: 0, count: 0 },
    ticket: { total: 0, count: 0 },
    altro: { total: 0, count: 0 },
  }
}

async function loadDeduped(from: string, to: string): Promise<Record<string, unknown>[]> {
  const allRows = await gestionaleSql.queryIncassiRange({ from, to, segment: "all" })
  return dedupeIncassi(allRows)
}

function summarize(rows: Record<string, unknown>[]) {
  const segments = emptySegTotals()
  for (const r of rows) {
    const seg = gestionaleSql.classifyIncassiSegment(r)
    const euro = amountOf(r)
    segments[seg].total += euro
    segments[seg].count += 1
  }
  const total = rows.reduce((s, r) => s + amountOf(r), 0)
  return { total, count: rows.length, segments }
}

export async function getIncassi(req: Request, res: Response) {
  const u = getScopedUser(req)
  if (u.role !== "admin") return res.status(403).json({ message: "Permessi insufficienti" })

  const from = String(req.query.from ?? "").trim()
  const to = String(req.query.to ?? "").trim()
  if (!isIsoDate(from) || !isIsoDate(to)) return res.status(400).json({ message: "from/to obbligatori (YYYY-MM-DD)" })
  if (from > to) return res.status(400).json({ message: "Intervallo non valido (from > to)" })

  const seg = segFromRaw(String(req.query.segment ?? "all"))
  try {
    const rowsAll = await loadDeduped(from, to)
    const rows = seg === "all" ? rowsAll : rowsAll.filter((r) => gestionaleSql.classifyIncassiSegment(r) === seg)
    const total = rows.reduce((s, r) => s + amountOf(r as any), 0)
    res.json({ from, to, segment: seg, count: rows.length, total, rows })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getIncassiRiepilogo(req: Request, res: Response) {
  const u = getScopedUser(req)
  if (u.role !== "admin") return res.status(403).json({ message: "Permessi insufficienti" })

  const from = String(req.query.from ?? "").trim()
  const to = String(req.query.to ?? "").trim()
  if (!isIsoDate(from) || !isIsoDate(to)) return res.status(400).json({ message: "from/to obbligatori (YYYY-MM-DD)" })
  if (from > to) return res.status(400).json({ message: "Intervallo non valido (from > to)" })

  try {
    const rows = await loadDeduped(from, to)
    const { total, count, segments } = summarize(rows)
    res.json({ from, to, total, count, segments, order: DETAIL_SEGS })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
