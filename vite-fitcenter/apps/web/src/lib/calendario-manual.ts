import type { CalendarioComparto, CalendarioMergedEventDto } from "@/api/calendario"

/** Calendari gestiti solo su server (nessun Excel in build). */
/** Turni manuali (reception, bagnini, …): solo DB, fascia oraria, opz. dataIso. */
export const MANUAL_SERVER_COMPARTI: CalendarioComparto[] = [
  "reception",
  "piscina",
  "sala_fitness",
  "acquaticita",
  "spogliatoi",
  "pulizie",
]

/** Import una volta (Excel/orario), poi solo DB. */
export const SERVER_SEEDED_COMPARTI: CalendarioComparto[] = ["scuola_nuoto", "sala_fitness"]

export function compartoIsManualServer(comparto: CalendarioComparto | null | undefined): boolean {
  return comparto != null && MANUAL_SERVER_COMPARTI.includes(comparto)
}

export function compartoIsServerSeeded(comparto: CalendarioComparto | null | undefined): boolean {
  return comparto != null && SERVER_SEEDED_COMPARTI.includes(comparto)
}

function isoYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type CalendarDayEvent = {
  dateIso?: string | null
  dow: number
  seasonal?: { from: string; to: string }
}

function eventDateIso(e: { dateIso?: string | null }): string {
  return String(e.dateIso ?? "").trim()
}

function eventMatchesSeason(e: CalendarDayEvent, d: Date): boolean {
  const monthDay = isoYmd(d).slice(5)
  return Boolean(e.seasonal && e.dow === d.getDay() && monthDay >= e.seasonal.from && monthDay <= e.seasonal.to)
}

/** Slot visibile nel giorno di calendario d (data esatta o, legacy, ripetizione settimanale per dow). */
export function eventMatchesCalendarDay(e: CalendarioMergedEventDto, d: Date): boolean {
  if (e.seasonal) return eventMatchesSeason(e, d)
  const dateIso = eventDateIso(e)
  if (dateIso) return dateIso === isoYmd(d)
  return e.dow === d.getDay()
}

/** Se quel giorno ha turni con data, ignora i vecchi slot settimanali senza data (doppioni SIMO/Innocenti). */
export function eventsMatchingCalendarDay<T extends CalendarDayEvent>(
  events: T[],
  d: Date
): T[] {
  const iso = isoYmd(d)
  const seasonal = events.filter((e) => eventMatchesSeason(e, d))
  const dated = events.filter((e) => eventDateIso(e) === iso)
  if (dated.length) return [...dated, ...seasonal]
  return [...events.filter((e) => !eventDateIso(e) && !e.seasonal && e.dow === d.getDay()), ...seasonal]
}
