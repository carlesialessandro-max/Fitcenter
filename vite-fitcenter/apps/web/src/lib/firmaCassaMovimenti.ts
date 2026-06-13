import type { CassaMovimentoUtenteRow } from "@/api/data"

function normalizeFirmaBlob(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function isCampusMovimento(r: CassaMovimentoUtenteRow): boolean {
  const blob = normalizeFirmaBlob(`${r.causale ?? ""} ${r.tipoServizioDescrizione ?? ""}`)
  return blob.includes("CAMPUS")
}

export function isAsiTesseramentoMovimento(r: CassaMovimentoUtenteRow): boolean {
  const blob = normalizeFirmaBlob(r.causale ?? "")
  if (!blob) return false
  if (blob.includes("ASI") && blob.includes("ISCR")) return true
  if (blob.includes("TESSERAMENTO")) return true
  if (/\bASI\b/.test(blob)) return true
  return false
}

/** Solo righe con incasso > 0 (esclude cauzioni a zero). */
export function isSoloCampusAcquisto(rows: CassaMovimentoUtenteRow[]): boolean {
  const paid = rows.filter((r) => Number(r.importo ?? 0) > 0)
  if (paid.length === 0) return false
  return paid.every(isCampusMovimento)
}

const ASI_GRATUITO_CAUSALE = "Tesseramento ASI (gratuito campus)"

/**
 * Acquisto campus only: mostra tesseramento ASI a 0 € nel contratto (gratuito).
 * Se esiste già una riga ASI con importo, la azzera; altrimenti la aggiunge.
 */
export function augmentMovimentiCampusAsiGratuito(rows: CassaMovimentoUtenteRow[]): CassaMovimentoUtenteRow[] {
  if (!isSoloCampusAcquisto(rows)) return rows

  const asiIdx = rows.findIndex(isAsiTesseramentoMovimento)
  if (asiIdx >= 0) {
    return rows.map((r, i) =>
      i === asiIdx
        ? {
            ...r,
            importo: 0,
            iscrizioneTotale: 0,
            causale: r.causale?.toLowerCase().includes("gratuit") ? r.causale : ASI_GRATUITO_CAUSALE,
          }
        : r
    )
  }

  const ref = rows[0]
  if (!ref) return rows

  const asiRow: CassaMovimentoUtenteRow = {
    ...ref,
    movimentoId: null,
    causale: ASI_GRATUITO_CAUSALE,
    tipoServizioDescrizione: "Abbonamenti",
    importo: 0,
    iscrizioneTotale: 0,
  }

  return [asiRow, ...rows]
}
