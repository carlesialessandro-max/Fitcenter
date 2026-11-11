/**
 * Black Friday novembre 2026 (11–23): i lead arrivano dal form sito con
 * oggetto/messaggio tipo:
 * - Info offerta: BLACK FRIDAY BAMBINI – Fino al 50% di sconto!
 * - Info offerta: BLACK FRIDAY H2SPORT PISTOIA
 * - Info offerta: Offerta Flash
 * + «Sono interessato all'offerta … Vorrei essere ricontattato.»
 *
 * Niente WhatsApp automatico (benvenuto, guide, slot): si crea il lead,
 * le consulenti richiamano.
 */

import type { LeadCreate } from "../types/lead.js"

export const BLACK_FRIDAY_FROM_ISO = "2026-11-11"
export const BLACK_FRIDAY_UNTIL_ISO = "2026-11-23"

export type BlackFridayOffer = "bambini" | "h2sport" | "flash" | "generic"

export const BLACK_FRIDAY_DETTAGLIO: Record<BlackFridayOffer, string> = {
  bambini: "Black Friday Bambini",
  h2sport: "Black Friday H2SPORT Pistoia",
  flash: "Offerta Flash",
  generic: "Black Friday",
}

export const BLACK_FRIDAY_FONTE_DETTAGLIO = "Black Friday novembre"

function foldIt(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function isBlackFridayCampaignActive(now = new Date()): boolean {
  const from = new Date(`${BLACK_FRIDAY_FROM_ISO}T00:00:00+01:00`).getTime()
  const until = new Date(`${BLACK_FRIDAY_UNTIL_ISO}T23:59:59.999+01:00`).getTime()
  const t = now.getTime()
  return t >= from && t <= until
}

export function classifyBlackFridayOffer(...parts: (string | undefined | null)[]): BlackFridayOffer | null {
  const t = foldIt(parts.filter((p) => p != null && String(p).trim() !== "").join(" "))
  if (!t) return null

  const isBf = /black[\s-]*friday/.test(t)
  const isFlash = /offerta[\s-]*flash/.test(t)
  const isH2Pistoia = /h2sport[\s-]*pistoia/.test(t)

  // Solo queste tre offerte: qualsiasi altro form/WhatsApp resta sul bot normale.
  if (!isBf && !isFlash && !isH2Pistoia) return null

  if (isBf && /\bbambin|\bbimbi|scuola\s*nuoto|acquaticit/.test(t)) return "bambini"
  if (isFlash) return "flash"
  if (isH2Pistoia || (isBf && /\b(spa|piscina\s*estern)/.test(t))) return "h2sport"
  return "generic"
}

export function isBlackFridayText(...parts: (string | undefined | null)[]): boolean {
  return classifyBlackFridayOffer(...parts) != null
}

export function isBlackFridayLead(lead: {
  interesse?: string | null
  interesseDettaglio?: string | null
  note?: string | null
  categoria?: string | null
  fonteDettaglio?: string | null
}): boolean {
  return isBlackFridayText(
    lead.interesse,
    lead.interesseDettaglio,
    lead.note,
    lead.categoria,
    lead.fonteDettaglio
  )
}

export function applyBlackFridayLeadFields(payload: LeadCreate): LeadCreate {
  if (!isBlackFridayCampaignActive()) return payload
  const offer = classifyBlackFridayOffer(
    payload.interesse,
    payload.interesseDettaglio,
    payload.note,
    payload.categoria,
    payload.fonteDettaglio
  )
  if (!offer) return payload

  const interesse =
    payload.interesse ??
    (offer === "bambini" ? "corsi" : offer === "flash" ? "palestra" : undefined)

  return {
    ...payload,
    interesse,
    interesseDettaglio: BLACK_FRIDAY_DETTAGLIO[offer],
    categoria: offer === "bambini" ? "bambini" : payload.categoria,
    fonteDettaglio: payload.fonteDettaglio || BLACK_FRIDAY_FONTE_DETTAGLIO,
  }
}
