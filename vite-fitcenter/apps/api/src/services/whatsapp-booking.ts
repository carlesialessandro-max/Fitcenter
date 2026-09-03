/**
 * Orchestratore: messaggio WhatsApp in ingresso → parse giorno/ora → prenota A2 → conferma.
 * Gestisce anche: ricontatto consulente, giorno senza orario, slot pieno.
 */
import { store as leadsStore } from "../store/leads.js"
import { whatsappEventsStore } from "../store/whatsapp-events.js"
import {
  createConsulenzaAppuntamento,
  phonesMatch,
  pickFreeConsulente,
  resolveIdUtenteForWaBooking,
  findIdUtenteNuovoCliente,
  findUpcomingConsulenzaByPhone,
  findAllUpcomingConsulenzeByPhone,
  cancelConsulenzaAppuntamento,
  slotEnd,
  IDA2_SERVIZIO_BAMBINI,
  IDA2_SERVIZIO_CONSULENTI_ADULTI,
  type AgendaSegmento,
} from "./agenda-a2.js"
import {
  isWhatsappSendConfigured,
  normalizeWaTo,
  sendWhatsappText,
  sendWhatsappDocument,
  extractItalianMobileDestinations,
  formatWaDisplay,
} from "./whatsapp.js"
import { isSmtpConfigured, sendMail } from "./mailer.js"
import { bookProveSnbSlot, isProveSnbSheetConfigured, type BambiniCorso } from "./prove-snb-sheet.js"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const processedWaIds = new Set<string>()
const MAX_PROCESSED = 2000

/** Attesa età dopo «prenota prova» + giorno/ora (TTL 30 min). */
type PendingProva = {
  weekday: number
  hour: number
  minute: number
  relative?: "oggi" | "domani"
  day?: number
  month?: number
  year?: number
  raw: string
  corso?: BambiniCorso
  expiresAt: number
}
const pendingProvaByPhone = new Map<string, PendingProva>()
const PENDING_PROVA_TTL_MS = 30 * 60_000

/** Giorno/data già scelti per la prova (es. orario sbagliato → poi solo «ore 16:15»). */
type PendingProvaDay = {
  weekday: number
  relative?: "oggi" | "domani"
  day?: number
  month?: number
  year?: number
  corso?: BambiniCorso
  etaLabel?: string
  etaYears?: number
  expiresAt: number
}
const pendingProvaDayByPhone = new Map<string, PendingProvaDay>()

/** Attesa scelta corso prima di INFO documenti. */
type PendingInfoCorso = { channel: "wa" | "email"; expiresAt: number }
const pendingInfoCorsoByPhone = new Map<string, PendingInfoCorso>()

/** Attesa canale (WhatsApp vs email) dopo «vorrei info / costi». */
type PendingInfoChannel = { corso?: BambiniCorso; expiresAt: number }
const pendingInfoChannelByPhone = new Map<string, PendingInfoChannel>()

/** Ricontatto già richiesto: i messaggi successivi sono note per la chiamata, non slot sede. */
type PendingCallback = { requestedAt: number; expiresAt: number }
const pendingCallbackByPhone = new Map<string, PendingCallback>()
const PENDING_CALLBACK_TTL_MS = 2 * 60 * 60_000

const WEEKDAY: Record<string, number> = {
  domenica: 0,
  dom: 0,
  lunedi: 1,
  lunedì: 1,
  lun: 1,
  martedi: 2,
  martedì: 2,
  mar: 2,
  mercoledi: 3,
  mercoledì: 3,
  mer: 3,
  giovedi: 4,
  giovedì: 4,
  gio: 4,
  venerdi: 5,
  venerdì: 5,
  ven: 5,
  sabato: 6,
  sab: 6,
}

const GUIDE_SLOT_MSG =
  `Per fissare l'appuntamento in sede rispondi con giorno e orario, ad esempio:\n` +
  `• Oggi 18:30\n` +
  `• Domani mattina\n` +
  `• Lunedì 18:30\n` +
  `• Sabato mattina\n\n` +
  `Se preferisci essere ricontattato da una consulente, scrivi pure «richiamatemi».`

const CALLBACK_MSG =
  `Perfetto, abbiamo segnato la tua richiesta.\n` +
  `Una consulente H2Sport ti richiamerà a breve.\n` +
  `Non serve indicare giorno e ora: ti contattiamo noi.`

const CALLBACK_AGAIN_MSG =
  `Ok, la richiesta di ricontatto è già in carico.\n` +
  `Una consulente H2Sport ti richiamerà a breve.`

/** Messaggio quando non capiamo la richiesta: lead a «contattato» + ricontatto umano. */
const GENERIC_HANDOFF_MSG =
  `Grazie per il messaggio: non sono riuscito a gestirlo in automatico.\n` +
  `Una consulente H2Sport ti risponderà a breve.\n\n` +
  `Se preferisci essere chiamato, scrivi «richiamatemi».`

function bambiniInfoUrl(): string {
  return (process.env.WHATSAPP_BAMBINI_INFO_URL ?? "https://h2sport.it/bambini/").trim()
}

function bambiniDataDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  // Preferisci assets (in repo); fallback data/ locale
  const assets = path.resolve(__dirname, "../../assets/bambini-info")
  const data = path.resolve(__dirname, "../../data/bambini-info")
  if (fs.existsSync(assets)) return assets
  return data
}

type BambiniDoc = { key: BambiniCorso; label: string; filename: string; filePath: string }

const CORSO_TAG = /\[corso:(acquaticita|scuola_nuoto)\]/i

/** Documenti stagione: share UNC (env) oppure copia in apps/api/data/bambini-info. */
function resolveBambiniDocs(corso?: BambiniCorso | null): BambiniDoc[] {
  const localDir = bambiniDataDir()
  const acqEnv = (process.env.WHATSAPP_BAMBINI_DOC_ACQUATICITA ?? "").trim()
  const snbEnv = (process.env.WHATSAPP_BAMBINI_DOC_SCUOLA_NUOTO ?? "").trim()
  const candidates: Array<{ key: BambiniDoc["key"]; label: string; filename: string; paths: string[] }> = [
    {
      key: "acquaticita",
      label: "Acquaticità stagione 2026-27",
      filename: "Acquaticita-2026-27.docx",
      paths: [
        acqEnv,
        path.join(localDir, "acquaticita-26-27.docx"),
        "\\\\ls220d3b7\\share\\societa\\CONDIVISA\\BAMBINI stagione 26-27\\ACQUATICITA' stag. 26- 27.docx",
      ],
    },
    {
      key: "scuola_nuoto",
      label: "Scuola Nuoto Bambini settembre 2026",
      filename: "Scuola-Nuoto-Bambini-2026-27.docx",
      paths: [
        snbEnv,
        path.join(localDir, "scuola-nuoto-bambini-26-27.docx"),
        "\\\\ls220d3b7\\share\\societa\\CONDIVISA\\BAMBINI stagione 26-27\\SCUOLA NUOTO BAMBINI 26-27\\SNB da SETTEMBRE 2026  !!!.docx",
      ],
    },
  ]
  const filtered = corso ? candidates.filter((c) => c.key === corso) : candidates
  const out: BambiniDoc[] = []
  for (const c of filtered) {
    const filePath = c.paths.find((p) => p && fs.existsSync(p))
    if (!filePath) continue
    out.push({ key: c.key, label: c.label, filename: c.filename, filePath })
  }
  return out
}

function corsoLabel(corso: BambiniCorso): string {
  return corso === "acquaticita" ? "Acquaticità" : "Scuola Nuoto Bambini"
}

/** Rileva acquaticità vs scuola nuoto da lead / testo / età. */
export function detectBambiniCorso(opts: {
  lead?: {
    interesseDettaglio?: string | null
    note?: string | null
    categoria?: string | null
  } | null
  text?: string
  ageYears?: number | null
}): BambiniCorso | null {
  const blob = normText(
    [opts.text, opts.lead?.interesseDettaglio, opts.lead?.note, opts.lead?.categoria]
      .filter(Boolean)
      .join(" ")
  )
  const tag = String(opts.lead?.note ?? "").match(CORSO_TAG)
  if (tag) return tag[1].toLowerCase() === "acquaticita" ? "acquaticita" : "scuola_nuoto"

  if (
    /\bacquaticit/.test(blob) ||
    /\bliv\.?\s*[123]\b/.test(blob) ||
    /\b(mesi|neonat|lattant)/.test(blob) ||
    /\b0\s*[-–\/]\s*3(\s*anni?)?\b/.test(blob)
  ) {
    return "acquaticita"
  }
  if (/\bscuola\s*nuoto\b/.test(blob) || /\bsnb\b/.test(blob) || /\bnuoto\s*bambin/.test(blob)) {
    return "scuola_nuoto"
  }
  if (opts.ageYears != null && Number.isFinite(opts.ageYears)) {
    // Acquaticità fino a ~3,5 anni; da 4 anni → scuola nuoto
    return opts.ageYears < 4 ? "acquaticita" : "scuola_nuoto"
  }
  return null
}

function parseCorsoChoiceIt(text: string): BambiniCorso | null {
  const t = normText(text)
  if (!t) return null
  if (/\bacquaticit/.test(t) || /^acq\b/.test(t) || /\b0\s*[-–\/]\s*3(\s*anni?)?\b/.test(t)) {
    return "acquaticita"
  }
  if (/\bscuola\s*nuoto\b/.test(t) || /\bsnb\b/.test(t) || /^scuola\b/.test(t)) return "scuola_nuoto"
  return null
}

function askCorsoMsg(): string {
  return (
    `Per inviarti il documento giusto, dimmi se ti interessa:\n` +
    `👉 ACQUATICITÀ (dai 3 mesi ai 3 anni e mezzo)\n` +
    `👉 SCUOLA NUOTO (dai 4 anni in su)\n\n` +
    `Puoi anche scrivere età del bambino (es. «18 mesi» oppure «età 7»).`
  )
}

