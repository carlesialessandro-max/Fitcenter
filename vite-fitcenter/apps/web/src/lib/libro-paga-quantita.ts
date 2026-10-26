/** Stessa regola in apps/api/src/store/libro-paga-db.ts */

export type ModalitaValoreTurno = "ore" | "servizi" | "importo"

export type LivelloValoreTurno = {
  nome: string
  fissa: boolean
  retribuzione: number
}

export function modalitaValoreTurno(livello: LivelloValoreTurno): ModalitaValoreTurno {
  const nome = livello.nome
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
  if (/inserim\w*\s+libero/.test(nome)) return "importo"
  if (livello.fissa && Math.round(Number(livello.retribuzione) * 100) === 100) return "importo"
  if (livello.fissa) return "servizi"
  return "ore"
}

export function messaggioQuantitaTurno(livello: LivelloValoreTurno, quantita: number): string | null {
  const mode = modalitaValoreTurno(livello)
  if (!Number.isFinite(quantita) || quantita <= 0) {
    if (mode === "importo") return "Importo non valido"
    if (mode === "servizi") return "Numero servizi non valido (1–24)"
    return "Ore non valide (fino a 24, es. 1,5 o 2,25)"
  }
  if (mode === "ore" && quantita > 24) return "Ore non valide (fino a 24, es. 1,5 o 2,25)"
  if (mode === "servizi" && quantita > 24) return "Numero servizi non valido (1–24)"
  if (mode === "importo" && quantita > 10000) return "Importo non valido (massimo 10.000 €)"
  return null
}

export function calcolaImportoTurno(livello: LivelloValoreTurno, quantita: number): number {
  const q = Math.round(quantita * 100) / 100
  if (modalitaValoreTurno(livello) === "importo") return q
  return Math.round(q * Number(livello.retribuzione) * 100) / 100
}

export function etichettaValoreTurno(livello: LivelloValoreTurno | undefined): { label: string; hint: string } {
  if (!livello) return { label: "Valore", hint: "Ore, servizi o importo in base alla mansione" }
  const mode = modalitaValoreTurno(livello)
  if (mode === "importo") return { label: "Importo €", hint: "Inserimento libero: scrivi l’importo in euro (es. 60)" }
  if (mode === "servizi") {
    const paga = Number(livello.retribuzione)
    const pagaTxt = Number.isFinite(paga) && paga > 0 ? ` da ${paga.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}` : ""
    return { label: "Servizi", hint: `Paga fissa${pagaTxt}: numero di servizi (es. 1, 2, 3)` }
  }
  const paga = Number(livello.retribuzione)
  const pagaTxt = Number.isFinite(paga) && paga > 0 ? ` a ${paga.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}/h` : ""
  return { label: "Ore", hint: `Paga oraria${pagaTxt}: ore lavorate (es. 1,5 o 2,25), massimo 24` }
}
