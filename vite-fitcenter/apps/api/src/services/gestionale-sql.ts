/**
 * Lettura dal gestionale (Microsoft SQL Server): solo anagrafici clienti e abbonamenti.
 * Configurare SQL_CONNECTION_STRING nel .env.
 *
 * Modello dati (allineato a export Excel: ID Venditore 336/348 = consulente).
 * - Utenti: IDUtente = chiave (336 Carmen, 348 Serena, ecc.). Cerchiamo le 3 consulenti per Nome+Cognome.
 * - MovimentiVenduto: colonna IDUtente = venditore → filtro WHERE IDUtente = IDUtente consulente.
 * - AbbonamentiIscrizione: colonna IDVenditore = stesso numero (336, 348) → filtro WHERE IDVenditore = IDUtente consulente.
 *
 * Supporta:
 * - Autenticazione Windows (Integrated Security=true): richiede il driver opzionale msnodesqlv8.
 *   L'app deve essere eseguita con un account Windows che abbia accesso in sola lettura al DB.
 * - Autenticazione SQL (User Id=...; Password=...): connessione standard.
 *
 * Dal gestionale si importano SOLO:
 * - Clienti (anagrafiche: nome, cognome, email, telefono, ecc.)
 * - Abbonamenti (tipologia, prezzo, scadenza, collegamento cliente)
 *
 * NON si importano: Lead (arrivano da sito/FB/Google), Budget (assegnato da admin),
 * Piani/Catalogo (non usati dal gestionale).
 */

import sql from "mssql"

let pool: sql.ConnectionPool | null = null
let lastConnectionError: string | null = null

function getConnectionString(): string | undefined {
  return process.env.SQL_CONNECTION_STRING
}

/** Estrae coppie chiave=valore dalla connection string (case-insensitive per chiavi). */
function parseConnectionString(cs: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of cs.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1).trim()
    map.set(key, value)
  }
  return map
}

function isWindowsAuth(cs: string): boolean {
  const p = parseConnectionString(cs)
  const integrated = p.get("integrated security") ?? p.get("trusted_connection")
  return integrated === "true" || integrated === "yes" || integrated === "sspi"
}

export async function getPool(): Promise<sql.ConnectionPool | null> {
  const cs = getConnectionString()
  if (!cs) return null
  if (pool) return pool
  try {
    if (isWindowsAuth(cs)) {
      const params = parseConnectionString(cs)
      const server = params.get("server") ?? params.get("data source") ?? "."
      const database = params.get("database") ?? params.get("initial catalog") ?? ""
      const trustCert = params.get("trustservercertificate")?.toLowerCase() === "true"
      try {
        const sqlWin = await import("mssql/msnodesqlv8")
        pool = await sqlWin.default.connect({
          server,
          database,
          options: {
            trustedConnection: true,
            trustServerCertificate: trustCert,
            enableArithAbort: true,
          },
        })
      } catch (e) {
        const msg = (e as NodeJS.ErrnoException)?.message ?? String(e)
        if (msg.includes("Cannot find module") || msg.includes("msnodesqlv8")) {
          throw new Error(
            "Per usare l'autenticazione Windows (Integrated Security) installa il driver opzionale: pnpm add msnodesqlv8 (solo su Windows). " +
              "Oppure usa autenticazione SQL con User Id e Password nella connection string."
          )
        }
        throw e
      }
    } else {
      pool = await sql.connect(cs)
    }
    return pool
  } catch (e) {
    lastConnectionError = (e as Error)?.message ?? String(e)
    if (isWindowsAuth(cs)) throw e
    return null
  }
}

/** Ultimo errore di connessione (per debug in /api/data/sql-status). */
export function getLastConnectionError(): string | null {
  return lastConnectionError
}

const defaultTables = {
  clienti: process.env.GESTIONALE_TABLE_CLIENTI ?? "Utenti",
  movimentiVenduto: process.env.GESTIONALE_TABLE_MOVIMENTI_VENDUTO ?? "MovimentiVenduto",
}

/** Nome tabella/vista abbonamenti in uso (per debug e query): letto ogni volta da process.env così rispetta il .env caricato in index.ts. */
export function getAbbonamentiTableName(): string {
  return process.env.GESTIONALE_TABLE_ABBONAMENTI?.trim() || "AbbonamentiIscrizione"
}

