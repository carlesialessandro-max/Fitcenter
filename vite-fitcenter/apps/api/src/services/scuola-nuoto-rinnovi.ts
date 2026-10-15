import type { Abbonamento } from "../types/gestionale.js"

/** Fine corsi scuola nuoto bambini / acquaticità — stagione 2026-27. */
export const SCUOLA_NUOTO_CORSI_SCADENZA = [
  { id: "2026-11-08", dataFine: "2026-11-08", label: "8 novembre 2026" },
  { id: "2027-01-17", dataFine: "2027-01-17", label: "17 gennaio 2027" },
  { id: "2027-03-07", dataFine: "2027-03-07", label: "7 marzo 2027" },
  { id: "2027-04-25", dataFine: "2027-04-25", label: "25 aprile 2027" },
  { id: "2027-06-13", dataFine: "2027-06-13", label: "13 giugno 2027" },
] as const

export type TipologiaCorsoRinnovo = "acquaticita" | "scuola_nuoto"

const ALLOWED_FINI = new Set<string>(SCUOLA_NUOTO_CORSI_SCADENZA.map((c) => c.dataFine))

export function isDataFineCorsoRinnovo(dataFine: string): boolean {
  return ALLOWED_FINI.has(String(dataFine ?? "").slice(0, 10))
}

function blobAbb(a: Abbonamento): string {
  return `${a.macroCategoriaDescrizione ?? ""} ${a.categoriaAbbonamentoDescrizione ?? ""} ${a.pianoNome ?? ""} ${a.abbonamentoDescrizione ?? ""}`
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

/** Solo acquaticità e scuola nuoto bambini (no agonismo, no adulti). */
export function tipologiaCorsoRinnovo(a: Abbonamento): TipologiaCorsoRinnovo | null {
  const text = blobAbb(a)
  if (/\bNUOTO ADULTI\b/.test(text)) return null
  if (/ACQUATICIT/.test(text)) return "acquaticita"
  if (/SCUOLA\s*NUOTO/.test(text)) return "scuola_nuoto"
  return null
}

export function ymdDataFine(s: string): string {
  const t = String(s ?? "").trim()
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(t)
  if (iso) return iso[1]!
  const it = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/.exec(t)
  if (it) return `${it[3]}-${it[2]!.padStart(2, "0")}-${it[1]!.padStart(2, "0")}`
  return t.slice(0, 10)
}
