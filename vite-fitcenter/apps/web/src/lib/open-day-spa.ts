/** Open Day SPA 30 settembre 2026 — stessa logica di riconoscimento dell'API. */

export const OPEN_DAY_SPA_ISO = "2026-09-30"
export const OPEN_DAY_SPA_LABEL = "Open Spa 30/09"

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

export function isOpenDaySpaCampaignActive(now = new Date()): boolean {
  return now.getTime() <= new Date(`${OPEN_DAY_SPA_ISO}T23:59:59.999+02:00`).getTime()
}

export function isOpenDaySpaLead(lead: {
  interesse?: string | null
  interesseDettaglio?: string | null
  note?: string | null
  categoria?: string | null
}): boolean {
  return isOpenDaySpaText(lead.interesse, lead.interesseDettaglio, lead.note, lead.categoria)
}
