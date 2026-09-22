import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import {
  createWhatsappUtilityTemplate,
  findWhatsappTemplate,
  isWhatsappSendConfigured,
  listWhatsappTemplates,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
} from "./whatsapp.js"
import { whatsappEventsStore } from "../store/whatsapp-events.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

const LP_SHORT_BODY = "FitCenter lezione privata: {{1}}"
const LP_SHORT_EXAMPLE = "Mario Rossi, 40 anni, mercoledi mattina, tel 3331234567"

function lpShortTemplateName(): string {
  return (process.env.WHATSAPP_LP_TEMPLATE ?? "lezione_privata_breve").trim() || "lezione_privata_breve"
}

function lpLang(): string {
  return (process.env.WHATSAPP_LP_TEMPLATE_LANG ?? "it").trim() || "it"
}

function sanitizeLpTemplateParam(text: string): string {
  return text.replace(/[\r\n]+/g, " · ").replace(/\s+/g, " ").trim().slice(0, 500)
}

function isLongWelcomeBody(text?: string): boolean {
  const t = String(text ?? "")
  return /appuntamento in sede|18:30|sabato mattina|h2sport\.it|grazie per aver richiesto informazioni/i.test(t)
}

function isShortApprovedBody(text?: string): boolean {
  const t = String(text ?? "").trim()
  if (!t || isLongWelcomeBody(t)) return false
  const staticLen = t.replace(/\{\{[^}]+\}\}/g, "").length
  return t.length <= 120 && staticLen <= 80
}

let lpShortReady: Promise<{ name: string; languageCode: string }> | null = null

async function pickShortApprovedTemplate(): Promise<{ name: string; languageCode: string } | null> {
  const preferred = lpShortTemplateName()
  const lang = lpLang()
  const own = await findWhatsappTemplate(preferred, lang).catch(() => null)
  if (own?.status === "APPROVED" && !isLongWelcomeBody(own.bodyText)) {
    return { name: own.name || preferred, languageCode: own.language || lang }
  }
  if (own?.status === "PENDING" || own?.status === "IN_APPEAL" || own?.status === "PAUSED") {
    throw new Error(
      `Template breve «${preferred}» non ancora approvato (${own.status}). In Meta attendi lo stato verde, poi reinvia: i messaggi saranno di una riga, senza il testo delle consulenti.`
    )
  }
  if (own?.status === "REJECTED" || own?.status === "DISABLED") {
    throw new Error(
      `Template breve «${preferred}» rifiutato da Meta. In Business Manager creane uno UTILITY italiano con testo: FitCenter lezione privata: {{1}}`
    )
  }
  try {
    const all = await listWhatsappTemplates()
    const short = all.find(
      (t) =>
        t.status === "APPROVED" &&
        String(t.language ?? "").toLowerCase().startsWith(lang.slice(0, 2)) &&
        isShortApprovedBody(t.bodyText)
    )
    if (short) return { name: short.name, languageCode: short.language || lang }
  } catch (e) {
    console.warn("[lp-wa] elenco template Meta:", (e as Error).message)
  }
  return null
}

async function ensureShortLpTemplate(): Promise<{ name: string; languageCode: string }> {
  if (!lpShortReady) {
    lpShortReady = (async () => {
      const existing = await pickShortApprovedTemplate()
      if (existing) return existing
      const name = lpShortTemplateName()
      const languageCode = lpLang()
      try {
        await createWhatsappUtilityTemplate({
          name,
          languageCode,
          body: LP_SHORT_BODY,
          example: LP_SHORT_EXAMPLE,
        })
      } catch (e) {
        const msg = (e as Error).message || String(e)
        if (!/already exists|taken|duplicate/i.test(msg)) {
          throw new Error(`Non riesco a creare il template breve «${name}». ${msg}`)
        }
      }
      const again = await findWhatsappTemplate(name, languageCode).catch(() => null)
      if (again?.status === "APPROVED") return { name, languageCode: again.language || languageCode }
      throw new Error(
        `Template breve «${name}» inviato a Meta (una riga, senza il testo H2Sport). Attendi l'approvazione e reinvia.`
      )
    })().catch((e) => {
      setTimeout(() => {
        lpShortReady = null
      }, 60_000)
      throw e
    })
  }
  return lpShortReady
}

async function sendShortLpTemplate(
  telefono: string,
  text: string,
  tpl: { name: string; languageCode: string }
): Promise<void> {
  const param = sanitizeLpTemplateParam(text)
  const langs = Array.from(new Set([tpl.languageCode, "it", "it_IT"].filter(Boolean)))
  let last: Error | null = null
  for (let i = 0; i < langs.length; i++) {
    const languageCode = langs[i]!
    const lastTry = i === langs.length - 1
    try {
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName: tpl.name,
        languageCode,
        bodyParams: [param],
        skipLog: !lastTry,
      })
      return
    } catch (e) {
      last = e as Error
    }
  }
  throw last ?? new Error("Invio template breve fallito")
}

/**
 * Chat aperta (24h): solo il testo della richiesta.
 * Chat chiusa: template UTILITY di una riga. Mai il benvenuto lungo delle consulenti.
 */
