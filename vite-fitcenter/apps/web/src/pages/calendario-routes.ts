import type { CalendarioComparto } from "@/api/calendario"
import type { Role } from "@/contexts/AuthContext"

export type CalendarioSegmento =
  | "corsi"
  | "scuola-nuoto"
  | "piscina"
  | "reception"
  | "campus"
  | "sala-fitness"
  | "acquaticita"
  | "spogliatoi"
  | "consulenti"

export const CALENDARIO_SEGMENTI: { segmento: CalendarioSegmento; api: CalendarioComparto; label: string }[] = [
  { segmento: "corsi", api: "corsi", label: "Corsi (terra + acqua)" },
  { segmento: "scuola-nuoto", api: "scuola_nuoto", label: "Scuola nuoto" },
  { segmento: "piscina", api: "piscina", label: "Calendario bagnini" },
  { segmento: "reception", api: "reception", label: "Reception" },
  { segmento: "campus", api: "campus", label: "Campus" },
  { segmento: "sala-fitness", api: "sala_fitness", label: "Sala fitness" },
  { segmento: "acquaticita", api: "acquaticita", label: "Acquaticità" },
  { segmento: "spogliatoi", api: "spogliatoi", label: "Spogliatoi" },
  { segmento: "consulenti", api: "consulenti", label: "Consulenti" },
]

export function segmentoToApi(s: string): CalendarioComparto | null {
  const row = CALENDARIO_SEGMENTI.find((x) => x.segmento === s)
  return row?.api ?? null
}

export function apiToSegmento(api: CalendarioComparto): CalendarioSegmento | null {
  const row = CALENDARIO_SEGMENTI.find((x) => x.api === api)
  return row?.segmento ?? null
}

export function calendarioPath(segmento: CalendarioSegmento): string {
  return `/calendario/${segmento}`
}

export function roleCanReadCalendarioComparto(role: Role, comparto: CalendarioComparto): boolean {
  if (role === "admin") return true
  if (comparto === "corsi") return role === "corsi" || role === "istruttore"
  if (comparto === "scuola_nuoto") return role === "scuola_nuoto"
  if (comparto === "piscina") return role === "bagnini"
  if (comparto === "acquaticita" || comparto === "spogliatoi") return role === "bagnini"
  if (comparto === "campus") return role === "campus"
  if (comparto === "reception") return role === "operatore" || role === "firme"
  if (comparto === "sala_fitness") return role === "bagnini"
  if (comparto === "consulenti") return false
  return false
}

export function roleCanWriteCalendarioComparto(role: Role, comparto: CalendarioComparto): boolean {
  if (role === "admin") return true
  if (comparto === "corsi") return role === "corsi" || role === "istruttore"
  if (comparto === "scuola_nuoto") return role === "scuola_nuoto"
  if (comparto === "piscina") return role === "bagnini"
  if (comparto === "acquaticita" || comparto === "spogliatoi") return role === "bagnini"
  if (comparto === "campus") return role === "campus"
  if (comparto === "reception") return role === "operatore" || role === "firme"
  if (comparto === "sala_fitness") return role === "bagnini"
  if (comparto === "consulenti") return false
  return false
}