function askInfoChannelMsg(corso?: BambiniCorso | null): string {
  const corsoBit = corso ? ` ${corsoLabel(corso)}` : ""
  return (
    `Perfetto, ti mando le info${corsoBit}.\n\n` +
    `Dove le vuoi ricevere?\n` +
    `📲 INFO WHATSAPP → te le invio qui in chat\n` +
    `📧 INFO EMAIL → te le mando via email\n\n` +
    `Scrivi INFO WHATSAPP oppure INFO EMAIL.`
  )
}

/** Canale info: esplicito (INFO WHATSAPP) oppure risposta breve se stiamo aspettando. */
function parseInfoChannelIt(text: string, opts?: { allowShort?: boolean }): "wa" | "email" | null {
  const t = normText(text)
  if (!t) return null
  if (/\binfo\s*whatsapp\b/.test(t) && !/\binfo\s*(email|mail)\b/.test(t)) return "wa"
  if (/\binfo\s*(email|mail)\b/.test(t) && !/\binfo\s*whatsapp\b/.test(t)) return "email"
  if (!opts?.allowShort) return null
  if (/^(whatsapp|wa|qui|in chat|su whatsapp)$/.test(t)) return "wa"
  if (/^(email|e-mail|mail|via email|via mail)$/.test(t)) return "email"
  if (/\bwhatsapp\b/.test(t) && !/\b(email|mail)\b/.test(t)) return "wa"
  if (/\b(email|e-mail)\b/.test(t) && !/\bwhatsapp\b/.test(t)) return "email"
  return null
}

function persistCorsoOnLead(
  lead: { id: string; note?: string | null; stato?: string } | null | undefined,
  corso: BambiniCorso
) {
  if (!lead) return
  const prev = String(lead.note ?? "").replace(CORSO_TAG, "").trim()
  appendLeadNote(lead.id, `[corso:${corso}]`, {
    stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
  })
  // Se c'erano tag corso vecchi, normalizza note (appendLeadNote ha già aggiunto il nuovo tag)
  const cur = leadsStore.get(lead.id)
  if (cur) {
    const lines = String(cur.note ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    const without = lines.filter((l) => !CORSO_TAG.test(l))
    const next = [...without, `[corso:${corso}]`].join("\n")
    if (next !== cur.note) leadsStore.update(lead.id, { note: next })
  }
}

export async function sendBambiniInfoDocsWhatsapp(
  to: string,
  corso: BambiniCorso
): Promise<{ sent: string[]; missing: boolean }> {
  const docs = resolveBambiniDocs(corso)
  if (docs.length === 0) {
    await sendWhatsappText(
      to,
      `Al momento non trovo il file info ${corsoLabel(corso)} sul server.\n` +
        `Una consulente ti ricontatterà a breve, oppure consulta ${bambiniInfoUrl()}`
    )
    return { sent: [], missing: true }
  }
  const provaHint = isProveSnbSheetConfigured()
    ? `📅 Per prenotare la prova da WhatsApp rispondi così:\n` +
      (corso === "acquaticita"
        ? `👉 PRENOTA PROVA mercoledì 16/09 ore 16:15 età 12 mesi\n`
        : `👉 PRENOTA PROVA lunedì 14 settembre ore 17:00 età 7\n`) +
      `(giorno + data + orario + età)\n` +
      `Se indichi solo il giorno (es. mercoledì) uso la prossima data disponibile sul foglio.\n\n` +
      `In alternativa puoi chiamare il 0573 572649.`
    : `📞 Per prenotare la prova puoi contattarci al 0573 572649.`
  await sendWhatsappText(
    to,
    `Ti invio le info ${corsoLabel(corso)} stagione 2026-27:\n` +
      docs.map((d) => `• ${d.label}`).join("\n") +
      `\n\nPer individuare il gruppo e il posto in vasca più adatti, è necessario effettuare una prova in acqua ` +
      `per verificare il livello di acquaticità del bambino.\n\n` +
      `${provaHint}\n` +
      `Successivamente potremo procedere con l'iscrizione in base al livello e alle esigenze del bambino.`
  )
  const sent: string[] = []
  for (const d of docs) {
    await sendWhatsappDocument({
      toRaw: to,
      filePath: d.filePath,
      filename: d.filename,
      caption: d.label,
    })
    sent.push(d.label)
  }
  return { sent, missing: false }
}

/** Pulsante CRM: invia i documenti dal numero WhatsApp H2Sport (non dal cellulare del consulente). */
export async function sendLeadBambiniInfoFromCrm(params: {
  leadId: string
  corso?: BambiniCorso | null
}): Promise<{ sent: string[]; missing: boolean; corso: BambiniCorso; to: string; toDisplay: string }> {
  const lead = leadsStore.get(params.leadId)
  if (!lead) {
    const err = new Error("Lead non trovato") as Error & { status: number }
    err.status = 404
    throw err
  }
  const to = String(lead.telefono ?? "").trim()
  if (!to || to === "—") {
    const err = new Error("Telefono mancante sul lead") as Error & { status: number }
    err.status = 400
    throw err
  }
  const corso =
    params.corso ||
    detectBambiniCorso({ lead, text: `${lead.note ?? ""} ${lead.interesseDettaglio ?? ""}` })
  if (!corso) {
    const err = new Error("Scegli il corso: Acquaticità oppure Scuola nuoto") as Error & { status: number }
    err.status = 400
    throw err
  }
  const dests = extractItalianMobileDestinations(to)
  if (dests.length === 0) {
    const err = new Error("Numero del lead non valido per WhatsApp") as Error & { status: number }
    err.status = 400
    throw err
  }
  if (dests.length > 1) {
    const err = new Error(
      `Sul lead ci sono più numeri (${dests.map(formatWaDisplay).join(" e ")}). ` +
        `Lascia solo il cellulare del cliente e riprova.`
    ) as Error & { status: number }
    err.status = 400
    throw err
  }
  const dest = dests[0]
  const r = await sendBambiniInfoDocsWhatsapp(dest, corso)
  persistCorsoOnLead(lead, corso)
  appendLeadNote(
    lead.id,
    r.missing
      ? `WA info ${corsoLabel(corso)}: FILE NON TROVATO sul server (nessun documento inviato)`
      : `WA info ${corsoLabel(corso)}: ${r.sent.join(", ")} inviate a ${formatWaDisplay(dest)} dal WhatsApp H2Sport (non dal cellulare consulente)`,
    { stato: lead.stato === "nuovo" ? "contattato" : lead.stato }
  )
  if (r.missing) {
    const err = new Error(
      `File info ${corsoLabel(corso)} non trovato sul server. Controlla la share BAMBINI / .env documenti.`
    ) as Error & { status: number }
    err.status = 502
    throw err
  }
  return { ...r, corso, to: dest, toDisplay: formatWaDisplay(dest) }
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "")
}

function normText(raw: string): string {
  return stripAccents(String(raw ?? "").toLowerCase()).replace(/\s+/g, " ").trim()
}

export type ParsedSlotRequest = {
  weekday: number
  hour: number
  minute: number
  raw: string
  /** Giorno relativo esplicito (oggi/domani). */
  relative?: "oggi" | "domani"
  /** Data calendario esplicita (es. «7 settembre»). */
  day?: number
  month?: number
  year?: number
}

function weekdayInRome(d: Date): number {
  const wdShort =
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", weekday: "short" })
      .formatToParts(d)
      .find((p) => p.type === "weekday")?.value ?? ""
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[wdShort] ?? d.getDay()
}

/** Istante Europe/Rome per oggi/domani all'ora richiesta. */
function slotOnRelativeDay(
  relative: "oggi" | "domani",
  hour: number,
  minute: number,
  from = new Date()
): Date {
  const addDays = relative === "domani" ? 1 : 0
  const probe = new Date(from.getTime() + addDays * 86400000)
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(probe)
  const y = Number(parts.find((p) => p.type === "year")?.value)
  const m = Number(parts.find((p) => p.type === "month")?.value)
  const d = Number(parts.find((p) => p.type === "day")?.value)
  const asUtcGuess = Date.UTC(y, m - 1, d, hour, minute, 0)
  let best = new Date(asUtcGuess)
  for (const offH of [0, -1, -2, 1, 2]) {
    const cand = new Date(asUtcGuess + offH * 3600_000)
    const fp = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(cand)
    const get = (t: string) => fp.find((p) => p.type === t)?.value
    if (
      Number(get("year")) === y &&
      Number(get("month")) === m &&
      Number(get("day")) === d &&
      Number(get("hour")) === hour &&
      Number(get("minute")) === minute
    ) {
      best = cand
      break
    }
  }
  return best
}

/** Preferenza esplicita: richiamata da consulente (niente prenotazione automatica). */
export function parseCallbackRequestIt(text: string): boolean {
  const t = normText(text)
  if (!t || t.length > 200) return false
  // Non è una richiesta del cliente: è il nostro messaggio di benvenuto.
  if (/h2sport\.it/i.test(text) || /corsi adulti e programma/.test(t)) return false
  if (
    /\b(richiamatemi|richiamami|richiamateci|richiamaci|richiamarmi|richiamarlo)\b/.test(t) ||
    /\b(chiamatemi|chiamami|chiamateci|chiamaci)\b/.test(t) ||
    /\bricontattat[aeio]\b/.test(t) ||
    /\b(preferisco|vorrei)\b.{0,40}\b(essere\s+)?(ricontattat|chiamat|richiamat)/.test(t) ||
    /\b(mi\s+ricontattate|mi\s+richiamate|mi\s+chiamate)\b/.test(t) ||
    /\b(parlare\s+con|sentire)\s+(una\s+)?consulent/.test(t) ||
    /\bconsulent[ea]\b.{0,30}\b(chiami|richiami|ricontatt)/.test(t)
  ) {
    return true
  }
  // Frasi corte tipiche
  if (/^(richiamate|richiamami|chiamatemi|piu\s*tardi|più\s*tardi)$/.test(t)) return true
  return false
}

