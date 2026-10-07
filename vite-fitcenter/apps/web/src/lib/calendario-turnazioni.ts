import type { CalendarioIstruttore, CalendarioMergedEventDto } from "@/api/calendario"
import { eventMatchesCalendarDay } from "@/lib/calendario-manual"
import { eventTimeRange, parseHm } from "@/lib/reception-shift"
import { staffColorKey, staffLaneLabel } from "@/lib/staff-colors"

function isoYmd(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}
function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  return addDays(x, -mondayIndex(x))
}

export type TurnazioniScope = "week" | "month"

export type StaffHoursRow = {
  key: string
  label: string
  minutes: number
  slotCount: number
}

export type TurnazioniPeriodSummary = {
  scope: TurnazioniScope
  label: string
  from: string
  to: string
  rows: StaffHoursRow[]
  totalMinutes: number
  totalSlots: number
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Durata slot: intervallo nel titolo, altrimenti default per comparto. */
export function eventDurationMinutes(e: CalendarioMergedEventDto, comparto?: string): number {
  const { start, end } = eventTimeRange(e)
  const sm = parseHm(start)
  const em = parseHm(end)
  if (sm != null && em != null && em > sm) {
    const d = em - sm
    const max =
      comparto === "reception" || comparto === "piscina" || comparto === "sala_fitness" || comparto === "pulizie"
        ? 14 * 60
        : 8 * 60
    if (d > 0 && d <= max) return d
  }
  if (comparto === "reception" || comparto === "piscina" || comparto === "sala_fitness" || comparto === "pulizie") return 6 * 60
  if (comparto === "scuola_nuoto" || comparto === "acquaticita" || comparto === "spogliatoi") return 45
  return 60
}

function mergeMinuteRanges(ranges: { sm: number; em: number }[]): { sm: number; em: number }[] {
  const sorted = [...ranges].sort((a, b) => a.sm - b.sm || b.em - a.em)
  const out: { sm: number; em: number }[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (!last || r.sm >= last.em) {
      out.push({ ...r })
      continue
    }
    last.em = Math.max(last.em, r.em)
  }
  return out
}

function staffLabelsFromEvent(e: CalendarioMergedEventDto, _instructors: CalendarioIstruttore[]): { key: string; label: string }[] {
  const key = staffColorKey(e)
  const label = staffLaneLabel(e)
  if (key === "unknown" && (!label || label === "—")) return [{ key: "unknown", label: "Non assegnato" }]
  return [{ key, label: label && label !== "—" ? label : "Non assegnato" }]
}

function datesForWeek(anchor: Date): Date[] {
  const start = startOfWeekMonday(anchor)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

function datesForMonth(anchor: Date): Date[] {
  const y = anchor.getFullYear()
  const m = anchor.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  const out: Date[] = []
  for (let d = 1; d <= last; d++) out.push(new Date(y, m, d, 12, 0, 0, 0))
  return out
}

function countOccurrencesOnDates(events: CalendarioMergedEventDto[], dates: Date[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of events) {
    const sk = e.stableKey
    let n = 0
    for (const d of dates) {
      if (eventMatchesCalendarDay(e, d)) n++
    }
    counts.set(sk, n)
  }
  return counts
}

function buildPeriodSummary(
  scope: TurnazioniScope,
  label: string,
  dates: Date[],
  events: CalendarioMergedEventDto[],
  instructors: CalendarioIstruttore[],
  comparto?: string
): TurnazioniPeriodSummary {
  const occ = countOccurrencesOnDates(events, dates)
  const byStaff = new Map<string, StaffHoursRow>()

  for (const e of events) {
    const n = occ.get(e.stableKey) ?? 0
    if (n <= 0) continue
    const dur = eventDurationMinutes(e, comparto)
    const staffList = staffLabelsFromEvent(e, instructors)
    const share = staffList.length > 0 ? dur / staffList.length : dur
    for (const { key, label: staffLabel } of staffList) {
      const prev = byStaff.get(key) ?? { key, label: staffLabel, minutes: 0, slotCount: 0 }
      prev.minutes += share * n
      prev.slotCount += n
      byStaff.set(key, prev)
    }
  }

  const rows = Array.from(byStaff.values()).sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label))
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0)
  let totalSlots = 0
  for (const e of events) {
    const n = occ.get(e.stableKey) ?? 0
    if (n > 0) totalSlots += n
  }
  const from = isoYmd(dates[0]!)
  const to = isoYmd(dates[dates.length - 1]!)

  return { scope, label, from, to, rows, totalMinutes, totalSlots }
}

