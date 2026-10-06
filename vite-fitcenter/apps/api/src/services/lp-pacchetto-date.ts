/** Date ISO (YYYY-MM-DD) per pacchetto private: stesso giorno ogni 7 giorni, opz. un secondo weekday. */

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function isoDow(iso: string): number {
  return new Date(`${iso}T12:00:00`).getDay()
}

/** n date a partire da startIso; secondoDow 0–6 (JS) per es. lunedì + mercoledì. */
export function buildWeeklyLessonDates(startIso: string, n: number, secondoDow?: number | null): string[] {
  const count = Math.max(0, Math.floor(n))
  if (count === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startIso)) return []
  const firstDow = isoDow(startIso)
  const extra =
    secondoDow == null || !Number.isInteger(secondoDow) || secondoDow < 0 || secondoDow > 6 || secondoDow === firstDow
      ? null
      : secondoDow
  if (extra == null) {
    return Array.from({ length: count }, (_, i) => addDaysIso(startIso, i * 7))
  }
  let delta = (extra - firstDow + 7) % 7
  if (delta === 0) delta = 7
  const out: string[] = []
  let a = startIso
  let b = addDaysIso(startIso, delta)
  while (out.length < count) {
    if (a <= b) {
      out.push(a)
      a = addDaysIso(a, 7)
    } else {
      out.push(b)
      b = addDaysIso(b, 7)
    }
  }
  return out
}

export function parseSecondoGiornoSettimana(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).trim())
  if (!Number.isInteger(n) || n < 0 || n > 6) return null
  return n
}
