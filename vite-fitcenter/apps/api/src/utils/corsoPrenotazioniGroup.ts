import type { PrenotazioneCorsoRow } from "../services/gestionale-sql.js"

function firstNonEmptyStr(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim()
  return s ? s : undefined
}

/** Stessa logica della pagina web Corsi (getCorsoTitolo + chiave gruppo). */
export function getCorsoTitolo(r: PrenotazioneCorsoRow): string {
  const raw = (r.raw ?? {}) as Record<string, unknown>
  return (
    firstNonEmptyStr(r.servizio) ??
    firstNonEmptyStr(raw.PrenotazioneDescrizione) ??
    firstNonEmptyStr(raw.ServizioDescrizione) ??
    firstNonEmptyStr(raw.DescrizioneServizio) ??
    firstNonEmptyStr(raw.NomeServizio) ??
    firstNonEmptyStr(raw.AttivitaDescrizione) ??
    firstNonEmptyStr(raw.DescrizioneAttivita) ??
    firstNonEmptyStr(raw.CorsoDescrizione) ??
    firstNonEmptyStr(raw.DescrizioneCorso) ??
    firstNonEmptyStr(raw.NomeCorso) ??
    firstNonEmptyStr(raw.Corso) ??
    "—"
  )
}

export function corsoGroupKey(r: PrenotazioneCorsoRow): string {
  const servizio = getCorsoTitolo(r)
  const giorno = (r.giorno ?? "").trim() || "—"
  const oraInizio = (r.oraInizio ?? "").trim() || undefined
  const oraFine = (r.oraFine ?? "").trim() || undefined
  return `${servizio}__${giorno}__${oraInizio ?? ""}__${oraFine ?? ""}`
}