/** Annullamento appuntamento già fissato. */
export function parseCancelRequestIt(text: string): boolean {
  const t = normText(text)
  if (!t || t.length > 220) return false
  if (
    /\b(annulla|annullare|annullamento|annullate|annullami|cancellare|cancella|disdici|disdire|disdetta)\b/.test(
      t
    ) ||
    /\b(non\s+posso\s+(venire|passare|presentarmi)|non\s+riesco\s+a\s+venire)\b/.test(t) ||
    /\b(devo|vorrei|voglio)\s+annullare\b/.test(t)
  ) {
    return true
  }
  if (/^(annulla|annullare|cancella|disdici|non\s+posso\s+venire)$/.test(t)) return true
  if (/\b(annull|cancell|disdic)\w*\b/.test(t) && /\b(appuntamento|impegno|prenotazione|consulenza)\b/.test(t)) {
    return true
  }
  return false
}

function hasRelativeDay(t: string): boolean {
  return /\b(oggi|domani)\b/.test(t)
}

function hasWeekday(t: string): boolean {
  if (hasRelativeDay(t)) return true
  for (const k of Object.keys(WEEKDAY)) {
    if (new RegExp(`\\b${stripAccents(k)}\\b`, "i").test(t)) return true
  }
  return false
}

function hasTimeHint(t: string): boolean {
  if (/\b([01]?\d|2[0-3])[:\.]([0-5]\d)\b/.test(t)) return true
  if (/\b(mattina|pomeriggio|sera)\b/.test(t)) return true
  if (/\b(?:ore|alle)\s*([01]?\d|2[0-3])\b/.test(t)) return true
  if (/\b([01]?\d|2[0-3])\b/.test(t) && /\b(ore|alle)\b/.test(t)) return true
  return false
}

/** Solo orario (senza giorno), per completare una prova con giorno già in pending. */
function parseTimeOnlyIt(text: string): { hour: number; minute: number } | null {
  const t = normText(text)
  const hm = t.match(/\b([01]?\d|2[0-3])[:\.]([0-5]\d)\b/)
  if (hm) return { hour: Number(hm[1]), minute: Number(hm[2]) }
  if (/\bmattina\b/.test(t)) return { hour: 10, minute: 0 }
  if (/\bpomeriggio\b/.test(t)) return { hour: 16, minute: 0 }
  if (/\bsera\b/.test(t)) return { hour: 18, minute: 30 }
  const hOnly = t.match(/\b(?:ore|alle)\s*([01]?\d|2[0-3])\b/)
  if (hOnly) return { hour: Number(hOnly[1]), minute: 0 }
  return null
}

function takePendingProvaDay(from: string): PendingProvaDay | null {
  const p = pendingProvaDayByPhone.get(from)
  if (!p) return null
  if (p.expiresAt <= Date.now()) {
    pendingProvaDayByPhone.delete(from)
    return null
  }
  return p
}

function peekPendingCallback(from: string): PendingCallback | null {
  const p = pendingCallbackByPhone.get(from)
  if (!p) return null
  if (p.expiresAt <= Date.now()) {
    pendingCallbackByPhone.delete(from)
    return null
  }
  return p
}

function markCallbackPending(from: string) {
  pendingCallbackByPhone.set(from, {
    requestedAt: Date.now(),
    expiresAt: Date.now() + PENDING_CALLBACK_TTL_MS,
  })
  pendingProvaByPhone.delete(from)
  pendingProvaDayByPhone.delete(from)
}

function refreshCallbackPending(from: string) {
  const p = peekPendingCallback(from)
  if (!p) {
    markCallbackPending(from)
    return
  }
  p.expiresAt = Date.now() + PENDING_CALLBACK_TTL_MS
}

function callbackPreferenceMsg(raw: string): string {
  const clipped = raw.trim().replace(/\s+/g, " ").slice(0, 140)
  return (
    `Ok, ho segnato: «${clipped}».\n` +
    `Una consulente H2Sport ti richiamerà tenendone conto.`
  )
}

/** Fascia ricorrente / flessibile: non è un appuntamento in un giorno preciso. */
export function isRecurringAvailabilityIt(text: string): boolean {
  const t = normText(text)
  if (!t) return false
  if (/\b(tutti|tutte|ogni)\s+(i|le|il|la)?\s*(giorn|pomerig|mattin|ser)/.test(t)) return true
  if (/\b(tutti|tutte|ogni|qualsiasi|qualunque)\b.{0,24}\b(giorn|pomerig|mattin|ser|orari)\b/.test(t)) {
    return true
  }
  if (/\bquando\s+(volete|potete|puoi|riuscite|vuoi)\b/.test(t)) return true
  if (/\b(indifferente|quando\s+vi\s+pare)\b/.test(t)) return true
  if (/\bqualsiasi\s+(giorno|orario|momento)\b/.test(t)) return true
  return false
}


function hasBookingIntent(t: string): boolean {
  return (
    /\b(appuntamento|prenot|disponibil|orario|fascia|venire|passare|tour|visita|consulenza)\b/.test(t) ||
    hasWeekday(t) ||
    hasTimeHint(t)
  )
}

/** Domanda libera (orari, chiusure, piscina…): non è una prenotazione. */
export function looksLikeQuestionIt(text: string): boolean {
  const raw = String(text ?? "")
  const t = normText(raw)
  if (!t) return false
  if (/\?/.test(raw)) return true
  if (/\b(quando|quanto|quanti|dove|come|perche|quale|quali)\b/.test(t)) return true
  if (/\b(e\s+chius|e\s+apert|resta\s+chius|resta\s+apert|aprite|chiudete|apertura|chiusura)\b/.test(t)) {
    return true
  }
  if (/\b(si\s+puo|posso|potete|avete|c'e|ce\s+l'avete|sapete|mi\s+dite|mi\s+dici)\b/.test(t)) {
    return true
  }
  if (/\b(scusa|scusami|scusate|scusatemi)\b/.test(t) && t.length > 18) return true
  return false
}

/** Richiesta operativa da chi ha già il numero (vasca, corsi, abbonamento…). */
export function looksLikeOperationalQuestionIt(text: string): boolean {
  const t = normText(text)
  if (!t) return false
  return /\b(piscina|vasca|corsie|corsia|nuoto\s+libero|25\s*m|25mt|50\s*m|50mt|chius[aoe]|apert[aoe]|abbonament|tessera|ingresso|spogliatoio|parcheggio|sauna|idromassaggio)\b/.test(
    t
  )
}

function shouldHandoffAsQuestion(text: string): boolean {
  if (wantsExplicitAppointment(normText(text))) return false
  return looksLikeQuestionIt(text) || looksLikeOperationalQuestionIt(text)
}

/** Frase corta da prenotazione (es. «giovedì», «domani mattina»), non una domanda. */
function looksLikeSlotFragmentIt(text: string): boolean {
  if (shouldHandoffAsQuestion(text)) return false
  const t = normText(text)
  if (wantsExplicitAppointment(t) && (hasWeekday(t) || hasTimeHint(t))) return true
  const stripped = t
    .replace(
      /\b(ciao|salve|buongiorno|buonasera|ok|va bene|per favore|per piacere|grazie|vorrei|voglio|possibile)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim()
  return (hasWeekday(t) || hasTimeHint(t)) && stripped.length <= 36
}

function wantsBambiniInfo(t: string): boolean {
  return (
    /\b(info\s*whatsapp|info\s*email|info\s*mail|mandami\s+(le\s+)?info|costi|prezzi|tariff|orari|programma|brochure|preventivo)\b/.test(
      t
    ) || /\b(info|informazioni)\b/.test(t)
  )
}

function wantsExplicitAppointment(t: string): boolean {
  return /\b(appuntamento|prenot|venire|passare|fix|visita|in\s+sede)\b/.test(t)
}

/** Consulenza in sede (agenda A2), non prova sul foglio. */
function wantsSedeConsulenza(t: string): boolean {
  return (
    /\b(appuntamento|consulenza|in\s+sede|con\s+(una\s+)?consulent)\b/.test(t) && !/\bprova\b/.test(t)
  )
}

/** Intent prova in acqua (foglio SNB), non consulenza in sede. */
export function parseProvaIntentIt(text: string): boolean {
  const t = normText(text)
  if (!t) return false
  if (/\b(prenota\s+prova|prova\s+in\s+acqua|prova\s+in\s+vasca|prova\s+acqua)\b/.test(t)) return true
  if (/\bprova\b/.test(t) && /\b(prenot|fissa|vorrei|voglio|bambin|figli|acqua|vasca)\b/.test(t)) {
    return true
  }
  if (/^prova\b/.test(t)) return true
  return false
}

/** Età bambino: anni o mesi (acquaticità). */
export type ChildAgeParsed = { years: number; label: string }

export function parseChildAgeIt(text: string): ChildAgeParsed | null {
  const t = normText(text)
  if (!t) return null
  const mesi = t.match(/\b(?:eta|età)?\s*[:=]?\s*(\d{1,2})\s*mesi\b/) || t.match(/\b(\d{1,2})\s*mesi\b/)
  if (mesi) {
    const n = Number(mesi[1])
    if (n >= 1 && n <= 48) return { years: n / 12, label: `${n} mesi` }
  }
  const m1 = t.match(/\b(?:eta|età)\s*[:=]?\s*(\d{1,2})\b/)
  if (m1) {
    const n = Number(m1[1])
    if (n >= 1 && n <= 17) return { years: n, label: String(n) }
  }
  const m2 = t.match(/\b(\d{1,2})\s*anni?\b/)
  if (m2) {
    const n = Number(m2[1])
    if (n >= 1 && n <= 17) return { years: n, label: String(n) }
  }
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t)
    if (n >= 1 && n <= 17) return { years: n, label: String(n) }
  }
  return null
}

