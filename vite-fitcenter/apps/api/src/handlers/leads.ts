import { Request, Response } from "express"
import { store } from "../store/leads.js"
import { importFromSqlServer } from "../services/sql-import.js"
import type { LeadSource, LeadStatus, LeadCreate, InteresseLead } from "../types/lead.js"

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
  const lead = store.get(String(req.params.id))
  if (!lead) return res.status(404).json({ message: "Lead non trovato" })
  res.json(lead)
}

export async function createLead(req: Request, res: Response) {
  const created = store.create(req.body)
  res.status(201).json(created)
}

/** Fonti ammesse dal webhook Zapier: campagna FB, Google Ads, sito, o generico zapier. */
const VALID_FONTE_ZAPIER: LeadSource[] = ["facebook", "google", "website", "zapier"]
const VALID_INTERESSE: InteresseLead[] = ["palestra", "piscina", "spa", "corsi", "full_premium"]

/** Webhook Zapier: nome, cognome, email, telefono; opzionale fonte (facebook|google|website|zapier) per CRM vendita. */
function normalizeZapierBody(body: Record<string, unknown>): LeadCreate {
  const nome = String(body.nome ?? body.first_name ?? body.name ?? "").trim()
  const cognome = String(body.cognome ?? body.last_name ?? body.surname ?? "").trim()
  const email = String(body.email ?? "").trim()
  const telefono = String(body.telefono ?? body.phone ?? body.cellulare ?? "").trim()
  let fonte: LeadSource = "zapier"
  const fonteRaw = String(body.fonte ?? body.source ?? body.campaign_source ?? body.origin ?? "").trim().toLowerCase()
  if (fonteRaw && VALID_FONTE_ZAPIER.includes(fonteRaw as LeadSource)) fonte = fonteRaw as LeadSource
  let interesse = body.interesse as string | undefined
  if (interesse && !VALID_INTERESSE.includes(interesse as InteresseLead)) interesse = undefined
  const note = body.note != null ? String(body.note) : undefined
  return {
    nome: nome || "—",
    cognome: cognome || "—",
    email: email || "—",
    telefono: telefono || "—",
    fonte,
    fonteDettaglio: body.fonte_dettaglio != null ? String(body.fonte_dettaglio) : undefined,
    interesse: interesse as InteresseLead | undefined,
    note,
  }
}

export async function webhookZapier(req: Request, res: Response) {
  if (req.method === "GET") {
    return res.status(200).json({
      message: "Webhook Zapier: invia una richiesta POST con body JSON per creare lead.",
      example: { nome: "Mario", cognome: "Rossi", email: "mario@example.com", telefono: "3331234567", fonte: "website" },
    })
  }
  try {
    const body = req.body as Record<string, unknown>
    const items = Array.isArray(body) ? body : body.data ? (body.data as Record<string, unknown>[]) : [body]
    if (items.length === 0) {
      return res.status(400).json({ message: "Nessun lead da creare", created: 0 })
    }
    const created: unknown[] = []
    for (const item of items) {
      const payload = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
      const leadPayload = normalizeZapierBody(payload)
      const lead = store.create(leadPayload)
      created.push(lead)
    }
    res.status(201).json({ created: created.length, leads: created })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message, created: 0 })
  }
}

export async function updateLead(req: Request, res: Response) {
  const updated = store.update(String(req.params.id), req.body)
  if (!updated) return res.status(404).json({ message: "Lead non trovato" })
  res.json(updated)
}

export async function deleteLead(req: Request, res: Response) {
  const ok = store.delete(String(req.params.id))
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
