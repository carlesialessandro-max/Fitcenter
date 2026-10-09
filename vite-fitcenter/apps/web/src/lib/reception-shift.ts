/** Fascia oraria turni reception (es. 08:00–14:00, 6 ore). */

export function parseHm(hm: string): number | null {
  const m = String(hm ?? "")
    .trim()
    .match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || h > 23 || !Number.isFinite(min) || min > 59) return null
  return h * 60 + min
}

export function formatHm(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(t / 60)
  const m = t % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** Prima fascia utile (pulizie alle 5; niente mezzanotte). */
export const SHIFT_DAY_START_MIN = 5 * 60
const DESK_OPEN_MIN = 8 * 60

const RANGE_RE = /(\d{1,2})[:.](\d{2})\s*[–\-−—]\s*(\d{1,2})[:.](\d{2})/g

function padRangeHm(h: string, min: string): string | null {
  const hh = Number(h)
  const mm = Number(min)
  if (!Number.isFinite(hh) || hh > 23 || !Number.isFinite(mm) || mm > 59) return null
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

export function parseRangeFromTitle(title: string): { start: string; end: string } | null {
  const raw = String(title ?? "")
  const re = new RegExp(RANGE_RE.source, "g")
  let last: { start: string; end: string } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const start = padRangeHm(m[1]!, m[2]!)
    const end = padRangeHm(m[3]!, m[4]!)
    if (!start || !end) continue
    const sm = parseHm(start)
    const em = parseHm(end)
    if (sm == null || em == null || em <= sm) continue
    last = { start, end }
  }
  if (last) return last
  const times: string[] = []
  const timeRe = /(\d{1,2})[:.](\d{2})/g
  while ((m = timeRe.exec(raw))) {
    const hm = padRangeHm(m[1]!, m[2]!)
    if (hm) times.push(hm)
  }
  if (times.length < 2) return null
  const start = times[0]!
  const end = times[1]!
  const sm = parseHm(start)
  const em = parseHm(end)
  if (sm == null || em == null || em <= sm) return null
  return { start, end }
}

export function formatShiftDurationLabel(start: string, end: string): string {
  const sm = parseHm(start)
  const em = parseHm(end)
  if (sm == null || em == null || em <= sm) return ""
  const d = em - sm
  const h = Math.floor(d / 60)
  const m = d % 60
  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function usableShiftStart(titleStart: number, em: number, fieldStart: number | null): number {
  // Fascia nel titolo è quella salvata (es. 08:00–08:30); il campo start può restare un orario vecchio.
  if (titleStart >= SHIFT_DAY_START_MIN && titleStart < em) return titleStart
  if (fieldStart != null && fieldStart >= SHIFT_DAY_START_MIN && fieldStart < em) return fieldStart
  if (em > DESK_OPEN_MIN) return DESK_OPEN_MIN
  return SHIFT_DAY_START_MIN
}

export function normalizeHmInput(raw: string): string {
  const m = parseHm(String(raw ?? "").trim())
  return m == null ? String(raw ?? "").trim() : formatHm(m)
}

export function eventRangeMin(e: { title: string; start: string }): { sm: number; em: number } {
  const { start, end } = eventTimeRange(e)
  const sm = parseHm(start)
  const em = parseHm(end)
  if (sm == null) return { sm: 8 * 60, em: 8 * 60 + 30 }
  if (em == null || em <= sm) return { sm, em: sm + 30 }
  return { sm, em }
}

export function compareByShiftRange(
  a: { title: string; start: string; staffDisplay?: string | null },
  b: { title: string; start: string; staffDisplay?: string | null }
): number {
  const ar = eventRangeMin(a)
  const br = eventRangeMin(b)
  return (
    ar.sm - br.sm ||
    ar.em - br.em ||
    String(a.staffDisplay ?? "").localeCompare(String(b.staffDisplay ?? ""), "it")
  )
}

export function eventTimeRange(e: { title: string; start: string }): { start: string; end: string } {
  const fieldStart = parseHm(e.start)
  const fromTitle = parseRangeFromTitle(e.title)
  if (fromTitle) {
    const titleStart = parseHm(fromTitle.start)!
    const titleEnd = parseHm(fromTitle.end)!
    const sm = usableShiftStart(titleStart, titleEnd, fieldStart)
    const em = titleEnd > sm ? titleEnd : sm + 30
    return { start: formatHm(sm), end: formatHm(em) }
  }
  const sm = fieldStart != null && fieldStart >= SHIFT_DAY_START_MIN ? fieldStart : DESK_OPEN_MIN
  return { start: formatHm(sm), end: formatHm(sm + 30) }
}

export function buildReceptionTitle(activity: string, start: string, end: string): string {
  const label = String(activity ?? "").trim() || "Sportello"
  const sm = parseHm(start)
  const em = parseHm(end)
  const s = formatHm(sm ?? 8 * 60)
  const e = formatHm(em != null && sm != null && em > sm ? em : (sm ?? 8 * 60) + 30)
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
  if (sm == null || em == null || em <= sm) return Math.floor((parseHm(e.start) ?? 8 * 60) / 60) === hour
  const hourStart = hour * 60
  const hourEnd = hourStart + 60
  return sm < hourEnd && em > hourStart
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
    const s = parseHm(e.start)
    if (s == null) return false
    return s >= slotStartMin && s < slotEnd
  }
  if (em <= sm) return sm >= slotStartMin && sm < slotEnd
  return sm < slotEnd && em > slotStartMin
}

export function addHoursToHm(hm: string, hours: number): string {
  const m = parseHm(hm)
  if (m == null) return hm
  return formatHm(m + hours * 60)
}
