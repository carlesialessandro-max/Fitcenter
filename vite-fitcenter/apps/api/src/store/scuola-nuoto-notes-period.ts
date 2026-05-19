/** Intervalli calendario per archivio note scuola nuoto (settimana lun–dom, mese solare). */

export type ScuolaNuotoNotesPeriod = "current_week" | "previous_week" | "month"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = x.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + diff)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

export function dateRangeForNotesPeriod(
  period: ScuolaNuotoNotesPeriod,
  ref: Date = new Date()
): { from: string; to: string; label: string } {
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  if (period === "month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1)
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const label = today.toLocaleDateString("it-IT", { month: "long", year: "numeric" })
    return { from: isoDateLocal(from), to: isoDateLocal(to), label }
  }
  const weekStart = startOfWeekMonday(today)
  const offset = period === "previous_week" ? -7 : 0
  const from = addDays(weekStart, offset)
  const to = addDays(from, 6)
  const label =
    period === "previous_week"
      ? `Settimana precedente (${fmtItShort(from)} – ${fmtItShort(to)})`
      : `Settimana in corso (${fmtItShort(from)} – ${fmtItShort(to)})`
  return { from: isoDateLocal(from), to: isoDateLocal(to), label }
}

function fmtItShort(d: Date): string {
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
}

export function eachIsoDateInRange(from: string, to: string): string[] {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from)
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to)
  if (!m1 || !m2) return []
  let cur = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]))
  const end = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]))
  const out: string[] = []
  while (cur.getTime() <= end.getTime()) {
    out.push(isoDateLocal(cur))
    cur = addDays(cur, 1)
  }
  return out
}

export function weekdayKeyFromIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return "lun"
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const map = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"] as const
  return map[d.getDay()] ?? "lun"
}
