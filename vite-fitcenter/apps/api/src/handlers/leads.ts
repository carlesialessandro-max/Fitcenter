import { Request, Response } from "express"
import crypto from "crypto"
import { store } from "../store/leads.js"
import { importFromSqlServer } from "../services/sql-import.js"
import type { LeadSource, LeadStatus, LeadCreate, InteresseLead } from "../types/lead.js"
import { getScopedUser, getOperatoreConsulenteNome } from "../middleware/auth.js"

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
  const flatten = (root: unknown, maxDepth = 4): Record<string, string> => {
    const out: Record<string, string> = {}
    const visit = (v: unknown, path: string, depth: number) => {
      if (depth > maxDepth) return
      if (v == null) return
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        const s = String(v).trim()
        if (s) out[path] = s
        return
      }
      if (Array.isArray(v)) {
        v.slice(0, 50).forEach((item, i) => visit(item, `${path}[${i}]`, depth + 1))
        return
      }
      if (typeof v === "object") {
        const o = v as Record<string, unknown>
        // Pattern Zapier comune: { key/name/label: "...", value: "..." }
        const key = unwrap(o.key ?? o.name ?? o.label ?? "").trim()
        const val = unwrap(o.value ?? o.text ?? o.val ?? "").trim()
        if (key && val) out[key] = val
        for (const [k, vv] of Object.entries(o)) {
          visit(vv, path ? `${path}.${k}` : k, depth + 1)
        }
      }
    }
    visit(root, "", 0)
    return out
  }
  const flat = flatten(body)
  const pick = (keys: string[]): string => {
    for (const k of keys) {
      if (body[k] != null) {
        const s = unwrap(body[k]).trim()
        if (s) return s
      }
      // match su chiave "flat" (case-insensitive, tollera spazi)
      const target = k.toLowerCase().trim()
      for (const [fk, fv] of Object.entries(flat)) {
        if (fk.toLowerCase().trim() === target) return fv.trim()
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

  const parseFromLabeledText = (
    raw: string
  ): { nome?: string; cognome?: string; email?: string; telefono?: string; tipologia?: string; messaggio?: string; oggetto?: string } => {
    const s = String(raw ?? "").trim()
    if (!s) return {}
    const lines = s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (lines.length < 2) return {}
    const take = (label: string): string => {
      const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, "i")
      for (const ln of lines) {
        const m = re.exec(ln)
        if (m?.[1]) return m[1].trim()
      }
      return ""
    }
    const nomeFull = take("Nome")
    const tipologia = take("Tipologia") || take("Interesse")
    const email = take("Email")
    const telefono = take("Telefono") || take("Cellulare")
    const messaggio = take("Messaggio")
    const oggetto = take("Oggetto")
    let nome: string | undefined
    let cognome: string | undefined
    if (nomeFull) {
      const parts = nomeFull.split(/\s+/).filter(Boolean)
      nome = parts[0]
      cognome = parts.slice(1).join(" ") || undefined
    }
    return { nome, cognome, email, telefono, tipologia, messaggio, oggetto }
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
  const labeled = parseFromLabeledText(rawCandidate)

  let nome = nomePick || labeled.nome || parsed.nome || ""
  let cognome = cognomePick || labeled.cognome || parsed.cognome || ""
  const splitIfNeeded = () => {
    const n = nome.trim()
    const c = cognome.trim()
    if (c && c !== "—" && c.toLowerCase() !== n.toLowerCase()) return
    const parts = n.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      nome = parts[0]!
      cognome = parts.slice(1).join(" ")
    }
  }
  splitIfNeeded()
  const email = emailPick || labeled.email || parsed.email || ""
  const telefono = telefonoPick || labeled.telefono || parsed.telefono || ""
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
  const tipologiaRaw =
    pick([
      "tipologia",
      "Tipologia",
      "tipologiaRichiesta",
      "TipologiaRichiesta",
      "tipologia_di_richiesta",
      "Tipologia di richiesta",
      "requestType",
      "RequestType",
      "tipoRichiesta",
      "TipoRichiesta",
      "tipo",
      "Tipo",
    ]) || ""

  let interesseRaw =
    pick(["interesse", "Interesse", "interest", "Interest"]) ||
    (body.interesse != null ? unwrap(body.interesse) : "") ||
    labeled.tipologia ||
    tipologiaRaw
  if (!interesseRaw.trim()) {
    for (const [fk, fv] of Object.entries(flat)) {
      if (/interess|tipolog|scuola|nuoto|campus|bambin/i.test(fk)) {
        interesseRaw = fv.trim()
        break
      }
    }
  }
  if (!interesseRaw.trim()) {
    for (const fv of Object.values(flat)) {
      const v = fv.trim()
      if (/scuola\s*nuoto|nuoto\s*bambin|bambin|campus|festa\s+della\s+mamma/i.test(v)) {
        interesseRaw = v
        break
      }
    }
  }
  interesseRaw = interesseRaw.trim()
  const interesseNorm = interesseRaw.toLowerCase()
  const interesseValido =
    interesseRaw && VALID_INTERESSE.includes(interesseNorm as InteresseLead)
      ? (interesseNorm as InteresseLead)
      : undefined
  const interesseDettaglio = interesseRaw && !interesseValido ? interesseRaw : undefined

  const oggetto =
    pick(["oggetto", "Oggetto", "subject", "Subject", "titolo", "Titolo"]) ||
    pick(["Oggetto richiesta", "OggettoRichiesta"]) ||
    labeled.oggetto ||
    ""
  const messaggio =
    pick(["messaggio", "Messaggio", "message", "Message", "testo", "Testo", "body", "Body", "descrizione", "Descrizione"]) ||
    labeled.messaggio ||
    ""

  // Default: se arriva dal form sito (tipologia/oggetto/messaggio) e non è specificata fonte, consideriamolo "website".
  if (!fonteRaw && (tipologiaRaw || oggetto || messaggio)) fonte = "website"

  const noteParts: string[] = []
  if (tipologiaRaw) noteParts.push(`Tipologia: ${tipologiaRaw}`)
  if (oggetto) noteParts.push(`Oggetto: ${oggetto}`)
  if (messaggio) noteParts.push(messaggio)
  const note =
    (body.note != null ? String(body.note) : "") ||
    (noteParts.length ? noteParts.join("\n") : "")
  const noteOut = note.trim() ? note.trim() : undefined

  const categoriaRaw = (pick(["categoria", "Categoria", "canale", "Canale"]) || "").toLowerCase()
  const flatBlob = Object.entries(flat)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
    .toLowerCase()
  const blobCat = `${categoriaRaw} ${tipologiaRaw} ${interesseRaw} ${oggetto} ${messaggio} ${noteOut ?? ""} ${flatBlob}`.toLowerCase()
  const categoria =
    categoriaRaw === "bambini" ||
    /\b(bambin|campus|scuola\s*nuoto|nuoto\s*bambin|acquatic|festa\s+della\s+mamma)\b/i.test(blobCat)
      ? ("bambini" as const)
      : undefined
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
    note: noteOut,
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
      const isBambini =
        (leadPayload.categoria ?? "generale") === "bambini" ||
        /\b(bambin|campus|scuola\s*nuoto|nuoto\s*bambin)\b/i.test(
          `${leadPayload.interesseDettaglio ?? ""} ${leadPayload.note ?? ""} ${leadPayload.categoria ?? ""}`
        )
      if (isBambini) {
        const patched = store.update(lead.id, {
          consulenteNome: "Irene",
          consulenteId: "irene",
          categoria: "bambini",
        })
        created.push(patched ?? lead)
      } else {
        created.push(lead)
      }
    }
    res.status(201).json({ created: created.length, leads: created })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message, created: 0 })
  }
}

