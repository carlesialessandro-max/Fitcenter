import { Request, Response } from "express"
import sql from "mssql"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getScopedUser } from "../middleware/auth.js"

export async function postScuolaNuotoMoveIscrizione(req: Request, res: Response) {
  const u = getScopedUser(req)
  if (u.role !== "admin") return res.status(403).json({ message: "Permessi insufficienti" })

  const idIscrizione = Number((req.body as any)?.idIscrizione)
  const targetIdCorso = Number((req.body as any)?.targetIdCorso)
  const idUtente = (req.body as any)?.idUtente != null ? Number((req.body as any)?.idUtente) : null

  if (!Number.isFinite(idIscrizione) || idIscrizione <= 0) return res.status(400).json({ message: "idIscrizione non valido" })
  if (!Number.isFinite(targetIdCorso) || targetIdCorso <= 0) return res.status(400).json({ message: "targetIdCorso non valido" })
  if (idUtente != null && (!Number.isFinite(idUtente) || idUtente <= 0)) return res.status(400).json({ message: "idUtente non valido" })

  const p = await gestionaleSql.getPoolWrite()
  if (!p) return res.status(503).json({ message: "DB gestionale write non configurato (SQL_CONNECTION_STRING_WRITE)" })

  const r = await p
    .request()
    .input("idIscrizione", sql.Int, idIscrizione)
    .input("targetIdCorso", sql.Int, targetIdCorso)
    .input("idUtente", sql.Int, idUtente ?? null)
    .query(
      `
      UPDATE dbo.CorsiIscrizione
      SET IDCorso = @targetIdCorso,
          DataOperazione = GETDATE()
      WHERE IDIscrizione = @idIscrizione
        AND (@idUtente IS NULL OR IDUtente = @idUtente);
    `
    )

  const rowsAffected = (r.rowsAffected?.[0] ?? 0) as number
  if (!rowsAffected) return res.status(404).json({ message: "Iscrizione non trovata o non modificabile" })
  return res.json({ ok: true, rowsAffected })
}

