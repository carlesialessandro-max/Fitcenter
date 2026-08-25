import crypto from "crypto"
import path from "path"
import { fileURLToPath } from "url"
import type { Request, Response } from "express"
import { whatsappEventsStore } from "../store/whatsapp-events.js"
import {
  isWhatsappSendConfigured,
  leadWelcomeTemplateConfig,
  sendWhatsappTemplate,
  sendWhatsappText,
  whatsappConfig,
} from "../services/whatsapp.js"
import { store as leadsStore } from "../store/leads.js"

function resolveWhatsappDataDirHint(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(__dirname, "../../data")
}

function hubQuery(req: Request, key: string): string {
  const v = req.query[key]
  return typeof v === "string" ? v : Array.isArray(v) ? String(v[0] ?? "") : ""
}

/** Meta GET challenge: hub.mode, hub.verify_token, hub.challenge */
export function whatsappWebhookVerify(req: Request, res: Response) {
  const mode = hubQuery(req, "hub.mode")
  const token = hubQuery(req, "hub.verify_token")
  const challenge = hubQuery(req, "hub.challenge")
  const expected = whatsappConfig().verifyToken

  if (!expected) {
    return res.status(500).send("WHATSAPP_VERIFY_TOKEN non configurato sul server")
  }
  if (mode === "subscribe" && token === expected && challenge) {
    return res.status(200).type("text/plain").send(challenge)
  }
  return res.status(403).send("Forbidden")
}

function verifyMetaSignature(req: Request): boolean {
  const secret = whatsappConfig().appSecret
  if (!secret) return true // opzionale in MVP
  const sig = String(req.headers["x-hub-signature-256"] ?? "")
  if (!sig.startsWith("sha256=")) return false
  const raw: Buffer = (req as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex")
  const got = sig.slice("sha256=".length)
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"))
  } catch {
    return false
  }
}

type WaChangeValue = {
  messages?: Array<{
    from?: string
    id?: string
    timestamp?: string
    type?: string
    text?: { body?: string }
  }>
  statuses?: Array<{
    id?: string
    status?: string
    timestamp?: string
    recipient_id?: string
  }>
  metadata?: { display_phone_number?: string; phone_number_id?: string }
}

function ingestChangeValue(value: WaChangeValue, rawChange: unknown) {
  const displayTo = value.metadata?.display_phone_number
  let stored = 0

  for (const msg of value.messages ?? []) {
    const text =
      msg.type === "text"
        ? msg.text?.body
        : msg.type
          ? `[${msg.type}]`
          : undefined
    whatsappEventsStore.append({
      kind: "message_in",
      from: msg.from,
      to: displayTo,
      waMessageId: msg.id,
      text,
      raw: msg,
    })
    stored++
  }

  for (const st of value.statuses ?? []) {
    whatsappEventsStore.append({
      kind: "status",
      to: st.recipient_id,
      waMessageId: st.id,
      status: st.status,
      raw: st,
    })
    stored++
  }

  if (stored === 0) {
    whatsappEventsStore.append({ kind: "other", raw: rawChange })
  }
}

function ingestPayload(body: unknown) {
  const root = body as {
    object?: string
    entry?: Array<{ changes?: Array<{ field?: string; value?: WaChangeValue }> }>
    field?: string
    value?: WaChangeValue
  }

  // Formato produzione Meta: { object, entry: [ { changes: [ { field, value } ] } ] }
  const entries = Array.isArray(root?.entry) ? root.entry : []
  let handled = false
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const ch of changes) {
      ingestChangeValue(ch?.value ?? {}, ch)
      handled = true
    }
  }

  // Formato test dashboard Meta: { field: "messages", value: { ... } }
  if (!handled && root?.value && typeof root.value === "object") {
    ingestChangeValue(root.value, root)
    handled = true
  }

  if (!handled && body != null) {
    whatsappEventsStore.append({ kind: "other", raw: body })
  }
}

