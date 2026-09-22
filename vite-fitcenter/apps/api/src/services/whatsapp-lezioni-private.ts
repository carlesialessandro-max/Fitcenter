import { parseCancelRequestIt, parseSlotRequestIt } from "./whatsapp-booking.js"
import {
  createWhatsappNamedUtilityTemplate,
  createWhatsappPlainUtilityTemplate,
  createWhatsappUtilityTemplate,
  findWhatsappTemplate,
  isWhatsappSendConfigured,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
} from "./whatsapp.js"
import { whatsappEventsStore } from "../store/whatsapp-events.js"
import { readLezioniPrivateDb, writeLezioniPrivateDb, type LpRichiesta } from "../store/lezioni-private-db.js"

const LP_TEMPLATE_BODY = "FitCenter: nuova richiesta lezione privata. {{1}}"
const LP_TEMPLATE_BODY_NAMED = "FitCenter: nuova richiesta lezione privata. {{dettaglio}}"
const LP_TEMPLATE_BODY_PLAIN =
  "FitCenter: hai una nuova richiesta di lezione privata. Apri FitCenter, pagina Lezioni private."
const LP_TEMPLATE_EXAMPLE = "Mario Rossi, 40 anni, mercoledi mattina, tel 3331234567"
const LP_NAMED_PARAM = "dettaglio"

type LpTemplateKind = "positional" | "named" | "plain"

function lpTemplateConfig() {
  const name = (process.env.WHATSAPP_LP_TEMPLATE ?? "lezione_privata_richiesta").trim() || "lezione_privata_richiesta"
  const languageCode = (process.env.WHATSAPP_LP_TEMPLATE_LANG ?? "it").trim() || "it"
  return { name, languageCode }
}

function sanitizeLpTemplateParam(text: string): string {
  return text.replace(/[\r\n]+/g, " · ").replace(/\s+/g, " ").trim().slice(0, 600)
}

let lpTemplateReady: Promise<LpTemplateKind> | null = null

function alreadyExists(msg: string): boolean {
  return /already exists|taken|duplicate|already been created/i.test(msg)
}