function provaGuideMsg(corso?: BambiniCorso | null): string {
  if (!isProveSnbSheetConfigured()) {
    return (
      `Per la prova in acqua (circa 10 minuti con istruttore) puoi chiamare il 0573 572649.\n` +
      `Ti aspettiamo a H2Sport! 💙`
    )
  }
  const ex =
    corso === "acquaticita"
      ? `👉 PRENOTA PROVA mercoledì 16/09 ore 16:15 età 12 mesi`
      : `👉 PRENOTA PROVA lunedì 14 settembre ore 17:00 età 7`
  return (
    `Per la prova in acqua (circa 10 minuti) rispondi con giorno, data, orario ed età, ad esempio:\n` +
    `${ex}\n` +
    `Se manca la data e scrivi solo «mercoledì», prendo la prossima data disponibile sul foglio (non per forza la settimana dopo).\n\n` +
    (corso
      ? `Foglio: ${corsoLabel(corso)}.\n`
      : `Indica anche ACQUATICITÀ o SCUOLA NUOTO se non l'hai ancora detto.\n`) +
    `In alternativa: 0573 572649.`
  )
}

function fmtProvaAlts(alts?: string[]): string {
  if (!alts?.length) return ""
  return `\nOrari liberi in quel giorno: ${alts.join(", ")}.`
}

async function completeProvaBooking(params: {
  from: string
  lead: {
    id: string
    nome?: string | null
    cognome?: string | null
    stato?: string
    interesseDettaglio?: string | null
    note?: string | null
    categoria?: string | null
  } | null
  text: string
  parsed: ParsedSlotRequest
  eta: ChildAgeParsed
  corso: BambiniCorso
}): Promise<{ handled: true; detail: string }> {
  const { from, lead, text, parsed, eta, corso } = params
  persistCorsoOnLead(lead, corso)

  const displayName = [lead?.nome, lead?.cognome].filter(Boolean).join(" ").trim() || "WA"
  const phoneDisplay = from.replace(/^39/, "")

  // oggi/domani → data assoluta; data esplicita (7 settembre); altrimenti weekday sul foglio
  const bookReq = parsed.relative
    ? {
        corso,
        when: slotOnRelativeDay(parsed.relative, parsed.hour, parsed.minute),
        hour: parsed.hour,
        minute: parsed.minute,
        nome: displayName,
        telefono: phoneDisplay,
        eta: eta.label,
      }
    : {
        corso,
        weekday: parsed.weekday,
        hour: parsed.hour,
        minute: parsed.minute,
        day: parsed.day,
        month: parsed.month,
        year: parsed.year,
        nome: displayName,
        telefono: phoneDisplay,
        eta: eta.label,
      }

  if (parsed.relative) {
    const inizio = bookReq.when!
    if (inizio.getTime() <= Date.now() + 60_000) {
      await sendWhatsappText(
        from,
        `Per ${parsed.relative} quell'orario è già passato o troppo vicino.\n\n` + provaGuideMsg()
      )
      return { handled: true, detail: "prova slot relativo passato" }
    }
  }

  const result = await bookProveSnbSlot(bookReq)

  pendingProvaByPhone.delete(from)

  if (result.ok) {
    pendingProvaDayByPhone.delete(from)
    const msg =
      `Perfetto! Prova in acqua prenotata:\n` +
      `${result.dayLabel} — ore ${result.orario} — età ${eta.label}\n\n` +
      `Portate: costume, cuffia, ciabatte, accappatoio e occorrente per lavarsi ` +
      `(anche ciabatte per il genitore).\n` +
      `H2Sport — 0573 572649`
    await sendWhatsappText(from, msg)
    whatsappEventsStore.append({
      kind: "booking",
      from,
      text: `prova ${corso} ${result.dayLabel} ${result.orario} età ${eta.label}`,
      status: "ok",
      raw: { result, text, eta, corso },
    })
    if (lead) {
      appendLeadNote(
        lead.id,
        `WA prova in acqua (${corsoLabel(corso)}): ${result.dayLabel} ore ${result.orario} età ${eta.label} (riga ${result.row})`,
        { stato: "appuntamento_prova", categoria: "bambini" }
      )
    }
    return { handled: true, detail: `prova ${corso} ${result.dayLabel} ${result.orario}` }
  }

  if (result.reason === "not_configured") {
    await sendWhatsappText(
      from,
      `Per prenotare la prova in acqua chiama il 0573 572649: ti fissiamo lo slot in sede.`
    )
    if (lead) appendLeadNote(lead.id, `WA prova: foglio non configurato («${text}»)`)
    return { handled: true, detail: "prova sheet not configured" }
  }

  if (result.reason === "slot_taken" || result.reason === "slot_not_found") {
    pendingProvaDayByPhone.set(from, {
      weekday: parsed.weekday,
      relative: parsed.relative,
      day: parsed.day,
      month: parsed.month,
      year: parsed.year,
      corso,
      etaLabel: eta.label,
      etaYears: eta.years,
      expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
    })
  }

  if (result.reason === "slot_taken") {
    await sendWhatsappText(
      from,
      `Quell'orario per la prova è già occupato.${fmtProvaAlts(result.alternatives)}\n\n` +
        `Puoi rispondere solo con un altro orario (es. ore 16:15), tengo il giorno già scelto.\n` +
        `Oppure chiama 0573 572649.`
    )
    if (lead) appendLeadNote(lead.id, `WA prova slot occupato: «${text}»`)
    return { handled: true, detail: "prova slot taken" }
  }

  if (result.reason === "day_not_found") {
    const giorni = result.alternatives?.length
      ? `\nGiorni sul foglio: ${result.alternatives.join(", ")}.`
      : ""
    await sendWhatsappText(
      from,
      `Quel giorno non è sul foglio prove.${giorni}\n\n` +
        `Scegli un giorno in elenco + data + orario + età, oppure chiama 0573 572649.`
    )
    if (lead) {
      appendLeadNote(lead.id, `WA prova giorno non in foglio: «${text}» (${result.detail ?? ""})`)
    }
    return { handled: true, detail: "prova day_not_found" }
  }

  if (result.reason === "slot_not_found") {
    await sendWhatsappText(
      from,
      `Non trovo quell'orario sul foglio prove.${fmtProvaAlts(result.alternatives)}\n\n` +
        `Rispondi solo con un orario in elenco (es. ore 16:15): tengo già il giorno.\n` +
        `Oppure chiama 0573 572649.`
    )
    if (lead) {
      appendLeadNote(lead.id, `WA prova giorno/ora non in foglio: «${text}» (${result.detail ?? ""})`)
    }
    return { handled: true, detail: `prova ${result.reason}` }
  }

  await sendWhatsappText(
    from,
    `Ho ricevuto la richiesta di prova, ma non sono riuscito a scriverla sul foglio in automatico.\n` +
      `Chiama pure il 0573 572649: ti fissiamo lo slot.`
  )
  if (lead) appendLeadNote(lead.id, `WA prova ERRORE foglio: ${result.detail ?? result.reason} («${text}»)`)
  return { handled: true, detail: `prova api_error: ${result.detail ?? ""}` }
}

/** Es. "Mercoledì ore 17:30", "lunedì 7 settembre 17:00", "oggi 18:00". */
export function parseSlotRequestIt(text: string): ParsedSlotRequest | null {
  const raw = String(text ?? "").trim()
  if (!raw) return null
  const t = normText(raw)

  const MONTHS: Record<string, number> = {
    gennaio: 1,
    febbraio: 2,
    marzo: 3,
    aprile: 4,
    maggio: 5,
    giugno: 6,
    luglio: 7,
    agosto: 8,
    settembre: 9,
    ottobre: 10,
    novembre: 11,
    dicembre: 12,
  }

  let day: number | undefined
  let month: number | undefined
  let year: number | undefined
  const mName = t.match(
    /\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?\b/
  )
  if (mName) {
    day = Number(mName[1])
    month = MONTHS[mName[2]]
    if (mName[3]) year = Number(mName[3])
  } else {
    const mSlash = t.match(/\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?\b/)
    if (mSlash) {
      day = Number(mSlash[1])
      month = Number(mSlash[2])
      if (mSlash[3]) {
        const y = Number(mSlash[3])
        year = y < 100 ? 2000 + y : y
      }
    }
  }

  let weekday: number | null = null
  let relative: "oggi" | "domani" | undefined
  if (/\boggi\b/.test(t)) {
    weekday = weekdayInRome(new Date())
    relative = "oggi"
  } else if (/\bdomani\b/.test(t)) {
    weekday = weekdayInRome(new Date(Date.now() + 86400000))
    relative = "domani"
  } else {
    for (const [k, v] of Object.entries(WEEKDAY)) {
      const key = stripAccents(k)
      if (new RegExp(`\\b${key}\\b`, "i").test(t)) {
        weekday = v
        break
      }
    }
  }

  // Se c'è solo «7 settembre» senza lunedì, ricava weekday dalla data
  if (weekday == null && day != null && month != null) {
    const y = year ?? romeYmdFromPartsFallback()
    const wd = weekdayFromYmd(y, month, day)
    if (wd != null) weekday = wd
  }
  if (weekday == null) return null

  let hour = 10
  let minute = 0
  const hm = t.match(/\b([01]?\d|2[0-3])[:\.]([0-5]\d)\b/)
  if (hm) {
    hour = Number(hm[1])
    minute = Number(hm[2])
  } else if (/\bmattina\b/.test(t)) {
    hour = 10
    minute = 0
  } else if (/\bpomeriggio\b/.test(t)) {
    hour = 16
    minute = 0
  } else if (/\bsera\b/.test(t)) {
    hour = 18
    minute = 30
  } else {
    // Richiede «ore»/«alle» così «7 settembre» non viene letto come ora 7
    const hOnly = t.match(/\b(?:ore|alle)\s*([01]?\d|2[0-3])\b/)
    if (hOnly) hour = Number(hOnly[1])
    else return null
  }

  return { weekday, hour, minute, raw, relative, day, month, year }
}

function romeYmdFromPartsFallback(): number {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric" })
    .formatToParts(new Date())
    .find((p) => p.type === "year")?.value
    ? Number(
        new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric" })
          .formatToParts(new Date())
          .find((p) => p.type === "year")?.value
      )
    : new Date().getFullYear()
}

