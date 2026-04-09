import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"

function parseGiorno(req: Request): string | undefined {
  const raw = String(req.query.giorno ?? "").trim()
  if (!raw) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "__INVALID__"
}

export async function getPrenotazioniCorsi(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.json({ rows: [], meta: { fromSql: false } })
    }
    const giorno = parseGiorno(req)
    if (giorno === "__INVALID__") {
      return res.status(400).json({ message: "Parametro giorno non valido (YYYY-MM-DD)" })
    }
    const rows = await gestionaleSql.queryPrenotazioniCorsi({ giorno })
    const view = await gestionaleSql.getPrenotazioniViewNameResolved()
    res.json({
      rows,
      meta: {
        fromSql: true,
        giorno: giorno ?? null,
        view,
      },
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

