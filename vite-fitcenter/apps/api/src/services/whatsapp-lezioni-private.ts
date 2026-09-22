import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import {
  isWhatsappSendConfigured,
  leadWelcomeTemplateConfig,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
} from "./whatsapp.js"
import { whatsappEventsStore } from "../store/whatsapp-events.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

function sanitizeLpTemplateParam(text: string): string {
  return text.replace(/[\r\n]+/g, " · ").replace(/\s+/g, " ").trim().slice(0, 600)
}

/** Stessi modelli già approvati che usano le consulenti (niente template nuovo da far passare a Meta). */
function lpClosedWindowTemplates(): Array<{ name: string; languageCode: string }> {
  const adulti = leadWelcomeTemplateConfig({ bambini: false })
  const bambini = leadWelcomeTemplateConfig({ bambini: true })
  const extra = (process.env.WHATSAPP_LP_TEMPLATE ?? "").trim()
  const lang = (process.env.WHATSAPP_LP_TEMPLATE_LANG ?? adulti.languageCode ?? "it").trim() || "it"
  const names = [extra, adulti.templateName, "lead_benvenuto_adulti", "lead_benvenuto", bambini.templateName].filter(
    (n): n is string => Boolean(n && n.trim())
  )
  const seen = new Set<string>()
  const out: Array<{ name: string; languageCode: string }> = []
  for (const name of names) {
    const key = `${name}:${lang}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, languageCode: lang })
  }
  return out
}

async function sendWithConsultantTemplate(telefono: string, text: string, nome?: string): Promise<void> {
  const dettaglio = sanitizeLpTemplateParam(text)
  const chi = sanitizeLpTemplateParam((nome ?? "").trim().split(/\s+/)[0] || "Ciao")
  const langs = ["it", "it_IT"]
  const paramSets: Array<string[] | undefined> = [
    [dettaglio],
    [`${chi}: ${dettaglio}`.slice(0, 600)],
    [chi],
    undefined,
  ]
  let last: Error | null = null
  const tries: Array<{ name: string; languageCode: string; bodyParams?: string[] }> = []
  for (const tpl of lpClosedWindowTemplates()) {
    for (const languageCode of Array.from(new Set([tpl.languageCode, ...langs]))) {
      for (const bodyParams of paramSets) {
        tries.push({ name: tpl.name, languageCode, bodyParams })
      }
    }
  }
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i]!
    const lastTry = i === tries.length - 1
    try {
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName: t.name,
        languageCode: t.languageCode,
        ...(t.bodyParams ? { bodyParams: t.bodyParams } : {}),
        skipLog: !lastTry,
      })
      return
    } catch (e) {
      last = e as Error
    }
  }
  throw last ?? new Error("Invio WhatsApp fallito")
}

/**
 * Stesso numero Cloud API delle consulenti.
 * Chat già aperta (24h): testo della richiesta. Altrimenti i template già approvati
 * (lead_benvenuto_adulti / lead_benvenuto), senza crearne di nuovi.
 */
export async function sendLezionePrivataWhatsapp(telefono: string, text: string, nome?: string): Promise<void> {
  if (!normalizeWaTo(telefono)) throw new Error("numero WhatsApp non valido")
  const body = text.trim()
  if (!body) throw new Error("Testo messaggio vuoto")
  if (whatsappEventsStore.hasCustomerWindow(telefono)) {
    await sendWhatsappText(telefono, body)
    return
  }
  await sendWithConsultantTemplate(telefono, body, nome)
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
