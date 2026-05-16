import type { CalendarioComparto } from "@/api/calendario"

import { MANUAL_SERVER_COMPARTI } from "@/lib/calendario-manual"

/** Comparti con turni a fascia oraria (solo DB, senza Excel in build). */
export const SHIFT_RANGE_COMPARTI: CalendarioComparto[] = [...MANUAL_SERVER_COMPARTI]

export function compartoUsesShiftRange(comparto: CalendarioComparto | null | undefined): boolean {
  return comparto != null && SHIFT_RANGE_COMPARTI.includes(comparto)
}

export function defaultZonaForShiftComparto(comparto: CalendarioComparto): string {
  if (comparto === "reception") return "reception"
  if (comparto === "sala_fitness") return "sala_fitness"
  if (comparto === "acquaticita") return "acquaticita"
  if (comparto === "spogliatoi") return "spogliatoi"
  if (comparto === "scuola_nuoto") return "acqua"
  return "invernale"
}

export function defaultActivityForShiftComparto(comparto: CalendarioComparto): string {
  if (comparto === "reception") return "Sportello"
  if (comparto === "sala_fitness") return "Turno sala"
  if (comparto === "acquaticita") return "Acquaticità"
  if (comparto === "spogliatoi") return "Spogliatoi"
  if (comparto === "scuola_nuoto") return "Lezione"
  return "Copertura"
}
