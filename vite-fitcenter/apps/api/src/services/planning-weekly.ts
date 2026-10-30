/**
 * Titoli planning corsi (Excel/PDF). Il match resta disponibile per calendario e report.
 * Le lezioni vuote della pagina Corsi NON si filtrano più da qui: un corso attivo in
 * gestionale va mostrato anche a zero iscritti, per poterlo bloccare da casa.
 */

export function compactPlanningTitle(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/^(FITNESS|H2O|CORSIAPAGAMENTO|CORSIPAGAMENTODANZA)+/, "")
    .replace(/[^A-Z0-9]/g, "")
}

/** Match titoli planning: uguaglianza o contenimento solo se il più corto ha almeno 8 caratteri (evita TERRA ⊂ SBARRATERRA). */
export function planningTitlesMatch(servizio: string, eventTitle: string): boolean {
  const a = compactPlanningTitle(servizio)
  const b = compactPlanningTitle(eventTitle)
  if (!a || !b) return false
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return shorter.length >= 8 && longer.includes(shorter)
}
