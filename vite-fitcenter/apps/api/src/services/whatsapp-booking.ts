/**
 * Orchestratore: messaggio WhatsApp in ingresso → parse giorno/ora → prenota A2 → conferma.
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

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "")
}

export type ParsedSlotRequest = {
  weekday: number
  hour: number
  minute: number
  raw: string
}

/** Es. "Mercoledì ore 17:30", "lunedi 18.30", "sabato mattina". */
export function parseSlotRequestIt(text: string): ParsedSlotRequest | null {
  const raw = String(text ?? "").trim()
  if (!raw) return null
  const t = stripAccents(raw.toLowerCase()).replace(/\s+/g, " ")

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

  const parsed = parseSlotRequestIt(text)
  if (!parsed) {
    // Non è una richiesta slot: ignora (reception gestirà in Business Suite)
    return { handled: false, detail: "non è richiesta slot" }
  }

  if (!isWhatsappSendConfigured()) {
    return { handled: false, detail: "whatsapp non configurato" }
  }

  const inizio = nextOccurrence(parsed.weekday, parsed.hour, parsed.minute)
  const fine = slotEnd(inizio)
  const lead = findLeadByPhone(from)

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
  // Note agenda: nome/tel reali (anagrafica può essere placeholder "nuovo cliente")
  const noteAgenda = (
    usatoNuovoCliente
      ? `NUOVO: ${displayName} | tel ${phoneDisplay} | ${text}`
      : `${displayName} | tel ${phoneDisplay} | WA: ${text}`
  ).slice(0, 200)

  const consulente = await pickFreeConsulente(inizio, fine)
  if (!consulente) {
    await sendWhatsappText(
      from,
      `Grazie per la richiesta (${fmtIt(inizio)}). In quell'orario non risultano disponibilità. ` +
        `Prova un altro giorno/orario rispondendo a questo messaggio, oppure ti richiamiamo noi.`
    )
    if (lead) {
      leadsStore.update(lead.id, {
        note: [lead.note, `WA richiesta NON disponibile: ${text}`].filter(Boolean).join("\n"),
      })
    }
    return { handled: true, detail: "slot non libero" }
  }

  try {
    const created = await createConsulenzaAppuntamento({
      idUtente,
      inizio,
      consulente,
      note: noteAgenda,
    })
    const msg =
      `Perfetto! Ti confermiamo l'appuntamento in H2Sport:\n` +
      `📅 ${fmtIt(inizio)}\n` +
      `👤 Consulente: ${consulente.nome}\n` +
      `Durata circa 30 minuti.\n` +
      `Ti aspettiamo in sede! 💙`
    await sendWhatsappText(from, msg)
    if (lead) {
      leadsStore.update(lead.id, {
        stato: "appuntamento",
        consulenteNome: consulente.nome,
        note: [
          lead.note,
          `WA appuntamento #${created.idAppuntamento} ${fmtIt(inizio)} con ${consulente.nome}` +
            (usatoNuovoCliente ? ` (anagrafica nuovo cliente ${idUtente})` : ""),
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }
    return {
      handled: true,
      detail: `prenotato #${created.idAppuntamento} ${consulente.nome}${usatoNuovoCliente ? " (nuovo cliente)" : ""}`,
    }
  } catch (e) {
    const err = (e as Error)?.message ?? String(e)
    console.error("[whatsapp-booking]", err)
    whatsappEventsStore.append({
      kind: "other",
      from,
      text: `booking_error: ${err} | req=${text} | slot=${fmtIt(inizio)}`,
      raw: { err, text, inizio: inizio.toISOString(), idUtente, consulente },
    })
    try {
      await sendWhatsappText(
        from,
        `Abbiamo ricevuto la tua richiesta per ${fmtIt(inizio)}, ma al momento non siamo riusciti a confermare in automatico. ` +
          `Ti richiamiamo a breve per fissare l'appuntamento.`
      )
    } catch {
      /* ignore */
    }
    return { handled: true, detail: `errore: ${err}` }
  }
}