export async function updateLead(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim()
  if (!id) return res.status(400).json({ message: "id mancante" })
  const u = getScopedUser(req)
  const lead = store.get(id)
  if (!lead) return res.status(404).json({ message: "Lead non trovato" })

  // Admin: whitelist campi (inclusa riassegnazione consulente, es. errore Zapier).
  // Consulente: solo stato/interesse/note sui lead assegnati a lei.
  let payload: Record<string, unknown>
  if (u.role === "admin") {
    const body = (req.body ?? {}) as Record<string, unknown>
    const w: Record<string, unknown> = {}
    const keys = [
      "stato",
      "interesse",
      "interesseDettaglio",
      "note",
      "consulenteId",
      "consulenteNome",
      "categoria",
      "fonteDettaglio",
    ] as const
    for (const k of keys) {
      if (body[k] !== undefined) w[k] = body[k]
    }
    const cn = w.consulenteNome
    const cid = w.consulenteId
    if (cn === "" || cn === null) w.consulenteNome = undefined
    if (cid === "" || cid === null) w.consulenteId = undefined
    payload = w
  } else {
    const me = (getOperatoreConsulenteNome(req) ?? "").trim().toLowerCase()
    const assigned = String(lead.consulenteNome ?? "").trim().toLowerCase()
    if (!me) return res.status(403).json({ message: "Solo operatore può aggiornare un lead" })
    if (!assigned || assigned !== me) return res.status(403).json({ message: "Lead non assegnato a te" })

    const body = (req.body ?? {}) as Record<string, unknown>
    payload = {}
    if (body.stato != null) payload.stato = body.stato
    if (body.interesse != null) payload.interesse = body.interesse
    if (body.note != null) payload.note = body.note
  }

  const updated = store.update(id, payload as any)
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
