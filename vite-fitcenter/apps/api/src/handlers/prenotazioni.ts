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
    const pool = await gestionaleSql.getPool()
    const giorno = parseGiorno(req)
    if (giorno === "__INVALID__") {
      return res.status(400).json({ message: "Parametro giorno non valido (YYYY-MM-DD)" })
    }
    if (!pool) {
      return res.json({
        rows: [],
        meta: {
          fromSql: true,
          connected: false,
          giorno: giorno ?? null,
          sqlError: gestionaleSql.getLastConnectionError(),
        },
      })
    }
    const rows = await gestionaleSql.queryPrenotazioniCorsi({ giorno })
    const dbg = await gestionaleSql.debugPrenotazioniViewInfo()
    const sql = await gestionaleSql.getSqlIdentity()
    const cs = gestionaleSql.getSqlConnectionInfo()
    const dayCount =
      giorno && dbg.dateCol
        ? await gestionaleSql.debugPrenotazioniCountForDay({
            view: dbg.view,
            dateCol: dbg.dateCol,
            giornoIso: giorno,
          })
        : null
    const dayCountExpr =
      giorno && dbg.dateCol
        ? await gestionaleSql.debugPrenotazioniCountForDayExpr({
            view: dbg.view,
            dateCol: dbg.dateCol,
            giornoIso: giorno,
          })
        : null
    const lastErr = gestionaleSql.getLastConnectionError()
    res.json({
      rows,
      meta: {
        fromSql: true,
        connected: true,
        giorno: giorno ?? null,
        view: dbg.view,
        dateCol: dbg.dateCol,
        cols: dbg.cols,
        count: rows.length,
        dayCount,
        dayCountExpr,
        sql,
        cs,
        // Se sql identity non è disponibile, esponi eventuale errore precedente.
        ...(sql.server == null && sql.database == null && lastErr ? { sqlError: lastErr } : {}),
      },
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

