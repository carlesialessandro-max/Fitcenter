import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"

function parseIsoDate(s: string): Date | null {
  const t = String(s ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getPrenotazioniCorsiRange(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.json({ rows: [], meta: { fromSql: false } })
    }
    const pool = await gestionaleSql.getPool()
    if (!pool) {
      return res.status(503).json({ message: "Database non connesso" })
    }

    const fromRaw = String(req.query.from ?? "").trim()
    const toRaw = String(req.query.to ?? "").trim()
    const from = parseIsoDate(fromRaw)
    const to = parseIsoDate(toRaw)
    if (!from || !to) return res.status(400).json({ message: "from/to obbligatori (YYYY-MM-DD)" })
    if (from > to) return res.status(400).json({ message: "Intervallo non valido (from > to)" })

    const rows: gestionaleSql.PrenotazioneCorsoRow[] = []
    const maxDays = 31
    let countDays = 0
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      countDays += 1
      if (countDays > maxDays) return res.status(400).json({ message: `Range troppo lungo (max ${maxDays} giorni)` })
      const iso = toIso(d)
      const dayRows = await gestionaleSql.queryPrenotazioniCorsi({ giorno: iso })
      rows.push(...dayRows)
    }

    res.json({ rows, meta: { fromSql: true, from: fromRaw, to: toRaw, days: countDays, count: rows.length } })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

