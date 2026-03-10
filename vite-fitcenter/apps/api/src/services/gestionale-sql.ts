/**
 * Lettura dati dal gestionale (Microsoft SQL Server).
 * Configurare SQL_CONNECTION_STRING nel .env.
 * Nomi tabelle/viste configurabili con env (es. GESTIONALE_CLIENTI=Clienti).
 */

import sql from "mssql"

let pool: sql.ConnectionPool | null = null

function getConnectionString(): string | undefined {
  return process.env.SQL_CONNECTION_STRING
}

export async function getPool(): Promise<sql.ConnectionPool | null> {
  const cs = getConnectionString()
  if (!cs) return null
  if (pool) return pool
  try {
    pool = await sql.connect(cs)
    return pool
  } catch {
    return null
  }
}

const defaultTables = {
  clienti: process.env.GESTIONALE_TABLE_CLIENTI ?? "Clienti",
  abbonamenti: process.env.GESTIONALE_TABLE_ABBONAMENTI ?? "Abbonamenti",
  lead: process.env.GESTIONALE_TABLE_LEAD ?? "Lead",
  piani: process.env.GESTIONALE_TABLE_PIANI ?? "PianiAbbonamento",
  budget: process.env.GESTIONALE_TABLE_BUDGET ?? "BudgetMensile",
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

export async function queryLead(): Promise<Record<string, unknown>[]> {
  const p = await getPool()
  if (!p) return []
  try {
    const r = await p.request().query(
      `SELECT * FROM [${defaultTables.lead}] ORDER BY DataCreazione DESC`
    )
    return (r.recordset ?? []) as Record<string, unknown>[]
  } catch {
    return []
  }
}

export async function queryPiani(): Promise<Record<string, unknown>[]> {
  const p = await getPool()
  if (!p) return []
  try {
    const r = await p.request().query(`SELECT * FROM [${defaultTables.piani}]`)
    return (r.recordset ?? []) as Record<string, unknown>[]
  } catch {
    return []
  }
}

export async function queryBudget(): Promise<Record<string, unknown>[]> {
  const p = await getPool()
  if (!p) return []
  try {
    const r = await p.request().query(
      `SELECT * FROM [${defaultTables.budget}] ORDER BY Anno, Mese`
    )
    return (r.recordset ?? []) as Record<string, unknown>[]
  } catch {
    return []
  }
}

export function isGestionaleConfigured(): boolean {
  return !!getConnectionString()
}