const IT_MONTHS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
] as const

export function computeTurnazioni(
  cursor: Date,
  events: CalendarioMergedEventDto[],
  instructors: CalendarioIstruttore[],
  comparto?: string
): { week: TurnazioniPeriodSummary; month: TurnazioniPeriodSummary } {
  const weekDates = datesForWeek(cursor)
  const monthDates = datesForMonth(cursor)
  const w0 = weekDates[0]!
  const w6 = weekDates[6]!
  const weekLabel = `Settimana ${pad2(w0.getDate())}/${pad2(w0.getMonth() + 1)} – ${pad2(w6.getDate())}/${pad2(w6.getMonth() + 1)} ${w6.getFullYear()}`
  const monthLabel = `${IT_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`

  return {
    week: buildPeriodSummary("week", weekLabel, weekDates, events, instructors, comparto),
    month: buildPeriodSummary("month", monthLabel, monthDates, events, instructors, comparto),
  }
}

export function formatHoursMinutes(totalMinutes: number): string {
  const m = Math.round(totalMinutes)
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h > 0 && r > 0) return `${h}h ${r}m`
  if (h > 0) return `${h}h`
  return `${r}m`
}

export function formatHoursDecimal(totalMinutes: number): string {
  return `${(totalMinutes / 60).toFixed(1).replace(".", ",")} h`
}

export function formatHoursShort(totalMinutes: number): string {
  if (totalMinutes <= 0) return ""
  const h = Math.round((totalMinutes / 60) * 10) / 10
  if (Number.isInteger(h)) return String(h)
  return h.toFixed(1).replace(".", ",")
}

export type StaffWeekHoursRow = {
  key: string
  label: string
  days: number[]
  totalMinutes: number
}

/** Ore per persona e per giorno della settimana visibile (come tabella in fondo all'Excel). */
export function computeWeekHoursByStaff(
  weekDays: Date[],
  events: CalendarioMergedEventDto[],
  instructors: CalendarioIstruttore[],
): { rows: StaffWeekHoursRow[]; dayTotals: number[]; totalMinutes: number } {
  const byStaff = new Map<string, StaffWeekHoursRow>()
  const dayTotals = Array.from({ length: weekDays.length }, () => 0)

  for (let i = 0; i < weekDays.length; i++) {
    const d = weekDays[i]!
    const intervals = new Map<string, { label: string; ranges: { sm: number; em: number }[] }>()
    for (const e of events) {
      if (!eventMatchesCalendarDay(e, d)) continue
      const { start, end } = eventTimeRange(e)
      const sm = parseHm(start)
      const em = parseHm(end)
      if (sm == null || em == null || em <= sm) continue
      for (const { key, label } of staffLabelsFromEvent(e, instructors)) {
        const row = intervals.get(key) ?? { label, ranges: [] }
        row.ranges.push({ sm, em })
        intervals.set(key, row)
      }
    }
    for (const [key, { label, ranges }] of intervals) {
      const merged = mergeMinuteRanges(ranges)
      let minutes = 0
      for (const r of merged) minutes += r.em - r.sm
      if (minutes <= 0) continue
      dayTotals[i] += minutes
      const prev = byStaff.get(key) ?? {
        key,
        label,
        days: Array.from({ length: weekDays.length }, () => 0),
        totalMinutes: 0,
      }
      prev.days[i] += minutes
      prev.totalMinutes += minutes
      byStaff.set(key, prev)
    }
  }

  const rows = Array.from(byStaff.values()).sort((a, b) => b.totalMinutes - a.totalMinutes || a.label.localeCompare(b.label))
  const totalMinutes = dayTotals.reduce((s, n) => s + n, 0)
  return { rows, dayTotals, totalMinutes }
}
