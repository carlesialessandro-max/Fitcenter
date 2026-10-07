/** Fascia oraria turni reception (es. 08:00–14:00, 6 ore). */

export function parseHm(hm: string): number | null {
  const m = String(hm ?? "").trim().match(/^(\d{1,2})[:.](\d{2})$/)
  if (!m) return null
  const h = Math.min(23, Math.max(0, Number(m[1])))
  const min = Math.min(59, Math.max(0, Number(m[2])))
  return h * 60 + min
}

export function formatHm(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(t / 60)
  const m = t % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

const RANGE_RE = /(\d{1,2})[:.](\d{2})\s*[–\-]\s*(\d{1,2})[:.](\d{2})/

export function parseRangeFromTitle(title: string): { start: string; end: string } | null {
  const m = String(title ?? "").match(RANGE_RE)
  if (!m) return null
  return {
    start: `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`,
    end: `${String(Number(m[3])).padStart(2, "0")}:${m[4]}`,
  }
}

export function formatShiftDurationLabel(start: string, end: string): string {
  const sm = parseHm(start)
  const em = parseHm(end)
  if (sm == null || em == null) return ""
  let d = em - sm
  if (d <= 0) d += 24 * 60
  const h = Math.floor(d / 60)
  const m = d % 60
  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}`
  if (h > 0) return `${h}h`
  return `${m}m`
}

export function eventTimeRange(e: { title: string; start: string }): { start: string; end: string } {
  const fromTitle = parseRangeFromTitle(e.title)
  if (fromTitle) return fromTitle
  const s = parseHm(e.start)
  if (s == null) return { start: e.start, end: e.start }
  return { start: formatHm(s), end: formatHm(s + 30) }
}

export function buildReceptionTitle(activity: string, start: string, end: string): string {
  const label = String(activity ?? "").trim() || "Sportello"
  const s = formatHm(parseHm(start) ?? 0)
  const e = formatHm(parseHm(end) ?? 0)
  return `${label} · ${s}–${e}`
}

/** Fascia oraria (reception, bagnini, sala fitness). */
export function buildShiftTitle(activity: string, start: string, end: string): string {
  return buildReceptionTitle(activity, start, end)
}

/** Slot visibile nella riga oraria h (0–23). */
export function receptionEventInHour(e: { title: string; start: string }, hour: number): boolean {
  const { start, end } = eventTimeRange(e)
  const sm = parseHm(start)
  const em = parseHm(end)
  if (sm == null || em == null) return Math.floor((parseHm(e.start) ?? 0) / 60) === hour
  let endMin = em
  if (endMin <= sm) endMin += 24 * 60
  const hourStart = hour * 60
  const hourEnd = hourStart + 60
  return sm < hourEnd && endMin > hourStart
}

export const shiftEventInHour = receptionEventInHour

/** Slot visibile nella riga da slotStartMin (es. 7:30 → 450) per slotMinutes (30 o 60). */
export function shiftEventInSlot(
  e: { title: string; start: string },
  slotStartMin: number,
  slotMinutes = 30
): boolean {
  const { start, end } = eventTimeRange(e)
  const sm = parseHm(start)
  const em = parseHm(end)
  const slotEnd = slotStartMin + slotMinutes
  if (sm == null || em == null) {
    const s = parseHm(e.start) ?? 0
    return s >= slotStartMin && s < slotEnd
  }
  let endMin = em
  if (endMin <= sm) endMin += 24 * 60
  return sm < slotEnd && endMin > slotStartMin
}

export function addHoursToHm(hm: string, hours: number): string {
  const m = parseHm(hm)
  if (m == null) return hm
  return formatHm(m + hours * 60)
}
