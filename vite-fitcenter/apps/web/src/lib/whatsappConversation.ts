import type { WhatsappLogEvent } from "@/api/whatsapp"

export type ChatRole = "cliente" | "bot" | "sistema"

export type ChatField = { label: string; value: string }

export type ChatBubble = {
  id: string
  at: string
  role: ChatRole
  kicker: string
  body: string
  fields?: ChatField[]
  status?: string
  errorIt?: string
}

export type LeadFormDump = {
  referente: string
  allievo: string
  altro: string
  disponibilita: string
  note: string
  telefono: string
}

function isDash(s: string): boolean {
  const t = s.trim()
  return !t || t === "-" || t === "—"
}

function isPhoneToken(s: string): boolean {
  const digits = s.replace(/\D/g, "")
  return digits.length >= 8 && digits.length <= 15
}

/** Form Facebook corsi (referente, allievo + età, altro, giorni, note, telefono). */
export function parseLeadFormDump(raw: string): LeadFormDump | null {
  const s = String(raw ?? "").trim()
  if (!s.includes(",")) return null
  const inner = s.replace(/^template:[^\s\[]+\s*\[(.*)\]\s*$/i, "$1").trim() || s
  const parts = inner.split(",").map((x) => x.trim())
  const last = parts[parts.length - 1] ?? ""
  if (!isPhoneToken(last) || parts.length < 5) return null
  const hasAge = parts.some((p) => /\(\s*\d+\s*anni?\.?\s*\)/i.test(p))
  if (!hasAge && parts.length < 6) return null
  const body = parts.slice(0, -1)
  if (body.length < 4) return null
  return {
    referente: body[0] ?? "",
    allievo: body[1] ?? "",
    altro: isDash(body[2] ?? "") ? "" : (body[2] ?? ""),
    disponibilita: isDash(body[3] ?? "") ? "" : (body[3] ?? ""),
    note: body
      .slice(4)
      .filter((x) => !isDash(x))
      .join(", "),
    telefono: last.replace(/\D/g, ""),
  }
}

export function firstNameOf(raw: string): string {
  const dump = parseLeadFormDump(raw)
  const base = (dump?.referente || raw.split(",")[0] || "").trim()
  const first = base.split(/\s+/)[0]?.replace(/[()]/g, "") ?? ""
  if (!first || /^ciao$/i.test(first) || first === "—") return "Ciao"
  return first
}

export function parseTemplate(text: string): { name: string; params: string } | null {
  const t = String(text ?? "").trim()
  const m = t.match(/^template:([^\s\[]+)\s*(?:\[(.*)\])?$/is)
  if (!m) return null
  return { name: (m[1] ?? "").trim(), params: (m[2] ?? "").trim() }
}

function labeledLines(text: string): ChatField[] | undefined {
  const fields: ChatField[] = []
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^([^:]{2,40}):\s*(.+)$/)
    if (m?.[1] && m[2]) fields.push({ label: m[1].trim(), value: m[2].trim() })
  }
  return fields.length >= 2 ? fields : undefined
}

function dumpFields(d: LeadFormDump): ChatField[] {
  const out: ChatField[] = []
  if (d.allievo) out.push({ label: "Allievo", value: d.allievo })
  if (d.referente) out.push({ label: "Chi ha compilato", value: d.referente })
  if (d.altro) out.push({ label: "Altro contatto", value: d.altro })
  if (d.disponibilita) out.push({ label: "Quando può", value: d.disponibilita })
  if (d.note) out.push({ label: "Cosa ha chiesto", value: d.note })
  if (d.telefono) out.push({ label: "Cellulare nel form", value: d.telefono })
  return out
}

