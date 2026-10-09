import { buildShiftTitle, compareByShiftRange, eventRangeMin, formatHm } from "@/lib/reception-shift"
import { staffColorKey } from "@/lib/staff-colors"

type ShiftEvent = {
  id: string
  title: string
  start: string
  staffDisplay?: string | null
  staff?: string | null
  staffOverride?: string | null
  istruttoreId?: string | null
  zona?: string | null
}

const DESK_OPEN = 8 * 60
const MORNING_START_LATEST = 9 * 60 + 30
const MORNING_END_MIN = 13 * 60
const MORNING_MIN_DUR = 3 * 60
const OPEN_FRAGMENT_GAP = 60

function activityFromTitle(title: string): string {
  const t = String(title ?? "").trim()
  const cut = t.search(/\d{1,2}[:.]\d{2}/)
  const raw = (cut > 0 ? t.slice(0, cut) : t).replace(/[·•.\-–—]+\s*$/, "").trim()
  return raw || "Sportello"
}

function withDisplayRange<T extends ShiftEvent>(e: T, sm: number, em: number): T {
  const start = formatHm(sm)
  const end = formatHm(em)
  return { ...e, start, title: buildShiftTitle(activityFromTitle(e.title), start, end) }
}

function isShortDeskOpen(sm: number, em: number): boolean {
  return sm === DESK_OPEN && em - sm <= 30
}

function isLongMorning(sm: number, em: number): boolean {
  return sm <= MORNING_START_LATEST && em >= MORNING_END_MIN && em - sm >= MORNING_MIN_DUR
}

/** Stesso operatore, stesso orario o contenuto in un turno più lungo: tiene il turno che copre di più. */
export function mergeOverlappingShifts<T extends ShiftEvent>(laneEvents: T[]): T[] {
  const sorted = [...laneEvents].sort((a, b) => {
    const ar = eventRangeMin(a)
    const br = eventRangeMin(b)
    return ar.sm - br.sm || br.em - ar.em || a.id.localeCompare(b.id)
  })
  const out: T[] = []
  for (const e of sorted) {
    const r = eventRangeMin(e)
    const last = out[out.length - 1]
    if (!last) {
      out.push(e)
      continue
    }
    const lr = eventRangeMin(last)
    if (r.sm < lr.em) {
      const lastDur = lr.em - lr.sm
      const dur = r.em - r.sm
      if (dur > lastDur || (dur === lastDur && r.sm < lr.sm)) out[out.length - 1] = e
      continue
    }
    out.push(e)
  }
  return out
}

/**
 * Residui Excel 08:00–08:30: si attaccano a chi fa davvero 08:00/09:30–14:00.
 * Se la mattina è già coperta da un’altra persona, lo slot da 30 minuti sparisce (non è un secondo apertura).
 */
export function coalesceMorningOpenFragments<T extends ShiftEvent>(events: T[]): T[] {
  if (events.length < 2) return events
  const tagged = events.map((e) => ({ e, r: eventRangeMin(e), key: staffColorKey(e) }))
  const longMorning = tagged.filter((x) => isLongMorning(x.r.sm, x.r.em) && !isShortDeskOpen(x.r.sm, x.r.em))
  const extendStart = new Map<string, number>()
  const drop = new Set<string>()

  for (const open of tagged.filter((x) => isShortDeskOpen(x.r.sm, x.r.em))) {
    const same = longMorning
      .filter((m) => m.key === open.key && m.r.sm >= open.r.em && m.r.sm - open.r.em <= OPEN_FRAGMENT_GAP)
      .sort((a, b) => a.r.sm - b.r.sm)[0]
    if (same) {
      drop.add(open.e.id)
      const prev = extendStart.get(same.e.id)
      extendStart.set(same.e.id, prev == null ? open.r.sm : Math.min(prev, open.r.sm))
      continue
    }
    if (longMorning.some((m) => m.key !== open.key || m.r.sm <= DESK_OPEN)) {
      drop.add(open.e.id)
    }
  }

  const out: T[] = []
  for (const x of tagged) {
    if (drop.has(x.e.id)) continue
    const sm0 = extendStart.get(x.e.id)
    if (sm0 != null && sm0 < x.r.sm) out.push(withDisplayRange(x.e, sm0, x.r.em))
    else out.push(x.e)
  }
  return out
}

export function dedupeShiftEvents<T extends ShiftEvent>(dayEvents: T[]): T[] {
  const byLane = new Map<string, T[]>()
  const sorted = [...dayEvents].sort((a, b) => eventRangeMin(a).sm - eventRangeMin(b).sm || a.id.localeCompare(b.id))
  for (const e of sorted) {
    const key = staffColorKey(e)
    const list = byLane.get(key)
    if (list) list.push(e)
    else byLane.set(key, [e])
  }
  const out: T[] = []
  for (const list of byLane.values()) out.push(...mergeOverlappingShifts(list))
  const coalesced = coalesceMorningOpenFragments(out)
  coalesced.sort(compareByShiftRange)
  return coalesced
}
