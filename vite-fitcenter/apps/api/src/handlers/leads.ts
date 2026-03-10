import { Request, Response } from "express"
import { store } from "../store/leads.js"
import { importFromSqlServer } from "../services/sql-import.js"
import type { LeadSource, LeadStatus } from "../types/lead.js"

export async function listLeads(req: Request, res: Response) {
  try {
    const { fonte, stato, consulenteId, search } = req.query
    const list = store.list({
      fonte: fonte as LeadSource | undefined,
      stato: stato as LeadStatus | undefined,
      consulenteId: consulenteId as string | undefined,
      search: search as string | undefined,
    })
    res.json(list)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getLead(req: Request, res: Response) {
  const lead = store.get(req.params.id)
  if (!lead) return res.status(404).json({ message: "Lead non trovato" })
  res.json(lead)
}

export async function createLead(req: Request, res: Response) {
  const created = store.create(req.body)
  res.status(201).json(created)
}

export async function updateLead(req: Request, res: Response) {
  const updated = store.update(req.params.id, req.body)
  if (!updated) return res.status(404).json({ message: "Lead non trovato" })
  res.json(updated)
}

export async function deleteLead(req: Request, res: Response) {
  const ok = store.delete(req.params.id)
  if (!ok) return res.status(404).json({ message: "Lead non trovato" })
  res.status(204).send()
}

export async function importFromSql(req: Request, res: Response) {
  try {
    const { connectionString, query, mapping } = req.body as {
      connectionString: string
      query: string
      mapping: Record<string, string>
    }
    if (!connectionString || !query) {
      return res.status(400).json({
        message: "connectionString e query sono obbligatori",
        imported: 0,
        errors: [],
      })
    }
    const result = await importFromSqlServer({
      connectionString,
      query,
      mapping: mapping ?? {
        nome: "nome",
        cognome: "cognome",
        email: "email",
        telefono: "telefono",
      },
    })
    res.json(result)
  } catch (e) {
    res.status(500).json({
      imported: 0,
      errors: [(e as Error).message],
    })
  }
}
