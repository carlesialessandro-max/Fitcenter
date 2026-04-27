import type { Request, Response } from "express"
import sql from "mssql"
import { getScopedUser } from "../middleware/auth.js"
import * as gestionaleSql from "../services/gestionale-sql.js"

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function safeIdent(s: string): string | null {
  const t = String(s ?? "").trim()
  if (!t) return null
  // allow dbo.Table, [dbo].[Table], Table
  if (!/^[A-Za-z0-9_.\[\]]+$/.test(t)) return null
  return t
}

function qualifySqlObject(name: string): { query: string; objectId: string } {
  const raw = String(name ?? "").trim()
  const cleaned = raw.replace(/[\[\]]/g, "")
  if (cleaned.includes(".")) {
    const q = raw.includes("[") ? raw : raw.split(".").map((p) => `[${p}]`).join(".")
    return { query: q, objectId: cleaned }
  }
  const safe = cleaned
  return { query: `[dbo].[${safe}]`, objectId: `dbo.${safe}` }
}

async function getColsLower(objName: string): Promise<Set<string>> {
  const p = await gestionaleSql.getPoolWrite()
  if (!p) return new Set()
  try {
    const clean = qualifySqlObject(objName).objectId
    const r = await p.request().input("obj", sql.NVarChar, clean).query(
      `SELECT LOWER(c.name) AS name
       FROM sys.columns c
       WHERE c.object_id = OBJECT_ID(@obj);`
    )
    const cols = new Set<string>(((r.recordset ?? []) as any[]).map((x) => String(x.name ?? "")).filter(Boolean))
    return cols
  } catch {
    return new Set()
  }
}

function pickFirstCol(colsLower: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (colsLower.has(c.toLowerCase())) return c
  }
  return null
}

/**
 * Blocca/sblocca un corso sul gestionale.
 *
 * NOTE: non sappiamo a priori la colonna corretta del gestionale per "prenotabile".
 * Usiamo un best-effort su dbo.Corsi (o env) e proviamo colonne tipiche.
 */
export async function postBloccaCorso(req: Request, res: Response) {
  const u = getScopedUser(req)
  if (u.role !== "admin" && u.role !== "corsi") return res.status(403).json({ message: "Permessi insufficienti" })

  const body = (req.body ?? {}) as any
  const idCorso = Number(body?.idCorso)
  const giorno = String(body?.giorno ?? "").trim()
  const blocked = Boolean(body?.blocked)
  const motivo = String(body?.motivo ?? "").trim()

  if (!Number.isFinite(idCorso) || idCorso <= 0) return res.status(400).json({ message: "idCorso non valido" })
  if (giorno && !isIsoDate(giorno)) return res.status(400).json({ message: "giorno non valido (YYYY-MM-DD)" })

  const p = await gestionaleSql.getPoolWrite()
  if (!p) return res.status(503).json({ message: "DB gestionale write non configurato (SQL_CONNECTION_STRING_WRITE)" })

  const rawTable = safeIdent(process.env.GESTIONALE_TABLE_CORSI ?? "dbo.Corsi") ?? "dbo.Corsi"
  const q = qualifySqlObject(rawTable).query
  const colsLower = await getColsLower(rawTable)

  // Colonne possibili: abilitazione web/prenotazioni
  const colEnabled = pickFirstCol(colsLower, [
    "AbilitaWEB",
    "AbilitatoWEB",
    "AbilitatoWeb",
    "PrenotabileWeb",
    "Prenotabile",
    "Attivo",
    "Abilitato",
    "IsActive",
    "Bloccato",
  ])
  if (!colEnabled) {
    return res.status(503).json({
      message:
        "Impossibile determinare colonna blocco corso su dbo.Corsi. Imposta una colonna (es. AbilitaWEB/Attivo) o configura il gestionale.",
    })
  }

  // Proviamo anche una colonna note/motivo se esiste (opzionale).
  const colMotivo = pickFirstCol(colsLower, ["Note", "Motivo", "NoteWeb", "NotePrenotazioni", "NotePrenotazione"])
  const colDataOp = pickFirstCol(colsLower, ["DataOperazione", "DataModifica", "UpdatedAt", "DataAggiornamento"])

  const enabledValue = blocked ? 0 : 1
  const setParts: string[] = [`[${colEnabled}] = @enabled`]
  if (colMotivo && motivo) setParts.push(`[${colMotivo}] = @motivo`)
  if (colDataOp) setParts.push(`[${colDataOp}] = GETDATE()`)

  // NB: non sappiamo se il blocco è per giorno o globale sul corso; per ora è globale (su IDCorso).
  // Se in futuro si scopre che è per singola data, aggiungiamo tabella/config dedicata.
  try {
    let rreq = p.request().input("idCorso", sql.Int, idCorso).input("enabled", sql.Int, enabledValue)
    if (colMotivo && motivo) rreq = rreq.input("motivo", sql.NVarChar(500), motivo)
    const r = await rreq.query(`UPDATE ${q} SET ${setParts.join(", ")} WHERE [IDCorso] = @idCorso;`)
    const affected = Array.isArray((r as any)?.rowsAffected) ? Number((r as any).rowsAffected?.[0] ?? 0) : 0
    if (!affected) return res.status(404).json({ message: "Corso non trovato o non modificabile" })
    return res.json({ ok: true, rowsAffected: affected, table: rawTable, colEnabled, enabledValue, giorno: giorno || null })
  } catch (e) {
    return res.status(500).json({ message: (e as Error).message })
  }
}

