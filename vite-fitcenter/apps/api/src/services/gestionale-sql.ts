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

function isSafeSqlIdentifierLoose(s: string): boolean {
  // Permettiamo solo caratteri innocui per identificatori (schema.tabella, [dbo].[View], ecc.).
  // Niente apici, punti e virgola, commenti, spazi.
  return /^[A-Za-z0-9_\.\[\]]+$/.test(s)
}

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

function getPrenotazioniViewName(): string {
  // Default: vista corsi con righe prenotazioni (nome, prenotato il, note, orari).
  const raw = (process.env.GESTIONALE_VIEW_PRENOTAZIONI_UTENTI ?? "RVW_PrenotazioniUtentiAbbonamento").trim()
  if (!raw) return "RVW_PrenotazioniUtentiAbbonamento"
  // Evita injection via env.
  if (!isSafeSqlIdentifierLoose(raw)) return "RVW_PrenotazioniUtentiAbbonamento"
  return raw
}

async function resolvePrenotazioniViewName(): Promise<string> {
  const preferred = getPrenotazioniViewName()
  const candidates = [
    preferred,
    "RVW_PrenotazioniUtentiAbbonamento",
    "RVW_PrenotazioniUtenti",
    "RVW_PrenotazioniUtent",
    "SRVW_PrenotazioniUtenti",
  ]
    .map((s) => s.trim())
    .filter((s) => s && isSafeSqlIdentifierLoose(s))

  const p = await getPool()
  if (!p) return preferred

  for (const name of candidates) {
    try {
      // OBJECT_ID funziona con schema qualora passato (dbo.View) o [dbo].[View].
      const clean = name.replace(/[\[\]]/g, "")
      const r = await p.request().input("obj", sql.NVarChar, clean).query("SELECT OBJECT_ID(@obj) AS oid")
      const oid = r.recordset?.[0]?.oid
      if (oid != null) return name
    } catch {
      // ignore e prova prossimo
    }
  }
  return preferred
}

export async function getPrenotazioniViewNameResolved(): Promise<string> {
  return resolvePrenotazioniViewName()
}

export async function debugPrenotazioniViewInfo(): Promise<{ view: string; dateCol: string | null; cols: string[] }> {
  const view = await resolvePrenotazioniViewName()
  const cols = await prenGetCols(view)
  const dateCol = await pickBestDateColForView(view, [
    "InizioPrenotazioneIscrizione",
    "DataInizioPrenotazioneIscrizione",
    "PrenotazioniListaAttesaDataInizio",
    "DataFinePrenotazioneIscrizione",
    "DataOraInizio",
    "DataInizio",
    "DataLezione",
    "DataCorso",
    "DataAppuntamento",
    "DataOra",
    "Data",
  ])
  return { view, dateCol, cols }
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
  nome?: string
  cognome?: string
  telefono?: string
}

let crmColsCache: { view: string; cols: Set<string> } | null = null
async function crmHasCol(view: string, col: string): Promise<boolean> {
  const clean = view.replace(/[\[\]]/g, "")
  if (crmColsCache?.view === clean) return crmColsCache.cols.has(col.toLowerCase())
  try {
    const p = await getPool()
    if (!p) return false
    const r = await p.request().input("obj", sql.NVarChar, clean).query(
      `SELECT LOWER(c.name) AS name
       FROM sys.columns c
       WHERE c.object_id = OBJECT_ID(@obj);`
    )
    const cols = new Set<string>(((r.recordset ?? []) as any[]).map((x) => String(x.name ?? "").toLowerCase()).filter(Boolean))
    crmColsCache = { view: clean, cols }
    return cols.has(col.toLowerCase())
  } catch {
    return false
  }
}

let prenColsCache: { view: string; cols: Set<string> } | null = null
async function prenHasCol(view: string, col: string): Promise<boolean> {
  const clean = view.replace(/[\[\]]/g, "")
  if (prenColsCache?.view === clean) return prenColsCache.cols.has(col.toLowerCase())
  try {
    const p = await getPool()
    if (!p) return false
    const r = await p.request().input("obj", sql.NVarChar, clean).query(
      `SELECT LOWER(c.name) AS name
       FROM sys.columns c
       WHERE c.object_id = OBJECT_ID(@obj);`
    )
    const cols = new Set<string>(((r.recordset ?? []) as any[]).map((x) => String(x.name ?? "").toLowerCase()).filter(Boolean))
    prenColsCache = { view: clean, cols }
    return cols.has(col.toLowerCase())
  } catch {
    return false
  }
}

