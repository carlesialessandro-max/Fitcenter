/**
 * Open Day SPA 30 settembre 2026: i lead arrivano col testo della richiesta
 * (anche se il form manda «Campus estivo»). Vanno gestiti come SPA adulti fino al 30.
 */

import type { LeadCreate } from "../types/lead.js"

export const OPEN_DAY_SPA_ISO = "2026-09-30"
export const OPEN_DAY_SPA_DETTAGLIO = "Open Day Spa 30 settembre"

function foldIt(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function isOpenDaySpaText(...parts: (string | undefined | null)[]): boolean {
  const t = foldIt(parts.filter((p) => p != null && String(p).trim() !== "").join(" "))
  if (!t) return false
  return /open[\s-]*day[\s-]*spa/.test(t) || /openday[\s-]*spa/.test(t) || /open[\s-]*spa/.test(t)
}

/** Fino a fine giornata 30/09/2026 (Europe/Rome, CEST). */
export function isOpenDaySpaCampaignActive(now = new Date()): boolean {
  return now.getTime() <= new Date(`${OPEN_DAY_SPA_ISO}T23:59:59.999+02:00`).getTime()
}

export function applyOpenDaySpaLeadFields(payload: LeadCreate): LeadCreate {
  if (!isOpenDaySpaText(payload.interesse, payload.interesseDettaglio, payload.note, payload.categoria)) {
    return payload
  }
  return {
    ...payload,
    interesse: "spa",
    interesseDettaglio: OPEN_DAY_SPA_DETTAGLIO,
    categoria: undefined,
  }
}

function firstName(nome?: string | null): string {
  const raw = String(nome ?? "").trim()
  if (!raw || /^ciao$/i.test(raw) || raw === "—") return "Ciao"
  return `Ciao ${raw.split(/\s+/)[0]}`
}

export function openDaySpaReplyMsg(opts: { nome?: string | null; fromSite?: boolean }): string {
  const chi = firstName(opts.nome)
  const intro = opts.fromSite
    ? `${chi}, abbiamo letto la tua richiesta dal sito. 💙\n\n`
    : `${chi}, 💙\n\n`

  if (isOpenDaySpaCampaignActive()) {
    return (
      intro +
      `Hai chiesto info sull'Open Day SPA del 30 settembre.\n\n` +
      `Ti aspettiamo al nostro Open Day SPA & Benessere!\n\n` +
      `Dalle 11:00 alle 20:00 puoi scoprire i percorsi relax e, solo per quella giornata, hai il 50% di sconto sull'abbonamento SPA.\n\n` +
      `I posti sono limitati e la prenotazione è obbligatoria (ultimo accesso ore 19:00).\n\n` +
      `Per riservare o altre info: 0573 572649.\n` +
      `Oppure scrivi RICHIAMATEMI e ti chiamiamo noi.`
    )
  }

  return (
    intro +
    `L'Open Day SPA del 30 settembre è concluso.\n\n` +
    `Per la SPA / area benessere ti diamo info e disponibilità in sede o al 0573 572649.\n\n` +
    `Dettagli: https://h2sport.it/#attivita\n` +
    `Contatti: https://h2sport.it/contatti`
  )
}
