import type { Cliente, Abbonamento, BudgetMensile } from "../types/gestionale.js"

function str(v: unknown): string {
  if (v == null) return ""
  return String(v)
}
function num(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
function dateStr(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.split("T")[0] ?? v
  if (v instanceof Date) return v.toISOString().split("T")[0] ?? ""
  return String(v)
}

/** Mappa una riga generica dal DB (nomi colonne italiani o inglesi) a Cliente */
export function rowToCliente(row: Record<string, unknown>, abbonamentiCount: Map<string, number>): Cliente {
  const id = str(row.Id ?? row.id ?? row.ClienteId ?? row.clienteId)
  const count = abbonamentiCount.get(id) ?? 0
  const stato = (row.Stato ?? row.stato ?? (count > 0 ? "attivo" : "inattivo")) as string
  return {
    id: id || crypto.randomUUID(),
    nome: str(row.Nome ?? row.nome ?? row.Name ?? row.name),
    cognome: str(row.Cognome ?? row.cognome ?? row.Surname ?? row.surname),
    email: str(row.Email ?? row.email),
    telefono: str(row.Telefono ?? row.telefono ?? row.Phone ?? row.phone),
    citta: str(row.Citta ?? row.citta ?? row.City ?? row.city),
    codiceFiscale: str(row.CodiceFiscale ?? row.codiceFiscale) || undefined,
    abbonamentiAttivi: num(row.AbbonamentiAttivi ?? row.abbonamentiAttivi) || count,
    stato: stato.toLowerCase() === "inattivo" ? "inattivo" : "attivo",
  }
}

/** Mappa riga DB ad Abbonamento */
export function rowToAbbonamento(row: Record<string, unknown>): Abbonamento {
  const dataFine = dateStr(row.DataFine ?? row.dataFine ?? row.Fine ?? row.fine)
  const oggi = new Date().toISOString().split("T")[0]
  const stato = dataFine && dataFine < oggi ? "scaduto" : "attivo"
  const categorie = ["palestra", "piscina", "spa", "corsi", "full_premium"] as const
  let cat = str(row.Categoria ?? row.categoria ?? row.Category ?? row.category).toLowerCase()
  if (!categorie.includes(cat as typeof categorie[number])) cat = "palestra"
  return {
    id: str(row.Id ?? row.id) || crypto.randomUUID(),
    clienteId: str(row.ClienteId ?? row.clienteId),
    clienteNome: str(row.ClienteNome ?? row.clienteNome ?? row.Cliente ?? row.cliente),
    pianoId: str(row.PianoId ?? row.pianoId),
    pianoNome: str(row.PianoNome ?? row.pianoNome ?? row.Piano ?? row.piano),
    categoria: cat as Abbonamento["categoria"],
    prezzo: num(row.Prezzo ?? row.prezzo ?? row.Price ?? row.price),
    dataInizio: dateStr(row.DataInizio ?? row.dataInizio ?? row.Inizio ?? row.inizio),
    dataFine,
    stato: (row.Stato ?? row.stato ?? stato) as "attivo" | "scaduto",
    consulenteNome: str(row.ConsulenteNome ?? row.consulenteNome ?? row.Consulente ?? row.consulente) || undefined,
  }
}

/** Mappa riga DB a BudgetMensile */
export function rowToBudget(row: Record<string, unknown>): BudgetMensile {
  return {
    anno: num(row.Anno ?? row.anno ?? row.Year ?? row.year),
    mese: num(row.Mese ?? row.mese ?? row.Month ?? row.month),
    budget: num(row.Budget ?? row.budget),
    vendite: num(row.Vendite ?? row.vendite ?? row.Sales ?? row.sales) || undefined,
  }
}