/** Weekday 0=dom…6=sab per Y-M-D in Europe/Rome (mezzogiorno). */
function weekdayFromYmd(year: number, month: number, day: number): number | null {
  if (!year || !month || !day) return null
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return weekdayInRome(probe)
}

/** Prossima occorrenza del giorno settimanale all'orario indicato (Europe/Rome). */
export function nextOccurrence(weekday: number, hour: number, minute: number, from = new Date()): Date {
  // Itera i prossimi 8 giorni in fuso Roma
  for (let add = 0; add <= 7; add++) {
    const probe = new Date(from.getTime() + add * 24 * 60 * 60 * 1000)
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Rome",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(probe)
    const wdShort = parts.find((p) => p.type === "weekday")?.value ?? ""
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const wd = map[wdShort]
    if (wd !== weekday) continue
    const y = Number(parts.find((p) => p.type === "year")?.value)
    const m = Number(parts.find((p) => p.type === "month")?.value)
    const d = Number(parts.find((p) => p.type === "day")?.value)
    const asUtcGuess = Date.UTC(y, m - 1, d, hour, minute, 0)
    let best = new Date(asUtcGuess)
    for (const offH of [0, -1, -2, 1, 2]) {
      const cand = new Date(asUtcGuess + offH * 3600_000)
      const fp = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(cand)
      const get = (t: string) => fp.find((p) => p.type === t)?.value
      if (
        Number(get("year")) === y &&
        Number(get("month")) === m &&
        Number(get("day")) === d &&
        Number(get("hour")) === hour &&
        Number(get("minute")) === minute
      ) {
        best = cand
        break
      }
    }
    if (best.getTime() > from.getTime() + 60_000) return best
  }
  // fallback: +7 giorni dall'inizio calcolato grezzo
  const fallback = new Date(from.getTime() + 7 * 86400000)
  fallback.setHours(hour, minute, 0, 0)
  return fallback
}