function kindFromTemplate(row: { bodyText?: string; parameterFormat?: string } | null): LpTemplateKind {
  const fmt = String(row?.parameterFormat ?? "").toLowerCase()
  const body = row?.bodyText ?? ""
  if (fmt === "named" || /\{\{[a-z_][a-z0-9_]*\}\}/i.test(body)) return "named"
  if (body && !/\{\{/.test(body)) return "plain"
  return "positional"
}

async function statusOrNull(name: string, languageCode: string) {
  try {
    return await findWhatsappTemplate(name, languageCode)
  } catch (e) {
    console.warn("[lp-wa] lettura template Meta:", (e as Error).message)
    return null
  }
}

function throwIfNotSendable(name: string, status: string | null | undefined) {
  if (!status || status === "APPROVED") return
  if (status === "PENDING" || status === "IN_APPEAL" || status === "PAUSED") {
    throw new Error(
      `Template WhatsApp «${name}» non ancora approvato (${status}). In Meta Business Manager attendi lo stato verde, poi reinvia.`
    )
  }
  if (status === "REJECTED" || status === "DISABLED") {
    throw new Error(
      `Template WhatsApp «${name}» rifiutato da Meta. Correggilo in Business Manager (categoria UTILITY) e reinvia.`
    )
  }
}

async function submitLpTemplate(): Promise<LpTemplateKind> {
  const cfg = lpTemplateConfig()
  const existing = await statusOrNull(cfg.name, cfg.languageCode)
  if (existing?.status === "APPROVED") return kindFromTemplate(existing)
  throwIfNotSendable(cfg.name, existing?.status)

  const errors: string[] = []
  try {
    await createWhatsappUtilityTemplate({
      name: cfg.name,
      languageCode: cfg.languageCode,
      body: LP_TEMPLATE_BODY,
      example: LP_TEMPLATE_EXAMPLE,
    })
    throw new Error(
      `Template «${cfg.name}» inviato a Meta per approvazione. Di solito è questione di minuti: appena è APPROVED i WhatsApp arrivano anche a chat chiusa.`
    )
  } catch (e) {
    const msg = (e as Error).message || String(e)
    if (alreadyExists(msg)) {
      const again = await statusOrNull(cfg.name, cfg.languageCode)
      if (again?.status === "APPROVED") return kindFromTemplate(again)
      throwIfNotSendable(cfg.name, again?.status)
    }
    if (/approvazione/i.test(msg)) throw e
    errors.push(msg)
  }

  try {
    await createWhatsappNamedUtilityTemplate({
      name: cfg.name,
      languageCode: cfg.languageCode,
      body: LP_TEMPLATE_BODY_NAMED,
      paramName: LP_NAMED_PARAM,
      example: LP_TEMPLATE_EXAMPLE,
    })
    throw new Error(
      `Template «${cfg.name}» inviato a Meta per approvazione. Di solito è questione di minuti: appena è APPROVED i WhatsApp arrivano anche a chat chiusa.`
    )
  } catch (e) {
    const msg = (e as Error).message || String(e)
    if (alreadyExists(msg)) {
      const again = await statusOrNull(cfg.name, cfg.languageCode)
      if (again?.status === "APPROVED") return kindFromTemplate(again)
      throwIfNotSendable(cfg.name, again?.status)
    }
    if (/approvazione/i.test(msg)) throw e
    errors.push(msg)
  }

  const plainName = `${cfg.name}_avviso`
  const plain = await statusOrNull(plainName, cfg.languageCode)
  if (plain?.status === "APPROVED") return "plain"
  if (!plain?.status) {
    try {
      await createWhatsappPlainUtilityTemplate({
        name: plainName,
        languageCode: cfg.languageCode,
        body: LP_TEMPLATE_BODY_PLAIN,
      })
      throw new Error(
        `Template «${plainName}» inviato a Meta per approvazione. Di solito è questione di minuti: appena è APPROVED i WhatsApp arrivano anche a chat chiusa.`
      )
    } catch (e) {
      const msg = (e as Error).message || String(e)
      if (alreadyExists(msg)) {
        const again = await statusOrNull(plainName, cfg.languageCode)
        if (again?.status === "APPROVED") return "plain"
        throwIfNotSendable(plainName, again?.status)
      }
      if (/approvazione/i.test(msg)) throw e
      errors.push(msg)
    }
  } else {
    throwIfNotSendable(plainName, plain.status)
  }

  throw new Error(
    `Serve il template Meta «${cfg.name}» (UTILITY, italiano). ${errors.filter(Boolean).join(" · ")}`
  )
}

async function ensureLpTemplateApproved(): Promise<{ name: string; languageCode: string; kind: LpTemplateKind }> {
  const cfg = lpTemplateConfig()
  if (!lpTemplateReady) {
    lpTemplateReady = submitLpTemplate().catch((e) => {
      setTimeout(() => {
        lpTemplateReady = null
      }, 60_000)
      throw e
    })
  }
  const kind = await lpTemplateReady
  return { ...cfg, kind }
}

async function sendLpTemplateMessage(telefono: string, param: string, kind: LpTemplateKind) {
  const cfg = lpTemplateConfig()
  const langs = Array.from(new Set([cfg.languageCode, "it", "it_IT"].filter(Boolean)))
  if (kind === "plain") {
    let last: Error | null = null
    for (const languageCode of langs) {
      try {
        await sendWhatsappTemplate({
          toRaw: telefono,
          templateName: `${cfg.name}_avviso`,
          languageCode,
        })
        return
      } catch (e) {
        last = e as Error
      }
    }
    throw last ?? new Error("Invio template WhatsApp fallito")
  }
  let last: Error | null = null
  for (const languageCode of langs) {
    try {
      if (kind === "named") {
        await sendWhatsappTemplate({
          toRaw: telefono,
          templateName: cfg.name,
          languageCode,
          namedBodyParams: [{ name: LP_NAMED_PARAM, text: param }],
        })
      } else {
        await sendWhatsappTemplate({
          toRaw: telefono,
          templateName: cfg.name,
          languageCode,
          bodyParams: [param],
        })
      }
      return
    } catch (e) {
      last = e as Error
    }
  }
  throw last ?? new Error("Invio template WhatsApp fallito")
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
  const param = sanitizeLpTemplateParam(body)
  try {
    await sendLpTemplateMessage(telefono, param, "positional")
    return
  } catch (e) {
    const msg = (e as Error).message || String(e)
    if (!/132001|133010|does not exist|template name|invalid parameter|#100|not exist/i.test(msg)) {
      throw e
    }
  }
  const ready = await ensureLpTemplateApproved()
  await sendLpTemplateMessage(telefono, param, ready.kind)
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
