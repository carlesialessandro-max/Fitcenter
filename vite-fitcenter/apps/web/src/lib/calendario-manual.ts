import type { CalendarioComparto, CalendarioMergedEventDto } from "@/api/calendario"

/** Calendari gestiti solo su server (nessun Excel in build). */
/** Turni manuali (reception, bagnini, …): solo DB, fascia oraria, opz. dataIso. */
export const MANUAL_SERVER_COMPARTI: CalendarioComparto[] = [
  "reception",
  "piscina",
  "sala_fitness",
  "acquaticita",
  "spogliatoi",
]

/** Corsi/lezioni importati una volta da Excel, poi solo DB (modifiche da calendario). */
export const SERVER_SEEDED_COMPARTI: CalendarioComparto[] = ["corsi", "scuola_nuoto"]

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

/** Slot visibile nel giorno di calendario d (data esatta o, legacy, ripetizione settimanale per dow). */
export function eventMatchesCalendarDay(e: CalendarioMergedEventDto, d: Date): boolean {
  const dateIso = String((e as { dateIso?: string | null }).dateIso ?? "").trim()
  if (dateIso) return dateIso === isoYmd(d)
  return e.dow === d.getDay()
}
