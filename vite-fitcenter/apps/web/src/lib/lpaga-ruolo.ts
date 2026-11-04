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
  "Un solo utente, anche se insegna e coordina. Istruttore: inserisce i propri corsi. Coordinatore e responsabile: vedono i reparti assegnati e, come istruttori, inseriscono i propri corsi dalle mansioni. Amministratore: accesso completo al libro paga."
