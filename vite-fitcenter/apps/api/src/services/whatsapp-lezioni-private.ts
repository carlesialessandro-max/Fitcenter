import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import {
  findWhatsappTemplate,
  isWhatsappSendConfigured,
  listWhatsappTemplates,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
  type WhatsappTemplateInfo,
} from "./whatsapp.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

const LP_TPL_NAME = "lp_avviso_fitcenter"
const LP_TPL_FALLBACKS = [
  "lp_avviso_fitcenter",
  "lezione_privata_richiesta_avviso_v2",
  "lezione_privata_richiesta_avviso",
]

function lpPreferredName(): string {
  return (process.env.WHATSAPP_LP_TEMPLATE ?? "").trim() || LP_TPL_NAME
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

const MANAGER_HINT =
  "In Manager crea (nome nuovo, mai usato) lp_avviso_fitcenter, Utility se disponibile altrimenti Marketing Predefinita, Italiano, testo: FitCenter: hai una nuova richiesta di lezione privata. {{1}} Apri FitCenter, pagina Lezioni private."

function pickShort(rows: WhatsappTemplateInfo[]): WhatsappTemplateInfo | null {
  const preferred = lpPreferredName()
  const names = [preferred, ...LP_TPL_FALLBACKS]
  const ok = rows.filter((t) => !isLongWelcomeBody(t.bodyText) && isUsableStatus(t.status))
  for (const name of names) {
    const hit = ok.find((t) => t.name === name)
    if (hit) return hit
  }
  return ok.find((t) => isShortApprovedBody(t.bodyText)) ?? null
}

function isUsableStatus(status?: string): boolean {
  const s = String(status ?? "").toUpperCase()
  return s === "APPROVED" || s === "ACTIVE" || s === "QUALITY_PENDING" || s.includes("APPROVED")
}

let listedAllCache: { at: number; rows: WhatsappTemplateInfo[] } | null = null
let ensureTplAt = 0
let ensureTpl: Promise<WhatsappTemplateInfo> | null = null

async function listAllTemplates(): Promise<WhatsappTemplateInfo[]> {
  const now = Date.now()
  if (listedAllCache && now - listedAllCache.at < 30_000) return listedAllCache.rows
  const rows = await listWhatsappTemplates()
  listedAllCache = { at: now, rows }
  return rows
}

async function ensureLpShortTemplate(): Promise<WhatsappTemplateInfo> {
  if (ensureTpl && Date.now() - ensureTplAt < 30_000) return ensureTpl
  ensureTplAt = Date.now()
  ensureTpl = (async () => {
    const preferred = lpPreferredName()
    const v2 = await findWhatsappTemplate(preferred, "it").catch(() => null)
    if (v2 && isUsableStatus(v2.status) && !isLongWelcomeBody(v2.bodyText)) return v2
    if (v2?.status === "PENDING" || v2?.status === "IN_APPEAL") {
      throw new Error(
        `Template «${v2.name}» in controllo Meta. Quando è verde, reinvia da FitCenter. Poi elimina lezione_privata_richiesta_avviso.`,
      )
    }
    for (const name of LP_TPL_FALLBACKS) {
      if (name === preferred) continue
      const row = await findWhatsappTemplate(name, "it").catch(() => null)
      if (row && isUsableStatus(row.status) && !isLongWelcomeBody(row.bodyText)) return row
    }
    const rows = await listAllTemplates()
    const short = pickShort(rows)
    if (short) return short
    throw new Error(MANAGER_HINT)
  })().catch((e) => {
    ensureTpl = null
    ensureTplAt = 0
    throw e
  })
  return ensureTpl
}

async function sendLpShortTemplate(telefono: string, text: string, tpl: WhatsappTemplateInfo): Promise<void> {
  const param = sanitizeLpTemplateParam(text)
  const langs = Array.from(new Set([tpl.language || "it", "it"].filter(Boolean)))
  const tries: Array<{ languageCode: string; bodyParams?: string[] }> = []
  for (const languageCode of langs) {
    tries.push({ languageCode, bodyParams: [param] })
    tries.push({ languageCode })
  }
  let last: Error | null = null
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i]!
    try {
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName: tpl.name,
        languageCode: t.languageCode,
        bodyParams: t.bodyParams,
        skipLog: i < tries.length - 1,
      })
      return
    } catch (e) {
      last = e as Error
    }
  }
  throw last ?? new Error(`Invio template «${tpl.name}» fallito`)
}

/**
 * Mai il benvenuto H2Sport. Solo un UTILITY breve (FitCenter lezione privata: {{1}}).
 */
export async function sendLezionePrivataWhatsapp(telefono: string, text: string, _nome?: string): Promise<void> {
  void _nome
  if (!normalizeWaTo(telefono)) throw new Error("numero WhatsApp non valido")
  const body = text.trim()
  if (!body) throw new Error("Testo messaggio vuoto")
  const tpl = await ensureLpShortTemplate()
  await sendLpShortTemplate(telefono, body, tpl)
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
