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

/** Valore grezzo età: colonne note + qualunque chiave che corrisponde a «Eta» (driver SQL può usare maiuscole diverse). */
function findEtaRaw(row: Record<string, unknown>): unknown {
  const explicit =
    row.Eta ??
    row.Età ??
    row.ETA ??
    row.ClienteEtaJoin ??
    row.ClienteEta ??
    row.clienteEta ??
    row.EtaCliente ??
    row.Age ??
    row.age
  if (explicit != null && explicit !== "") return explicit
  for (const [k, v] of Object.entries(row)) {
    const nk = k.replace(/\s/g, "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    if (nk === "eta" || nk === "clienteetajoin") {
      if (v != null && v !== "") return v
    }
  }
  return undefined
}

/** Età in anni dalla view (`a.*` con colonna Eta) o da `ClienteEtaJoin` se imposti GESTIONALE_UTENTI_COL_ETA. */
function optionalEtaAnni(row: Record<string, unknown>): number | undefined {
  const raw = findEtaRaw(row)
  if (raw == null || raw === "") return undefined
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."))
  if (!Number.isFinite(n)) return undefined
  const rounded = Math.round(n)
  if (rounded < 0 || rounded > 120) return undefined
  return rounded
}
function dateStr(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.split("T")[0] ?? v
  if (v instanceof Date) return v.toISOString().split("T")[0] ?? ""
  return String(v)
}

/** Mappa una riga generica dal DB (Utenti, Clienti, ecc.) a Cliente */
export function rowToCliente(row: Record<string, unknown>, abbonamentiCount: Map<string, number>): Cliente {
  const id = str(row.IDUtente ?? row.Id ?? row.id ?? row.ClienteId ?? row.clienteId)
  const count = abbonamentiCount.get(id) ?? 0
  const stato = (row.Stato ?? row.stato ?? (count > 0 ? "attivo" : "inattivo")) as string
  const telefono = str(
    row.SMS ?? row.sms ?? row.Telefono_1 ?? row.Telefono_2 ?? row.Telefono ?? row.telefono ?? row.Phone ?? row.phone
  )
  return {
    id: id || crypto.randomUUID(),
    nome: str(row.Nome ?? row.nome ?? row.Name ?? row.name),
    cognome: str(row.Cognome ?? row.cognome ?? row.Surname ?? row.surname),
    email: str(row.Email ?? row.email),
    telefono: telefono || str(row.Telefono_2 ?? row.telefono),
    citta: str(row.Indirizzo_Citta ?? row.Citta ?? row.citta ?? row.City ?? row.city),
    codiceFiscale: str(row.CodiceFiscale ?? row.codiceFiscale) || undefined,
    abbonamentiAttivi: num(row.AbbonamentiAttivi ?? row.abbonamentiAttivi) || count,
    stato: stato.toLowerCase() === "inattivo" ? "inattivo" : "attivo",
  }
}

/** Tesseramenti da escludere: solo descrizioni (CategoriaAbbonamentoDescrizione, MacroCategoriaAbbonamentoDescrizione). */
function isTesseramentoRow(row: Record<string, unknown>): boolean {
  const idCategoria = row.IDCategoria != null ? num(row.IDCategoria) : NaN
  const catDesc = str(row.CategoriaAbbonamentoDescrizione ?? row.categoriaAbbonamentoDescrizione ?? "").trim().toUpperCase()
  const macroDesc = str(
    row.MacroCategoriaAbbonamentoDescrizione ?? row.macroCategoriaAbbonamentoDescrizione ?? ""
  ).trim().toUpperCase()
  const abbonDesc = str(
    row.AbbonamentoDescrizione ?? row.abbonamentoDescrizione ?? row.Abbonamento ?? row.abbonamento ?? ""
  ).trim().toUpperCase()
  // IDCategoria = 19: VARIE/TESSERAMENTI da escludere
  if (!Number.isNaN(idCategoria) && idCategoria === 19) return true
  if (catDesc === "TESSERAMENTI") return true
  if (macroDesc === "VARIE") return true
  if (macroDesc.includes("ASI") && macroDesc.includes("ISCRIZIONE")) return true
  if (abbonDesc.includes("ASI") && abbonDesc.includes("ISCRIZIONE")) return true
  return false
}

