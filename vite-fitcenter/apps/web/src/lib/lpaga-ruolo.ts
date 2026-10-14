/** Ruoli libro paga: istruttore, responsabile di reparto, amministratore. */
export function ruoloLabel(r: string): string {
  if (r === "admin") return "Amministratore"
  if (r === "manager") return "Responsabile"
  return "Istruttore"
}

export const RUOLO_LEGENDA =
  "Istruttore: inserisce i propri turni. Responsabile: gestisce il personale del proprio reparto. Amministratore: accesso completo al libro paga."
