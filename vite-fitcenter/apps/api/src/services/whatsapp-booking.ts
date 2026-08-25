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
  slotEnd,
  IDA2_SERVIZIO_BAMBINI,
  IDA2_SERVIZIO_CONSULENTI_ADULTI,
  type AgendaSegmento,
} from "./agenda-a2.js"
import { isWhatsappSendConfigured, normalizeWaTo, sendWhatsappText } from "./whatsapp.js"

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
  `• Lunedì 18:30\n` +
  `• Mercoledì ore 16\n` +
  `• Sabato mattina\n\n` +
  `Se preferisci essere ricontattato da una consulente, scrivi pure «richiamatemi».`

const CALLBACK_MSG =
  `Perfetto, abbiamo segnato la tua richiesta.\n` +
  `Una consulente H2Sport ti richiamerà a breve per fissare l'appuntamento in sede.\n` +
  `Se nel frattempo vuoi proporre tu un orario, rispondi pure con giorno e ora (es. Martedì 17:00).`

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

function hasWeekday(t: string): boolean {
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

/** Es. "Mercoledì ore 17:30", "lunedi 18.30", "sabato mattina". */
export function parseSlotRequestIt(text: string): ParsedSlotRequest | null {
  const raw = String(text ?? "").trim()
  if (!raw) return null
  const t = normText(raw)

  let weekday: number | null = null
  for (const [k, v] of Object.entries(WEEKDAY)) {
    const key = stripAccents(k)
    if (new RegExp(`\\b${key}\\b`, "i").test(t)) {
      weekday = v
      break
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

  return { weekday, hour, minute, raw }
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
  const matches = leadsStore.list({}).filter((l) => phonesMatch(l.telefono, phone))
  if (matches.length === 0) return null
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
  return matches[0] ?? null
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

  const parsed = parseSlotRequestIt(text)

  // 2) Risposta incompleta / sbagliata (giorno senza ora, solo «appuntamento», ora senza giorno…)
  if (!parsed) {
    const incomplete =
      (hasWeekday(t) && !hasTimeHint(t)) ||
      (hasTimeHint(t) && !hasWeekday(t)) ||
      (hasBookingIntent(t) && !/^(ok|va bene|grazie|perfetto|si|sì|no)\b/.test(t))

    if (!incomplete) {
      // Messaggio generico (ok/grazie/…): non rispondere in automatico
      return { handled: false, detail: "non è richiesta slot" }
    }

    let hint = GUIDE_SLOT_MSG
    if (hasWeekday(t) && !hasTimeHint(t)) {
      hint =
        `Ho capito il giorno, ma mi manca l'orario.\n\n` +
        GUIDE_SLOT_MSG
    } else if (hasTimeHint(t) && !hasWeekday(t)) {
      hint =
        `Ho capito l'orario, ma mi manca il giorno della settimana.\n\n` +
        GUIDE_SLOT_MSG
    }

    await sendWhatsappText(from, hint)
    if (lead) {
      appendLeadNote(lead.id, `WA risposta incompleta: «${text}» → inviata guida giorno/ora`)
    }
    return { handled: true, detail: "guida giorno/ora" }
  }

  // 3) Slot completo → prenota o slot pieno
  const inizio = nextOccurrence(parsed.weekday, parsed.hour, parsed.minute)
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
