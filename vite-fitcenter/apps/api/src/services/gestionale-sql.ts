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

function ensureSqlTimeouts(cs: string): string {
  // Applica timeouts "nativi" al driver mssql.
  // Se non funzionano, la Promise JS (Promise.race) non basta perché alcune fasi possono bloccare l'event loop.
  const p = parseConnectionString(cs)
  const connectKey = "connect timeout"
  const requestKey = "request timeout"

  // Default: 15s per connettere, 45s per la singola request SQL.
  const connectTimeout = p.get(connectKey)
  const requestTimeout = p.get(requestKey)

  let out = cs
  if (connectTimeout == null) out += ";Connect Timeout=15"
  // Per tedious, Request Timeout in connection string viene interpretato in millisecondi.
  // Se mettiamo 45 otteniamo 45ms (come visto dai test), quindi usiamo 45000.
  if (requestTimeout == null) out += ";Request Timeout=45000"
  return out
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
      pool = await sql.connect(ensureSqlTimeouts(cs))
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

/** Unisce gli ID delle consulenti (es. risoluzione per Carmen + Serena + Ombretta) in una stringa per una sola query SQL. */
export function mergeConsultantIdStrings(parts: (string | undefined)[]): string | undefined {
  const set = new Set<number>()
  for (const s of parts) {
    if (!s?.trim()) continue
    for (const n of parseConsultantIds(s)) set.add(n)
  }
  if (set.size === 0) return undefined
  return [...set].sort((a, b) => a - b).join(",")
}

/** Opzioni per query abbonamenti: inScadenza = 30 o 60 restituisce solo abbonamenti con DataFine tra oggi e oggi+N. */
export type QueryAbbonamentiOptions = { inScadenza?: number }

/**
 * Età da tabella utenti: SOLO se imposti GESTIONALE_UTENTI_COL_ETA al nome reale della colonna.
 * Default: nessun campo aggiunto (evita "Invalid column name 'Eta'" se Utenti non ha Eta).
 * Se l'età è nella view abbonamenti (a.*), rowToAbbonamento la legge da lì senza questa opzione.
 */
function sqlUtenteEtaFragment(): string {
  const raw = process.env.GESTIONALE_UTENTI_COL_ETA?.trim()
  if (!raw) return ""
  const col = raw.replace(/[^\p{L}\p{N}_]/gu, "")
  if (!col) return ""
  return `, u.[${col}] AS ClienteEtaJoin`
}

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
  const etaFrag = sqlUtenteEtaFragment()

  const runWithCol = async (col: string) => {
    let req = p.request()
    if (idConsultant) {
      const { type, value } = idParamType(idConsultant)
      req = req.input("id", type, value)
    }
    const where = (idConsultant ? ` WHERE a.[${col}] = @id` : " WHERE 1=1") + dateFilter
    const r = await req.query(
      `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome${etaFrag}
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
          `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome${etaFrag}, R.[${viewCfg.colNome}] AS ConsulenteNome
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
      `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome${etaFrag}
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
          `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome${etaFrag}, R.[${viewCfg.colNome}] AS ConsulenteNome
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
      `SELECT a.*, u.Cognome AS ClienteCognome, u.Nome AS ClienteNome${etaFrag}
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

/** Nome view CRM appuntamenti (env o default [dbo].[RVW_CRMUtenti]). */
function getCrmUtentiViewName(): string {
  return process.env.GESTIONALE_VIEW_CRM_UTENTI?.trim() || "[dbo].[RVW_CRMUtenti]"
}

/**
 * Appuntamenti CRM dal gestionale (RVW_CRMUtenti): DataAppuntamento, TipoDescrizione, EsitoDescrizione, CRMDescrizione.
 * Filtri: NomeVenditore, Cognome/Nome cliente, DestinatarioNomeOperatore. Solo mese in corso.
 */
export interface CrmAppuntamentoRow {
  dataAppuntamento: string
  tipoDescrizione: string
  esitoDescrizione: string
  crmDescrizione: string
}

export async function queryCrmAppuntamenti(params: {
  nomeVenditore: string
  cognome: string
  nome: string
  nomeOperatore: string
}): Promise<CrmAppuntamentoRow[]> {
  const p = await getPool()
  if (!p) return []
  const view = getCrmUtentiViewName()
  try {
    const req = p
      .request()
      .input("nomeVenditore", sql.NVarChar, params.nomeVenditore?.trim() ?? "")
      .input("cognome", sql.NVarChar, params.cognome?.trim() ?? "")
      .input("nome", sql.NVarChar, params.nome?.trim() ?? "")
      .input("nomeOperatore", sql.NVarChar, params.nomeOperatore?.trim() ?? "")
    const r = await req.query(
      `SELECT DataAppuntamento, TipoDescrizione, EsitoDescrizione, CRMDescrizione
       FROM ${view}
       WHERE NomeVenditore = @nomeVenditore
         AND Cognome = @cognome
         AND Nome = @nome
         AND DestinatarioNomeOperatore = @nomeOperatore
         AND YEAR(DataAppuntamento) = YEAR(GETDATE())
         AND MONTH(DataAppuntamento) = MONTH(GETDATE())
       ORDER BY DataAppuntamento DESC`
    )
    const rows = (r.recordset ?? []) as Record<string, unknown>[]
    return rows.map((row) => ({
      dataAppuntamento: row.DataAppuntamento != null ? String(row.DataAppuntamento) : "",
      tipoDescrizione: row.TipoDescrizione != null ? String(row.TipoDescrizione) : "",
      esitoDescrizione: row.EsitoDescrizione != null ? String(row.EsitoDescrizione) : "",
      crmDescrizione: row.CRMDescrizione != null ? String(row.CRMDescrizione) : "",
    }))
  } catch {
    return []
  }
}

const COL_DATA = "DataOperazione"
const COL_IMPORTO = "Importo"
const COL_ISCRIZIONE = "IDIscrizione"

/**
 * Colonne su MovimentiVenduto da usare per «chi ha venduto» (il gestionale può usare cassa/operatore).
 * `GESTIONALE_MOVIMENTI_COL_VENDITORE` = primaria (default IDVenditore);
 * `GESTIONALE_MOVIMENTI_COL_VENDITORE_EXTRA` = lista separata da virgola, es. IDOperatore
 */
function colsAttribuzioneVenditaSuMovimento(): string[] {
  const raw = process.env.GESTIONALE_MOVIMENTI_COL_VENDITORE?.trim()
  const prim =
    raw && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) ? raw : "IDVenditore"
  const extras = (process.env.GESTIONALE_MOVIMENTI_COL_VENDITORE_EXTRA ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s))
  return [...new Set([prim, ...extras])]
}

function sqlMovimentoAttribuitoIdsSuMovimento(idParams: string): string {
  const orM = colsAttribuzioneVenditaSuMovimento()
    .map((col) => `M.[${col}] IN (${idParams})`)
    .join(" OR ")
  return `(${orM})`
}

function movimentoTipoOperazioneVendita(): string {
  const raw = (process.env.GESTIONALE_MOVIMENTI_TIPO_OPERAZIONE_VENDITA ?? "I").trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : "I"
}
function movimentoTipoServizioVendita(): string | null {
  const raw = (process.env.GESTIONALE_MOVIMENTI_TIPO_SERVIZIO_VENDITA ?? "").trim()
  if (!raw) return null
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : null
}

function whereEsclusioniVenditeView(alias = "R"): string {
  const upperCatAbbonExpr = `UPPER(COALESCE(${alias}.[CategoriaAbbonamentoDescrizione], ''))`
  const upperCatExpr = `UPPER(COALESCE(${alias}.[CategoriaDescrizione], ''))`
  return `
    AND COALESCE(${alias}.[IDCategoriaUtente], -1) <> 19
    AND ${upperCatAbbonExpr} NOT LIKE '%TESSERAMENT%'
    AND NOT (${upperCatAbbonExpr} LIKE '%ASI%' AND ${upperCatAbbonExpr} LIKE '%ISCRIZIONE%')
    AND ${upperCatExpr} NOT LIKE '%TESSERAMENT%'
    AND NOT (${upperCatExpr} LIKE '%ASI%' AND ${upperCatExpr} LIKE '%ISCRIZIONE%')
    AND ${upperCatExpr} NOT LIKE '%VARIE%'
    AND ${upperCatAbbonExpr} NOT LIKE '%DANZA%'
    AND ${upperCatExpr} NOT LIKE '%DANZA%'
    AND ${upperCatAbbonExpr} NOT LIKE '%CAMPUS%'
    AND ${upperCatExpr} NOT LIKE '%CAMPUS%'
    AND ${upperCatAbbonExpr} NOT LIKE '%ACQUATIC%'
    AND ${upperCatExpr} NOT LIKE '%ACQUATIC%'
    AND NOT (
      (${upperCatAbbonExpr} LIKE '%SCUOLA%' AND ${upperCatAbbonExpr} LIKE '%NUOT%')
      AND ${upperCatAbbonExpr} NOT LIKE '%ADULT%'
      AND ${upperCatAbbonExpr} NOT LIKE '%MASTER%'
    )
    AND NOT (
      (${upperCatExpr} LIKE '%SCUOLA%' AND ${upperCatExpr} LIKE '%NUOT%')
      AND ${upperCatExpr} NOT LIKE '%ADULT%'
      AND ${upperCatExpr} NOT LIKE '%MASTER%'
    )
  `
}

function sqlTotaleReportPerIscrizione(args: {
  tblMov: string
  view: string
  colJoin: string
  idWhereR: string
  colTotale: string
  fromParam: "@dataInizio" | "@from"
  toParam: "@dataFine" | "@to"
}): string {
  // Replica report: Temp_Stampe = IDIscrizione con movimento nel periodo (da MovimentiVenduto),
  // poi somma Totale dalla view una volta per iscrizione (MAX per sicurezza).
  const tipoOp = movimentoTipoOperazioneVendita()
  const tipoServ = movimentoTipoServizioVendita()
  const whereTipo = `AND M.[TipoOperazione] = '${tipoOp.replace(/'/g, "''")}'` + (tipoServ ? ` AND M.[TipoServizio] = '${tipoServ.replace(/'/g, "''")}'` : "")
  return `;WITH Temp_Stampe AS (
    SELECT DISTINCT M.[${COL_ISCRIZIONE}] AS ID
    FROM [${args.tblMov}] M
    WHERE M.[${COL_IMPORTO}] > 0
      AND CAST(M.[${COL_DATA}] AS DATE) >= CAST(${args.fromParam} AS DATE)
      AND CAST(M.[${COL_DATA}] AS DATE) <= CAST(${args.toParam} AS DATE)
      ${whereTipo}
  ),
  UnaPerIscrizione AS (
    SELECT T.ID, MAX(TRY_CONVERT(float, R.[${args.colTotale}])) AS Totale
    FROM Temp_Stampe T
    INNER JOIN [${args.view}] R ON R.[${args.colJoin}] = T.ID
    WHERE ${args.idWhereR}
      ${whereEsclusioniVenditeView("R")}
    GROUP BY T.ID
  )
  SELECT COALESCE(SUM(Totale), 0) AS Totale FROM UnaPerIscrizione`
}

/**
 * Il gestionale include movimenti attribuiti al consulente anche via colonna su M, non solo tramite view
 * (INNER JOIN view esclude righe senza iscrizione in view o con join incompleto).
 */
function sqlMovimentoAttribuitoConsulente(
  view: string,
  colJoin: string,
  idWhereR: string,
  idParams: string
): string {
  return `(
    EXISTS (
      SELECT 1 FROM [${view}] R
      WHERE R.[${colJoin}] = M.[${COL_ISCRIZIONE}] AND ${idWhereR}
    )
    OR ${sqlMovimentoAttribuitoIdsSuMovimento(idParams)}
  )`
}

/**
 * Totale vendite: con view venditore si usa **SUM(M.Importo)** su MovimentiVenduto join view (stesso criterio
 * del gestionale: una riga = un movimento). La vecchia logica MAX(R.Totale) per IDIscrizione sottostimava
 * quando ci sono più movimenti sulla stessa iscrizione (merchandising, ecc.). Senza view: SUM(M.Importo).
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

  // Dashboard: replica **report gestionale**: Totale dalla view (una volta per IDIscrizione)
  // per le iscrizioni con movimento nel periodo (Temp_Stampe).
  if (viewCfg && idConsultant) {
    const ids = parseConsultantIds(idConsultant)
    if (ids.length === 0) return 0
    try {
      const view = viewCfg.view
      const colId = viewCfg.colId
      const colJoin = viewCfg.colJoin
      const idParams = ids.map((_, i) => `@id${i}`).join(", ")
      const idWhereR = ids.length === 1 ? `R.[${colId}] = @id0` : `R.[${colId}] IN (${idParams})`
      const rawTot = process.env.GESTIONALE_VIEW_COL_TOTALE?.trim()
      const colTotale = rawTot && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawTot) ? rawTot : "Totale"

      if (giorno != null) {
        const dataStr = `${anno}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`
        let req = p.request().input("data", sql.VarChar(10), dataStr)
        ids.forEach((id, i) => {
          req = req.input(`id${i}`, sql.Int, id)
        })
        // Giorno: usa stessa CTE ma from=to=@data
        req = req.input("dataInizio", sql.VarChar(10), dataStr).input("dataFine", sql.VarChar(10), dataStr)
        const r = await req.query(
          sqlTotaleReportPerIscrizione({
            tblMov: tbl,
            view,
            colJoin,
            idWhereR,
            colTotale,
            fromParam: "@dataInizio",
            toParam: "@dataFine",
          })
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
      ids.forEach((id, i) => {
        req = req.input(`id${i}`, sql.Int, id)
      })
      const r = await req.query(
        sqlTotaleReportPerIscrizione({
          tblMov: tbl,
          view,
          colJoin,
          idWhereR,
          colTotale,
          fromParam: "@dataInizio",
          toParam: "@dataFine",
        })
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
      const idWhereR = ids.length === 1 ? `R.[${viewCfg.colId}] = @id0` : `R.[${viewCfg.colId}] IN (${idParams})`
      const matchCons = sqlMovimentoAttribuitoConsulente(viewCfg.view, viewCfg.colJoin, idWhereR, idParams)
      let req = p.request().input("anno", sql.Int, anno)
      ids.forEach((id, i) => {
        req = req.input(`id${i}`, sql.Int, id)
      })
      const r = await req.query(
        `SELECT MONTH(M.[${COL_DATA}]) AS Mese, SUM(M.[${COL_IMPORTO}]) AS Totale
         FROM [${tbl}] M
         WHERE M.[${COL_IMPORTO}] > 0 AND YEAR(M.[${COL_DATA}]) = @anno AND ${matchCons}
         GROUP BY MONTH(M.[${COL_DATA}]) ORDER BY Mese`
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
  const tbl = defaultTables.movimentiVenduto
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
    try {
      let req = p.request()
      ids.forEach((id, i) => {
        req = req.input(`id${i}`, sql.Int, id)
      })
      if (ids.length === 0) {
        const r = await req.query(
          `SELECT YEAR(M.[${COL_DATA}]) AS Anno, SUM(M.[${COL_IMPORTO}]) AS Totale
           FROM [${tbl}] M
           WHERE M.[${COL_IMPORTO}] > 0
           GROUP BY YEAR(M.[${COL_DATA}])
           ORDER BY Anno`
        )
        return mapRows((r.recordset ?? []) as Record<string, unknown>[])
      }
      const idParams = ids.map((_, i) => `@id${i}`).join(", ")
      const idWhereR = ids.length === 1 ? `R.[${viewCfg.colId}] = @id0` : `R.[${viewCfg.colId}] IN (${idParams})`
      const matchCons = sqlMovimentoAttribuitoConsulente(viewCfg.view, viewCfg.colJoin, idWhereR, idParams)
      const r = await req.query(
        `SELECT YEAR(M.[${COL_DATA}]) AS Anno, SUM(M.[${COL_IMPORTO}]) AS Totale
         FROM [${tbl}] M
         WHERE M.[${COL_IMPORTO}] > 0 AND ${matchCons}
         GROUP BY YEAR(M.[${COL_DATA}])
         ORDER BY Anno`
      )
      return mapRows((r.recordset ?? []) as Record<string, unknown>[])
    } catch {
      return []
    }
  }

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

/** Distribuzione vendite (movimenti Importo>0) per categoria e durata.
 *  Replica il gestionale: **conteggio movimenti** e **somma importo** nel periodo [from,to],
 *  includendo anche i tesseramenti (che generano importo). */
export async function getVenditeMovimentiCategoriaDurata(
  from: string,
  to: string,
  idConsultant?: string
): Promise<{
  totalCount: number
  rows: { categoria: string; durataMesi: number | null; count: number; totalEuro: number }[]
}> {
  const p = await getPool()
  if (!p) return { totalCount: 0, rows: [] }

  const tblM = defaultTables.movimentiVenduto
  const viewCfg = getViewVenditoreAbbonamento()
  const strict = (process.env.MOVIMENTI_AGG_STRICT ?? "true").toLowerCase() !== "false"
  try {
    const ids = idConsultant ? parseConsultantIds(idConsultant) : []
    if (!viewCfg) return { totalCount: 0, rows: [] }

    const req = p.request().input("from", sql.VarChar(10), from).input("to", sql.VarChar(10), to)
    ids.forEach((id, i) => req.input(`id${i}`, sql.Int, id))

    const whereBase = `
      WHERE M.[${COL_IMPORTO}] > 0
        AND CAST(M.[${COL_DATA}] AS DATE) >= CAST(@from AS DATE)
        AND CAST(M.[${COL_DATA}] AS DATE) <= CAST(@to AS DATE)
        AND M.[TipoOperazione] = '${movimentoTipoOperazioneVendita().replace(/'/g, "''")}'
    `

    // La view espone CategoriaAbbonamentoDescrizione / CategoriaDescrizione + Durata (tipicamente mesi).
    // Per evitare "categoria sconosciuta" usiamo INNER JOIN sulla view.
    const durataCol = "Durata"
    const categoriaExpr = "COALESCE(R.[CategoriaAbbonamentoDescrizione], R.[CategoriaDescrizione])"

    const consultantFilter =
      idConsultant && ids.length > 0
        ? ` AND R.[IDVenditoreAbbonamento] IN (${ids.map((_, i) => `@id${i}`).join(", ")})`
        : ""

    // Escludi categorie non commerciali (come prima): evita "Danza adulti" e simili.
    const upperCatAbbonExpr = "UPPER(COALESCE(R.[CategoriaAbbonamentoDescrizione], ''))"
    const upperCatExpr = "UPPER(COALESCE(R.[CategoriaDescrizione], ''))"
    const whereCategorieEscluse = `
      AND ${upperCatAbbonExpr} NOT LIKE '%DANZA%'
      AND ${upperCatExpr} NOT LIKE '%DANZA%'
      AND ${upperCatAbbonExpr} NOT LIKE '%CAMPUS%'
      AND ${upperCatExpr} NOT LIKE '%CAMPUS%'
      AND ${upperCatAbbonExpr} NOT LIKE '%ACQUATIC%'
      AND ${upperCatExpr} NOT LIKE '%ACQUATIC%'
      AND NOT (
        (${upperCatAbbonExpr} LIKE '%SCUOLA%' AND ${upperCatAbbonExpr} LIKE '%NUOT%')
        AND ${upperCatAbbonExpr} NOT LIKE '%ADULT%'
        AND ${upperCatAbbonExpr} NOT LIKE '%MASTER%'
      )
      AND NOT (
        (${upperCatExpr} LIKE '%SCUOLA%' AND ${upperCatExpr} LIKE '%NUOT%')
        AND ${upperCatExpr} NOT LIKE '%ADULT%'
        AND ${upperCatExpr} NOT LIKE '%MASTER%'
      )
    `

    // Distribuzione come report: una volta per iscrizione (Totale view), non per movimento.
    const rawTot = process.env.GESTIONALE_VIEW_COL_TOTALE?.trim()
    const colTotale = rawTot && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawTot) ? rawTot : "Totale"

    const rTotal = await req.query(
      `WITH ViewDedup AS (
         SELECT
           R0.[${viewCfg.colJoin}] AS IDIscrizione,
           MAX(R0.[CategoriaAbbonamentoDescrizione]) AS CategoriaAbbonamentoDescrizione,
           MAX(R0.[CategoriaDescrizione]) AS CategoriaDescrizione,
           MAX(R0.[${durataCol}]) AS Durata,
           MAX(R0.[${colTotale}]) AS Totale,
           MAX(R0.[${viewCfg.colId}]) AS IDVenditoreAbbonamento
         FROM [${viewCfg.view}] R0
         GROUP BY R0.[${viewCfg.colJoin}]
       ),
       Temp_Stampe AS (
         SELECT DISTINCT M.[${COL_ISCRIZIONE}] AS ID
         FROM [${tblM}] M
         ${whereBase}
       ),
       PerIscrizione AS (
         SELECT
           T.ID,
           ${categoriaExpr} AS Categoria,
           R.[${durataCol}] AS DurataMesi,
           MAX(TRY_CONVERT(float, R.[Totale])) AS TotaleEuro
         FROM Temp_Stampe T
         INNER JOIN ViewDedup R ON R.[IDIscrizione] = T.ID
         WHERE 1=1
           ${consultantFilter}
           ${whereEsclusioniVenditeView("R")}
           ${whereCategorieEscluse}
         GROUP BY T.ID, ${categoriaExpr}, R.[${durataCol}]
       )
       SELECT COUNT(*) AS totalCount FROM PerIscrizione;`
    )

    const r = await req.query(
      `WITH ViewDedup AS (
         SELECT
           R0.[${viewCfg.colJoin}] AS IDIscrizione,
           MAX(R0.[CategoriaAbbonamentoDescrizione]) AS CategoriaAbbonamentoDescrizione,
           MAX(R0.[CategoriaDescrizione]) AS CategoriaDescrizione,
           MAX(R0.[${durataCol}]) AS Durata,
           MAX(R0.[${colTotale}]) AS Totale,
           MAX(R0.[${viewCfg.colId}]) AS IDVenditoreAbbonamento
         FROM [${viewCfg.view}] R0
         GROUP BY R0.[${viewCfg.colJoin}]
       ),
       Temp_Stampe AS (
         SELECT DISTINCT M.[${COL_ISCRIZIONE}] AS ID
         FROM [${tblM}] M
         ${whereBase}
       ),
       PerIscrizione AS (
         SELECT
           T.ID,
           ${categoriaExpr} AS Categoria,
           R.[${durataCol}] AS DurataMesi,
           MAX(TRY_CONVERT(float, R.[Totale])) AS TotaleEuro
         FROM Temp_Stampe T
         INNER JOIN ViewDedup R ON R.[IDIscrizione] = T.ID
         WHERE 1=1
           ${consultantFilter}
           ${whereEsclusioniVenditeView("R")}
           ${whereCategorieEscluse}
         GROUP BY T.ID, ${categoriaExpr}, R.[${durataCol}]
       )
       SELECT
         Categoria,
         DurataMesi,
         COUNT(*) AS count,
         SUM(COALESCE(TotaleEuro, 0)) AS totalEuro
       FROM PerIscrizione
       GROUP BY Categoria, DurataMesi
       ORDER BY count DESC;`
    )

    const totalCount = Number(rTotal.recordset?.[0]?.totalCount ?? 0) || 0
    const rows = (r.recordset ?? []).map((row) => {
      const durataRaw = row.DurataMesi == null ? null : Number(row.DurataMesi)
      const durataMesi =
        durataRaw == null || Number.isNaN(durataRaw) || durataRaw === -1 ? null : durataRaw
      return {
        categoria: String(row.Categoria ?? "").toLowerCase().trim() || "palestra",
        durataMesi,
        count: Number(row.count ?? row.Count ?? 0) || 0,
        totalEuro: Number(row.totalEuro ?? row.totaleEuro ?? 0) || 0,
      }
    })

    return { totalCount, rows }
  } catch (e) {
    if (strict) throw e
    // Fallback: se il DB non ha Categoria/IDDurata con questi nomi, ritorniamo vuoto e usiamo mock lato UI.
    return { totalCount: 0, rows: [] }
  }
}

const ZERO_VENDITE_RANGE_VIEW = { ok: false as const, totaleEuro: 0 }

/**
 * Produzione € su intervallo [from,to]: **SUM(M.Importo)** movimenti join view venditore (stessa base di `queryVenditeSum`).
 */
export async function getVenditeTotaleRangeView(
  from: string,
  to: string,
  idConsultant?: string
): Promise<{ ok: true; totaleEuro: number } | typeof ZERO_VENDITE_RANGE_VIEW> {
  const p = await getPool()
  if (!p) return ZERO_VENDITE_RANGE_VIEW
  const viewCfg = getViewVenditoreAbbonamento()
  if (!viewCfg || !idConsultant) return ZERO_VENDITE_RANGE_VIEW
  const ids = parseConsultantIds(idConsultant)
  if (ids.length === 0) return ZERO_VENDITE_RANGE_VIEW
  try {
    const view = viewCfg.view
    const colId = viewCfg.colId
    const colJoin = viewCfg.colJoin
    const idParams = ids.map((_, i) => `@id${i}`).join(", ")
    const idWhereR = ids.length === 1 ? `R.[${colId}] = @id0` : `R.[${colId}] IN (${idParams})`
    const tblM = defaultTables.movimentiVenduto
    const matchCons = sqlMovimentoAttribuitoConsulente(view, colJoin, idWhereR, idParams)
    let req = p.request().input("from", sql.VarChar(10), from).input("to", sql.VarChar(10), to)
    ids.forEach((id, i) => {
      req = req.input(`id${i}`, sql.Int, id)
    })
    const r = await req.query(
      `SELECT COALESCE(SUM(M.[${COL_IMPORTO}]), 0) AS Totale
       FROM [${tblM}] M
       WHERE M.[${COL_IMPORTO}] > 0
         AND CAST(M.[${COL_DATA}] AS DATE) >= CAST(@from AS DATE)
         AND CAST(M.[${COL_DATA}] AS DATE) <= CAST(@to AS DATE)
         AND ${matchCons}`
    )
    const row = (r.recordset ?? [])[0] as Record<string, unknown> | undefined
    return { ok: true, totaleEuro: Number(row?.Totale ?? row?.totale) || 0 }
  } catch {
    return ZERO_VENDITE_RANGE_VIEW
  }
}

const ZERI_CONTEGGI_REPORT = { ok: false as const, clientiNuovi: 0, rinnovi: 0, invitoClienti: 0 }

/**
 * Conteggi report (nuovi / rinnovi / invito) allineati a «Andamento vendite»:
 * stesso join MovimentiVenduto → view venditore, data su movimento (Importo>0), stessi filtri tesseramenti ed esclusioni categoria.
 * Macro: NUOVI, GOLD ESTIVO, GOLD ESITVO, GOLD PREMIUM; RINNOVI; categoria abbonamento = INVITO.
 */
export async function getReportConteggiAndamento(
  from: string,
  to: string,
  idConsultant?: string
): Promise<{ ok: true; clientiNuovi: number; rinnovi: number; invitoClienti: number } | typeof ZERI_CONTEGGI_REPORT> {
  const p = await getPool()
  if (!p) return ZERI_CONTEGGI_REPORT

  const tblM = defaultTables.movimentiVenduto
  const viewCfg = getViewVenditoreAbbonamento()
  const strict = (process.env.MOVIMENTI_AGG_STRICT ?? "true").toLowerCase() !== "false"
  const colMacro = process.env.GESTIONALE_VIEW_COL_MACRO?.trim() ?? "MacroCategoriaAbbonamentoDescrizione"

  if (!viewCfg) return ZERI_CONTEGGI_REPORT

  try {
    const ids = idConsultant ? parseConsultantIds(idConsultant) : []
    const req = p.request().input("from", sql.VarChar(10), from).input("to", sql.VarChar(10), to)
    ids.forEach((id, i) => req.input(`id${i}`, sql.Int, id))

    const whereBase = `
      WHERE M.[${COL_IMPORTO}] > 0
        AND CAST(M.[${COL_DATA}] AS DATE) >= CAST(@from AS DATE)
        AND CAST(M.[${COL_DATA}] AS DATE) <= CAST(@to AS DATE)
    `

    const upperCatAbbonExpr = "UPPER(COALESCE(R.[CategoriaAbbonamentoDescrizione], ''))"
    const upperCatExpr = "UPPER(COALESCE(R.[CategoriaDescrizione], ''))"
    const upperMacroExpr = `UPPER(LTRIM(RTRIM(COALESCE(R.[${colMacro}], ''))))`

    const whereTesseramento = `
      AND COALESCE(R.[IDCategoriaUtente], -1) <> 19
      AND ${upperCatAbbonExpr} NOT LIKE '%TESSERAMENT%'
      AND NOT (${upperCatAbbonExpr} LIKE '%ASI%' AND ${upperCatAbbonExpr} LIKE '%ISCRIZIONE%')
      AND ${upperCatExpr} NOT LIKE '%TESSERAMENT%'
      AND NOT (${upperCatExpr} LIKE '%ASI%' AND ${upperCatExpr} LIKE '%ISCRIZIONE%')
      AND ${upperCatExpr} NOT LIKE '%VARIE%'
    `
    const whereCategorieEscluse = `
      AND ${upperCatAbbonExpr} NOT LIKE '%DANZA%'
      AND ${upperCatExpr} NOT LIKE '%DANZA%'
      AND ${upperCatAbbonExpr} NOT LIKE '%CAMPUS%'
      AND ${upperCatExpr} NOT LIKE '%CAMPUS%'
      AND ${upperCatAbbonExpr} NOT LIKE '%ACQUATIC%'
      AND ${upperCatExpr} NOT LIKE '%ACQUATIC%'
      -- "Scuola nuoto" di solito è bambini: escludiamo salvo casi esplicitamente adulti/master.
      AND NOT (
        (${upperCatAbbonExpr} LIKE '%SCUOLA%' AND ${upperCatAbbonExpr} LIKE '%NUOT%')
        AND ${upperCatAbbonExpr} NOT LIKE '%ADULT%'
        AND ${upperCatAbbonExpr} NOT LIKE '%MASTER%'
      )
      AND NOT (
        (${upperCatExpr} LIKE '%SCUOLA%' AND ${upperCatExpr} LIKE '%NUOT%')
        AND ${upperCatExpr} NOT LIKE '%ADULT%'
        AND ${upperCatExpr} NOT LIKE '%MASTER%'
      )
    `

    const consultantFilter =
      idConsultant && ids.length > 0
        ? ` AND R.[${viewCfg.colId}] IN (${ids.map((_, i) => `@id${i}`).join(", ")})`
        : ""

    const upperCategoriaInvito =
      "UPPER(LTRIM(RTRIM(COALESCE(R.[CategoriaAbbonamentoDescrizione], R.[CategoriaDescrizione], ''))))"

    const r = await req.query(
      `SELECT
        COUNT(DISTINCT CASE
          WHEN ${upperMacroExpr} IN (N'NUOVI', N'GOLD ESTIVO', N'GOLD ESITVO', N'GOLD PREMIUM')
          THEN M.[${COL_ISCRIZIONE}] END) AS clientiNuovi,
        COUNT(DISTINCT CASE
          WHEN ${upperMacroExpr} = N'RINNOVI'
          THEN M.[${COL_ISCRIZIONE}] END) AS rinnovi,
        COUNT(DISTINCT CASE
          WHEN ${upperCategoriaInvito} = N'INVITO' OR ${upperCategoriaInvito} LIKE N'INVITO %'
          THEN M.[${COL_ISCRIZIONE}] END) AS invitoClienti
      FROM [${tblM}] M
      INNER JOIN [${viewCfg.view}] R ON R.[${viewCfg.colJoin}] = M.[${COL_ISCRIZIONE}]
      ${whereBase}
      ${consultantFilter}
      ${whereTesseramento}
      ${whereCategorieEscluse}`
    )

    const row = (r.recordset ?? [])[0] as Record<string, unknown> | undefined
    return {
      ok: true,
      clientiNuovi: Number(row?.clientiNuovi ?? row?.ClientiNuovi ?? 0) || 0,
      rinnovi: Number(row?.rinnovi ?? row?.Rinnovi ?? 0) || 0,
      invitoClienti: Number(row?.invitoClienti ?? row?.InvitoClienti ?? 0) || 0,
    }
  } catch (e) {
    if (strict) throw e
    return ZERI_CONTEGGI_REPORT
  }
}

export function isGestionaleConfigured(): boolean {
  return !!getConnectionString()
}
