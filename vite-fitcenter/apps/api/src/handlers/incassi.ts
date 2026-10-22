import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { canVedereTotaliCentro, getScopedUser } from "../middleware/auth.js"

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

async function loadDeduped(from: string, to: string): Promise<Record<string, unknown>[]> {
  const allRows = await gestionaleSql.queryIncassiRange({ from, to, segment: "all" })
  return gestionaleSql.dedupeIncassiRows(allRows)
}

export async function getIncassi(req: Request, res: Response) {
  if (!canVedereTotaliCentro(getScopedUser(req))) {
    return res.status(403).json({ message: "Permessi insufficienti" })
  }
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
    res.status(500).json({ message: (e as Error).message || "Errore lettura incassi" })
  }
}

export async function getIncassiRiepilogo(req: Request, res: Response) {
  if (!canVedereTotaliCentro(getScopedUser(req))) {
    return res.status(403).json({ message: "Permessi insufficienti" })
  }
  const from = String(req.query.from ?? "").trim()
  const to = String(req.query.to ?? "").trim()
  if (!isIsoDate(from) || !isIsoDate(to)) return res.status(400).json({ message: "from/to obbligatori (YYYY-MM-DD)" })
  if (from > to) return res.status(400).json({ message: "Intervallo non valido (from > to)" })

  try {
    const agg = await gestionaleSql.queryIncassiRiepilogo({ from, to })
    res.json({ from, to, total: agg.total, count: agg.count, segments: agg.segments, order: DETAIL_SEGS })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message || "Errore lettura riepilogo incassi" })
  }
}
