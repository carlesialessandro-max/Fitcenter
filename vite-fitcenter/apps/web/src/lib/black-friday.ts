/** Black Friday novembre 2026 (11–23) — stessa logica di riconoscimento dell'API. */

export const BLACK_FRIDAY_FROM_ISO = "2026-11-11"
export const BLACK_FRIDAY_UNTIL_ISO = "2026-11-23"
export const BLACK_FRIDAY_LABEL = "Black Friday"

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

export function isBlackFridayText(...parts: (string | undefined | null)[]): boolean {
  const t = foldIt(parts.filter((p) => p != null && String(p).trim() !== "").join(" "))
  if (!t) return false
  return (
    /black[\s-]*friday/.test(t) ||
    /offerta[\s-]*flash/.test(t) ||
    /h2sport[\s-]*pistoia/.test(t)
  )
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
