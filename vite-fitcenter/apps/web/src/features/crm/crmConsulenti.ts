/** Consulenti vendita (allineati a utenti operatore / webhook Zapier bambini → Irene). */
export const CRM_CONSULENTI_LEAD: { id: string; nome: string }[] = [
  { id: "carmen", nome: "Carmen Severino" },
  { id: "serena", nome: "Serena Del Prete" },
  { id: "ombretta", nome: "Ombretta Zenoni" },
  { id: "irene", nome: "Irene" },
]

export function crmConsulentiLeadOptionsForAssign(): { id: string; nome: string }[] {
  return [{ id: "", nome: "Non assegnato" }, ...CRM_CONSULENTI_LEAD]
}
