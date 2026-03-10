import sql from "mssql"
import type { LeadCreate } from "../types/lead.js"
import { store } from "../store/leads.js"

export interface SqlImportOptions {
  connectionString: string
  query: string
  mapping: Record<string, string>
}

export async function importFromSqlServer(options: SqlImportOptions): Promise<{
  imported: number
  errors: string[]
}> {
  const { connectionString, query, mapping } = options
  const errors: string[] = []
  let imported = 0

  let pool: sql.ConnectionPool
  try {
    pool = await sql.connect(connectionString)
  } catch (e) {
    return {
      imported: 0,
      errors: [`Connessione fallita: ${(e as Error).message}`],
    }
  }

  try {
    const result = await pool.request().query(query)

    if (!result.recordset || result.recordset.length === 0) {
      return { imported: 0, errors: [] }
    }

    const cols = Object.keys(result.recordset[0] as object)
    for (let i = 0; i < result.recordset.length; i++) {
      const row = result.recordset[i] as Record<string, unknown>
      try {
        const nome = String(row[mapping.nome ?? "nome"] ?? "").trim()
        const cognome = String(row[mapping.cognome ?? "cognome"] ?? "").trim()
        const email = String(row[mapping.email ?? "email"] ?? "").trim()
        const telefono = String(row[mapping.telefono ?? "telefono"] ?? "").trim()

        if (!email) {
          errors.push(`Riga ${i + 1}: email mancante`)
          continue
        }

        const create: LeadCreate = {
          nome: nome || "—",
          cognome: cognome || "—",
          email,
          telefono: telefono || "",
          fonte: "sql_server",
          fonteDettaglio: `Import da SQL (${cols.join(", ")})`,
        }
        store.create(create)
        imported++
      } catch (err) {
        errors.push(`Riga ${i + 1}: ${(err as Error).message}`)
      }
    }
  } finally {
    await pool.close()
  }

  return { imported, errors }
}
