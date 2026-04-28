import type { Request, Response } from "express"
import sql from "mssql"
import { getScopedUser } from "../middleware/auth.js"
import * as gestionaleSql from "../services/gestionale-sql.js"

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function normHHmm(s: string): string | null {
  const t = String(s ?? "").trim()
  if (!t) return null
  const m = /^(\d{1,2})[:\.](\d{2})/.exec(t)
  if (!m) return null
  const hh = String(Number(m[1])).padStart(2, "0")
  const mm = String(m[2]).padStart(2, "0")
  return /^\d{2}:\d{2}$/.test(`${hh}:${mm}`) ? `${hh}:${mm}` : null
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

type ColMeta = { name: string; isIdentity: boolean; isComputed: boolean }
async function getColsMeta(objName: string): Promise<ColMeta[]> {
  const p = await gestionaleSql.getPoolWrite()
  if (!p) return []
  try {
    const clean = qualifySqlObject(objName).objectId
    const r = await p.request().input("obj", sql.NVarChar, clean).query(
      `SELECT
         c.name AS name,
         CAST(COLUMNPROPERTY(c.object_id, c.name, 'IsIdentity') AS int) AS isIdentity,
         CAST(c.is_computed AS int) AS isComputed
       FROM sys.columns c
       WHERE c.object_id = OBJECT_ID(@obj)
       ORDER BY c.column_id ASC;`
    )
    return ((r.recordset ?? []) as any[]).map((x) => ({
      name: String(x?.name ?? "").trim(),
      isIdentity: Number(x?.isIdentity ?? 0) === 1,
      isComputed: Number(x?.isComputed ?? 0) === 1,
    })).filter((x) => !!x.name)
  } catch {
    return []
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
  const idPrenotazioneRaw = body?.idPrenotazione != null ? Number(body?.idPrenotazione) : null
  const giorno = String(body?.giorno ?? "").trim()
  const blocked = Boolean(body?.blocked)
  const motivo = String(body?.motivo ?? "").trim()
  const oraInizioRaw = String(body?.oraInizio ?? "").trim()
  const oraFineRaw = String(body?.oraFine ?? "").trim()

  if (!Number.isFinite(idCorso) || idCorso <= 0) return res.status(400).json({ message: "idCorso non valido" })
  if (idPrenotazioneRaw != null && (!Number.isFinite(idPrenotazioneRaw) || idPrenotazioneRaw <= 0)) {
    return res.status(400).json({ message: "idPrenotazione non valido" })
  }
  if (giorno && !isIsoDate(giorno)) return res.status(400).json({ message: "giorno non valido (YYYY-MM-DD)" })

  const p = await gestionaleSql.getPoolWrite()
  if (!p) return res.status(503).json({ message: "DB gestionale write non configurato (SQL_CONNECTION_STRING_WRITE)" })

  // Caso speciale richiesto: blocco SOLO per una data/ora (non tutta la ricorrenza).
  // Sul gestionale questo è rappresentato da righe in dbo.PrenotazioniIscrizione con IDUtente = NULL (blocco temporaneo).
  if (giorno) {
    // Orari: se non arrivano dal client, li ricaviamo da dbo.PrenotazioniLezioni (OraInizio/OraFine).
    let oraInizio = normHHmm(oraInizioRaw)
    let oraFine = normHHmm(oraFineRaw)

    // Se non ci arriva IDPrenotazione dalla view, lo ricaviamo da PrenotazioniLezioni.
    let idPrenotazione: number | null = idPrenotazioneRaw
    if (idPrenotazione == null || oraInizio == null || oraFine == null) {
      try {
        const rawPl = safeIdent(process.env.GESTIONALE_TABLE_PRENOTAZIONI_LEZIONI ?? "dbo.PrenotazioniLezioni") ?? "dbo.PrenotazioniLezioni"
        const plQ = qualifySqlObject(rawPl).query
        const plCols = await getColsLower(rawPl)
        const colPlId = pickFirstCol(plCols, ["IDPrenotazioneLezione", "IdPrenotazioneLezione"])
        const colPlPren = pickFirstCol(plCols, ["IDPrenotazione", "IdPrenotazione"])
        const colPlOraInizio = pickFirstCol(plCols, ["OraInizio", "OraIn"])
        const colPlOraFine = pickFirstCol(plCols, ["OraFine", "OraFin"])
        if (colPlId && colPlPren) {
          const rr = await p
            .request()
            .input("idLez", sql.Int, idCorso)
            .query(
              `SELECT TOP (1)
                 CAST([${colPlPren}] AS int) AS idPren
                 ${colPlOraInizio ? `, LEFT(CONVERT(varchar(8), [${colPlOraInizio}], 108), 5) AS oi` : ""}
                 ${colPlOraFine ? `, LEFT(CONVERT(varchar(8), [${colPlOraFine}], 108), 5) AS of` : ""}
               FROM ${plQ}
               WHERE [${colPlId}] = @idLez;`
            )
          const row = (rr.recordset?.[0] as any) ?? {}
          if (idPrenotazione == null) {
            const n = Number(row?.idPren)
            idPrenotazione = Number.isFinite(n) && n > 0 ? n : null
          }
          if (oraInizio == null) oraInizio = normHHmm(row?.oi)
          if (oraFine == null) oraFine = normHHmm(row?.of)
        }
      } catch {
        idPrenotazione = null
      }
    }

    if (idPrenotazione == null) {
      return res.status(400).json({ message: "Impossibile determinare IDPrenotazione per la lezione selezionata" })
    }
    if (oraInizio == null || oraFine == null) {
      return res.status(400).json({ message: "Impossibile determinare oraInizio/oraFine per la lezione selezionata" })
    }

    const rawPi = safeIdent(process.env.GESTIONALE_TABLE_PRENOTAZIONI_ISCRIZIONE ?? "dbo.PrenotazioniIscrizione") ?? "dbo.PrenotazioniIscrizione"
    const piQ = qualifySqlObject(rawPi).query
    let piCols = await getColsLower(rawPi)
    // Alcune configurazioni SQL limitano la visibilità metadati (sys.columns) anche con permessi di scrittura.
    // Se non riusciamo a leggere le colonne, proviamo un fallback con nomi "standard" del gestionale.
    if (piCols.size === 0) {
      piCols = new Set<string>([
        "idprenotazioneiscrizione",
        "idprenotazione",
        "idprenotazionelezione",
        "idutente",
        "datainizio",
        "datafine",
        "dataoperazione",
        "note",
        "importo",
        "canale",
        "idoperatore",
      ])
    }
    const colIdPren = pickFirstCol(piCols, ["IDPrenotazione", "IdPrenotazione"])
    const colIdLez = pickFirstCol(piCols, ["IDPrenotazioneLezione", "IdPrenotazioneLezione"])
    const colIdUtente = pickFirstCol(piCols, ["IDUtente", "IdUtente"])
    const colDataInizio = pickFirstCol(piCols, ["DataInizio", "Datainizio", "DataOraInizio", "DataOra", "Inizio", "OraInizio"])
    const colDataFine = pickFirstCol(piCols, ["DataFine", "Datafine", "DataOraFine", "Fine", "OraFine"])
    const colDataOp = pickFirstCol(piCols, ["DataOperazione", "DataOperazionePrenotazioneIscrizione", "DataModifica", "UpdatedAt"])
    const colNote = pickFirstCol(piCols, ["Note", "Nota", "Descrizione", "Motivo"])
    const colImporto = pickFirstCol(piCols, ["Importo", "Costo", "Prezzo", "Totale", "ImportoWEB", "ImportoTotem"])
    const colCanale = pickFirstCol(piCols, ["Canale", "Origine", "Fonte", "Tipo"])
    const colOperatore = pickFirstCol(piCols, ["IDOperatore", "IdOperatore", "OperatoreId"])

    // Non richiediamo un ID identity (IDPrenotazioneIscrizione): non serve per INSERT/DELETE e può avere nomi diversi.
    if (!colIdPren || !colIdLez || !colDataInizio || !colDataFine) {
      return res.status(503).json({
        message: "Tabella PrenotazioniIscrizione non compatibile (colonne obbligatorie mancanti)",
        debug: {
          table: rawPi,
          missing: {
            idPrenotazione: !colIdPren,
            idPrenotazioneLezione: !colIdLez,
            dataInizio: !colDataInizio,
            dataFine: !colDataFine,
          },
          hint:
            "Se 'cols' è vuoto, al DB user serve VIEW DEFINITION sulla tabella/schema oppure permessi metadata; in alternativa imposta GESTIONALE_TABLE_PRENOTAZIONI_ISCRIZIONE e rinomina colonne candidate nel codice.",
          cols: Array.from(piCols).slice(0, 120),
        },
      })
    }

    const dtStart = `${giorno}T${oraInizio}:00`
    const dtEnd = `${giorno}T${oraFine}:00`

    // Individua righe blocco esistenti: stesso corso+prenotazione+intervallo e IDUtente NULL.
    const whereParts = [
      `[${colIdLez}] = @idLez`,
      `[${colIdPren}] = @idPren`,
      `[${colDataInizio}] = @dtStart`,
      `[${colDataFine}] = @dtEnd`,
    ]
    if (colIdUtente) whereParts.push(`[${colIdUtente}] IS NULL`)

    if (blocked) {
      // Inserisce blocco se non esiste già.
      //
      // IMPORTANTISSIMO: su molte installazioni il gestionale inserisce un blocco "clonando" una riga reale
      // (stessi campi della prenotazione) e poi sovrascrive solo alcuni campi (IDUtente=NULL, Importo=0, Note, ecc).
      // Questo evita record "incompleti" che non vengono letti correttamente dal gestionale.
      //
      // Strategia:
      // - se troviamo una riga "base" (stessa lezione+prenotazione+orari, con IDUtente NOT NULL) facciamo
      //   INSERT ... SELECT copiando tutte le colonne non identity/non computed, sovrascrivendo i campi noti.
      // - se non troviamo base row, fallback al vecchio INSERT "minimo".

      const meta = await getColsMeta(rawPi)
      const insertable = meta.filter((c) => !c.isIdentity && !c.isComputed).map((c) => c.name)
      const canClone = insertable.length > 0

      const colList = (name: string) => `[${name.replace(/]/g, "]]")}]`

      const overrides = new Map<string, string>()
      overrides.set(colIdLez, "@idLez")
      overrides.set(colIdPren, "@idPren")
      overrides.set(colDataInizio, "@dtStart")
      overrides.set(colDataFine, "@dtEnd")
      if (colIdUtente) overrides.set(colIdUtente, "NULL")
      if (colImporto) overrides.set(colImporto, "0")
      if (colNote) overrides.set(colNote, "@note")
      if (colCanale) overrides.set(colCanale, "NULL")
      if (colOperatore) overrides.set(colOperatore, "5")
      if (colDataOp) overrides.set(colDataOp, "GETDATE()")

      const baseWhere = [...whereParts]
      // Base row: non deve essere già un blocco (IDUtente NOT NULL), se la colonna esiste.
      if (colIdUtente) baseWhere.push(`[${colIdUtente}] IS NOT NULL`)

      const cloneInsertSql = (() => {
        if (!canClone) return null
        const cols = insertable.map(colList).join(", ")
        const selectExprs = insertable
          .map((c) => {
            const ov = overrides.get(c)
            return ov ? `${ov} AS ${colList(c)}` : `B.${colList(c)}`
          })
          .join(", ")
        return `
          IF NOT EXISTS (SELECT 1 FROM ${piQ} WHERE ${whereParts.join(" AND ")})
          BEGIN
            IF EXISTS (SELECT 1 FROM ${piQ} B WHERE ${baseWhere.join(" AND ")})
            BEGIN
              INSERT INTO ${piQ} (${cols})
              SELECT TOP (1) ${selectExprs}
              FROM ${piQ} B
              WHERE ${baseWhere.join(" AND ")}
              ORDER BY ${colList(colIdPren)} DESC;
            END
            ELSE
            BEGIN
              -- fallback: insert minimo (senza clone)
              INSERT INTO ${piQ} (${[colIdLez, colIdPren, colDataInizio, colDataFine]
                .filter(Boolean)
                .map(colList)
                .join(", ")}${colIdUtente ? `, ${colList(colIdUtente)}` : ""}${colImporto ? `, ${colList(colImporto)}` : ""}${colNote ? `, ${colList(colNote)}` : ""}${colCanale ? `, ${colList(colCanale)}` : ""}${colOperatore ? `, ${colList(colOperatore)}` : ""}${colDataOp ? `, ${colList(colDataOp)}` : ""})
              VALUES (@idLez, @idPren, @dtStart, @dtEnd${colIdUtente ? ", NULL" : ""}${colImporto ? ", 0" : ""}${colNote ? ", @note" : ""}${colCanale ? ", NULL" : ""}${colOperatore ? ", 5" : ""}${colDataOp ? ", GETDATE()" : ""});
            END
          END
        `
      })()

      const qIns = cloneInsertSql ?? `
        IF NOT EXISTS (SELECT 1 FROM ${piQ} WHERE ${whereParts.join(" AND ")})
        BEGIN
          INSERT INTO ${piQ} ([${colIdLez}], [${colIdPren}], [${colDataInizio}], [${colDataFine}]${colIdUtente ? `, [${colIdUtente}]` : ""}${colImporto ? `, [${colImporto}]` : ""}${colNote ? `, [${colNote}]` : ""}${colCanale ? `, [${colCanale}]` : ""}${colOperatore ? `, [${colOperatore}]` : ""}${colDataOp ? `, [${colDataOp}]` : ""})
          VALUES (@idLez, @idPren, @dtStart, @dtEnd${colIdUtente ? ", NULL" : ""}${colImporto ? ", 0" : ""}${colNote ? ", @note" : ""}${colCanale ? ", NULL" : ""}${colOperatore ? ", 5" : ""}${colDataOp ? ", GETDATE()" : ""});
        END
      `

      const rr = await p
        .request()
        .input("idLez", sql.Int, idCorso)
        .input("idPren", sql.Int, idPrenotazione)
        .input("dtStart", sql.DateTime, new Date(dtStart))
        .input("dtEnd", sql.DateTime, new Date(dtEnd))
        .input("note", sql.NVarChar(200), motivo || "Blocco temporaneo")
        .query(qIns)
      const affected = Array.isArray((rr as any)?.rowsAffected) ? Number((rr as any).rowsAffected?.slice(-1)?.[0] ?? 0) : 0
      return res.json({ ok: true, rowsAffected: affected, table: rawPi, giorno, oraInizio, oraFine, mode: "iscrizione-insert" })
    }

    // Unblock: cancella le righe blocco (IDUtente NULL) per quella data/ora.
    const qDel = `DELETE FROM ${piQ} WHERE ${whereParts.join(" AND ")};`
    const rr = await p
      .request()
      .input("idLez", sql.Int, idCorso)
      .input("idPren", sql.Int, idPrenotazione)
      .input("dtStart", sql.DateTime, new Date(dtStart))
      .input("dtEnd", sql.DateTime, new Date(dtEnd))
      .query(qDel)
    const affected = Array.isArray((rr as any)?.rowsAffected) ? Number((rr as any).rowsAffected?.[0] ?? 0) : 0
    return res.json({ ok: true, rowsAffected: affected, table: rawPi, giorno, oraInizio, oraFine, mode: "iscrizione-delete" })
  }

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
    if (idPrenotazioneRaw != null) {
      const rawPrenTable = safeIdent(process.env.GESTIONALE_TABLE_PRENOTAZIONI ?? "dbo.Prenotazioni") ?? "dbo.Prenotazioni"
      const pq = qualifySqlObject(rawPrenTable).query
      const prenCols = await getColsLower(rawPrenTable)
      const prenIdCol = pickFirstCol(prenCols, ["IDPrenotazione", "IdPrenotazione"])
      const prenEnabledCol = pickFirstCol(prenCols, ["WebVisibile", "TotemVisibile", "Attivo"])
      if (prenIdCol && prenEnabledCol) {
        const rr = await p
          .request()
          .input("idPren", sql.Int, idPrenotazioneRaw)
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
      ...(idPrenotazioneRaw != null ? { rowsAffectedPrenotazione: affectedPren } : {}),
    })
  } catch (e) {
    return res.status(500).json({ message: (e as Error).message })
  }
}

export async function getBlocchiCorsiGiorno(req: Request, res: Response) {
  const u = getScopedUser(req)
  if (u.role !== "admin" && u.role !== "corsi") return res.status(403).json({ message: "Permessi insufficienti" })

  const giorno = String(req.query.giorno ?? "").trim()
  if (!isIsoDate(giorno)) return res.status(400).json({ message: "Parametro giorno non valido (YYYY-MM-DD)" })

  // Importante: la lista blocchi legge dbo.PrenotazioniIscrizione. Spesso l'utente READ non ha SELECT su questa tabella.
  // Usiamo quindi la connessione WRITE (se configurata) e facciamo fallback alla READ.
  const p = (await gestionaleSql.getPoolWrite()) ?? (await gestionaleSql.getPool())
  if (!p) return res.status(503).json({ message: "DB gestionale non configurato (SQL_CONNECTION_STRING[_WRITE])" })

  const rawPi = safeIdent(process.env.GESTIONALE_TABLE_PRENOTAZIONI_ISCRIZIONE ?? "dbo.PrenotazioniIscrizione") ?? "dbo.PrenotazioniIscrizione"
  const piQ = qualifySqlObject(rawPi).query
  const piCols = await getColsLower(rawPi)

  const colIdLez = pickFirstCol(piCols, ["IDPrenotazioneLezione", "IdPrenotazioneLezione"])
  const colIdPren = pickFirstCol(piCols, ["IDPrenotazione", "IdPrenotazione"])
  const colIdUtente = pickFirstCol(piCols, ["IDUtente", "IdUtente"])
  const colDataInizio = pickFirstCol(piCols, ["DataInizio", "Datainizio", "DataOraInizio", "DataOra", "Inizio", "OraInizio"])
  const colDataFine = pickFirstCol(piCols, ["DataFine", "Datafine", "DataOraFine", "Fine", "OraFine"])
  const colNote = pickFirstCol(piCols, ["Note", "Nota", "Descrizione", "Motivo"])

  if (!colIdLez || !colDataInizio) {
    return res.status(503).json({ message: "PrenotazioniIscrizione: colonne non trovate", debug: { table: rawPi } })
  }

  // Blocchi = righe con IDUtente NULL nel giorno richiesto (per data inizio).
  const whereParts = [`CAST([${colDataInizio}] AS date) = CAST(@giorno AS date)`]
  if (colIdUtente) whereParts.push(`[${colIdUtente}] IS NULL`)

  const selectCols = [
    colIdLez ? `[${colIdLez}] AS idPrenotazioneLezione` : "NULL AS idPrenotazioneLezione",
    colIdPren ? `[${colIdPren}] AS idPrenotazione` : "NULL AS idPrenotazione",
    // Importante: serializzare datetime come stringa locale (non Date->ISO Z) per evitare shift timezone sul client.
    colDataInizio
      ? `CONVERT(varchar(19), [${colDataInizio}], 120) AS dataInizioSql`
      : "NULL AS dataInizioSql",
    colDataFine ? `CONVERT(varchar(19), [${colDataFine}], 120) AS dataFineSql` : "NULL AS dataFineSql",
    colDataInizio ? `LEFT(CONVERT(varchar(8), [${colDataInizio}], 108), 5) AS oraInizio` : "NULL AS oraInizio",
    colDataFine ? `LEFT(CONVERT(varchar(8), [${colDataFine}], 108), 5) AS oraFine` : "NULL AS oraFine",
    colNote ? `[${colNote}] AS note` : "NULL AS note",
  ]

  const q = `
    SELECT ${selectCols.join(", ")}
    FROM ${piQ}
    WHERE ${whereParts.join(" AND ")}
  `

  const rr = await p.request().input("giorno", sql.Date, giorno).query(q)
  const rows = (rr.recordset ?? []) as any[]
  return res.json({ ok: true, rows })
}