export async function sendLezionePrivataWhatsapp(telefono: string, text: string, _nome?: string): Promise<void> {
  void _nome
  if (!normalizeWaTo(telefono)) throw new Error("numero WhatsApp non valido")
  const body = text.trim()
  if (!body) throw new Error("Testo messaggio vuoto")
  if (whatsappEventsStore.hasCustomerWindow(telefono)) {
    await sendWhatsappText(telefono, body)
    return
  }
  const tpl = await ensureShortLpTemplate()
  await sendShortLpTemplate(telefono, body, tpl)
}

function samePhone(a: string, b: string): boolean {
  const x = normalizeWaTo(a)
  const y = normalizeWaTo(b)
  return Boolean(x && y && x === y)
}

function politeAck(text: string): boolean {
  const t = text.trim().toLowerCase()
  return /^(ok|va bene|grazie|perfetto|si|sì|no|👍|🙏|ricevuto|visto)[\s!.]*$/.test(t) || t.length <= 2
}

function wantsChange(text: string): boolean {
  const t = text.toLowerCase()
  if (parseSlotRequestIt(text)) return true
  return /\b(cambi|cambio|spost|sposta|altro giorno|un altro|altra ora|posso\s+(lun|mar|mer|gio|ven|sab|dom))\b/.test(t)
}

function appendNote(r: LpRichiesta, line: string) {
  r.note = [r.note, line].filter(Boolean).join(" · ")
}

function latestRichiestaByPhone(telefono: string): LpRichiesta | null {
  const db = readLezioniPrivateDb()
  const rows = db.richieste
    .filter((r) => samePhone(r.telefono, telefono) && r.status !== "annullata")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return rows[0] ?? null
}

async function avvisaIstruttori(text: string, istruttoreId?: string) {
  const db = readLezioniPrivateDb()
  let dest = db.instructors.filter((i) => i.attivo && String(i.telefono ?? "").trim())
  if (istruttoreId) {
    const one = dest.filter((i) => i.id === istruttoreId)
    if (one.length) dest = one
  }
  for (const i of dest) {
    try {
      await sendLezionePrivataWhatsapp(i.telefono, text, i.nome)
    } catch (e) {
      console.error("[lp-wa istruttore]", i.nome, (e as Error).message)
    }
  }
}

const CLIENTE_CONTATTA_ISTR =
  "Per annullare o spostare la lezione privata contatta l'istruttore: da WhatsApp non togliamo noi l'orario in vasca."

export async function handleWhatsappLezioniPrivate(params: {
  from?: string
  text?: string
}): Promise<{ handled: boolean; detail?: string }> {
  const from = normalizeWaTo(params.from ?? "") ?? ""
  const text = String(params.text ?? "").trim()
  if (!from || !text || text.startsWith("[")) return { handled: false }
  if (!isWhatsappSendConfigured()) return { handled: false }

  const richiesta = latestRichiestaByPhone(from)
  const wantsCancel = parseCancelRequestIt(text)
  const wantsMove = wantsChange(text)

  if (richiesta && (wantsCancel || wantsMove)) {
    const db = readLezioniPrivateDb()
    const row = db.richieste.find((x) => x.id === richiesta.id)
    if (row) {
      appendNote(row, `WA cliente: «${text.trim().slice(0, 180)}»`)
      writeLezioniPrivateDb(db)
    }
    const azione = wantsCancel ? "annullare" : "spostare"
    await avvisaIstruttori(
      `${richiesta.clienteNome} chiede di ${azione} la lezione privata. Tel ${richiesta.telefono}. Messaggio: «${text.trim().slice(0, 120)}»`,
      richiesta.istruttoreId,
    )
    await sendWhatsappText(from, CLIENTE_CONTATTA_ISTR)
    return { handled: true, detail: wantsCancel ? "cliente chiede annullo → istruttore" : "cliente chiede spostamento → istruttore" }
  }

  const db = readLezioniPrivateDb()
  const instructor = db.instructors.find((i) => i.attivo && samePhone(i.telefono, from))
  if (instructor) {
    if (politeAck(text)) return { handled: true, detail: "istruttore ack" }
    const aperta = db.richieste.find((r) => r.status === "aperta")
    if (aperta && /\b(prendo|prendiamo|ci sto|ok la prendo|io la prendo)\b/i.test(text)) {
      appendNote(aperta, `WA ${instructor.nome}: «${text}»`)
      writeLezioniPrivateDb(db)
      await sendWhatsappText(
        from,
        `Ricevuto ${instructor.nome}. Per fissare vasca e orario apri FitCenter → Lezioni private → Prendi in carico.`,
      )
      return { handled: true, detail: "istruttore prendi" }
    }
    await sendWhatsappText(
      from,
      `Ricevuto. Per le lezioni private usa FitCenter → Lezioni private (prendi in carico, calendario vasche).`,
    )
    return { handled: true, detail: "istruttore handoff fitcenter" }
  }

  if (!richiesta) return { handled: false }
  if (politeAck(text)) return { handled: true, detail: "cliente ack lp" }

  await sendWhatsappText(from, CLIENTE_CONTATTA_ISTR)
  return { handled: true, detail: "cliente guida lp" }
}