/** Mappa riga DB ad Abbonamento (Abbonamentilscrizione, ecc.) */
export function rowToAbbonamento(row: Record<string, unknown>): Abbonamento {
  const dataFine = dateStr(row.DataFine ?? row.dataFine ?? row.Fine ?? row.fine)
  const oggi = new Date().toISOString().split("T")[0]
  const stato = dataFine && dataFine < oggi ? "scaduto" : "attivo"
  const categorie = ["palestra", "piscina", "spa", "corsi", "full_premium"] as const
  let cat = str(row.Categoria ?? row.categoria ?? row.Category ?? row.category).toLowerCase()
  if (!categorie.includes(cat as typeof categorie[number])) cat = "palestra"
  const cognome = str(row.ClienteCognome ?? row.Cognome ?? row.cognome)
  const nome = str(row.ClienteNome ?? row.Nome ?? row.nome)
  const clienteNome = [cognome, nome].filter(Boolean).join(" ") || str(row.Cliente ?? row.cliente)
  // Descrizioni dalla view (se la view le espone; altrimenti la tabella base ha solo IDDurata, NomeOperatore, ecc.)
  const categoriaAbbonamentoDescrizione = str(
    row.CategoriaAbbonamentoDescrizione ??
    row.categoriaAbbonamentoDescrizione ??
    row.DescrizioneCategoria ??
    row.NomeCategoria ??
    ""
  )
  const macroCategoriaDescrizione = str(
    row.MacroCategoriaAbbonamentoDescrizione ?? row.macroCategoriaAbbonamentoDescrizione ?? ""
  )
  const abbonamentoDescrizione = str(
    row.AbbonamentoDescrizione ??
    row.abbonamentoDescrizione ??
    row.DescrizioneAbbonamento ??
    row.NomeAbbonamento ??
    row.Abbonamento ??
    row.abbonamento ??
    ""
  )
  // Per la colonna "Abbonamento" in UI: descrizione view, oppure "Piano IDDurata" se abbiamo solo IDDurata (tabella base)
  const pianoNome =
    abbonamentoDescrizione ||
    categoriaAbbonamentoDescrizione ||
    str(row.PianoNome ?? row.pianoNome ?? row.Piano ?? row.piano) ||
    str(row.Descrizione ?? row.descrizione) ||
    (row.IDDurata != null ? `Piano ${row.IDDurata}` : "") ||
    "Abbonamento"
  const prezzo = num(row.Totale ?? row.Prezzo ?? row.prezzo ?? row.Price ?? row.price ?? row.Importo ?? row.importo)
  const dmRaw = row.DurataMesi ?? row.durataMesi ?? row.Durata ?? row.durata
  let durataMesi: number | undefined
  if (dmRaw != null && String(dmRaw).trim() !== "") {
    const n = num(dmRaw)
    if (n >= 1 && n <= 240) durataMesi = Math.round(n)
  } else {
    const idDur = num(row.IDDurata)
    if (idDur >= 1 && idDur <= 24) durataMesi = Math.round(idDur)
  }
  const isTesseramento = isTesseramentoRow(row)
  const clienteEta = optionalEtaAnni(row)
  return {
    id: str(row.IDIscrizione ?? row.Id ?? row.id) || crypto.randomUUID(),
    clienteId: str(row.IDUtente ?? row.ClienteId ?? row.clienteId),
    clienteNome: clienteNome || "—",
    clienteEta,
    pianoId: str(row.IDDurata ?? row.PianoId ?? row.pianoId),
    pianoNome,
    categoria: cat as Abbonamento["categoria"],
    prezzo,
    durataMesi,
    dataInizio: dateStr(row.DataInizio ?? row.Datalnizio ?? row.dataInizio ?? row.Inizio ?? row.inizio),
    dataFine,
    stato: (row.Stato ?? row.stato ?? stato) as "attivo" | "scaduto",
    consulenteNome: str(row.NomeOperatore ?? row.ConsulenteNome ?? row.consulenteNome ?? row.Consulente ?? row.consulente) || undefined,
    categoriaAbbonamentoDescrizione: categoriaAbbonamentoDescrizione || undefined,
    abbonamentoDescrizione: abbonamentoDescrizione || undefined,
    macroCategoriaDescrizione: macroCategoriaDescrizione || undefined,
    isTesseramento: isTesseramento || undefined,
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
