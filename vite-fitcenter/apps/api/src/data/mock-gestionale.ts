import type { Cliente, Abbonamento, BudgetMensile, DashboardStats } from "../types/gestionale.js"

export const mockClienti: Cliente[] = [
  { id: "1", nome: "Valentina", cognome: "Gallo", email: "valentina.gallo@email.it", telefono: "+39 333 8901234", citta: "Milano", abbonamentiAttivi: 1, stato: "attivo" },
  { id: "2", nome: "Chiara", cognome: "Marino", email: "chiara.marino@email.it", telefono: "+39 340 5678901", citta: "Milano", abbonamentiAttivi: 1, stato: "attivo" },
  { id: "3", nome: "Elena", cognome: "Moretti", email: "elena.moretti@email.it", telefono: "+39 328 1234567", citta: "Milano", abbonamentiAttivi: 2, stato: "attivo" },
  { id: "4", nome: "Luca", cognome: "Barbieri", email: "luca.barbieri@email.it", telefono: "+39 347 9876543", citta: "Milano", abbonamentiAttivi: 1, stato: "attivo" },
  { id: "5", nome: "Paolo", cognome: "Santoro", email: "paolo.santoro@email.it", telefono: "+39 333 5551234", citta: "Milano", abbonamentiAttivi: 0, stato: "inattivo" },
]

export const mockAbbonamenti: Abbonamento[] = [
  { id: "a1", clienteId: "2", clienteNome: "Chiara Marino", pianoId: "p1", pianoNome: "Piscina Annuale", categoria: "piscina", prezzo: 499.9, dataInizio: "2026-03-01", dataFine: "2027-02-28", stato: "attivo", consulenteNome: "Luca Ferrari" },
  { id: "a2", clienteId: "3", clienteNome: "Elena Moretti", pianoId: "p2", pianoNome: "Corsi Mensile", categoria: "corsi", prezzo: 69.9, dataInizio: "2026-02-01", dataFine: "2026-03-31", stato: "attivo", consulenteNome: "Anna Bianchi" },
  { id: "a3", clienteId: "3", clienteNome: "Elena Moretti", pianoId: "p3", pianoNome: "Spa Mensile", categoria: "spa", prezzo: 179.9, dataInizio: "2026-02-01", dataFine: "2026-02-28", stato: "scaduto", consulenteNome: "Anna Bianchi" },
  { id: "a4", clienteId: "4", clienteNome: "Luca Barbieri", pianoId: "p4", pianoNome: "Palestra Base", categoria: "palestra", prezzo: 49.9, dataInizio: "2026-01-15", dataFine: "2026-02-15", stato: "attivo", consulenteNome: "Luca Ferrari" },
  { id: "a5", clienteId: "1", clienteNome: "Valentina Gallo", pianoId: "p5", pianoNome: "Full Premium Annuale", categoria: "full_premium", prezzo: 899, dataInizio: "2026-01-01", dataFine: "2026-12-31", stato: "attivo", consulenteNome: "Anna Bianchi" },
]

export const mockBudget: BudgetMensile[] = [
  { anno: 2026, mese: 1, budget: 5000, vendite: 1500 },
  { anno: 2026, mese: 2, budget: 5500, vendite: 2200 },
  { anno: 2026, mese: 3, budget: 6000, vendite: 749.7 },
  { anno: 2026, mese: 4, budget: 6000 },
  { anno: 2026, mese: 5, budget: 6000 },
  { anno: 2026, mese: 6, budget: 6000 },
]

const mesi = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]

export function getMockDashboardStats(leadTotali: number, leadVinti: number, leadPersi: number): DashboardStats {
  const entrateMese = 749.7
  const budgetMese = 6000
  const attivi = mockAbbonamenti.filter((a) => a.stato === "attivo").length
  const inScadenza = mockAbbonamenti.filter((a) => {
    if (a.stato !== "attivo") return false
    const fine = new Date(a.dataFine)
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    return fine <= in30
  })
  return {
    leadTotali,
    leadVinti,
    leadPersi,
    abbonamentiAttivi: attivi,
    abbonamentiInScadenza: inScadenza.length,
    entrateMese,
    budgetMese,
    percentualeBudget: Math.round((entrateMese / budgetMese) * 1000) / 10,
    tassoConversione: leadTotali > 0 ? Math.round((leadVinti / leadTotali) * 1000) / 10 : 0,
    clientiAttivi: mockClienti.filter((c) => c.stato === "attivo").length,
    venditePerMese: mockBudget.slice(0, 6).map((b) => ({
      mese: mesi[b.mese - 1],
      vendite: b.vendite ?? 0,
      budget: b.budget,
    })),
    leadPerFonte: [
      { fonte: "Sito Web", count: 4 },
      { fonte: "Google", count: 3 },
      { fonte: "Facebook", count: 3 },
    ],
    abbonamentiPerCategoria: [
      { categoria: "Corsi", count: 2 },
      { categoria: "Piscina", count: 1 },
      { categoria: "Full", count: 1 },
      { categoria: "Palestra", count: 1 },
    ],
    abbonamentiInScadenzaLista: inScadenza.map((a) => ({
      clienteNome: a.clienteNome,
      piano: a.pianoNome.toLowerCase(),
      dataFine: a.dataFine,
    })),
  }
}
