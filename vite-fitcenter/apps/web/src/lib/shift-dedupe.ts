import { compareByShiftRange, eventRangeMin } from "@/lib/reception-shift"
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
  out.sort(compareByShiftRange)
  return out
}
