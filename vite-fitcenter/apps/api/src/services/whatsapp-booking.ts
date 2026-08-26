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
import { isWhatsappSendConfigured, normalizeWaTo, sendWhatsappText, sendWhatsappDocument } from "./whatsapp.js"
import { isSmtpConfigured, sendMail } from "./mailer.js"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const processedWaIds = new Set<string>()
const MAX_PROCESSED = 2000

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
  `Una consulente H2Sport ti richiamerà a breve per fissare l'appuntamento in sede.\n` +
  `Se nel frattempo vuoi proporre tu un orario, rispondi pure con giorno e ora (es. Martedì 17:00).`

/** Messaggio quando non capiamo la richiesta: lead a «contattato» + ricontatto umano. */
const GENERIC_HANDOFF_MSG =
  `Grazie per il messaggio: non sono riuscito a interpretarlo in automatico.\n` +
  `Verrà ricontattato a breve da una nostra consulente H2Sport.\n\n` +
  `Se nel frattempo vuoi proporre un orario, rispondi con giorno e ora (es. Oggi 18:00 oppure Domani mattina), ` +
  `oppure scrivi «richiamatemi».`

function bambiniInfoUrl(): string {
  return (process.env.WHATSAPP_BAMBINI_INFO_URL ?? "https://h2sport.it/bambini/").trim()
}

function bambiniDataDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(__dirname, "../../data/bambini-info")
}

type BambiniDoc = { key: "acquaticita" | "scuola_nuoto"; label: string; filename: string; filePath: string }

/** Documenti stagione: share UNC (env) oppure copia in apps/api/data/bambini-info. */
function resolveBambiniDocs(): BambiniDoc[] {
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
  const out: BambiniDoc[] = []
  for (const c of candidates) {
    const filePath = c.paths.find((p) => p && fs.existsSync(p))
    if (!filePath) continue
    out.push({ key: c.key, label: c.label, filename: c.filename, filePath })
  }
  return out
}

async function sendBambiniInfoDocsWhatsapp(to: string): Promise<{ sent: string[]; missing: boolean }> {
  const docs = resolveBambiniDocs()
  if (docs.length === 0) {
    await sendWhatsappText(
      to,
      `Al momento non trovo i file info bambini sul server.\n` +
        `Una consulente ti ricontatterà a breve, oppure consulta ${bambiniInfoUrl()}`
    )
    return { sent: [], missing: true }
  }
  await sendWhatsappText(
    to,
    `Ti invio i documenti con orari e info stagione 2026-27:\n` +
      docs.map((d) => `• ${d.label}`).join("\n") +
      `\n\nPer costi o posto in vasca scrivi «richiamatemi» (Irene / Elisa).`
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

function bambiniInfoMenuMsg(): string {
  return (
    `Per i corsi bambini di solito partiamo dalle info (orari / acquaticità / scuola nuoto), non subito dall'appuntamento.\n\n` +
    `Scegli come preferisci riceverle:\n` +
    `1️⃣ «info whatsapp» → ti mando i documenti qui\n` +
    `2️⃣ «info email» → te li invio all'email del contatto\n` +
    `3️⃣ pagina web: ${bambiniInfoUrl()}\n\n` +
    `Se vuoi un appuntamento in sede, scrivi giorno e ora (es. Domani 17:00) oppure «richiamatemi».`
  )
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

function hasBookingIntent(t: string): boolean {
  return (
    /\b(appuntamento|prenot|disponibil|orario|fascia|venire|passare|tour|visita|consulenza)\b/.test(t) ||
    hasWeekday(t) ||
    hasTimeHint(t)
  )
}

function wantsBambiniInfo(t: string): boolean {
  return (
    /\b(info\s*whatsapp|info\s*email|info\s*mail|mandami\s+(le\s+)?info|costi|prezzi|tariff|orari|programma|brochure|preventivo)\b/.test(
      t
    ) || /\b(info|informazioni)\b/.test(t)
  )
}

function wantsExplicitAppointment(t: string): boolean {
  return /\b(appuntamento|prenot|venire|passare|tour|visita|in\s+sede)\b/.test(t)
}

/** Es. "Mercoledì ore 17:30", "oggi 18:00", "domani mattina", "sabato mattina". */
export function parseSlotRequestIt(text: string): ParsedSlotRequest | null {
  const raw = String(text ?? "").trim()
  if (!raw) return null
  const t = normText(raw)

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
    const hOnly = t.match(/\b(?:ore|alle)?\s*([01]?\d|2[0-3])\b/)
    if (hOnly) hour = Number(hOnly[1])
    else return null // giorno senza orario → non prenotare alla cieca
  }

  return { weekday, hour, minute, raw, relative }
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
    if (stato === "appuntamento" || stato === "tour" || stato === "proposta") return 1
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
        lead.stato === "appuntamento" || lead.stato === "tour" || lead.stato === "proposta"
          ? "contattato"
          : lead.stato,
    })
  }
}

/** Lead più recente in stato appuntamento (per capire se annullare adulti o bambini). */
function pickLeadForCancel(phone: string) {
  const all = findLeadsByPhone(phone)
  const withApp = all.filter((l) => l.stato === "appuntamento")
  if (withApp.length > 0) {
    return [...withApp].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null
  }
  return all[0] ?? null
}