async function prenGetCols(view: string): Promise<string[]> {
  const clean = view.replace(/[\[\]]/g, "")
  if (prenColsCache?.view === clean) return Array.from(prenColsCache.cols.values())
  try {
    const p = await getPool()
    if (!p) return []
    const r = await p.request().input("obj", sql.NVarChar, clean).query(
      `SELECT LOWER(c.name) AS name
       FROM sys.columns c
       WHERE c.object_id = OBJECT_ID(@obj);`
    )
    const cols = new Set<string>(((r.recordset ?? []) as any[]).map((x) => String(x.name ?? "").toLowerCase()).filter(Boolean))
    prenColsCache = { view: clean, cols }
    return Array.from(cols.values())
  } catch {
    return []
  }
}

function pickBestDateCol(colsLower: string[], candidates: string[]): string | null {
  const set = new Set(colsLower)
  // 1) match esatto sui candidates
  for (const c of candidates) {
    if (set.has(c.toLowerCase())) return c
  }
  // 2) fallback: prima colonna che contiene "data" o "giorno"
  const fuzzy = colsLower.find((x) => x.includes("data") || x.includes("giorno"))
  return fuzzy ? fuzzy : null
}

function sqlDateEqualsExpr(col: string, param: string): string {
  // Supporta:
  // - datetime/date nativi: CAST(col AS DATE)
  // - varchar in formato ISO: 2026-04-09 (style 23)
  // - varchar in formato IT: 09/04/2026 (style 103)
  // - stringhe con testo + data (es. "giovedì 09/04/2026"): estraiamo la prima occorrenza dd/MM/yyyy
  const c = `[${col}]`
  const p = `CAST(${param} AS DATE)`
  return `
    COALESCE(
      TRY_CONVERT(date, ${c}),
      TRY_CONVERT(date, ${c}, 23),
      TRY_CONVERT(date, ${c}, 103),
      TRY_CONVERT(date, LEFT(${c}, 10), 23),
      TRY_CONVERT(date, LEFT(${c}, 10), 103),
      TRY_CONVERT(
        date,
        SUBSTRING(${c}, NULLIF(PATINDEX('%[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]%', ${c}), 0), 10),
        103
      )
    ) = ${p}
  `
}

function bracketCol(col: string): string {
  // col viene da sys.columns -> preveniamo edge-case con ]
  return `[${col.replace(/]/g, "]]")}]`
}

async function pickBestDateColForView(view: string, candidates: string[]): Promise<string | null> {
  const envForced = (process.env.GESTIONALE_PRENOTAZIONI_COL_DATA ?? "").trim()
  const cols = await prenGetCols(view) // lower-case
  const set = new Set(cols)
  if (envForced && set.has(envForced.toLowerCase())) return envForced

  const isBad = (c: string) => {
    const x = c.toLowerCase()
    if (x.includes("nascita") || x.includes("birth")) return true
    if (x.includes("dataprenot") || x.includes("prenotato")) return true
    if (x.includes("created") || x.includes("creato") || x.includes("creazione") || x.includes("datacreaz")) return true
    if (x.includes("modifica") || x.includes("modified") || x.includes("update") || x.includes("datamodif")) return true
    return false
  }
  const boost = (c: string) => {
    const x = c.toLowerCase()
    if (x.includes("dataorainizio") || x.includes("orainizio")) return 5
    if (x.includes("datainizio") || x.includes("inizio")) return 4
    if (x.includes("dataorafine") || x.includes("orafine") || x.includes("fine")) return 3
    if (x.includes("lezione") || x.includes("corso") || x.includes("appuntamento")) return 2
    if (x === "data" || x.startsWith("data")) return 1
    return 0
  }

  const existing = candidates
    .map((c) => c.trim())
    .filter(Boolean)
    .filter((c) => set.has(c.toLowerCase()))
    .filter((c) => !isBad(c))

  // Fallback fuzzy: includi colonne che contengono "data" o "ora"
  const fuzzy = cols.filter((c) => (c.includes("data") || c.includes("ora")) && !existing.includes(c) && !isBad(c))
  const toTry = [...new Set([...existing, ...fuzzy])]
    .sort((a, b) => boost(b) - boost(a))
    .slice(0, 12) // evita troppi roundtrip

  const p = await getPool()
  if (!p) return existing[0] ?? fuzzy[0] ?? null

  // Score: quante righe su TOP(50) sono convertibili a date?
  // Usiamo la stessa COALESCE di `sqlDateEqualsExpr` ma senza parametro.
  let best: { col: string; ok: number } | null = null
  for (const col of toTry) {
    try {
      const c = bracketCol(col)
      const r = await p.request().query(
        `SELECT TOP (1)
           SUM(CASE WHEN ${`
             COALESCE(
               TRY_CONVERT(date, ${c}),
               TRY_CONVERT(date, ${c}, 23),
               TRY_CONVERT(date, ${c}, 103),
               TRY_CONVERT(date, LEFT(${c}, 10), 23),
               TRY_CONVERT(date, LEFT(${c}, 10), 103),
               TRY_CONVERT(date, SUBSTRING(${c}, NULLIF(PATINDEX('%[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]%', ${c}), 0), 10), 103)
             )
           `} IS NOT NULL THEN 1 ELSE 0 END) AS ok
         FROM (SELECT TOP (50) ${c} AS v FROM [${view}] WHERE ${c} IS NOT NULL) t;`
      )
      const ok = Number(r.recordset?.[0]?.ok ?? 0) || 0
      if (!best || ok > best.ok) best = { col, ok }
    } catch {
      // ignore
    }
  }

  // Se nessuna colonna è convertibile, prova l'exact "data*" anche se score 0.
  if (!best || best.ok <= 0) {
    const prefer = cols.find((c) => c.startsWith("data") && !isBad(c))
    return prefer ?? existing[0] ?? null
  }
  return best.col
}

