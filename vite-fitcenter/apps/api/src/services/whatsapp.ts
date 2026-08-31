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

/** Upload file → media id (Cloud API). */
export async function uploadWhatsappMedia(params: {
  filePath: string
  mimeType: string
  filename?: string
}): Promise<string> {
  const { token, phoneNumberId, graphVersion } = whatsappConfig()
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp non configurato: imposta WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID")
  }
  const fs = await import("fs")
  const path = await import("path")
  if (!fs.existsSync(params.filePath)) {
    throw new Error(`File WhatsApp non trovato: ${params.filePath}`)
  }
  const buf = fs.readFileSync(params.filePath)
  const filename = params.filename || path.basename(params.filePath)
  const form = new FormData()
  form.append("messaging_product", "whatsapp")
  form.append("type", params.mimeType)
  form.append("file", new Blob([new Uint8Array(buf)], { type: params.mimeType }), filename)

  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message ?? `Upload media WhatsApp HTTP ${res.status}`)
  }
  return json.id
}

export async function sendWhatsappDocument(params: {
  toRaw: string
  filePath: string
  filename?: string
  caption?: string
  mimeType?: string
}): Promise<unknown> {
  const to = normalizeWaTo(params.toRaw)
  if (!to) throw new Error("Numero destinatario non valido")
  const path = await import("path")
  const filename = params.filename || path.basename(params.filePath)
  const mimeType =
    params.mimeType ||
    (filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  const mediaId = await uploadWhatsappMedia({
    filePath: params.filePath,
    mimeType,
    filename,
  })
  const caption = (params.caption ?? "").trim()
  try {
    const result = await graphPost("messages", {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        ...(caption ? { caption } : {}),
      },
    })
    const waMessageId = String(
      (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? ""
    ).trim() || undefined
    whatsappEventsStore.append({
      kind: "message_out",
      to,
      text: `documento:${filename}${caption ? ` · ${caption}` : ""}`,
      waMessageId,
      status: "sent",
      raw: result,
    })
    return result
  } catch (e) {
    whatsappEventsStore.append({
      kind: "message_out",
      to,
      text: `documento:${filename}`,
      status: "error",
      raw: { error: (e as Error)?.message ?? String(e) },
    })
    throw e
  }
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
export function leadWelcomeTemplateConfig(opts?: { bambini?: boolean }) {
  const enabled = (process.env.WHATSAPP_AUTO_LEAD ?? "true").trim().toLowerCase() !== "false"
  const languageCode = (process.env.WHATSAPP_LEAD_TEMPLATE_LANG ?? "it").trim() || "it"
  if (opts?.bambini) {
    const templateName =
      (process.env.WHATSAPP_LEAD_TEMPLATE_BAMBINI ?? "").trim() ||
      (process.env.WHATSAPP_LEAD_TEMPLATE ?? "lead_benvenuto").trim() ||
      "lead_benvenuto"
    // Template bambini con Ciao {{1}}: default true se WHATSAPP_LEAD_TEMPLATE_BAMBINI è impostato
    const hasNameDefault = Boolean((process.env.WHATSAPP_LEAD_TEMPLATE_BAMBINI ?? "").trim())
    const hasNameParam =
      (process.env.WHATSAPP_LEAD_TEMPLATE_BAMBINI_HAS_NAME ?? "").trim().toLowerCase() === "true" ||
      ((process.env.WHATSAPP_LEAD_TEMPLATE_BAMBINI_HAS_NAME ?? "").trim() === "" && hasNameDefault) ||
      (process.env.WHATSAPP_LEAD_TEMPLATE_HAS_NAME ?? "").trim().toLowerCase() === "true"
    return { enabled, templateName, languageCode, hasNameParam }
  }
  const templateName = (process.env.WHATSAPP_LEAD_TEMPLATE ?? "lead_benvenuto").trim() || "lead_benvenuto"
  const hasNameParam = (process.env.WHATSAPP_LEAD_TEMPLATE_HAS_NAME ?? "").trim().toLowerCase() === "true"
  return { enabled, templateName, languageCode, hasNameParam }
}

/**
 * Primo contatto WhatsApp dopo lead (Zapier / CRM).
 * Non lanciare errori verso il caller: logga e ritorna esito.
 * Se il template Meta non ha variabili, non inviare bodyParams
 * (WHATSAPP_LEAD_TEMPLATE_HAS_NAME=true solo se c’è {{1}} nel modello).
 * Bambini: WHATSAPP_LEAD_TEMPLATE_BAMBINI + testo libero con prova in acqua obbligatoria.
 * Adulti: un solo messaggio (testo con appuntamento + link). Niente template saluto né «ti richiamerà».
 */
export async function notifyLeadWelcomeWhatsapp(params: {
  telefono?: string | null
  nome?: string | null
  bambini?: boolean
}): Promise<{ sent: boolean; skipped?: string; error?: string; result?: unknown }> {
  const { enabled, templateName, languageCode, hasNameParam } = leadWelcomeTemplateConfig({
    bambini: params.bambini,
  })
  if (!enabled) return { sent: false, skipped: "WHATSAPP_AUTO_LEAD=false" }
  if (!isWhatsappSendConfigured()) return { sent: false, skipped: "whatsapp non configurato" }
  const phone = String(params.telefono ?? "").trim()
  if (!phone || phone === "—") return { sent: false, skipped: "telefono mancante" }
  const nome = String(params.nome ?? "").trim() || "Ciao"
  try {
    if (params.bambini) {
      const result = await sendWhatsappTemplate({
        toRaw: phone,
        templateName,
        languageCode,
        ...(hasNameParam ? { bodyParams: [nome] } : {}),
      })
      try {
        await sendWhatsappText(phone, bambiniWelcomeFollowupMsg())
      } catch (e2) {
        console.warn(
          "[whatsapp] follow-up benvenuto bambini:",
          (e2 as Error)?.message ?? e2
        )
      }
      return { sent: true, result }
    }

    try {
      const result = await sendWhatsappText(phone, adultiWelcomeFollowupMsg(nome))
      return { sent: true, result }
    } catch (eText) {
      console.warn(
        "[whatsapp] adulti testo libero fallito (finestra 24h?), nessun secondo messaggio:",
        (eText as Error)?.message ?? eText
      )
      const result = await sendWhatsappTemplate({
        toRaw: phone,
        templateName,
        languageCode,
        ...(hasNameParam ? { bodyParams: [nome] } : {}),
      })
      return { sent: true, result }
    }
  } catch (e) {
    const error = (e as Error)?.message ?? String(e)
    console.error("[whatsapp] notify lead:", error)
    return { sent: false, error }
  }
}

/** Testo post-template: prova in acqua prima dell’iscrizione (non appuntamento sede). */
export function bambiniWelcomeFollowupMsg(): string {
  return (
    `👋 Benvenuto in H2Sport! 💙\n` +
    `Grazie per aver richiesto informazioni sui nostri corsi per bambini 🏊‍♂️\n\n` +
    `Per ricevere le informazioni puoi scegliere:\n` +
    `📲 INFO WHATSAPP → ti inviamo qui il documento con orari, costi e informazioni del corso richiesto.\n` +
    `📧 INFO EMAIL → riceverai tutte le informazioni via email.\n` +
    `☎️ RICHIAMATEMI → una nostra consulente ti contatterà.\n\n` +
    `⚠️ IMPORTANTE: prima di poter effettuare l'iscrizione è necessario fare una prova in acqua. ` +
    `La prova ci permette di valutare il livello del bambino e individuare il gruppo e il posto in vasca più adatti.\n\n` +
    `👉 Dopo aver ricevuto le informazioni, puoi prenotare la prova scrivendo:\n` +
    `PRENOTA PROVA + giorno + orario + età del bambino\n` +
    `Esempio:\n` +
    `PRENOTA PROVA martedì 15:15 età 18 mesi\n\n` +
    `💙 Ti aspettiamo a H2Sport!`
  )
}

/** Unico messaggio lead adulti: appuntamento in sede + link (niente template Meta). */
export function adultiWelcomeFollowupMsg(nome?: string | null): string {
  const raw = String(nome ?? "").trim()
  const chi = !raw || /^ciao$/i.test(raw) ? "Ciao" : `Ciao ${raw.split(/\s+/)[0]}`
  return (
    `${chi}, grazie per aver richiesto informazioni su H2Sport! 💙\n\n` +
    `Per aiutarti a scegliere la soluzione più adatta, ti consigliamo di fissare un appuntamento in sede: ` +
    `è il modo migliore per mostrarti la struttura e trovare la formula giusta per te.\n\n` +
    `Per evitare attese, rispondi a questo messaggio indicando quando preferisci venire:\n` +
    `👉 Lunedì alle 18:30\n` +
    `👉 Sabato mattina\n\n` +
    `Verificheremo subito la disponibilità e ti confermeremo l'appuntamento.\n\n` +
    `Se preferisci dare un'occhiata in autonomia:\n` +
    `🏋️ Corsi adulti e programma: https://h2sport.it/#attivita\n` +
    `🌊 Corsi in acqua: https://h2sport.it/#orari-acqua\n` +
    `🧘 Corsi fitness: https://h2sport.it/#orari-terra\n` +
    `🏊 Nuoto libero: https://h2sport.it/piscina#nuoto-libero\n` +
    `📄 Planning corsie (PDF): https://h2sport.it/corsi/nuoto-libero-da-settembre-2026.pdf\n\n` +
    `🕒 Orari di apertura:\n` +
    `Lun–Ven 7:00–22:00 · Sab 9:00–19:00 · Dom 9:00–13:00\n` +
    `📍 Via Provinciale Lucchese 139, Pistoia\n` +
    `🗺 Mappa e contatti: https://h2sport.it/contatti\n\n` +
    `📞 Preferisci parlare a voce? Scrivi solo RICHIAMATEMI e ti contattiamo prima possibile.\n\n` +
    `Ti aspettiamo a H2Sport! 💙`
  )
}
