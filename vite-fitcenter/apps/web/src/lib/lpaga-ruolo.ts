/** Ruoli libro paga: istruttore, coordinatore, responsabile di reparto, amministratore. */
export function ruoloLabel(r: string): string {
  if (r === "admin") return "Amministratore"
  if (r === "manager") return "Responsabile"
  if (r === "coordinator") return "Coordinatore"
  return "Istruttore"
}

export function isLpagaTeamRuolo(r?: string | null): boolean {
  return r === "admin" || r === "manager" || r === "coordinator"
}

export const RUOLO_LEGENDA =
  "Istruttore: inserisce i propri turni. Coordinatore: vede e gestisce solo le mansioni assegnate, non tutto il reparto. Responsabile: gestisce il personale del proprio reparto. Amministratore: accesso completo al libro paga."