/** View venditore da anagrafica (es. RVW_AbbonamentiUtentiCapofamiglia): IDVenditoreAbbonamento, NomeVenditoreAbbonamento, colonna join IDIscrizione. */
function getViewVenditoreAbbonamento(): { view: string; colId: string; colNome: string; colJoin: string } | null {
  const view = process.env.GESTIONALE_VIEW_VENDITORE_ABBONAMENTO?.trim()
  if (!view) return null
  return {
    view,
    colId: process.env.GESTIONALE_VIEW_COL_ID_VENDITORE?.trim() ?? "IDVenditoreAbbonamento",
    colNome: process.env.GESTIONALE_VIEW_COL_NOME_VENDITORE?.trim() ?? "NomeVenditoreAbbonamento",
    colJoin: process.env.GESTIONALE_VIEW_COL_JOIN?.trim() ?? "IDIscrizione",
  }
}

/** Coppie (Nome, Cognome) delle 3 consulenti per risalire a IDUtente dalla tabella Utenti. */
const CONSULENTI_NOME_COGNOME: { nome: string; cognome: string; label: string }[] = [
  { nome: "Carmen", cognome: "Severino", label: "Carmen Severino" },
  { nome: "Ombretta", cognome: "Zenoni", label: "Ombretta Zenoni" },
  { nome: "Serena", cognome: "Del Prete", label: "Serena Del Prete" },
]

let cacheConsultantIdMap: Map<string, string> | null = null

/**
 * Risolve il nome consulente in id (IDUtente da Utenti). Stesso id usato per venduto e abbonamenti.
 */
export async function getConsultantIdUtente(consulenteNome: string): Promise<string | null> {
  const map = await getConsultantIdUtenteMap()
  const trimmed = consulenteNome.trim()
  return map.get(trimmed) ?? map.get(trimmed.toLowerCase()) ?? null
}

/** Normalizza per match: lowercase, trim, spazi multipli → uno. */
function norm(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ")
}

/** Verifica se nomeOperatore (dal DB) corrisponde alla consulente (nome/cognome). */
function matchOperatore(nomeOperatore: string, consulente: { nome: string; cognome: string; label: string }): boolean {
  const op = norm(nomeOperatore)
  if (!op) return false
  const n = norm(consulente.nome)
  const c = norm(consulente.cognome)
  const label = norm(consulente.label)
  if (op === label) return true
  if (op.includes(n) && op.includes(c)) return true
  if (op.includes(n) && c.length >= 3 && op.includes(c.slice(0, Math.min(8, c.length)))) return true
  if (label.length >= 4 && op.includes(label.slice(0, 6))) return true
  if (op.length >= 4 && label.includes(op.slice(0, 6))) return true
  return false
}

/**
 * Mappa nome consulente → ID venditore.
 * Se configurata, usa la view RVW_AbbonamentiUtentiCapofamiglia (venditore assegnato in anagrafica clienti).
 * Altrimenti usa AbbonamentiIscrizione (IDVenditore, NomeOperatore).
 */
