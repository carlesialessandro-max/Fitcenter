import { Request, Response } from "express"
import crypto from "crypto"
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
  // Zapier/FB Lead Ads spesso usano chiavi diverse (camelCase, PascalCase, nested, ecc.)
  const unwrap = (v: unknown): string => {
    if (v == null) return ""
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v)
    if (typeof v === "object") {
      const o = v as Record<string, unknown>
      if (o.value != null) return unwrap(o.value)
      if (o.text != null) return unwrap(o.text)
    }
    return ""
  }
  const pick = (keys: string[]): string => {
    for (const k of keys) {
      if (body[k] != null) {
        const s = unwrap(body[k]).trim()
        if (s) return s
      }
    }
    return ""
  }

  const parseFromRawString = (raw: string): { nome?: string; cognome?: string; email?: string; telefono?: string } => {
    const s = String(raw ?? "").trim()
    if (!s || !s.includes(",")) return {}
    const emailMatch = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    const phoneMatch = s.match(/\+?\d{8,15}/)
    const email = emailMatch?.[0]?.trim()
    const telefono = phoneMatch?.[0]?.trim()
    const parts = s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
    const nome = parts[0]
    const cognome = parts[1]
    return { nome, cognome, email, telefono }
  }

  const nomePick = pick(["nome", "Nome", "first_name", "firstName", "FirstName", "name", "Name", "given_name", "givenName"])
  const cognomePick = pick(["cognome", "Cognome", "last_name", "lastName", "LastName", "surname", "Surname", "family_name", "familyName"])
  const emailPick = pick(["email", "Email", "e_mail", "mail", "Mail", "email_address", "emailAddress"])
  const telefonoPick = pick(["telefono", "Telefono", "phone", "Phone", "cellulare", "Cellulare", "mobile", "Mobile", "phone_number", "phoneNumber"])

  // Google Ads / form esterni: spesso mandano un'unica stringa tipo "Ilaria,Ciardi,mail,+39..."
  const rawCandidate =
    (nomePick && nomePick.includes(",") ? nomePick : "") ||
    pick(["raw", "Raw", "lead", "Lead", "contatto", "Contatto", "payload", "Payload", "message", "Message", "text", "Text"])
  const parsed = parseFromRawString(rawCandidate)

  const nome = nomePick || parsed.nome || ""
  const cognome = cognomePick || parsed.cognome || ""
  const email = emailPick || parsed.email || ""
  const telefono = telefonoPick || parsed.telefono || ""
  let fonte: LeadSource = "zapier"
  let fonteRaw = pick(["fonte", "Fonte", "source", "Source", "campaign_source", "origin"]).trim().toLowerCase()
  if (fonteRaw === "sito web" || fonteRaw === "sito") fonteRaw = "website"
  // Zapier / Facebook Lead Ads spesso mandano stringhe tipo "Facebook Leads Ads" o "Meta/Facebook".
  if (fonteRaw && !VALID_FONTE_ZAPIER.includes(fonteRaw as LeadSource)) {
    const blob = fonteRaw.replace(/\s+/g, " ").trim()
    if (blob.includes("facebook") || blob.includes("meta") || blob.includes("lead ads") || blob.includes("leads ads")) fonteRaw = "facebook"
    else if (blob.includes("google")) fonteRaw = "google"
    else if (blob.includes("website") || blob.includes("sito")) fonteRaw = "website"
  }
  if (fonteRaw && VALID_FONTE_ZAPIER.includes(fonteRaw as LeadSource)) fonte = fonteRaw as LeadSource
  const interesseRaw = pick(["interesse", "Interesse", "interest"]) || (body.interesse != null ? unwrap(body.interesse) : "")
  const interesseValido = interesseRaw && VALID_INTERESSE.includes(interesseRaw as InteresseLead) ? (interesseRaw as InteresseLead) : undefined
  const interesseDettaglio = interesseRaw && !interesseValido ? interesseRaw.trim() : undefined
  const note = body.note != null ? String(body.note) : undefined
  const categoriaRaw = pick(["categoria", "Categoria", "tipo", "Tipo", "canale"])?.toLowerCase()
  const categoria = categoriaRaw === "bambini" ? ("bambini" as const) : undefined
  return {
    nome: nome || "—",
    cognome: cognome || "—",
    email: email || "—",
    telefono: telefono || "—",
    fonte,
    fonteDettaglio: body.fonte_dettaglio != null ? String(body.fonte_dettaglio) : (body["fonteDettaglio"] != null ? String(body["fonteDettaglio"]) : undefined),
    interesse: interesseValido,
    interesseDettaglio: interesseDettaglio || undefined,
    categoria,
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

  // Firma HMAC opzionale (consigliata): header X-Zapier-Signature = sha256 hex del raw body.
  // Serve per mitigare leakage del token o replay semplici.
  const hmacSecret = (process.env.ZAPIER_WEBHOOK_HMAC_SECRET ?? "").trim()
  if (hmacSecret) {
    const provided = String(req.get("x-zapier-signature") ?? "").trim().toLowerCase()
    const raw = (req as any).rawBody as Buffer | undefined
    if (!provided || !raw || raw.length === 0) {
      return res.status(401).json({ message: "Unauthorized" })
    }
    const expectedSig = crypto.createHmac("sha256", hmacSecret).update(raw).digest("hex")
    try {
      const a = Buffer.from(provided, "hex")
      const b = Buffer.from(expectedSig, "hex")
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ message: "Unauthorized" })
      }
    } catch {
      return res.status(401).json({ message: "Unauthorized" })
    }
  }

  const expected = (process.env.ZAPIER_WEBHOOK_TOKEN ?? "").trim()
  if (expected) {
    const provided =
      String(req.query?.token ?? "").trim() ||
      String(req.get("x-zapier-token") ?? "").trim() ||
      String(req.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
    if (!provided || provided !== expected) {
      return res.status(401).json({ message: "Unauthorized" })
    }
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
