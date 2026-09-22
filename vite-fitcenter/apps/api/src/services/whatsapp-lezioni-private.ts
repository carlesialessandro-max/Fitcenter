import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import {
  createWhatsappUtilityTemplate,
  findWhatsappTemplateStatus,
  isWhatsappSendConfigured,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
} from "./whatsapp.js"
import { whatsappEventsStore } from "../store/whatsapp-events.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

const LP_TEMPLATE_BODY = "FitCenter — lezione privata:\n{{1}}"
const LP_TEMPLATE_EXAMPLE = "Mario Rossi, 40 anni, mercoledi mattina, tel 3331234567"

function lpTemplateConfig() {
  const name = (process.env.WHATSAPP_LP_TEMPLATE ?? "lezione_privata_richiesta").trim() || "lezione_privata_richiesta"
  const languageCode = (process.env.WHATSAPP_LP_TEMPLATE_LANG ?? "it").trim() || "it"
  return { name, languageCode }
}

function sanitizeLpTemplateParam(text: string): string {
  return text.replace(/[\r\n]+/g, " · ").replace(/\s+/g, " ").trim().slice(0, 600)
}

let lpTemplateReady: Promise<string> | null = null

async function ensureLpTemplateApproved(): Promise<{ name: string; languageCode: string }> {
  const cfg = lpTemplateConfig()
  if (!lpTemplateReady) {
    lpTemplateReady = (async () => {
      let status: string | null = null
      try {
        status = await findWhatsappTemplateStatus(cfg.name, cfg.languageCode)
      } catch (e) {
        console.warn("[lp-wa] lettura template Meta:", (e as Error).message)
      }
      if (status === "APPROVED") return "APPROVED"
      if (status === "PENDING" || status === "IN_APPEAL" || status === "PAUSED") {
        throw new Error(
          `Template WhatsApp «${cfg.name}» non ancora approvato (${status}). In Meta Business Manager attendi lo stato verde, poi reinvia.`
        )
      }
      if (status === "REJECTED" || status === "DISABLED") {
        throw new Error(
          `Template WhatsApp «${cfg.name}» rifiutato da Meta. Correggilo in Business Manager (categoria UTILITY) e reinvia.`
        )
      }
      try {
        await createWhatsappUtilityTemplate({
          name: cfg.name,
          languageCode: cfg.languageCode,
          body: LP_TEMPLATE_BODY,
          example: LP_TEMPLATE_EXAMPLE,
        })
      } catch (e) {
        const msg = (e as Error).message || String(e)
        if (!/already exists|taken|duplicate/i.test(msg)) {
          throw new Error(
            `Serve il template Meta «${cfg.name}» (UTILITY, italiano, testo: FitCenter — lezione privata: {{1}}). ${msg}`
          )
        }
      }
      throw new Error(
        `Template «${cfg.name}» inviato a Meta per approvazione. Di solito è questione di minuti: appena è APPROVED i WhatsApp arrivano anche a chat chiusa.`
      )
    })().catch((e) => {
      lpTemplateReady = null
      throw e
    })
  }
  await lpTemplateReady
  return cfg
}

/**
 * Se la persona ha già scritto a FitCenter (24h) parte il testo breve.
 * Altrimenti Meta rifiuta il testo libero: si usa il template UTILITY, mai il benvenuto H2Sport.
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
  const cfg = lpTemplateConfig()
  const param = sanitizeLpTemplateParam(body)
  try {
    await sendWhatsappTemplate({
      toRaw: telefono,
      templateName: cfg.name,
      languageCode: cfg.languageCode,
      bodyParams: [param],
    })
  } catch (e) {
    const msg = (e as Error).message || String(e)
    if (/132001|133010|does not exist|template name/i.test(msg)) {
      await ensureLpTemplateApproved()
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName: cfg.name,
        languageCode: cfg.languageCode,
        bodyParams: [param],
      })
      return
    }
    throw e
  }
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