function isLeadBambini(lead: { categoria?: string | null; interesseDettaglio?: string | null; note?: string | null } | null): boolean {
  if (!lead) return false
  if (lead.categoria === "bambini") return true
  const blob = `${lead.interesseDettaglio ?? ""} ${lead.note ?? ""}`
  return /\b(bambin|campus|scuola\s*nuoto|nuoto\s*bambin)\b/i.test(blob)
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

  // 1) Preferisce ricontatto da consulente
  if (parseCallbackRequestIt(text)) {
    await sendWhatsappText(from, CALLBACK_MSG)
    if (lead) {
      appendLeadNote(lead.id, `WA: richiede ricontatto consulente («${text}»)`, {
        stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
      })
    }
    return { handled: true, detail: "ricontatto consulente" }
  }

  // 1b) Bambini: priorità info (costi/orari) rispetto all'appuntamento automatico
  if (isLeadBambini(lead)) {
    const infoWa = /\binfo\s*whatsapp\b/.test(t)
    const infoMail = /\binfo\s*(email|mail)\b/.test(t)
    if (infoWa) {
      const r = await sendBambiniInfoDocsWhatsapp(from)
      if (lead) {
        appendLeadNote(
          lead.id,
          r.missing
            ? `WA info bambini: documenti non trovati («${text}»)`
            : `WA info bambini documenti: ${r.sent.join(", ")} («${text}»)`,
          { stato: lead.stato === "nuovo" ? "contattato" : lead.stato }
        )
      }
      return { handled: true, detail: r.missing ? "info bambini docs missing" : "info bambini whatsapp docs" }
    }
    if (infoMail) {
      const email = String(lead?.email ?? "").trim()
      if (!email || email === "—") {
        await sendWhatsappText(
          from,
          `Per inviarti le info via email mi serve un indirizzo.\n` +
            `Scrivilo pure in chat, oppure scegli «info whatsapp» / apri ${bambiniInfoUrl()}`
        )
        if (lead) appendLeadNote(lead.id, `WA info email: email mancante («${text}»)`)
        return { handled: true, detail: "info bambini email mancante" }
      }
      const docs = resolveBambiniDocs()
      if (docs.length === 0) {
        await sendWhatsappText(
          from,
          `Non trovo i documenti info sul server. Prova «info whatsapp» più tardi oppure scrivi «richiamatemi».`
        )
        return { handled: true, detail: "info bambini email docs missing" }
      }
      if (!isSmtpConfigured()) {
        const r = await sendBambiniInfoDocsWhatsapp(from)
        if (lead) {
          appendLeadNote(lead.id, `WA info email: SMTP off → documenti WA (${r.sent.join(", ")})`, {
            stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
          })
        }
        return { handled: true, detail: "info bambini email→wa fallback" }
      }
      const mail = await sendMail({
        to: email,
        subject: "H2Sport — info Acquaticità e Scuola Nuoto Bambini 2026-27",
        text:
          `Ciao,\n\nin allegato trovi i documenti con orari e info stagione 2026-27:\n` +
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
          `Perfetto, ti ho inviato i documenti all'indirizzo ${email}.\n` +
            `Se non li trovi, controlla anche lo spam.\n` +
            `Per un ricontatto scrivi «richiamatemi».`
        )
        if (lead) {
          appendLeadNote(lead.id, `WA info bambini via email a ${email}: ${docs.map((d) => d.label).join(", ")}`, {
            stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
          })
        }
        return { handled: true, detail: "info bambini email docs" }
      }
      const r = await sendBambiniInfoDocsWhatsapp(from)
      if (lead) appendLeadNote(lead.id, `WA info email fallita (${mail.detail}): docs WA (${r.sent.join(", ")})`)
      return { handled: true, detail: "info bambini email fail→wa" }
    }

    // Menu info: richieste tipiche senza slot esplicito di appuntamento
    const parsedEarly = parseSlotRequestIt(text)
    if (
      wantsBambiniInfo(t) ||
      (!parsedEarly && !wantsExplicitAppointment(t) && !hasBookingIntent(t))
    ) {
      // Solo se sembra una richiesta (non ok/grazie)
      if (!/^(ok|va bene|grazie|perfetto|si|sì|no)\b/.test(t)) {
        await sendWhatsappText(from, bambiniInfoMenuMsg())
        if (lead) {
          appendLeadNote(lead.id, `WA menu info bambini («${text}»)`, {
            stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
          })
        }
        return { handled: true, detail: "menu info bambini" }
      }
    }
    // Slot giorno+ora senza dire «appuntamento»: per bambini proponi comunque info, salvo richiesta esplicita
    if (parsedEarly && !wantsExplicitAppointment(t) && !/\b(appuntament|prenot)\w*\b/.test(t)) {
      await sendWhatsappText(
        from,
        `Ho capito la fascia (${parsedEarly.relative ?? "giorno"}).\n\n` +
          `Per i corsi bambini di solito partiamo dalle info costi/orari.\n` +
          bambiniInfoMenuMsg()
      )
      if (lead) {
        appendLeadNote(lead.id, `WA bambini: slot proposto ma inviato menu info («${text}»)`, {
          stato: lead.stato === "nuovo" ? "contattato" : lead.stato,
        })
      }
      return { handled: true, detail: "bambini slot→menu info" }
    }
  }

  const parsed = parseSlotRequestIt(text)

  // 2) Risposta incompleta / sbagliata (giorno senza ora, solo «appuntamento», ora senza giorno…)
  if (!parsed) {
    const politeAck = /^(ok|va bene|grazie|perfetto|si|sì|no|👍|🙏)\b/.test(t) || t.length <= 2
    const incomplete =
      (hasWeekday(t) && !hasTimeHint(t)) ||
      (hasTimeHint(t) && !hasWeekday(t)) ||
      (hasBookingIntent(t) && !politeAck)

    if (politeAck) {
      return { handled: false, detail: "non è richiesta slot" }
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