function fmtIt(d: Date): string {
  return d.toLocaleString("it-IT", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const LEAD_STATO_CLOSED = new Set(["chiuso_vinto", "chiuso_perso"])

/** Preferisci lead recenti aperti: con numeri duplicati `.find()` prendeva il primo (spesso vecchio). */
function findLeadByPhone(phone: string) {
  const matches = findLeadsByPhone(phone)
  return matches[0] ?? null
}

function findLeadsByPhone(phone: string) {
  const matches = leadsStore.list({}).filter((l) => phonesMatch(l.telefono, phone))
  if (matches.length === 0) return []
  const rank = (stato: string) => {
    if (stato === "nuovo" || stato === "contattato") return 0
    if (stato === "appuntamento" || stato === "appuntamento_prova" || stato === "tour" || stato === "proposta") return 1
    if (LEAD_STATO_CLOSED.has(stato)) return 3
    return 2
  }
  matches.sort((a, b) => {
    const ra = rank(a.stato)
    const rb = rank(b.stato)
    if (ra !== rb) return ra - rb
    return String(b.createdAt).localeCompare(String(a.createdAt))
  })
  return matches
}

/** Dopo annullamento: aggiorna solo i lead dello stesso segmento (adulti vs bambini). */
function markLeadsContattatoAfterCancel(phone: string, noteLine: string, segmento: AgendaSegmento) {
  for (const lead of findLeadsByPhone(phone)) {
    if (LEAD_STATO_CLOSED.has(lead.stato)) continue
    const leadBambini = isLeadBambini(lead)
    if (segmento === "bambini" && !leadBambini) continue
    if (segmento === "adulti" && leadBambini) continue
    appendLeadNote(lead.id, noteLine, {
      stato:
        lead.stato === "appuntamento" ||
        lead.stato === "appuntamento_prova" ||
        lead.stato === "tour" ||
        lead.stato === "proposta"
          ? "contattato"
          : lead.stato,
    })
  }
}

/** Lead più recente in stato appuntamento (per capire se annullare adulti o bambini). */
function pickLeadForCancel(phone: string) {
  const all = findLeadsByPhone(phone)
  const withApp = all.filter((l) => l.stato === "appuntamento" || l.stato === "appuntamento_prova")
  if (withApp.length > 0) {
    return [...withApp].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null
  }
  return all[0] ?? null
}

function isLeadBambini(lead: { categoria?: string | null; interesseDettaglio?: string | null; note?: string | null } | null): boolean {
  if (!lead) return false
  if (lead.categoria === "bambini") return true
  const blob = `${lead.interesseDettaglio ?? ""} ${lead.note ?? ""}`
  return /\b(bambin|campus|scuola\s*nuoto|nuoto\s*bambin|acquaticit)\b/i.test(blob)
}

function appendLeadNote(leadId: string, line: string, patch: Record<string, unknown> = {}) {
  const lead = leadsStore.get(leadId)
  if (!lead) return
  leadsStore.update(leadId, {
    ...patch,
    note: [lead.note, line].filter(Boolean).join("\n"),
  })
}

/**
 * Gestisce un messaggio inbound. Idempotente su waMessageId.
 * Ritorna true se ha tentato una prenotazione (ok o ko con reply).
 */
export async function handleWhatsappInboundBooking(params: {
  from?: string
  text?: string
  waMessageId?: string
}): Promise<{ handled: boolean; detail?: string }> {
  const waId = String(params.waMessageId ?? "").trim()
  if (waId) {
    if (processedWaIds.has(waId)) return { handled: false, detail: "già processato" }
    processedWaIds.add(waId)
    if (processedWaIds.size > MAX_PROCESSED) {
      const first = processedWaIds.values().next().value
      if (first) processedWaIds.delete(first)
    }
  }

  const from = normalizeWaTo(params.from ?? "") ?? String(params.from ?? "").replace(/\D/g, "")
  const text = String(params.text ?? "").trim()
  if (!from || !text || text.startsWith("[")) return { handled: false, detail: "no text" }

  if (!isWhatsappSendConfigured()) {
    return { handled: false, detail: "whatsapp non configurato" }
  }

  const lead = findLeadByPhone(from)
  const t = normText(text)

  const isWelcomeEcho =
    /h2sport\.it\/#attivita/i.test(text) ||
    /corsi adulti e programma/i.test(t) ||
    /nuoto-libero-da-settembre-2026/i.test(text) ||
    /una consulente h2sport ti richiamera/.test(t) ||
    /la richiesta di ricontatto e gia in carico/.test(t) ||
    /non serve indicare giorno e ora/.test(t) ||
    /non sono riuscito a gestirlo in automatico/.test(t) ||
    (/grazie per aver richiesto informazioni sui nostri corsi per bambini/.test(t) &&
      /info whatsapp/.test(t) &&
      /prenota prova/.test(t)) ||
    (/dove le vuoi ricevere/.test(t) && /info whatsapp/.test(t) && /info email/.test(t))

  // Eco del follow-up che abbiamo appena inviato (Meta a volte lo rimanda come inbound).
  if (isWelcomeEcho) {
    return { handled: true, detail: "echo follow-up ignorato" }
  }

  // Ogni testo del cliente va in note (sito e Facebook Ads), se il telefono combacia.
  if (lead) {
    appendLeadNote(lead.id, `WA: «${text}»`)
  }

  // 0) Annullamento: solo il segmento del lead (adulti vs bambini), non entrambi
  if (parseCancelRequestIt(text)) {
    try {
      const leadCancel = pickLeadForCancel(from) ?? lead
      const segmento: AgendaSegmento = isLeadBambini(leadCancel) ? "bambini" : "adulti"
      let upcomingList = await findAllUpcomingConsulenzeByPhone(from, segmento)
      // Se sul segmento del lead non c'è nulla, non toccare l'altro segmento: chiedi chiarimento
      if (upcomingList.length === 0) {
        const otherSeg: AgendaSegmento = segmento === "bambini" ? "adulti" : "bambini"
        const other = await findAllUpcomingConsulenzeByPhone(from, otherSeg)
        if (other.length > 0) {
          const whenTxt = other.map((c) => fmtIt(c.inizio)).join(", ")
          await sendWhatsappText(
            from,
            `Ho trovato appuntament${other.length > 1 ? "i" : "o"} in agenda ${otherSeg} (${whenTxt}), ` +
              `ma la richiesta sembra relativa a ${segmento}.\n\n` +
              `Scrivi «annulla adulti» oppure «annulla bambini» per scegliere quale cancellare.`
          )
          if (leadCancel) {
            appendLeadNote(
              leadCancel.id,
              `WA annullamento ambiguo: lead ${segmento}, slot su ${otherSeg} («${text}»)`
            )
          }
          return { handled: true, detail: "annullamento ambiguo adulti/bambini" }
        }
        await sendWhatsappText(
          from,
          `Non ho trovato un appuntamento futuro collegato a questo numero.\n` +
            `Se pensavi di averne uno, scrivi «richiamatemi» e una consulente ti aiuta.\n` +
            `Per fissarne uno nuovo, rispondi con giorno e orario (es. Giovedì 17:00).`
        )
        if (leadCancel) {
          appendLeadNote(leadCancel.id, `WA annullamento senza appuntamento trovato («${text}»)`)
        }
        whatsappEventsStore.append({
          kind: "booking",
          from,
          text: `cancel_miss: ${text}`,
          status: "none",
          raw: { text, segmento },
        })
        return { handled: true, detail: "annullamento: nessun appuntamento" }
      }

      // Preferenza esplicita nel testo
      const wantAdulti = /\bannull\w*\s+adulti\b/.test(t)
      const wantBambini = /\bannull\w*\s+bambin/.test(t)
      if (wantAdulti || wantBambini) {
        const forced: AgendaSegmento = wantBambini ? "bambini" : "adulti"
        upcomingList = await findAllUpcomingConsulenzeByPhone(from, forced)
        if (upcomingList.length === 0) {
          await sendWhatsappText(
            from,
            `Non ho trovato appuntamenti futuri in agenda ${forced} per questo numero.`
          )
          return { handled: true, detail: `annullamento: nessuno su ${forced}` }
        }
        const cancelled = []
        for (const upcoming of upcomingList) {
          await cancelConsulenzaAppuntamento({
            idAppuntamento: upcoming.idAppuntamento,
            idIscrizione: upcoming.idIscrizione,
            reasonNote: `Annullato WA (${forced}): ${text}`.slice(0, 180),
          })
          cancelled.push(upcoming)
        }
        const whenTxt = cancelled.map((c) => fmtIt(c.inizio)).join(", ")
        await sendWhatsappText(
          from,
          `Ok, ho annullato ${cancelled.length === 1 ? "l'appuntamento" : `${cancelled.length} appuntamenti`} ${forced}: ${whenTxt}.`
        )
        markLeadsContattatoAfterCancel(
          from,
          `WA annullati (${forced}): ${cancelled.map((c) => `#${c.idAppuntamento} ${fmtIt(c.inizio)}`).join("; ")} («${text}»)`,
          forced
        )
        whatsappEventsStore.append({
          kind: "booking",
          from,
          text: `annullati ${forced} ${cancelled.map((c) => `#${c.idAppuntamento}`).join(", ")}`,
          status: "cancelled",
          raw: { cancelled, text, segmento: forced },
        })
        return { handled: true, detail: `annullati ${cancelled.length} ${forced}` }
      }

      const cancelled = []
      for (const upcoming of upcomingList) {
        await cancelConsulenzaAppuntamento({
          idAppuntamento: upcoming.idAppuntamento,
          idIscrizione: upcoming.idIscrizione,
          reasonNote: `Annullato WA (${segmento}): ${text}`.slice(0, 180),
        })
        cancelled.push(upcoming)
      }

      const whenTxt = cancelled.map((c) => fmtIt(c.inizio)).join(", ")
      await sendWhatsappText(
        from,
        cancelled.length === 1
          ? `Ok, ho annullato il tuo appuntamento ${segmento} del ${whenTxt}.\n\n` +
              `Se vuoi riprenotare, rispondi con un nuovo giorno e orario (es. Venerdì 18:00).\n` +
              `Oppure scrivi «richiamatemi» per parlare con una consulente.`
          : `Ok, ho annullato ${cancelled.length} appuntamenti ${segmento} (${whenTxt}).\n\n` +
              `Se vuoi riprenotare, rispondi con un nuovo giorno e orario.\n` +
              `Oppure scrivi «richiamatemi».`
      )
      markLeadsContattatoAfterCancel(
        from,
        `WA annullati (${segmento}): ${cancelled.map((c) => `#${c.idAppuntamento} ${fmtIt(c.inizio)}`).join("; ")} («${text}»)`,
        segmento
      )
      whatsappEventsStore.append({
        kind: "booking",
        from,
        text: `annullati ${segmento} ${cancelled.map((c) => `#${c.idAppuntamento}`).join(", ")}`,
        status: "cancelled",
        raw: { cancelled, text, segmento },
      })
      return { handled: true, detail: `annullati ${cancelled.length} ${segmento}` }
    } catch (e) {
      const err = (e as Error)?.message ?? String(e)
      console.error("[whatsapp-booking] cancel:", err)
      whatsappEventsStore.append({
        kind: "booking",
        from,
        text: `cancel_error: ${err} | ${text}`,
        status: "error",
        raw: { err, text },
      })
      await sendWhatsappText(
        from,
        `Ho ricevuto la richiesta di annullamento, ma non sono riuscito a chiudere l'appuntamento in automatico.\n` +
          `Una consulente ti ricontatterà a breve per confermare.`
      )
      if (lead) {
        appendLeadNote(lead.id, `WA annullamento ERRORE: ${err} («${text}»)`)
      }
      return { handled: true, detail: `errore annullamento: ${err}` }
    }
  }

  // 1) Preferisce ricontatto da consulente (non è un appuntamento in sede)
  if (parseCallbackRequestIt(text)) {
    const already = peekPendingCallback(from)
    if (already) {
      refreshCallbackPending(from)
      await sendWhatsappText(from, CALLBACK_AGAIN_MSG)
      if (lead) {
        appendLeadNote(lead.id, `WA: ricontatto già in carico («${text}»)`, {
          stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
        })
      }
      return { handled: true, detail: "ricontatto già in carico" }
    }
    markCallbackPending(from)
    await sendWhatsappText(from, CALLBACK_MSG)
    if (lead) {
      appendLeadNote(lead.id, `WA: richiede ricontatto consulente («${text}»)`, {
        stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
      })
    }
    return { handled: true, detail: "ricontatto consulente" }
  }

  // 1a) Dopo «richiamatemi»: fascia oraria / giorno incompleto = nota per la chiamata
  {
    const pendingCb = peekPendingCallback(from)
    if (pendingCb) {
      const parsedCb = parseSlotRequestIt(text)
      const completeSlot = Boolean(parsedCb && hasWeekday(t) && hasTimeHint(t))
      const leaveToOtherFlow =
        completeSlot ||
        parseProvaIntentIt(text) ||
        wantsBambiniInfo(t) ||
        wantsSedeConsulenza(t) ||
        wantsExplicitAppointment(t) ||
        shouldHandoffAsQuestion(text)
      if (completeSlot) {
        pendingCallbackByPhone.delete(from)
      } else if (!leaveToOtherFlow) {
        const politeAck = /^(ok|va bene|grazie|perfetto|si|sì|no|👍|🙏)\b/.test(t) || t.length <= 2
        if (politeAck) {
          return { handled: false, detail: "ack dopo ricontatto" }
        }
        const isPref =
          isRecurringAvailabilityIt(text) ||
          (hasTimeHint(t) && !hasWeekday(t)) ||
          (hasWeekday(t) && !hasTimeHint(t))
        if (isPref) {
          refreshCallbackPending(from)
          await sendWhatsappText(from, callbackPreferenceMsg(text))
          if (lead) {
            appendLeadNote(lead.id, `WA nota per la chiamata: «${text}»`, {
              stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
            })
          }
          return { handled: true, detail: "nota ricontatto" }
        }
      }
    }
  }

  // 1b) Bambini: INFO / prova foglio (acquaticità vs scuola nuoto), guida
  if (isLeadBambini(lead)) {
    // Risposta a richiesta corso per INFO
    const pendingInfo = pendingInfoCorsoByPhone.get(from)
    if (pendingInfo && pendingInfo.expiresAt > Date.now()) {
      const ageForCorso = parseChildAgeIt(text)
      const corsoChoice =
        parseCorsoChoiceIt(text) ||
        (ageForCorso ? detectBambiniCorso({ ageYears: ageForCorso.years }) : null)
      if (corsoChoice) {
        pendingInfoCorsoByPhone.delete(from)
        persistCorsoOnLead(lead, corsoChoice)
        if (pendingInfo.channel === "wa") {
          const r = await sendBambiniInfoDocsWhatsapp(from, corsoChoice)
          if (lead) {
            appendLeadNote(
              lead.id,
              r.missing
                ? `WA info ${corsoLabel(corsoChoice)}: documento non trovato («${text}»)`
                : `WA info ${corsoLabel(corsoChoice)}: ${r.sent.join(", ")} («${text}»)`,
              { stato: lead.stato === "nuovo" ? "contattato" : lead.stato }
            )
          }
          return {
            handled: true,
            detail: r.missing ? "info docs missing" : `info wa ${corsoChoice}`,
          }
        }
        // channel email: corso salvato → ripeti flusso email sotto se utente riscrive INFO EMAIL
        await sendWhatsappText(
          from,
          `Ok, ${corsoLabel(corsoChoice)}. Scrivi di nuovo «INFO EMAIL» per ricevere il documento.`
        )
        return { handled: true, detail: `corso email ${corsoChoice}` }
      }
    } else if (pendingInfo) {
      pendingInfoCorsoByPhone.delete(from)
    }

    const pendingCh = pendingInfoChannelByPhone.get(from)
    const pendingChOk = Boolean(pendingCh && pendingCh.expiresAt > Date.now())
    if (pendingCh && !pendingChOk) pendingInfoChannelByPhone.delete(from)

    let infoCorsoHint: BambiniCorso | undefined
    let forcedInfoChannel: "wa" | "email" | null = null

    if (pendingChOk && pendingCh) {
      const ch = parseInfoChannelIt(text, { allowShort: true })
      if (!ch) {
        const ageForCorso = parseChildAgeIt(text)
        const corsoChoice =
          parseCorsoChoiceIt(text) ||
          (ageForCorso ? detectBambiniCorso({ ageYears: ageForCorso.years }) : null)
        if (corsoChoice) {
          persistCorsoOnLead(lead, corsoChoice)
          pendingInfoChannelByPhone.set(from, {
            corso: corsoChoice,
            expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
          })
          await sendWhatsappText(from, askInfoChannelMsg(corsoChoice))
          return { handled: true, detail: "info corso ok attesa canale" }
        }
        await sendWhatsappText(from, askInfoChannelMsg(pendingCh.corso ?? null))
        return { handled: true, detail: "info attesa canale (ripeti)" }
      }
      pendingInfoChannelByPhone.delete(from)
      forcedInfoChannel = ch
      infoCorsoHint = pendingCh.corso
    }

    // Completa prova in attesa di età / corso
    const pending = pendingProvaByPhone.get(from)
    if (pending) {
      if (pending.expiresAt <= Date.now()) {
        pendingProvaByPhone.delete(from)
      } else {
        const etaPending = parseChildAgeIt(text)
        if (etaPending != null) {
          const corso =
            pending.corso ||
            detectBambiniCorso({ lead, text, ageYears: etaPending.years }) ||
            parseCorsoChoiceIt(text)
          if (!corso) {
            await sendWhatsappText(
              from,
              `Età ricevuta (${etaPending.label}).\n` +
                `Ora indica il corso: ACQUATICITÀ oppure SCUOLA NUOTO.`
            )
            pendingProvaByPhone.set(from, {
              ...pending,
              expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
            })
            return { handled: true, detail: "prova attesa corso" }
          }
          return completeProvaBooking({
            from,
            lead,
            text,
            parsed: {
              weekday: pending.weekday,
              hour: pending.hour,
              minute: pending.minute,
              relative: pending.relative,
              day: pending.day,
              month: pending.month,
              year: pending.year,
              raw: pending.raw,
            },
            eta: etaPending,
            corso,
          })
        }
        const corsoOnly = parseCorsoChoiceIt(text)
        if (corsoOnly && !pending.corso) {
          pendingProvaByPhone.set(from, {
            ...pending,
            corso: corsoOnly,
            expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
          })
          persistCorsoOnLead(lead, corsoOnly)
          await sendWhatsappText(
            from,
            `Ok, ${corsoLabel(corsoOnly)}. Quanti anni/mesi ha il bambino? (es. 7 oppure 18 mesi)`
          )
          return { handled: true, detail: "prova corso ok attesa età" }
        }
      }
    }

    if (
      parseProvaIntentIt(text) ||
      // Lead bambini: «prenota lunedì…» → foglio prove (non agenda A2), salvo richiesta sede/consulenza
      (!!parseSlotRequestIt(text) && /\bprenot/.test(t) && !wantsSedeConsulenza(t)) ||
      // Solo orario dopo «orario non trovato» (giorno già scelto)
      (!!takePendingProvaDay(from) && hasTimeHint(t) && !hasWeekday(t) && !wantsSedeConsulenza(t))
    ) {
      const pendingDay = takePendingProvaDay(from)
      let parsedProva = parseSlotRequestIt(text)
      if (!parsedProva && pendingDay) {
        const tm = parseTimeOnlyIt(text)
        if (tm) {
          parsedProva = {
            weekday: pendingDay.weekday,
            hour: tm.hour,
            minute: tm.minute,
            relative: pendingDay.relative,
            day: pendingDay.day,
            month: pendingDay.month,
            year: pendingDay.year,
            raw: text,
          }
        }
      }
      const eta =
        parseChildAgeIt(text) ||
        (pendingDay?.etaLabel != null && pendingDay.etaYears != null
          ? { years: pendingDay.etaYears, label: pendingDay.etaLabel }
          : null)
      const corso =
        parseCorsoChoiceIt(text) ||
        pendingDay?.corso ||
        detectBambiniCorso({ lead, text, ageYears: eta?.years ?? null })
      if (!parsedProva) {
        await sendWhatsappText(from, provaGuideMsg(corso))
        if (lead) {
          appendLeadNote(lead.id, `WA guida prova in acqua («${text}»)`, {
            stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
          })
        }
        return { handled: true, detail: "guida prova" }
      }
      if (!corso) {
        pendingProvaByPhone.set(from, {
          weekday: parsedProva.weekday,
          hour: parsedProva.hour,
          minute: parsedProva.minute,
          relative: parsedProva.relative,
          day: parsedProva.day,
          month: parsedProva.month,
          year: parsedProva.year,
          raw: parsedProva.raw,
          expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
        })
        await sendWhatsappText(
          from,
          `Ok per lo slot. Prima dimmi il corso:\n` +
            `👉 ACQUATICITÀ oppure 👉 SCUOLA NUOTO\n` +
            (eta ? `(età già nota: ${eta.label})\n` : `Poi indica anche l'età.\n`)
        )
        return { handled: true, detail: "prova attesa corso" }
      }
      if (eta == null) {
        pendingProvaByPhone.set(from, {
          weekday: parsedProva.weekday,
          hour: parsedProva.hour,
          minute: parsedProva.minute,
          relative: parsedProva.relative,
          day: parsedProva.day,
          month: parsedProva.month,
          year: parsedProva.year,
          raw: parsedProva.raw,
          corso,
          expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
        })
        const dayNames = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"]
        const dayHint =
          parsedProva.day != null && parsedProva.month != null
            ? `${parsedProva.day}/${parsedProva.month}`
            : parsedProva.relative
              ? parsedProva.relative
              : dayNames[parsedProva.weekday] ?? "quel giorno"
        const hh = String(parsedProva.hour).padStart(2, "0")
        const mm = String(parsedProva.minute).padStart(2, "0")
        await sendWhatsappText(
          from,
          `Ok (${corsoLabel(corso)}), segno la prova per ${dayHint} alle ${hh}:${mm}.\n` +
            `Quanti anni/mesi ha il bambino? (es. 7 oppure 18 mesi)`
        )
        if (lead) appendLeadNote(lead.id, `WA prova ${corso}: attesa età («${text}»)`)
        return { handled: true, detail: "prova attesa età" }
      }
      return completeProvaBooking({ from, lead, text, parsed: parsedProva, eta, corso })
    }

    const infoMail = forcedInfoChannel === "email" || parseInfoChannelIt(text) === "email"
    // In chat WhatsApp le info partono dal numero H2Sport, senza chiedere il canale.
    const infoWa =
      !infoMail &&
      (forcedInfoChannel === "wa" ||
        parseInfoChannelIt(text) === "wa" ||
        wantsBambiniInfo(t))

    const resolveInfoCorso = (): BambiniCorso | null =>
      parseCorsoChoiceIt(text) ||
      infoCorsoHint ||
      detectBambiniCorso({
        lead,
        text,
        ageYears: parseChildAgeIt(text)?.years ?? null,
      })

    if (infoWa) {
      const corso = resolveInfoCorso()
      if (!corso) {
        pendingInfoCorsoByPhone.set(from, {
          channel: "wa",
          expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
        })
        await sendWhatsappText(from, askCorsoMsg())
        if (lead) appendLeadNote(lead.id, `WA info: attesa corso («${text}»)`)
        return { handled: true, detail: "info wa attesa corso" }
      }
      persistCorsoOnLead(lead, corso)
      const r = await sendBambiniInfoDocsWhatsapp(from, corso)
      if (lead) {
        appendLeadNote(
          lead.id,
          r.missing
            ? `WA info ${corsoLabel(corso)}: documento non trovato («${text}»)`
            : `WA info ${corsoLabel(corso)}: ${r.sent.join(", ")} («${text}»)`,
          { stato: lead.stato === "nuovo" ? "contattato" : lead.stato }
        )
      }
      return { handled: true, detail: r.missing ? "info docs missing" : `info wa ${corso}` }
    }

    if (infoMail) {
      const email = String(lead?.email ?? "").trim()
      if (!email || email === "—") {
        await sendWhatsappText(
          from,
          `Per inviarti le info via email mi serve un indirizzo.\n` +
            `Scrivilo pure in chat, oppure scegli «INFO WHATSAPP» / apri ${bambiniInfoUrl()}`
        )
        if (lead) appendLeadNote(lead.id, `WA info email: email mancante («${text}»)`)
        return { handled: true, detail: "info bambini email mancante" }
      }
      const corso = resolveInfoCorso()
      if (!corso) {
        pendingInfoCorsoByPhone.set(from, {
          channel: "email",
          expiresAt: Date.now() + PENDING_PROVA_TTL_MS,
        })
        await sendWhatsappText(from, askCorsoMsg())
        if (lead) appendLeadNote(lead.id, `WA info email: attesa corso («${text}»)`)
        return { handled: true, detail: "info email attesa corso" }
      }
      persistCorsoOnLead(lead, corso)
      const docs = resolveBambiniDocs(corso)
      if (docs.length === 0) {
        await sendWhatsappText(
          from,
          `Non trovo il documento ${corsoLabel(corso)} sul server. Prova «INFO WHATSAPP» più tardi oppure scrivi «RICHIAMATEMI».`
        )
        return { handled: true, detail: "info email docs missing" }
      }
      if (!isSmtpConfigured()) {
        const r = await sendBambiniInfoDocsWhatsapp(from, corso)
        if (lead) {
          appendLeadNote(lead.id, `WA info email: SMTP off → WA (${r.sent.join(", ")})`, {
            stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
          })
        }
        return { handled: true, detail: "info email→wa fallback" }
      }
      const mail = await sendMail({
        to: email,
        subject: `H2Sport — info ${corsoLabel(corso)} 2026-27`,
        text:
          `Ciao,\n\nin allegato trovi il documento ${corsoLabel(corso)} stagione 2026-27:\n` +
          docs.map((d) => `• ${d.label}`).join("\n") +
          `\n\nPer maggiori info: 0573 572649 — ${bambiniInfoUrl()}\n\nH2Sport`,
        attachments: docs.map((d) => ({
          filename: d.filename,
          path: d.filePath,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })),
      })
      if (mail.sent) {
        await sendWhatsappText(
          from,
          `Perfetto, ti ho inviato le info ${corsoLabel(corso)} all'indirizzo ${email}.\n` +
            `Se non le trovi, controlla anche lo spam.\n` +
            `Per un ricontatto scrivi «RICHIAMATEMI».`
        )
        if (lead) {
          appendLeadNote(
            lead.id,
            `WA info ${corsoLabel(corso)} via email a ${email}: ${docs.map((d) => d.label).join(", ")}`,
            { stato: lead.stato === "nuovo" ? "contattato" : lead.stato }
          )
        }
        return { handled: true, detail: `info email ${corso}` }
      }
      const r = await sendBambiniInfoDocsWhatsapp(from, corso)
      if (lead) {
        const mailErr =
          mail && typeof mail === "object" && "detail" in mail && (mail as { detail?: string }).detail
            ? String((mail as { detail?: string }).detail)
            : "errore invio"
        appendLeadNote(lead.id, `WA info email fallita (${mailErr}): docs WA (${r.sent.join(", ")})`)
      }
      return { handled: true, detail: "info email fail→wa" }
    }

    // Solo corso / età → salva corso e guida al passo successivo
    {
      const ageOnly = parseChildAgeIt(text)
      const corsoMsg = parseCorsoChoiceIt(text)
      const corso =
        corsoMsg ||
        detectBambiniCorso({ lead, text, ageYears: ageOnly?.years ?? null })
      if (
        (corsoMsg || ageOnly) &&
        corso &&
        !detectBambiniCorso({ lead }) &&
        !hasBookingIntent(t) &&
        !wantsBambiniInfo(t)
      ) {
        persistCorsoOnLead(lead, corso)
        await sendWhatsappText(
          from,
          `Perfetto, segno ${corsoLabel(corso)}.\n` +
            `Scrivi «INFO WHATSAPP» per il documento, oppure «PRENOTA PROVA» + giorno/ora + età.`
        )
        return { handled: true, detail: `corso salvato ${corso}` }
      }
    }

    // Messaggio libero senza slot: non rimandare il benvenuto (già inviato al lead)
    const parsedEarly = parseSlotRequestIt(text)
    if (!parsedEarly && !wantsExplicitAppointment(t) && !hasBookingIntent(t)) {
      if (!/^(ok|va bene|grazie|perfetto|si|sì|no)\b/.test(t)) {
        await sendWhatsappText(
          from,
          `Per le info scrivi INFO WHATSAPP oppure INFO EMAIL.\n` +
            `Per la prova: PRENOTA PROVA + giorno + orario + età.\n` +
            `Oppure RICHIAMATEMI.`
        )
        if (lead) {
          appendLeadNote(lead.id, `WA guida bambini («${text}»)`, {
            stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
          })
        }
        return { handled: true, detail: "guida bambini" }
      }
    }
  }

  const parsed = parseSlotRequestIt(text)

  // Domanda libera (es. «la 25 mt giovedì è chiusa?»): non è un appuntamento
  if (shouldHandoffAsQuestion(text)) {
    await sendWhatsappText(from, GENERIC_HANDOFF_MSG)
    if (lead) {
      appendLeadNote(lead.id, `WA domanda libera → ricontatto consulente («${text}»)`, {
        stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
      })
    }
    return { handled: true, detail: "handoff domanda" }
  }

  // 2) Risposta incompleta / sbagliata (giorno senza ora, solo «appuntamento», ora senza giorno…)
  if (!parsed) {
    const politeAck = /^(ok|va bene|grazie|perfetto|si|sì|no|👍|🙏)\b/.test(t) || t.length <= 2
    const incomplete = looksLikeSlotFragmentIt(text)

    if (politeAck) {
      return { handled: false, detail: "non è richiesta slot" }
    }

    // «tutti i pomeriggi», «ogni mattina»… non è un giorno preciso da fissare
    if (isRecurringAvailabilityIt(text) && !wantsExplicitAppointment(t)) {
      markCallbackPending(from)
      await sendWhatsappText(from, callbackPreferenceMsg(text))
      if (lead) {
        appendLeadNote(lead.id, `WA disponibilità ricorrente → ricontatto («${text}»)`, {
          stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
        })
      }
      return { handled: true, detail: "disponibilità ricorrente" }
    }

    if (!incomplete) {
      // Messaggio non interpretabile → handoff consulente
      await sendWhatsappText(from, GENERIC_HANDOFF_MSG)
      if (lead) {
        appendLeadNote(lead.id, `WA non interpretato → ricontatto consulente («${text}»)`, {
          stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
        })
      }
      return { handled: true, detail: "handoff generico" }
    }

    let hint = GUIDE_SLOT_MSG
    if (hasWeekday(t) && !hasTimeHint(t)) {
      hint =
        `Ho capito il giorno${hasRelativeDay(t) ? "" : ""}, ma mi manca l'orario.\n\n` +
        GUIDE_SLOT_MSG
    } else if (hasTimeHint(t) && !hasWeekday(t)) {
      hint =
        `Ho capito l'orario, ma mi manca il giorno (oggi, domani, oppure lunedì…).\n\n` +
        GUIDE_SLOT_MSG
    }

    await sendWhatsappText(from, hint)
    if (lead) {
      appendLeadNote(lead.id, `WA risposta incompleta: «${text}» → inviata guida giorno/ora`)
    }
    return { handled: true, detail: "guida giorno/ora" }
  }

  // 3) Slot completo → prenota o slot pieno
  // Bambini senza «appuntamento/consulenza in sede»: non creare A2 (usa foglio prove)
  if (isLeadBambini(lead) && !wantsSedeConsulenza(t)) {
    await sendWhatsappText(
      from,
      `Per la prova in acqua usa:\n` +
        `PRENOTA PROVA + giorno + orario + età\n` +
        `es. PRENOTA PROVA lunedì 14 settembre ore 17:00 età 5\n\n` +
        `Per un appuntamento in sede con consulente scrivi «appuntamento» + giorno/ora.`
    )
    if (lead) appendLeadNote(lead.id, `WA: slot senza «prova» → guida prova («${text}»)`)
    return { handled: true, detail: "bambini: guida prova non A2" }
  }

  let inizio: Date
  if (parsed.relative) {
    inizio = slotOnRelativeDay(parsed.relative, parsed.hour, parsed.minute)
    if (inizio.getTime() <= Date.now() + 60_000) {
      await sendWhatsappText(
        from,
        `Per ${parsed.relative} quell'orario (${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}) ` +
          `è già passato o troppo vicino.\n\n` +
          `Proponi un altro orario (es. Oggi 18:00) oppure scrivi «richiamatemi».`
      )
      if (lead) {
        appendLeadNote(lead.id, `WA slot ${parsed.relative} già passato: «${text}»`)
      }
      return { handled: true, detail: "slot relativo passato" }
    }
  } else {
    inizio = nextOccurrence(parsed.weekday, parsed.hour, parsed.minute)
  }
  const fine = slotEnd(inizio)
  const segmento: AgendaSegmento = isLeadBambini(lead) ? "bambini" : "adulti"
  const ida2Servizio =
    segmento === "bambini" ? IDA2_SERVIZIO_BAMBINI : IDA2_SERVIZIO_CONSULENTI_ADULTI

  const resolved = await resolveIdUtenteForWaBooking({
    phone: from,
    nome: lead?.nome,
    cognome: lead?.cognome,
  })
  const usatoNuovoCliente = resolved.idUtente == null
  const idUtente = resolved.idUtente ?? (await findIdUtenteNuovoCliente())
  if (usatoNuovoCliente) {
    console.log("[whatsapp-booking] anagrafica:", resolved.reason)
  }

  const displayName = [lead?.nome, lead?.cognome].filter(Boolean).join(" ").trim() || "lead WA"
  const phoneDisplay = from.replace(/^39/, "")
  const noteAgenda = (
    usatoNuovoCliente
      ? `NUOVO: ${displayName} | tel ${phoneDisplay} | ${text}`
      : `${displayName} | tel ${phoneDisplay} | WA: ${text}`
  ).slice(0, 200)

  const consulente = await pickFreeConsulente(inizio, fine, segmento)
  if (!consulente) {
    const chi = segmento === "bambini" ? "Irene o Elisa" : "una consulente"
    await sendWhatsappText(
      from,
      `Grazie per la richiesta (${fmtIt(inizio)}). In quell'orario non risultano disponibilità.\n\n` +
        `Puoi proporre un altro giorno/orario rispondendo a questo messaggio, oppure scrivere «richiamatemi» ` +
        `se preferisci essere ricontattato da ${chi}.`
    )
    if (lead) {
      appendLeadNote(lead.id, `WA richiesta NON disponibile (${segmento}): ${text} → ${fmtIt(inizio)}`, {
        stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
      })
    }
    return { handled: true, detail: `slot non libero (${segmento})` }
  }

  try {
    const created = await createConsulenzaAppuntamento({
      idUtente,
      inizio,
      consulente,
      note: noteAgenda,
      ida2Servizio,
    })
    const msg =
      `Perfetto! Ti confermiamo l'appuntamento in H2Sport:\n` +
      `📅 ${fmtIt(inizio)}\n` +
      `👤 Consulente: ${consulente.nome}\n` +
      `Durata circa 30 minuti.\n` +
      `Ti aspettiamo in sede! 💙`
    await sendWhatsappText(from, msg)
    pendingCallbackByPhone.delete(from)
    whatsappEventsStore.append({
      kind: "booking",
      from,
      text: `prenotato #${created.idAppuntamento} ${fmtIt(inizio)} con ${consulente.nome} [${segmento}]`,
      status: "ok",
      raw: {
        idAppuntamento: created.idAppuntamento,
        inizio: inizio.toISOString(),
        consulente: consulente.nome,
        segmento,
        idUtente,
        usatoNuovoCliente,
      },
    })
    if (lead) {
      appendLeadNote(
        lead.id,
        `WA appuntamento #${created.idAppuntamento} ${fmtIt(inizio)} con ${consulente.nome}` +
          (segmento === "bambini" ? " (agenda bambini)" : "") +
          (usatoNuovoCliente ? ` (anagrafica nuovo cliente ${idUtente})` : ""),
        {
          stato: "appuntamento",
          consulenteNome: consulente.nome,
          ...(segmento === "bambini" ? { categoria: "bambini" } : {}),
        }
      )
    }
    return {
      handled: true,
      detail: `prenotato #${created.idAppuntamento} ${consulente.nome} [${segmento}]${usatoNuovoCliente ? " (nuovo cliente)" : ""}`,
    }
  } catch (e) {
    const err = (e as Error)?.message ?? String(e)
    console.error("[whatsapp-booking]", err)
    whatsappEventsStore.append({
      kind: "other",
      from,
      text: `booking_error: ${err} | req=${text} | slot=${fmtIt(inizio)}`,
      status: "error",
      raw: { err, text, inizio: inizio.toISOString(), idUtente, consulente },
    })
    try {
      await sendWhatsappText(
        from,
        `Abbiamo ricevuto la tua richiesta per ${fmtIt(inizio)}, ma al momento non siamo riusciti a confermare in automatico.\n` +
          `Ti richiamiamo a breve, oppure rispondi «richiamatemi» se preferisci fissarlo con una consulente.`
      )
    } catch {
      /* ignore */
    }
    return { handled: true, detail: `errore: ${err}` }
  }
}
