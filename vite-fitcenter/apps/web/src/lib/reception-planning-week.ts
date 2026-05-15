/** Fogli Excel tipo "11-17", "18-24": intervallo giorni del mese per quella settimana di turnazione. */

const SHEET_RANGE_RE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/

export function listReceptionPlanningSheets(events: { sheet?: string }[]): string[] {
  const set = new Set<string>()
  for (const e of events) {
    const s = String(e.sheet ?? "").trim()
    if (s && SHEET_RANGE_RE.test(s)) set.add(s)
  }
  return [...set].sort((a, b) => {
    const pa = SHEET_RANGE_RE.exec(a)
    const pb = SHEET_RANGE_RE.exec(b)
    if (pa && pb) return Number(pa[1]) - Number(pb[1])
    return a.localeCompare(b)
  })
}

/** Foglio turnazione reception da usare per una data di calendario (stesso mese dell’ancora). */
export function receptionPlanningSheetForDate(date: Date, sheetNames: string[]): string | null {
  if (!sheetNames.length) return null
  const day = date.getDate()
  for (const name of sheetNames) {
    const m = SHEET_RANGE_RE.exec(name.trim())
    if (!m) continue
    const from = Number(m[1])
    const to = Number(m[2])
    if (day >= from && day <= to) return name
  }
  return sheetNames[sheetNames.length - 1] ?? null
}

export function isReceptionTurnazioneSheet(sheet: string | undefined): boolean {
  return SHEET_RANGE_RE.test(String(sheet ?? "").trim())
}

export function filterReceptionEventsByDate<T extends { sheet?: string }>(
  events: T[],
  date: Date,
  sheetNames: string[]
): T[] {
  if (!sheetNames.length) return events
  const sheet = receptionPlanningSheetForDate(date, sheetNames)
  if (!sheet) return events
  return events.filter((e) => {
    const s = String(e.sheet ?? "").trim()
    if (!isReceptionTurnazioneSheet(s)) return true
    return s === sheet
  })
}

export function receptionSheetLabel(sheet: string): string {
  const m = SHEET_RANGE_RE.exec(sheet.trim())
  if (!m) return sheet
  return `${m[1]}–${m[2]}`
}
