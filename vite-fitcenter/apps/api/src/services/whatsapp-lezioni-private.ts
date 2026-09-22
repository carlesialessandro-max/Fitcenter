import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import {
  isWhatsappSendConfigured,
  leadWelcomeTemplateConfig,
  listWhatsappTemplates,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
  type WhatsappTemplateInfo,
} from "./whatsapp.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

function lpPreferredName(): string {
  return (process.env.WHATSAPP_LP_TEMPLATE ?? "").trim()
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

function positionalPlaceholders(body?: string): number {
  const nums = [...String(body ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
  return nums.length ? Math.max(...nums) : 0
}

function namedPlaceholders(body?: string): string[] {
  const out: string[] = []
  for (const m of String(body ?? "").matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
    const n = m[1]!
    if (!out.includes(n)) out.push(n)
  }
  return out
}

let listedTplCache: { at: number; rows: WhatsappTemplateInfo[] } | null = null

async function approvedTemplates(): Promise<WhatsappTemplateInfo[]> {
  const now = Date.now()
  if (listedTplCache && now - listedTplCache.at < 10 * 60_000) return listedTplCache.rows
  const rows = (await listWhatsappTemplates()).filter((t) => t.status === "APPROVED")
  listedTplCache = { at: now, rows }
  return rows
}

function pickShortFrom(rows: WhatsappTemplateInfo[]): WhatsappTemplateInfo | null {
  const lang = lpLang().slice(0, 2).toLowerCase()
  const preferred = lpPreferredName()
  const it = rows.filter((t) => String(t.language ?? "").toLowerCase().startsWith(lang) || !t.language)
  if (preferred) {
    const own = it.find((t) => t.name === preferred && !isLongWelcomeBody(t.bodyText))
    if (own) return own
  }
  return it.find((t) => isShortApprovedBody(t.bodyText)) ?? null
}

function consultantFallbackNames(): string[] {
  const adulti = leadWelcomeTemplateConfig({ bambini: false })
  const bambini = leadWelcomeTemplateConfig({ bambini: true })
  return [
    lpPreferredName(),
    adulti.templateName,
    "lead_benvenuto_adulti",
    "lead_benvenuto",
    bambini.templateName,
  ].filter((n, i, a) => Boolean(n) && a.indexOf(n) === i)
}

async function sendApprovedTemplate(
  telefono: string,
  tpl: WhatsappTemplateInfo,
  dettaglio: string,
  chi: string,
): Promise<void> {
  const langs = Array.from(new Set([tpl.language || lpLang(), "it"].filter(Boolean)))
  const named = namedPlaceholders(tpl.bodyText)
  const nPos = positionalPlaceholders(tpl.bodyText)
  const namedFmt = String(tpl.parameterFormat ?? "").toUpperCase() === "NAMED" || (named.length > 0 && nPos === 0)
  const attempts: Array<{ languageCode: string; bodyParams?: string[]; namedBodyParams?: Array<{ name: string; text: string }> }> =
    []
  for (const languageCode of langs) {
    if (namedFmt && named.length) {
      attempts.push({
        languageCode,
        namedBodyParams: named.map((name, i) => ({ name, text: i === 0 ? dettaglio : chi })),
      })
    } else if (nPos <= 0) {
      attempts.push({ languageCode })
    } else if (nPos === 1) {
      attempts.push({ languageCode, bodyParams: [dettaglio] })
      attempts.push({ languageCode, bodyParams: [chi] })
    } else {
      attempts.push({ languageCode, bodyParams: [chi, dettaglio].slice(0, nPos) })
      attempts.push({ languageCode, bodyParams: Array.from({ length: nPos }, (_, i) => (i === 0 ? chi : dettaglio)) })
    }
  }
  let last: Error | null = null
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!
    try {
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName: tpl.name,
        languageCode: a.languageCode,
        bodyParams: a.bodyParams,
        namedBodyParams: a.namedBodyParams,
        skipLog: i < attempts.length - 1,
      })
      return
    } catch (e) {
      last = e as Error
    }
  }
  throw last ?? new Error(`Invio template «${tpl.name}» fallito`)
}

/** Invio diretto, senza GET su Meta: stessi modelli che già usano le consulenti. */
async function sendBlindConsultantTemplates(telefono: string, dettaglio: string, chi: string): Promise<void> {
  const names = consultantFallbackNames()
  const langs = Array.from(new Set([lpLang(), "it"].filter(Boolean)))
  const paramSets: Array<string[] | undefined> = [[dettaglio.slice(0, 220)], [chi], undefined]
  const tries: Array<{ name: string; languageCode: string; bodyParams?: string[] }> = []
  for (const name of names) {
    for (const languageCode of langs) {
      for (const bodyParams of paramSets) {
        tries.push({ name, languageCode, bodyParams })
      }
    }
  }
  let last: Error | null = null
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i]!
    try {
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName: t.name,
        languageCode: t.languageCode,
        bodyParams: t.bodyParams,
        skipLog: i < tries.length - 1,
      })
      return
    } catch (e) {
      last = e as Error
    }
  }
  throw last ?? new Error("Invio template consulenti fallito")
}

/** Chat chiusa: modelli già approvati, senza GET obbligatorio su Meta. */
async function sendClosedWindowTemplate(telefono: string, text: string, nome?: string): Promise<void> {
  const dettaglio = sanitizeLpTemplateParam(text)
  const chi = sanitizeLpTemplateParam((nome ?? "").trim().split(/\s+/)[0] || "Ciao")
  const rows = await approvedTemplates().catch((e) => {
    console.warn("[lp-wa] elenco template Meta:", (e as Error).message)
    return [] as WhatsappTemplateInfo[]
  })
  const short = pickShortFrom(rows)
  if (short) {
    try {
      await sendApprovedTemplate(telefono, short, dettaglio, chi)
      return
    } catch (e) {
      console.warn("[lp-wa] template breve:", (e as Error).message)
    }
  }
  await sendBlindConsultantTemplates(telefono, dettaglio, chi)
}

/**
 * Primo contatto lezione privata: solo template già approvati.
 * Il testo libero Graph può tornare 200 e poi fallire in webhook (131047): non usarlo qui.
 */
export async function sendLezionePrivataWhatsapp(telefono: string, text: string, nome?: string): Promise<void> {
  if (!normalizeWaTo(telefono)) throw new Error("numero WhatsApp non valido")
  const body = text.trim()
  if (!body) throw new Error("Testo messaggio vuoto")
  await sendClosedWindowTemplate(telefono, body, nome)
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
