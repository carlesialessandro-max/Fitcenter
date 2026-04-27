import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getScopedUser } from "../middleware/auth.js"

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function segFromRaw(s: string): "all" | "adulti" | "bambini" | "danza" {
  const t = s.trim().toLowerCase()
  if (t === "adulti") return "adulti"
  if (t === "bambini") return "bambini"
  if (t === "danza") return "danza"
  return "all"
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
    const allRows = await gestionaleSql.queryIncassiRange({ from, to, segment: seg })

    const amountOf = (r: any): number => {
      const x = r?.CassaMovimentiImporto ?? r?.Importo ?? r?.Totale ?? r?.importo ?? r?.totale ?? 0
      const n = Number(x)
      return Number.isFinite(n) ? n : 0
    }

    // Richiesta: nascondi importi a zero (spesso sono righe tecniche / doppioni).
    const rows = allRows.filter((r) => amountOf(r) !== 0)
    const total = rows.reduce((s, r) => s + amountOf(r as any), 0)
    res.json({ from, to, segment: seg, count: rows.length, total, rows })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