export async function getConsultantIdUtenteMap(): Promise<Map<string, string>> {
  if (cacheConsultantIdMap) return cacheConsultantIdMap
  const p = await getPool()
  const result = new Map<string, string>()
  if (!p) return applyConsultantFallback(result)

  const viewCfg = getViewVenditoreAbbonamento()
  if (viewCfg) {
    try {
      const r = await p.request().query(
        `SELECT DISTINCT [${viewCfg.colId}], [${viewCfg.colNome}] FROM [${viewCfg.view}] WHERE [${viewCfg.colId}] IS NOT NULL AND [${viewCfg.colNome}] IS NOT NULL`
      )
      const rows = (r.recordset ?? []) as Record<string, unknown>[]
      const labelNorm = (s: string) => norm(s)
      for (const cons of CONSULENTI_NOME_COGNOME) {
        const consLabelNorm = labelNorm(cons.label)
        const exactMatch = rows.filter((row) => labelNorm(String(row[viewCfg.colNome] ?? "")) === consLabelNorm)
        const fuzzyMatch = rows.filter((row) => matchOperatore(String(row[viewCfg.colNome] ?? ""), cons))
        const useAllMatches = cons.label === "Ombretta Zenoni"
        const source = useAllMatches ? fuzzyMatch : exactMatch.length > 0 ? exactMatch : fuzzyMatch
        const ids = [...new Set(source.map((row) => String(row[viewCfg.colId] ?? "").trim()).filter(Boolean))]
        if (ids.length > 0) {
          const idStr = ids.join(",")
          result.set(cons.label, idStr)
          result.set(cons.label.toLowerCase(), idStr)
        }
      }
    } catch {
      // ignore
    }
  }

  if (result.size === 0) {
    try {
      const tblA = getAbbonamentiTableName()
      const r = await p.request().query(
        `SELECT DISTINCT IDVenditore, NomeOperatore FROM [${tblA}] WHERE IDVenditore IS NOT NULL AND NomeOperatore IS NOT NULL`
      )
      const rows = (r.recordset ?? []) as Record<string, unknown>[]
      for (const cons of CONSULENTI_NOME_COGNOME) {
        const found = rows.find((row) => matchOperatore(String(row.NomeOperatore ?? row.Nome ?? ""), cons))
        if (found) {
          const id = String(found.IDVenditore ?? "")
          if (id) {
            result.set(cons.label, id)
            result.set(cons.label.toLowerCase(), id)
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (result.size === 0) {
    try {
      const conditions = CONSULENTI_NOME_COGNOME.map((_, i) => `(Nome = @nome${i} AND Cognome = @cognome${i})`).join(" OR ")
      const req = p.request()
      CONSULENTI_NOME_COGNOME.forEach((c, i) => {
        req.input(`nome${i}`, sql.NVarChar, c.nome)
        req.input(`cognome${i}`, sql.NVarChar, c.cognome)
      })
      const r = await req.query(`SELECT IDUtente, Nome, Cognome FROM [${defaultTables.clienti}] WHERE ${conditions}`)
      const rows = (r.recordset ?? []) as Record<string, unknown>[]
      rows.forEach((row) => {
        const id = String(row.IDUtente ?? row.Id ?? row.id ?? "")
        const nome = String(row.Nome ?? row.nome ?? "")
        const cognome = String(row.Cognome ?? row.cognome ?? "")
        const label = `${nome} ${cognome}`.trim()
        if (id && label) {
          result.set(label, id)
          result.set(label.toLowerCase(), id)
        }
      })
    } catch {
      // ignore
    }
  }

  return applyConsultantFallback(result)
}

/**
 * Completa la mappa con fallback da env. Ombretta: 312,352,73 (dati sotto più nomi in view).
 */
function applyConsultantFallback(result: Map<string, string>): Map<string, string> {
  const carmen = process.env.CONSULENTE_ID_CARMEN ?? "336"
  const serena = process.env.CONSULENTE_ID_SERENA ?? "348"
  const ombretta = process.env.CONSULENTE_ID_OMBRETTA ?? "312,352,73"
  if (!result.has("Carmen Severino")) {
    result.set("Carmen Severino", carmen)
    result.set("carmen severino", carmen)
  }
  if (!result.has("Serena Del Prete")) {
    result.set("Serena Del Prete", serena)
    result.set("serena del prete", serena)
  }
  if (!result.has("Ombretta Zenoni")) {
    result.set("Ombretta Zenoni", ombretta)
    result.set("ombretta zenoni", ombretta)
  }
  cacheConsultantIdMap = result
  return result
}

/** Query flessibili: se le tabelle non esistono, ritorniamo array vuoti (il frontend userà i mock). */
export async function queryClienti(): Promise<Record<string, unknown>[]> {
  const p = await getPool()
  if (!p) return []
  try {
    const r = await p.request().query(
      `SELECT * FROM [${defaultTables.clienti}] ORDER BY Cognome, Nome`
    )
    return (r.recordset ?? []) as Record<string, unknown>[]
  } catch {
    return []
  }
}

function idParamType(id: string): { type: typeof sql.Int | typeof sql.VarChar; value: number | string } {
  const n = parseInt(id, 10)
  if (String(n) === id && !Number.isNaN(n)) return { type: sql.Int, value: n }
  return { type: sql.VarChar, value: id }
}

/** Se idConsultant è "312,352,73" restituisce [312,352,73]; altrimenti [id] singolo. */
function parseConsultantIds(idConsultant: string): number[] {
  const parts = idConsultant.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
  if (parts.length > 0) return parts
  const single = parseInt(idConsultant.trim(), 10)
  return Number.isNaN(single) ? [] : [single]
}

/** Opzioni per query abbonamenti: inScadenza = 30 o 60 restituisce solo abbonamenti con DataFine tra oggi e oggi+N. */
export type QueryAbbonamentiOptions = { inScadenza?: number }

/** Abbonamenti con JOIN Utenti. Filtro: prova IDVenditore, Abbonanditore e confronto come stringa. */
export async function queryAbbonamenti(
  idConsultant?: string,
  options?: QueryAbbonamentiOptions
): Promise<Record<string, unknown>[]> {
  const p = await getPool()
  if (!p) return []
  const tblA = getAbbonamentiTableName()
  const tblU = defaultTables.clienti
  const inScadenza = options?.inScadenza
  const dateFilter =
    inScadenza != null && inScadenza > 0
      ? ` AND CAST(a.DataFine AS DATE) >= CAST(GETDATE() AS DATE) AND CAST(a.DataFine AS DATE) <= CAST(DATEADD(day, ${Math.min(365, inScadenza)}, GETDATE()) AS DATE)`
      : ""

  const runWithCol = async (col: string) => {
    let req = p.request()
    if (idConsultant) {
      const { type, value } = idParamType(idConsultant)
      req = req.input("id", type, value)
    }
    const where = (idConsultant ? ` WHERE a.[${col}] = @id` : " WHERE 1=1") + dateFilter
    const r = await req.query(
      `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome
       FROM [${tblA}] a
       LEFT JOIN [${tblU}] u ON u.IDUtente = a.IDUtente
       ${where}
       ORDER BY a.IDIscrizione DESC`
    )
    return (r.recordset ?? []) as Record<string, unknown>[]
  }
  if (!idConsultant) {
    const viewCfg = getViewVenditoreAbbonamento()
    const where = "WHERE 1=1" + dateFilter
    // Se configurata la view venditore, esponi anche il nome consulente per la lista admin (tutti).
    if (viewCfg) {
      try {
        const r = await p.request().query(
          `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome, R.[${viewCfg.colNome}] AS ConsulenteNome
           FROM [${tblA}] a
           INNER JOIN [${viewCfg.view}] R ON R.[${viewCfg.colJoin}] = a.IDIscrizione
           LEFT JOIN [${tblU}] u ON u.IDUtente = a.IDUtente
           ${where}
           ORDER BY a.IDIscrizione DESC`
        )
        return (r.recordset ?? []) as Record<string, unknown>[]
      } catch {
        // fallback sotto
      }
    }
    const r = await p.request().query(
      `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome
       FROM [${tblA}] a
       LEFT JOIN [${tblU}] u ON u.IDUtente = a.IDUtente
       ${where}
       ORDER BY a.IDIscrizione DESC`
    )
    return (r.recordset ?? []) as Record<string, unknown>[]
  }

  const viewCfg = getViewVenditoreAbbonamento()
  if (viewCfg) {
    const ids = parseConsultantIds(idConsultant)
    if (ids.length > 0) {
      try {
        const idParams = ids.map((_, i) => `@id${i}`).join(", ")
        const idWhere = ids.length === 1 ? `R.[${viewCfg.colId}] = @id0` : `R.[${viewCfg.colId}] IN (${idParams})`
        let req = p.request()
        ids.forEach((id, i) => { req = req.input(`id${i}`, sql.Int, id) })
        const r = await req.query(
          `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome, R.[${viewCfg.colNome}] AS ConsulenteNome
           FROM [${tblA}] a
           INNER JOIN [${viewCfg.view}] R ON R.[${viewCfg.colJoin}] = a.IDIscrizione
           LEFT JOIN [${tblU}] u ON u.IDUtente = a.IDUtente
           WHERE ${idWhere}${dateFilter}
           ORDER BY a.IDIscrizione DESC`
        )
        return (r.recordset ?? []) as Record<string, unknown>[]
      } catch {
        return []
      }
    }
  }

  const colsToTry = ["IDVenditore", "Abbonanditore"]
  const envCol = process.env.GESTIONALE_ABBONAMENTI_COL_VENDITORE
  if (envCol && !colsToTry.includes(envCol)) colsToTry.unshift(envCol)

  for (const col of colsToTry) {
    try {
      const rows = await runWithCol(col)
      if (rows.length > 0) return rows
    } catch {
      // colonna inesistente, prova la prossima
    }
  }
  try {
    const idStr = String(idConsultant)
    const req = p.request().input("id", sql.VarChar, idStr)
    const r = await req.query(
      `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome
       FROM [${tblA}] a
       LEFT JOIN [${tblU}] u ON u.IDUtente = a.IDUtente
       WHERE (CAST(a.IDVenditore AS NVARCHAR(50)) = @id OR CAST(a.Abbonanditore AS NVARCHAR(50)) = @id)${dateFilter}
       ORDER BY a.IDIscrizione DESC`
    )
    return (r.recordset ?? []) as Record<string, unknown>[]
  } catch {
    return []
  }
}

/** Vendite dalla tabella MovimentiVenduto. Con view venditore: join su IDIscrizione, filtro per venditore anagrafica. */
export async function queryMovimentiVenduto(idConsultant?: string): Promise<Record<string, unknown>[]> {
  const p = await getPool()
  if (!p) return []
  if (!idConsultant) {
    const r = await p.request().query(`SELECT * FROM [${defaultTables.movimentiVenduto}]`)
    return (r.recordset ?? []) as Record<string, unknown>[]
  }
  const viewCfg = getViewVenditoreAbbonamento()
  if (viewCfg) {
    const ids = parseConsultantIds(idConsultant)
    if (ids.length > 0) {
      try {
        const idParams = ids.map((_, i) => `@id${i}`).join(", ")
        const idWhere = ids.length === 1 ? `R.[${viewCfg.colId}] = @id0` : `R.[${viewCfg.colId}] IN (${idParams})`
        let req = p.request()
        ids.forEach((id, i) => { req = req.input(`id${i}`, sql.Int, id) })
        const r = await req.query(
          `SELECT M.* FROM [${defaultTables.movimentiVenduto}] M
           INNER JOIN [${viewCfg.view}] R ON R.[${viewCfg.colJoin}] = M.[IDIscrizione]
           WHERE ${idWhere}`
        )
        return (r.recordset ?? []) as Record<string, unknown>[]
      } catch {
        return []
      }
    }
  }
  const envCol = process.env.GESTIONALE_MOVIMENTI_COL_VENDITORE?.trim()
  const colsToTry = envCol ? [envCol, "IDVenditore"] : ["IDVenditore"]
  const { type, value } = idParamType(idConsultant)
  for (const col of colsToTry) {
    try {
      const req = p.request().input("id", type, value)
      const r = await req.query(`SELECT * FROM [${defaultTables.movimentiVenduto}] WHERE [${col}] = @id`)
      return (r.recordset ?? []) as Record<string, unknown>[]
    } catch {
      // skip
    }
  }
  return []
}

const COL_DATA = "DataOperazione"
const COL_IMPORTO = "Importo"
const COL_ISCRIZIONE = "IDIscrizione"

/**
 * Totale vendite: se è configurata la view venditore si usa la logica report (somma R.Totale dalla view
 * una volta per IDIscrizione per le iscrizioni con movimento nel periodo). Altrimenti SUM(M.Importo).
 */
/** progressivoGiorno: se impostato (e giorno non usato), somma vendite da inizio mese fino a quel giorno incluso. */
async function queryVenditeSum(
  p: sql.ConnectionPool,
  anno: number,
  mese: number,
  giorno?: number,
  idConsultant?: string,
  progressivoGiorno?: number
): Promise<number> {
  const tbl = defaultTables.movimentiVenduto
  const viewCfg = getViewVenditoreAbbonamento()

  // Stessa logica del report: CTE Temp_Stampe (IDIscrizione per data+venditore) poi SUM(R.Totale).
  // Supporta idConsultant multipli (es. "312,352,73" per Ombretta) con IN (@id0, @id1, @id2).
  if (viewCfg && idConsultant) {
    const ids = parseConsultantIds(idConsultant)
    if (ids.length === 0) return 0
    try {
      const view = viewCfg.view
      const colId = viewCfg.colId
      const colJoin = viewCfg.colJoin
      const idParams = ids.map((_, i) => `@id${i}`).join(", ")
      const idWhere = ids.length === 1 ? `[${colId}] = @id0` : `[${colId}] IN (${idParams})`

      if (giorno != null) {
        const dataStr = `${anno}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`
        let req = p.request().input("data", sql.VarChar(10), dataStr)
        ids.forEach((id, i) => { req = req.input(`id${i}`, sql.Int, id) })
        const r = await req.query(
          `;WITH Temp_Stampe AS (
            SELECT DISTINCT [${colJoin}] AS ID
            FROM [${view}]
            WHERE CAST([${COL_DATA}] AS DATE) = CAST(@data AS DATE)
              AND ${idWhere}
          ),
          UnaPerIscrizione AS (
            SELECT R.[${colJoin}], MAX(R.Totale) AS Totale
            FROM [${view}] R
            INNER JOIN Temp_Stampe T ON R.[${colJoin}] = T.ID
            WHERE ${idWhere} AND CAST(R.[${COL_DATA}] AS DATE) = CAST(@data AS DATE)
            GROUP BY R.[${colJoin}]
          )
          SELECT SUM(Totale) AS Totale FROM UnaPerIscrizione`
        )
        const row = (r.recordset ?? [])[0] as Record<string, unknown> | undefined
        return Number(row?.Totale ?? row?.totale) || 0
      }

      const ultimoGiorno = new Date(anno, mese, 0).getDate()
      const dataInizioStr = `${anno}-${String(mese).padStart(2, "0")}-01`
      const dataFineStr = `${anno}-${String(mese).padStart(2, "0")}-${String(ultimoGiorno).padStart(2, "0")}`
      // progressivo: da inizio mese fino a progressivoGiorno (incluso)
      const dataFineEffettiva =
        progressivoGiorno != null && progressivoGiorno >= 1 && progressivoGiorno <= ultimoGiorno
          ? `${anno}-${String(mese).padStart(2, "0")}-${String(progressivoGiorno).padStart(2, "0")}`
          : dataFineStr
      let req = p
        .request()
        .input("dataInizio", sql.VarChar(10), dataInizioStr)
        .input("dataFine", sql.VarChar(10), dataFineEffettiva)
      ids.forEach((id, i) => { req = req.input(`id${i}`, sql.Int, id) })
      const r = await req.query(
        `;WITH Temp_Stampe AS (
          SELECT DISTINCT [${colJoin}] AS ID
          FROM [${view}]
          WHERE CAST([${COL_DATA}] AS DATE) >= CAST(@dataInizio AS DATE)
            AND CAST([${COL_DATA}] AS DATE) <= CAST(@dataFine AS DATE)
            AND ${idWhere}
        ),
        UnaPerIscrizione AS (
          SELECT R.[${colJoin}], MAX(R.Totale) AS Totale
          FROM [${view}] R
          INNER JOIN Temp_Stampe T ON R.[${colJoin}] = T.ID
          WHERE ${idWhere}
            AND CAST(R.[${COL_DATA}] AS DATE) >= CAST(@dataInizio AS DATE)
            AND CAST(R.[${COL_DATA}] AS DATE) <= CAST(@dataFine AS DATE)
          GROUP BY R.[${colJoin}]
        )
        SELECT SUM(Totale) AS Totale FROM UnaPerIscrizione`
      )
      const row = (r.recordset ?? [])[0] as Record<string, unknown> | undefined
      return Number(row?.Totale ?? row?.totale) || 0
    } catch {
      return 0
    }
  }

  const runQuery = async (consultantCol: string | null): Promise<number> => {
    const req = p.request().input("anno", sql.Int, anno).input("mese", sql.Int, mese)
    if (giorno != null) req.input("giorno", sql.Int, giorno)
    if (progressivoGiorno != null) req.input("progressivoGiorno", sql.Int, progressivoGiorno)
    if (consultantCol && idConsultant) {
      const { type, value } = idParamType(idConsultant)
      req.input("id", type, value)
    }
    const dayCondition =
      giorno != null ? ` AND DAY([${COL_DATA}]) = @giorno` : progressivoGiorno != null ? ` AND DAY([${COL_DATA}]) <= @progressivoGiorno` : ""
    const where =
      (consultantCol && idConsultant ? `[${consultantCol}] = @id AND ` : "") +
      `[${COL_IMPORTO}] > 0 AND YEAR([${COL_DATA}]) = @anno AND MONTH([${COL_DATA}]) = @mese` +
      dayCondition
    const r = await req.query(`SELECT SUM([${COL_IMPORTO}]) AS Totale FROM [${tbl}] WHERE ${where}`)
    const row = (r.recordset ?? [])[0] as Record<string, unknown> | undefined
    return Number(row?.Totale ?? row?.totale) || 0
  }

  if (!idConsultant) return runQuery(null)

  const envCol = process.env.GESTIONALE_MOVIMENTI_COL_VENDITORE?.trim()
  const colsToTry = envCol ? [envCol, "IDVenditore"] : ["IDVenditore"]
  for (const col of colsToTry) {
    try {
      const sum = await runQuery(col)
      if (sum > 0) return sum
    } catch {
      // skip
    }
  }
  return 0
}

/** Totale vendite del mese (1–30/31, stessa logica report). Giorno non usato: sempre mese intero. */
export async function getVenditeTotaleMese(
  anno: number,
  mese: number,
  _giorno?: number,
  idConsultant?: string
): Promise<number> {
  const p = await getPool()
  if (!p) return 0
  try {
    return await queryVenditeSum(p, anno, mese, undefined, idConsultant)
  } catch {
    return 0
  }
}

/** Consuntivo progressivo: vendite da inizio mese fino a giorno (incluso). Usare per "entrate mese" alla data di oggi. */
export async function getVenditeProgressivoMese(
  anno: number,
  mese: number,
  giorno: number,
  idConsultant?: string
): Promise<number> {
  const p = await getPool()
  if (!p) return 0
  try {
    return await queryVenditeSum(p, anno, mese, undefined, idConsultant, giorno)
  } catch {
    return 0
  }
}

/** Totale vendite del giorno (calcolo in SQL). */
export async function getVenditeTotaleGiorno(
  anno: number,
  mese: number,
  giorno: number,
  idConsultant?: string
): Promise<number> {
  const p = await getPool()
  if (!p) return 0
  try {
    return await queryVenditeSum(p, anno, mese, giorno, idConsultant)
  } catch {
    return 0
  }
}

/** Totali per mese per un anno (per storico), calcolo in SQL. */
export async function getVenditePerMeseAnno(
  anno: number,
  idConsultant?: string
): Promise<{ mese: number; totale: number }[]> {
  const p = await getPool()
  if (!p) return []
  const tbl = defaultTables.movimentiVenduto
  const viewCfg = getViewVenditoreAbbonamento()
  const mapRows = (recordset: Record<string, unknown>[]) =>
    recordset.map((row) => ({
      mese: Number(row.Mese ?? row.mese),
      totale: Number(row.Totale ?? row.totale) || 0,
    }))

  if (viewCfg && idConsultant) {
    const ids = parseConsultantIds(idConsultant)
    if (ids.length === 0) return []
    try {
      const idParams = ids.map((_, i) => `@id${i}`).join(", ")
      const idWhere = ids.length === 1 ? `R.[${viewCfg.colId}] = @id0` : `R.[${viewCfg.colId}] IN (${idParams})`
      let req = p.request().input("anno", sql.Int, anno)
      ids.forEach((id, i) => { req = req.input(`id${i}`, sql.Int, id) })
      const r = await req.query(
        `WITH UnaPerIscrizioneMese AS (
          SELECT MONTH(R.[${COL_DATA}]) AS Mese, R.[${viewCfg.colJoin}], MAX(R.Totale) AS Totale
          FROM [${viewCfg.view}] R
          WHERE ${idWhere} AND YEAR(R.[${COL_DATA}]) = @anno
          GROUP BY MONTH(R.[${COL_DATA}]), R.[${viewCfg.colJoin}]
        )
        SELECT Mese, SUM(Totale) AS Totale FROM UnaPerIscrizioneMese GROUP BY Mese ORDER BY Mese`
      )
      return mapRows((r.recordset ?? []) as Record<string, unknown>[])
    } catch {
      return []
    }
  }

  const runNoFilter = async () => {
    const r = await p
      .request()
      .input("anno", sql.Int, anno)
      .query(
        `SELECT MONTH([${COL_DATA}]) AS Mese, SUM([${COL_IMPORTO}]) AS Totale FROM [${tbl}]
         WHERE [${COL_IMPORTO}] > 0 AND YEAR([${COL_DATA}]) = @anno
         GROUP BY MONTH([${COL_DATA}]) ORDER BY Mese`
      )
    return mapRows((r.recordset ?? []) as Record<string, unknown>[])
  }
  const runWithCol = async (col: string) => {
    const { type, value } = idParamType(idConsultant!)
    const r = await p
      .request()
      .input("anno", sql.Int, anno)
      .input("id", type, value)
      .query(
        `SELECT MONTH([${COL_DATA}]) AS Mese, SUM([${COL_IMPORTO}]) AS Totale FROM [${tbl}]
         WHERE [${COL_IMPORTO}] > 0 AND YEAR([${COL_DATA}]) = @anno AND [${col}] = @id
         GROUP BY MONTH([${COL_DATA}]) ORDER BY Mese`
      )
    return mapRows((r.recordset ?? []) as Record<string, unknown>[])
  }

  if (!idConsultant) return runNoFilter()

  // Vendita attribuita al venditore (IDVenditore), non all'operatore.
  const envCol = process.env.GESTIONALE_MOVIMENTI_COL_VENDITORE?.trim()
  const colsToTry = envCol ? [envCol, "IDVenditore"] : ["IDVenditore"]
  for (const col of colsToTry) {
    try {
      const rows = await runWithCol(col)
      if (rows.length > 0) return rows
    } catch {
      // skip
    }
  }
  return []
}

/** Totali vendite per anno (admin/report): calcolo in SQL senza full scan in Node. */
export async function getVenditeTotaliPerAnno(
  idConsultant?: string
): Promise<{ anno: number; totale: number }[]> {
  const p = await getPool()
  if (!p) return []
  const viewCfg = getViewVenditoreAbbonamento()
  const mapRows = (recordset: Record<string, unknown>[]) =>
    recordset
      .map((row) => ({
        anno: Number(row.Anno ?? row.anno),
        totale: Number(row.Totale ?? row.totale) || 0,
      }))
      .filter((x) => !Number.isNaN(x.anno))
      .sort((a, b) => a.anno - b.anno)

  if (viewCfg) {
    const ids = idConsultant ? parseConsultantIds(idConsultant) : []
    const idParams = ids.map((_, i) => `@id${i}`).join(", ")
    const idWhere = ids.length === 0 ? "" : ids.length === 1 ? ` AND R.[${viewCfg.colId}] = @id0` : ` AND R.[${viewCfg.colId}] IN (${idParams})`
    try {
      let req = p.request()
      ids.forEach((id, i) => { req = req.input(`id${i}`, sql.Int, id) })
      const r = await req.query(
        `WITH UnaPerIscrizioneAnno AS (
          SELECT YEAR(R.[${COL_DATA}]) AS Anno, R.[${viewCfg.colJoin}] AS ID, MAX(R.Totale) AS Totale
          FROM [${viewCfg.view}] R
          WHERE R.Totale > 0${idWhere}
          GROUP BY YEAR(R.[${COL_DATA}]), R.[${viewCfg.colJoin}]
        )
        SELECT Anno, SUM(Totale) AS Totale
        FROM UnaPerIscrizioneAnno
        GROUP BY Anno
        ORDER BY Anno`
      )
      return mapRows((r.recordset ?? []) as Record<string, unknown>[])
    } catch {
      return []
    }
  }

  const tbl = defaultTables.movimentiVenduto
  const envCol = process.env.GESTIONALE_MOVIMENTI_COL_VENDITORE?.trim()
  const colsToTry = idConsultant ? (envCol ? [envCol, "IDVenditore"] : ["IDVenditore"]) : [null]
  for (const consultantCol of colsToTry) {
    try {
      const req = p.request()
      if (consultantCol && idConsultant) {
        const { type, value } = idParamType(idConsultant)
        req.input("id", type, value)
      }
      const where =
        (consultantCol && idConsultant ? `[${consultantCol}] = @id AND ` : "") +
        `[${COL_IMPORTO}] > 0`
      const r = await req.query(
        `SELECT YEAR([${COL_DATA}]) AS Anno, SUM([${COL_IMPORTO}]) AS Totale
         FROM [${tbl}]
         WHERE ${where}
         GROUP BY YEAR([${COL_DATA}])
         ORDER BY Anno`
      )
      const rows = mapRows((r.recordset ?? []) as Record<string, unknown>[])
      if (!idConsultant || rows.length > 0) return rows
    } catch {
      // try next col
    }
  }
  return []
}

export function isGestionaleConfigured(): boolean {
  return !!getConnectionString()
}
