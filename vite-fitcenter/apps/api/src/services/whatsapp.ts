/**
 * Client WhatsApp Cloud API (Meta Graph).
 * Invio messaggi; webhook gestito in handlers/whatsapp.ts
 */
import { whatsappEventsStore } from "../store/whatsapp-events.js"

const GRAPH_VERSION = (process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0").trim() || "v21.0"

export function whatsappConfig() {
  const token = (process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim()
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim()
  const verifyToken = (process.env.WHATSAPP_VERIFY_TOKEN ?? "").trim()
  const appSecret = (process.env.WHATSAPP_APP_SECRET ?? "").trim()
  const wabaId = (process.env.WHATSAPP_WABA_ID ?? "").trim()
  return { token, phoneNumberId, verifyToken, appSecret, wabaId, graphVersion: GRAPH_VERSION }
}

export function isWhatsappSendConfigured(): boolean {
  const c = whatsappConfig()
  return Boolean(c.token && c.phoneNumberId)
}

/** Solo cifre, con prefisso paese (es. 393391234567). */
export function normalizeWaTo(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "")
  if (!digits) return null
  if (digits.startsWith("39") && digits.length >= 11) return digits
  if (digits.startsWith("0") && digits.length >= 9) return `39${digits.slice(1)}`
  if (digits.length === 10 && digits.startsWith("3")) return `39${digits}`
  if (digits.length >= 10) return digits
  return null
}

async function graphPost(pathSuffix: string, body: Record<string, unknown>): Promise<unknown> {
  const { token, phoneNumberId, graphVersion } = whatsappConfig()
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp non configurato: imposta WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID")
  }
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/${pathSuffix}`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined
    throw new Error(err?.message ?? `WhatsApp API HTTP ${res.status}`)
  }
  return json
}

export async function sendWhatsappText(toRaw: string, text: string): Promise<unknown> {
  const to = normalizeWaTo(toRaw)
  if (!to) throw new Error("Numero destinatario non valido")
  const body = text.trim()
  if (!body) throw new Error("Testo messaggio vuoto")
  try {
    const result = await graphPost("messages", {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body },
    })
    const waMessageId = String(
      (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? ""
    ).trim() || undefined
    whatsappEventsStore.append({
      kind: "message_out",
      to,
      text: body,
      waMessageId,
      status: "sent",
      raw: result,
    })
    return result
  } catch (e) {
    whatsappEventsStore.append({
      kind: "message_out",
      to,
      text: body,
      status: "error",
      raw: { error: (e as Error)?.message ?? String(e) },
    })
    throw e
  }
}

export async function sendWhatsappTemplate(params: {
  toRaw: string
  templateName: string
  languageCode?: string
  bodyParams?: string[]
}): Promise<unknown> {
  const to = normalizeWaTo(params.toRaw)
  if (!to) throw new Error("Numero destinatario non valido")
  const name = params.templateName.trim()
  if (!name) throw new Error("Nome template obbligatorio")
  const language = { code: (params.languageCode ?? "it").trim() || "it" }
  const components =
    params.bodyParams && params.bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: params.bodyParams.map((text) => ({ type: "text", text })),
          },
        ]
      : undefined
  const preview =
    `template:${name}` +
    (params.bodyParams?.length ? ` [${params.bodyParams.join(", ")}]` : "")
  try {
    const result = await graphPost("messages", {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language,
        ...(components ? { components } : {}),
      },
    })
    const waMessageId = String(
      (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? ""
    ).trim() || undefined
    whatsappEventsStore.append({
      kind: "message_out",
      to,
      text: preview,
      waMessageId,
      status: "sent",
      raw: result,
    })
    return result
  } catch (e) {
    whatsappEventsStore.append({
      kind: "message_out",
      to,
      text: preview,
      status: "error",
      raw: { error: (e as Error)?.message ?? String(e) },
    })
    throw e
  }
}

/** Template benvenuto lead (da creare in Meta Manager, lingua it). */
export function leadWelcomeTemplateConfig() {
  const enabled = (process.env.WHATSAPP_AUTO_LEAD ?? "true").trim().toLowerCase() !== "false"
  const templateName = (process.env.WHATSAPP_LEAD_TEMPLATE ?? "lead_benvenuto").trim() || "lead_benvenuto"
  const languageCode = (process.env.WHATSAPP_LEAD_TEMPLATE_LANG ?? "it").trim() || "it"
  return { enabled, templateName, languageCode }
}

/**
 * Primo contatto WhatsApp dopo lead (Zapier / CRM).
 * Non lanciare errori verso il caller: logga e ritorna esito.
 * Se il template Meta non ha variabili, non inviare bodyParams
 * (WHATSAPP_LEAD_TEMPLATE_HAS_NAME=true solo se c’è {{1}} nel modello).
 */
export async function notifyLeadWelcomeWhatsapp(params: {
  telefono?: string | null
  nome?: string | null
}): Promise<{ sent: boolean; skipped?: string; error?: string; result?: unknown }> {
  const { enabled, templateName, languageCode } = leadWelcomeTemplateConfig()
  if (!enabled) return { sent: false, skipped: "WHATSAPP_AUTO_LEAD=false" }
  if (!isWhatsappSendConfigured()) return { sent: false, skipped: "whatsapp non configurato" }
  const phone = String(params.telefono ?? "").trim()
  if (!phone || phone === "—") return { sent: false, skipped: "telefono mancante" }
  const nome = String(params.nome ?? "").trim() || "Ciao"
  const hasNameParam = (process.env.WHATSAPP_LEAD_TEMPLATE_HAS_NAME ?? "").trim().toLowerCase() === "true"
  try {
    const result = await sendWhatsappTemplate({
      toRaw: phone,
      templateName,
      languageCode,
      ...(hasNameParam ? { bodyParams: [nome] } : {}),
    })
    return { sent: true, result }
  } catch (e) {
    const error = (e as Error)?.message ?? String(e)
    console.error("[whatsapp] notify lead:", error)
    return { sent: false, error }
  }
}