function isBambiniTemplate(name: string, params: string): boolean {
  if (/bambin/i.test(name)) return true
  const dump = parseLeadFormDump(params)
  if (!dump) return false
  const age = dump.allievo.match(/\(\s*(\d+)\s*anni?/i)
  if (age && Number(age[1]) <= 17) return true
  return /\b(acquatic|scuola\s*nuoto|imparare a nuotare|vasca|bambin)\b/i.test(dump.note)
}

function botWelcomeBody(name: string, bambini: boolean): string {
  const chi = !name || /^ciao$/i.test(name) ? "Ciao" : `Ciao ${name}`
  if (bambini) {
    return (
      `${chi}, grazie per aver richiesto informazioni sui corsi per bambini.\n\n` +
      `Il bot ha inviato il benvenuto H2Sport:\n` +
      `• info su WhatsApp, email o richiamo\n` +
      `• prima dell’iscrizione serve una prova in acqua\n` +
      `• per prenotare la prova si scrive: PRENOTA PROVA + giorno + orario + età`
    )
  }
  return (
    `${chi}, grazie per aver richiesto informazioni su H2Sport.\n\n` +
    `Il bot ha inviato il benvenuto:\n` +
    `• fissare un appuntamento in sede (lunedì 18:30 o sabato mattina)\n` +
    `• oppure scrivere RICHIAMATEMI\n` +
    `• link a corsi, orari e nuoto libero sul sito`
  )
}

function botLezionePrivataBody(params: string): string {
  const t = params.trim()
  return t
    ? `Avviso lezione privata inviato.\n${t}`
    : "Avviso lezione privata inviato."
}

export function statusLabel(status?: string): string {
  switch (status) {
    case "error":
    case "failed":
    case "undelivered":
      return "non consegnato"
    case "cancelled":
      return "annullato"
    case "none":
      return "non trovato"
    case "delivered":
      return "consegnato"
    case "read":
      return "letto"
    case "sent":
      return "inviato a Meta"
    default:
      return ""
  }
}

export function fmtAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function customerPhoneOf(e: WhatsappLogEvent): string {
  const raw = e.kind === "message_out" ? e.to || e.from : e.from || e.to
  return String(raw ?? "—").replace(/^39/, "")
}

function bookingBody(e: WhatsappLogEvent): string {
  const t = String(e.text ?? "").trim() || "—"
  if (e.status === "cancelled" || /^annullat/i.test(t)) return t.replace(/^annullato/i, "Annullato")
  if (e.status === "ok" || /^prenotato/i.test(t)) return t.replace(/^prenotato/i, "Prenotato")
  return t
}

/** Un evento può diventare due bolle: richiesta form + risposta bot. */
export function eventToBubbles(e: WhatsappLogEvent): ChatBubble[] {
  const at = e.at
  const status = statusLabel(e.status)
  const errorIt = e.errorIt
  const rawText = String(e.text ?? "").trim()

  if (e.kind === "lead_request") {
    const dump = parseLeadFormDump(rawText)
    const fields = dump ? dumpFields(dump) : labeledLines(rawText)
    return [
      {
        id: `${e.id}-req`,
        at,
        role: "cliente",
        kicker: "Richiesta dal form",
        body: fields?.length
          ? "Il cliente ha compilato il form (Facebook / sito)."
          : rawText || "Richiesta informazioni.",
        fields,
      },
    ]
  }

  if (e.kind === "booking") {
    return [
      {
        id: e.id,
        at,
        role: "sistema",
        kicker: "Appuntamento",
        body: bookingBody(e),
        status,
        errorIt,
      },
    ]
  }

  if (e.kind === "message_in") {
    return [
      {
        id: e.id,
        at,
        role: "cliente",
        kicker: "Cliente ha scritto",
        body: rawText || "—",
      },
    ]
  }

  const tpl = parseTemplate(rawText)
  if (tpl) {
    const dump = parseLeadFormDump(tpl.params)
    const bubbles: ChatBubble[] = []
    if (dump) {
      bubbles.push({
        id: `${e.id}-form`,
        at,
        role: "cliente",
        kicker: "Richiesta dal form",
        body: "Il cliente non ha scritto su WhatsApp: ha compilato il form. Ecco cosa ha chiesto:",
        fields: dumpFields(dump),
      })
    }

    const isLp = /lezione|privata|^lp_/i.test(tpl.name) || /lezione privata|prenota in fitcenter/i.test(tpl.params)
    const name = dump ? firstNameOf(dump.referente) : firstNameOf(tpl.params)
    const body = isLp
      ? botLezionePrivataBody(tpl.params)
      : dump || /benvenuto|lead_/i.test(tpl.name)
        ? botWelcomeBody(name, isBambiniTemplate(tpl.name, tpl.params))
        : tpl.params
          ? `Template «${tpl.name}» inviato a ${name}.`
          : `Template «${tpl.name}» inviato.`

    bubbles.push({
      id: e.id,
      at,
      role: "bot",
      kicker: isLp ? "Bot ha avvisato (template)" : "Bot ha inviato il benvenuto",
      body,
      status,
      errorIt,
    })
    return bubbles
  }

  if (/^documento:/i.test(rawText)) {
    return [
      {
        id: e.id,
        at,
        role: "bot",
        kicker: "Bot ha inviato un documento",
        body: rawText.replace(/^documento:\s*/i, ""),
        status,
        errorIt,
      },
    ]
  }

  return [
    {
      id: e.id,
      at,
      role: e.kind === "message_out" ? "bot" : "sistema",
      kicker: e.kind === "message_out" ? "Bot ha risposto" : e.kind,
      body: rawText || "—",
      status,
      errorIt,
    },
  ]
}

export function conversationHasClientMessage(events: WhatsappLogEvent[]): boolean {
  return events.some((e) => e.kind === "message_in")
}

export type WaChannel = "lead" | "lezioni_private" | "altro"

function isLezionePrivataBlob(text: string): boolean {
  return (
    /lezione\s*privata/i.test(text) ||
    /\blp_avviso|\blp_/i.test(text) ||
    /prendi in carico|calendario vasche/i.test(text) ||
    /prenota in fitcenter/i.test(text) ||
    /contatta l['’]istruttore/i.test(text) ||
    /nuova richiesta di lezione privata/i.test(text) ||
    /abbiamo preso in carico la richiesta per la lezione privata/i.test(text)
  )
}

export function eventChannel(e: WhatsappLogEvent): WaChannel {
  const raw = String(e.text ?? "")
  if (e.kind === "lead_request") return "lead"
  if (e.kind === "booking") return "lead"
  const tpl = parseTemplate(raw)
  if (tpl && (/^lp_/i.test(tpl.name) || /lezione|privata/i.test(tpl.name) || isLezionePrivataBlob(tpl.params))) {
    return "lezioni_private"
  }
  if (isLezionePrivataBlob(raw)) return "lezioni_private"
  if (tpl && /benvenuto|lead_/i.test(tpl.name)) return "lead"
  if (parseLeadFormDump(tpl?.params || raw)) return "lead"
  if (/^documento:/i.test(raw)) return "lead"
  if (/PRENOTA\s+PROVA|RICHIAMATEMI|appuntamento in sede/i.test(raw)) return "lead"
  return "altro"
}

export function conversationChannel(events: WhatsappLogEvent[]): Exclude<WaChannel, "altro"> | "misto" {
  let lead = false
  let lp = false
  for (const e of events) {
    const c = eventChannel(e)
    if (c === "lead") lead = true
    if (c === "lezioni_private") lp = true
  }
  if (lead && lp) return "misto"
  if (lp) return "lezioni_private"
  return "lead"
}

export function eventMatchesChannel(
  e: WhatsappLogEvent,
  channel: "all" | "lead" | "lezioni_private",
): boolean {
  if (channel === "all") return true
  const c = eventChannel(e)
  return c === channel || c === "altro"
}