/** Meta POST eventi (messages / statuses). Rispondere 200 subito. */
export function whatsappWebhookReceive(req: Request, res: Response) {
  // Se APP_SECRET è impostato ma manca la firma (es. test dashboard), non bloccare in MVP.
  const hasSig = Boolean(String(req.headers["x-hub-signature-256"] ?? "").trim())
  if (hasSig && !verifyMetaSignature(req)) {
    return res.status(401).json({ message: "Firma webhook non valida" })
  }
  try {
    ingestPayload(req.body)
    console.log("[whatsapp webhook] evento ricevuto")
  } catch (e) {
    console.error("[whatsapp webhook]", (e as Error)?.message ?? e)
  }
  // Sempre 200 per evitare retry aggressivi su errori di parsing
  return res.status(200).json({ ok: true })
}

export function whatsappStatus(_req: Request, res: Response) {
  const c = whatsappConfig()
  res.json({
    verifyTokenConfigured: Boolean(c.verifyToken),
    sendConfigured: isWhatsappSendConfigured(),
    phoneNumberId: c.phoneNumberId ? `${c.phoneNumberId.slice(0, 4)}…` : null,
    wabaId: c.wabaId || null,
    appSecretConfigured: Boolean(c.appSecret),
    webhookPath: "/api/webhook/whatsapp",
    dataDirHint: resolveWhatsappDataDirHint(),
    eventsFile: "whatsapp-events.json",
    recentEvents: whatsappEventsStore.list(20).map((e) => ({
      id: e.id,
      kind: e.kind,
      at: e.at,
      from: e.from,
      text: e.text,
      status: e.status,
      waMessageId: e.waMessageId,
    })),
  })
}

export async function whatsappSendTest(req: Request, res: Response) {
  try {
    if (!isWhatsappSendConfigured()) {
      return res.status(400).json({
        message: "Imposta WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID in apps/api/.env",
      })
    }
    const body = (req.body ?? {}) as {
      to?: string
      text?: string
      templateName?: string
      languageCode?: string
      bodyParams?: string[]
    }
    const to = String(body.to ?? "").trim()
    if (!to) return res.status(400).json({ message: "Campo to obbligatorio" })

    if (body.templateName?.trim()) {
      const result = await sendWhatsappTemplate({
        toRaw: to,
        templateName: body.templateName.trim(),
        languageCode: body.languageCode,
        bodyParams: body.bodyParams,
      })
      return res.json({ ok: true, result })
    }

    const text = String(body.text ?? "").trim()
    if (!text) {
      return res.status(400).json({
        message: "Fornisci text (finestra 24h) oppure templateName",
      })
    }
    const result = await sendWhatsappText(to, text)
    return res.json({ ok: true, result })
  } catch (e) {
    return res.status(502).json({ message: (e as Error)?.message ?? String(e) })
  }
}

/** Invia template benvenuto (o custom) al telefono di un lead CRM. */
export async function whatsappSendLead(req: Request, res: Response) {
  try {
    if (!isWhatsappSendConfigured()) {
      return res.status(400).json({
        message: "Imposta WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID in apps/api/.env",
      })
    }
    const body = (req.body ?? {}) as {
      leadId?: string
      to?: string
      nome?: string
      templateName?: string
      languageCode?: string
      bodyParams?: string[]
    }
    let to = String(body.to ?? "").trim()
    let nome = String(body.nome ?? "").trim()
    const leadId = String(body.leadId ?? "").trim()
    if (leadId) {
      const lead = leadsStore.get(leadId)
      if (!lead) return res.status(404).json({ message: "Lead non trovato" })
      to = to || lead.telefono
      nome = nome || lead.nome
    }
    if (!to) return res.status(400).json({ message: "Telefono o leadId obbligatorio" })

    const cfg = leadWelcomeTemplateConfig()
    const templateName = (body.templateName ?? cfg.templateName).trim()
    const languageCode = (body.languageCode ?? cfg.languageCode).trim()
    const hasNameParam =
      body.bodyParams != null
        ? Array.isArray(body.bodyParams) && body.bodyParams.length > 0
        : (process.env.WHATSAPP_LEAD_TEMPLATE_HAS_NAME ?? "").trim().toLowerCase() === "true"
    const result = await sendWhatsappTemplate({
      toRaw: to,
      templateName,
      languageCode,
      ...(hasNameParam ? { bodyParams: body.bodyParams ?? [nome || "Ciao"] } : {}),
    })
    return res.json({ ok: true, templateName, languageCode, result })
  } catch (e) {
    return res.status(502).json({ message: (e as Error)?.message ?? String(e) })
  }
}
