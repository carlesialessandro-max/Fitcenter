/**
 * Lettura dal gestionale (Microsoft SQL Server): solo anagrafici clienti e abbonamenti.
 * Configurare SQL_CONNECTION_STRING nel .env.
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
    if (isWindowsAuth(cs)) throw e
    return null
  }
}

const defaultTables = {
  clienti: process.env.GESTIONALE_TABLE_CLIENTI ?? "Clienti",
  abbonamenti: process.env.GESTIONALE_TABLE_ABBONAMENTI ?? "Abbonamenti",
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

export async function queryAbbonamenti(): Promise<Record<string, unknown>[]> {
  const p = await getPool()
  if (!p) return []
  try {
    const r = await p.request().query(
      `SELECT * FROM [${defaultTables.abbonamenti}] ORDER BY DataInizio DESC`
    )
    return (r.recordset ?? []) as Record<string, unknown>[]
  } catch {
    return []
  }
}

export function isGestionaleConfigured(): boolean {
  return !!getConnectionString()
}