async function crmSelectExtraFragments(view: string): Promise<{ select: string; map: (row: Record<string, unknown>) => Partial<CrmAppuntamentoRow> }> {
  const hasNome = await crmHasCol(view, "Nome")
  const hasCognome = await crmHasCol(view, "Cognome")
  const hasTel = await crmHasCol(view, "Telefono")
  const hasCell = await crmHasCol(view, "Cellulare")
  const hasSms = await crmHasCol(view, "SMS")
  const selectParts: string[] = []
  if (hasNome) selectParts.push("Nome")
  if (hasCognome) selectParts.push("Cognome")
  if (hasTel) selectParts.push("Telefono")
  if (hasCell) selectParts.push("Cellulare")
  if (hasSms) selectParts.push("SMS")
  const select = selectParts.length ? ", " + selectParts.join(", ") : ""
  const map = (row: Record<string, unknown>) => ({
    nome: row.Nome != null ? String(row.Nome) : undefined,
    cognome: row.Cognome != null ? String(row.Cognome) : undefined,
    telefono: (row.SMS ?? row.Telefono ?? row.Cellulare) != null ? String(row.SMS ?? row.Telefono ?? row.Cellulare) : undefined,
  })
  return { select, map }
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

/** Appuntamenti CRM per operatore (range date). */
export async function queryCrmAppuntamentiOperatore(params: {
  nomeOperatore: string
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
}): Promise<CrmAppuntamentoRow[]> {
  const p = await getPool()
  if (!p) return []
  const view = getCrmUtentiViewName()
  try {
    const extra = await crmSelectExtraFragments(view)
    const req = p
      .request()
      .input("nomeOperatore", sql.NVarChar, params.nomeOperatore?.trim() ?? "")
      .input("from", sql.VarChar(10), params.from)
      .input("to", sql.VarChar(10), params.to)
    const r = await req.query(
      `SELECT DataAppuntamento, TipoDescrizione, EsitoDescrizione, CRMDescrizione${extra.select}
       FROM ${view}
       WHERE DestinatarioNomeOperatore = @nomeOperatore
         AND CAST(DataAppuntamento AS DATE) >= CAST(@from AS DATE)
         AND CAST(DataAppuntamento AS DATE) <= CAST(@to AS DATE)
       ORDER BY DataAppuntamento ASC`
    )
    const rows = (r.recordset ?? []) as Record<string, unknown>[]
    return rows.map((row) => ({
      dataAppuntamento: row.DataAppuntamento != null ? String(row.DataAppuntamento) : "",
      tipoDescrizione: row.TipoDescrizione != null ? String(row.TipoDescrizione) : "",
      esitoDescrizione: row.EsitoDescrizione != null ? String(row.EsitoDescrizione) : "",
      crmDescrizione: row.CRMDescrizione != null ? String(row.CRMDescrizione) : "",
      ...extra.map(row),
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
  // Regola richiesta: "DANZA ADULTI" è un falso positivo (altra azienda).
  // La escludiamo ovunque si usi la logica vendite/report (dashboard + andamento).
  const cat = `UPPER(LTRIM(RTRIM(COALESCE(${alias}.[CategoriaAbbonamentoDescrizione], ${alias}.[CategoriaDescrizione], ''))))`
  return `
    AND ${cat} <> 'DANZA ADULTI'
  `
}

function whereExcludeUispTesseramenti(alias = "R", categoriaExpr?: string): string {
  const cat = categoriaExpr
    ? `UPPER(LTRIM(RTRIM(COALESCE(${categoriaExpr}, ''))))`
    : `UPPER(LTRIM(RTRIM(COALESCE(${alias}.[CategoriaAbbonamentoDescrizione], ${alias}.[CategoriaDescrizione], ''))))`
  // Normalizza: molti DB salvano "U.I.S.P." o "U I S P" -> togliamo separatori comuni.
  const catNorm = `REPLACE(REPLACE(REPLACE(REPLACE(${cat}, '.', ''), ' ', ''), '-', ''), '_', '')`
  // Solo UISP tesseramenti: non devono influire sui conteggi.
  return `
    AND NOT (
      ${catNorm} LIKE '%UISP%'
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

    // Distribuzione come report: una volta per iscrizione (Totale view), non per movimento.
    const rawTot = process.env.GESTIONALE_VIEW_COL_TOTALE?.trim()
    const colTotale = rawTot && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawTot) ? rawTot : "Totale"
    const durataCol = "Durata"
    const categoriaExpr = "COALESCE(R.[CategoriaAbbonamentoDescrizione], R.[CategoriaDescrizione])"
    // Regola richiesta: "DANZA ADULTI" è un falso positivo (venditore rimasto da storico),
    // quindi lo escludiamo dall'andamento vendite.
    const whereCategoriaDanzaAdulti = `
      AND UPPER(LTRIM(RTRIM(COALESCE(${categoriaExpr}, '')))) <> 'DANZA ADULTI'
    `
    const consultantFilter =
      idConsultant && ids.length > 0
        ? ` AND R.[${viewCfg.colId}] IN (${ids.map((_, i) => `@id${i}`).join(", ")})`
        : ""

    const rTotal = await req.query(
      `;WITH Temp_Stampe AS (
         SELECT DISTINCT M.[${COL_ISCRIZIONE}] AS ID
         FROM [${tblM}] M
         ${whereBase}
       ),
       RigheView AS (
         SELECT
           R.[${viewCfg.colJoin}] AS ID,
           ${categoriaExpr} AS Categoria,
           R.[${durataCol}] AS DurataMesi,
           TRY_CONVERT(float, R.[${colTotale}]) AS TotaleEuro
         FROM [${viewCfg.view}] R
         INNER JOIN Temp_Stampe T ON T.ID = R.[${viewCfg.colJoin}]
         WHERE 1=1
           ${consultantFilter}
          ${whereCategoriaDanzaAdulti}
       ),
       PerIscrizione AS (
         SELECT
           ID,
           Categoria,
           DurataMesi,
           MAX(TotaleEuro) AS TotaleEuro
         FROM RigheView
         WHERE 1=1
           ${whereExcludeUispTesseramenti("RigheView", "RigheView.Categoria")}
         GROUP BY ID, Categoria, DurataMesi
       )
       SELECT COUNT(*) AS totalCount FROM PerIscrizione;`
    )

    const r = await req.query(
      `;WITH Temp_Stampe AS (
         SELECT DISTINCT M.[${COL_ISCRIZIONE}] AS ID
         FROM [${tblM}] M
         ${whereBase}
       ),
       RigheView AS (
         SELECT
           R.[${viewCfg.colJoin}] AS ID,
           ${categoriaExpr} AS Categoria,
           R.[${durataCol}] AS DurataMesi,
           TRY_CONVERT(float, R.[${colTotale}]) AS TotaleEuro
         FROM [${viewCfg.view}] R
         INNER JOIN Temp_Stampe T ON T.ID = R.[${viewCfg.colJoin}]
         WHERE 1=1
           ${consultantFilter}
          ${whereCategoriaDanzaAdulti}
       ),
       PerIscrizione AS (
         SELECT
           ID,
           Categoria,
           DurataMesi,
           MAX(TotaleEuro) AS TotaleEuro
         FROM RigheView
         WHERE 1=1
           ${whereExcludeUispTesseramenti("RigheView", "RigheView.Categoria")}
         GROUP BY ID, Categoria, DurataMesi
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

export type PrenotazioneCorsoRow = {
  giorno?: string
  servizio?: string
  oraInizio?: string
  oraFine?: string
  partecipanti?: number
  cognome?: string
  nome?: string
  prenotatoIl?: string
  note?: string
  // lasciamo anche le colonne originali, perché la vista può variare per DB
  raw: Record<string, unknown>
}

function firstNonEmpty(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw[k]
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return undefined
}

function toIsoTimeHHmm(val: unknown): string | undefined {
  if (val == null) return undefined
  // Alcune view usano "13.30" o "13:30" o datetime.
  if (typeof val === "string") {
    const t = val.trim()
    const m1 = /^(\d{1,2})[:\.](\d{2})/.exec(t)
    if (m1) return `${String(Number(m1[1])).padStart(2, "0")}:${m1[2]}`
    const d = new Date(t)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(11, 16)
    return undefined
  }
  if (val instanceof Date) return val.toISOString().slice(11, 16)
  const d = new Date(val as any)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(11, 16)
  return undefined
}

function toIsoDay(val: unknown): string | undefined {
  if (val == null) return undefined
  const d = val instanceof Date ? val : new Date(val as any)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

/**
 * Prenotazioni corsi (SRVW_PrenotazioniUtenti o vista configurata).
 * - Filtro opzionale per giorno: YYYY-MM-DD
 * - Numero partecipanti:
 *   - Se la vista espone già una colonna (NumeroPartecipanti/Partecipanti/Iscritti) la usiamo.
 *   - Altrimenti, se la vista è una riga-per-utente, calcoliamo COUNT(*) per gruppo tramite window function
 *     quando esistono colonne chiave per raggruppare.
 */
export async function queryPrenotazioniCorsi(params?: { giorno?: string }): Promise<PrenotazioneCorsoRow[]> {
  const p = await getPool()
  if (!p) return []
  const view = await resolvePrenotazioniViewName()
  const giorno = params?.giorno?.trim()

  const giornoOk = giorno ? /^\d{4}-\d{2}-\d{2}$/.test(giorno) : false
  const whereGiorno = giornoOk ? " WHERE CAST([Data] AS DATE) = CAST(@giorno AS DATE)" : ""

  // Scelta colonna data: NON usare "Giorno" se è testo (es. "martedì").
  // Preferiamo colonne data/ora reali e scegliamo quella convertibile.
  const dateCandidates = [
    // Prenotazioni corsi (gestionale): colonne viste in RVW_PrenotazioniUtentiAbbonamento
    "InizioPrenotazioneIscrizione",
    "DataInizioPrenotazioneIscrizione",
    "PrenotazioniListaAttesaDataInizio",
    "DataFinePrenotazioneIscrizione",
    "PrenotazioniIscrizioneOraInizio",
    "PrenotazioniIscrizioneOraFine",
    "DataOraInizio",
    "DataInizio",
    "DataLezione",
    "DataCorso",
    "DataAppuntamento",
    "DataOra",
    "Data",
  ]
  const dateCol = giornoOk ? await pickBestDateColForView(view, dateCandidates) : (await pickBestDateColForView(view, dateCandidates))
  // Se non troviamo la colonna data non possiamo filtrare in modo affidabile → evita query enorme.
  const where = giornoOk && dateCol ? ` WHERE ${sqlDateEqualsExpr(dateCol, "@giorno")}` : ""

  // Se esiste già una colonna partecipanti, la esponiamo.
  const partecipantiCols = ["NumeroPartecipanti", "Partecipanti", "NumeroIscritti", "Iscritti"]
  let partecipantiCol: string | null = null
  for (const c of partecipantiCols) {
    if (await prenHasCol(view, c)) {
      partecipantiCol = c
      break
    }
  }

  // Tentativo di raggruppamento: colonne tipiche per identificare "una lezione/corso".
  const groupCandidates: string[] = []
  const groupTry = ["IDCorso", "CorsoId", "IDAttivita", "IDLezione", "LezioneId", "IDAppuntamento", "AppuntamentoId", "IDSchedaCorso"]
  for (const c of groupTry) {
    if (await prenHasCol(view, c)) groupCandidates.push(c)
  }
  // Se non abbiamo chiavi, proviamo a raggruppare per (nome corso + data/ora) se presenti.
  const nameTry = ["Corso", "NomeCorso", "CorsoDescrizione", "Attivita", "DescrizioneCorso"]
  for (const c of nameTry) {
    if (await prenHasCol(view, c)) groupCandidates.push(c)
  }
  if (dateCol) groupCandidates.push(dateCol)

  // De-dup dei group cols mantenendo ordine.
  const groupCols = [...new Set(groupCandidates)]

  const req = p.request()
  if (giornoOk && dateCol) req.input("giorno", sql.VarChar(32), giorno)

  const enrich = (raw: Record<string, unknown>, partecipanti?: number): PrenotazioneCorsoRow => {
    const servizio = firstNonEmpty(raw, [
      "Servizio",
      "ServizioDescrizione",
      "TipoServizio",
      "Attivita",
      "Corso",
      "NomeCorso",
      "CorsoDescrizione",
      "DescrizioneCorso",
    ])
    const oraInizio = toIsoTimeHHmm(
      firstNonEmpty(raw, [
        "OraInizio",
        "OraIn",
        "OrarioInizio",
        "PrenotazioniIscrizioneOraInizio",
        "DataOraInizio",
        "InizioPrenotazioneIscrizione",
        "DataInizioPrenotazioneIscrizione",
        "DataInizio",
        "Inizio",
        "Ora",
      ])
    )
    const oraFine = toIsoTimeHHmm(
      firstNonEmpty(raw, [
        "OraFine",
        "OraFin",
        "OrarioFine",
        "PrenotazioniIscrizioneOraFine",
        "DataOraFine",
        "DataFinePrenotazioneIscrizione",
        "DataFine",
        "Fine",
      ])
    )
    const day = toIsoDay(dateCol ? raw[dateCol] : raw.Data)
    const cognome = firstNonEmpty(raw, ["Cognome", "CognomeUtente", "CognomeCliente", "ClienteCognome"])
    const nome = firstNonEmpty(raw, ["Nome", "NomeUtente", "NomeCliente", "ClienteNome"])
    const prenotatoIlRaw = firstNonEmpty(raw, ["PrenotatoIl", "DataPrenotazione", "DataPrenotato", "PrenotazioneData", "CreatoIl", "CreatedAt"])
    const prenotatoIl = prenotatoIlRaw
      ? (() => {
          const d = new Date(prenotatoIlRaw)
          return Number.isNaN(d.getTime()) ? prenotatoIlRaw : d.toISOString()
        })()
      : undefined
    const note = firstNonEmpty(raw, ["Note", "Nota", "PrenotazioneNote"])
    return { giorno: day, servizio, oraInizio, oraFine, partecipanti, cognome, nome, prenotatoIl, note, raw }
  }

  try {
    // Caso 1: la vista fornisce già partecipanti → SELECT * + normalizzazione giorno + partecipanti.
    if (partecipantiCol) {
      if (giornoOk && !dateCol) return []
      const r = await req.query(`SELECT * FROM [${view}]${where} ORDER BY 1`)
      const rows = (r.recordset ?? []) as Record<string, unknown>[]
      return rows.map((raw) => {
        const n = Number(raw[partecipantiCol!] ?? raw.NumeroPartecipanti ?? raw.Partecipanti ?? raw.NumeroIscritti ?? raw.Iscritti)
        return enrich(raw, Number.isFinite(n) ? n : undefined)
      })
    }

    // Caso 2: calcoliamo partecipanti con window function se abbiamo almeno 2 colonne per partizionare (es. idCorso + data).
    if (groupCols.length >= 2) {
      if (giornoOk && !dateCol) return []
      const partition = groupCols.map((c) => `[${c}]`).join(", ")
      const dSelect = dateCol ? `[${dateCol}] AS __Data` : "NULL AS __Data"
      const q = `
        SELECT
          *,
          ${dSelect},
          COUNT(1) OVER (PARTITION BY ${partition}) AS __Partecipanti
        FROM [${view}]
        ${where}
      `
      const r = await req.query(q)
      const rows = (r.recordset ?? []) as Record<string, unknown>[]
      return rows.map((raw) => {
        const n = Number(raw.__Partecipanti)
        const { __Data, __Partecipanti, ...clean } = raw as any
        return enrich(clean as Record<string, unknown>, Number.isFinite(n) ? n : undefined)
      })
    }

    // Caso 3: fallback: nessun conteggio possibile → ritorna righe raw.
    if (giornoOk && !dateCol) return []
    const r = await req.query(`SELECT * FROM [${view}]${where} ORDER BY 1`)
    const rows = (r.recordset ?? []) as Record<string, unknown>[]
    return rows.map((raw) => enrich(raw))
  } catch {
    // Se la vista non esiste o colonne diverse, fallback a vuoto (come le altre query "flessibili").
    return []
  }
}
