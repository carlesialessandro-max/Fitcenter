import type { CalendarioComparto } from "@/api/calendario"

/** Comparti con turni a fascia oraria (solo DB, senza Excel in build). */
export const SHIFT_RANGE_COMPARTI: CalendarioComparto[] = ["reception", "piscina", "sala_fitness"]

export function compartoUsesShiftRange(comparto: CalendarioComparto | null | undefined): boolean {
  return comparto != null && SHIFT_RANGE_COMPARTI.includes(comparto)
}

export function defaultZonaForShiftComparto(comparto: CalendarioComparto): string {
  if (comparto === "reception") return "reception"
  if (comparto === "sala_fitness") return "sala_fitness"
  return "invernale"
}

export function defaultActivityForShiftComparto(comparto: CalendarioComparto): string {
  if (comparto === "reception") return "Sportello"
  if (comparto === "sala_fitness") return "Turno sala"
  return "Copertura"
}
