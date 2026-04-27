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

export async function postBloccaCorso(req: Request, res: Response) {
  const u = getScopedUser(req)
  if (u.role !== "admin" && u.role !== "corsi") return res.status(403).json({ message: "Permessi insufficienti" })

  const body = (req.body ?? {}) as any
  // In pagina Corsi, l'ID più affidabile è quello della lezione/prenotazione (IDPrenotazioneLezione).
  const idCorso = Number(body?.idCorso)
  const idPrenotazione = body?.idPrenotazione != null ? Number(body?.idPrenotazione) : null
  const giorno = String(body?.giorno ?? "").trim()
  const blocked = Boolean(body?.blocked)
  const motivo = String(body?.motivo ?? "").trim()

  if (!Number.isFinite(idCorso) || idCorso <= 0) return res.status(400).json({ message: "idCorso non valido" })
  if (idPrenotazione != null && (!Number.isFinite(idPrenotazione) || idPrenotazione <= 0)) {
    return res.status(400).json({ message: "idPrenotazione non valido" })
  }
  if (giorno && !isIsoDate(giorno)) return res.status(400).json({ message: "giorno non valido (YYYY-MM-DD)" })

  const p = await gestionaleSql.getPoolWrite()
  if (!p) return res.status(503).json({ message: "DB gestionale write non configurato (SQL_CONNECTION_STRING_WRITE)" })

  // Gestionale H2: blocco visibilità/prenotazioni della lezione su dbo.PrenotazioniLezioni.WebVisibile (o TotemVisibile).
  // Override via env se necessario.
  const rawTable = safeIdent(process.env.GESTIONALE_TABLE_PRENOTAZIONI_LEZIONI ?? "dbo.PrenotazioniLezioni") ?? "dbo.PrenotazioniLezioni"
  const q = qualifySqlObject(rawTable).query
  const colsLower = await getColsLower(rawTable)

  // Colonne possibili su PrenotazioniLezioni
  const colEnabled = pickFirstCol(colsLower, ["WebVisibile", "TotemVisibile"])
  if (!colEnabled) {
    return res.status(503).json({
      message: "Impossibile determinare colonna visibilità su PrenotazioniLezioni (attese: WebVisibile/TotemVisibile).",
    })
  }

  // Proviamo anche una colonna note/motivo se esiste (opzionale).
  const colMotivo = pickFirstCol(colsLower, ["Note"])
  const colDataOp = pickFirstCol(colsLower, ["DataOperazione", "DataModifica", "UpdatedAt", "DataAggiornamento"])

  // NB: IDCorso qui è IDPrenotazioneLezione (lezione specifica).
  try {
    const colId = pickFirstCol(colsLower, ["IDPrenotazioneLezione", "IdPrenotazioneLezione"])
    if (!colId) return res.status(503).json({ message: "Colonna IDPrenotazioneLezione non trovata" })

    // Nel gestionale H2 spesso i flag sono smallint con -1 = true, 0 = false.
    // Per non indovinare, leggiamo il valore attuale e riusiamo il "true" coerente quando sblocchiamo.
    let currentEnabled: number | null = null
    try {
      const rr = await p
        .request()
        .input("idCorso", sql.Int, idCorso)
        .query(`SELECT TOP (1) CAST([${colEnabled}] AS int) AS v FROM ${q} WHERE [${colId}] = @idCorso;`)
      const v = (rr.recordset?.[0] as any)?.v
      const n = Number(v)
      currentEnabled = Number.isFinite(n) ? n : null
    } catch {
      currentEnabled = null
    }

    const enabledValue = blocked ? 0 : currentEnabled != null && currentEnabled !== 0 ? currentEnabled : -1
    const setParts: string[] = [`[${colEnabled}] = @enabled`]
    if (colMotivo && motivo) setParts.push(`[${colMotivo}] = @motivo`)
    if (colDataOp) setParts.push(`[${colDataOp}] = GETDATE()`)

    let rreq = p.request().input("idCorso", sql.Int, idCorso).input("enabled", sql.Int, enabledValue)
    if (colMotivo && motivo) rreq = rreq.input("motivo", sql.NVarChar(500), motivo)
    const r = await rreq.query(`UPDATE ${q} SET ${setParts.join(", ")} WHERE [${colId}] = @idCorso;`)
    const affected = Array.isArray((r as any)?.rowsAffected) ? Number((r as any).rowsAffected?.[0] ?? 0) : 0
    if (!affected) return res.status(404).json({ message: "Corso non trovato o non modificabile" })

    // Opzionale: aggiorna anche la "prenotazione madre" (dbo.Prenotazioni) se ci viene passato l'ID.
    // In alcuni gestionali la visibilità web dipende sia dalla lezione che dalla prenotazione.
    let affectedPren = 0
    if (idPrenotazione != null) {
      const rawPrenTable = safeIdent(process.env.GESTIONALE_TABLE_PRENOTAZIONI ?? "dbo.Prenotazioni") ?? "dbo.Prenotazioni"
      const pq = qualifySqlObject(rawPrenTable).query
      const prenCols = await getColsLower(rawPrenTable)
      const prenIdCol = pickFirstCol(prenCols, ["IDPrenotazione", "IdPrenotazione"])
      const prenEnabledCol = pickFirstCol(prenCols, ["WebVisibile", "TotemVisibile", "Attivo"])
      if (prenIdCol && prenEnabledCol) {
        const rr = await p
          .request()
          .input("idPren", sql.Int, idPrenotazione)
          .input("enabled", sql.Int, enabledValue)
          .query(`UPDATE ${pq} SET [${prenEnabledCol}] = @enabled WHERE [${prenIdCol}] = @idPren;`)
        affectedPren = Array.isArray((rr as any)?.rowsAffected) ? Number((rr as any).rowsAffected?.[0] ?? 0) : 0
      }
    }

    return res.json({
      ok: true,
      rowsAffected: affected,
      table: rawTable,
      colEnabled,
      enabledValue,
      giorno: giorno || null,
      ...(idPrenotazione != null ? { rowsAffectedPrenotazione: affectedPren } : {}),
    })
  } catch (e) {
    return res.status(500).json({ message: (e as Error).message })
  }
}

