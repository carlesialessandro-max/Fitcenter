function normalizza(s: string): string {
  return s.trim().replace(/\s+/g, " ")
}

function chiaveAlfabetica(p: { nome?: string; cognome?: string; nominativo?: string }): string {
  const c = normalizza(p.cognome ?? "")
  const n = normalizza(p.nome ?? "")
  if (c || n) return `${c} ${n}`.trim()
  return normalizza(p.nominativo ?? "")
}

const collator = new Intl.Collator("it", { sensitivity: "base", ignorePunctuation: true, numeric: false })

/** Ordine elenco personale: cognome, poi nome. */
export function cmpNomeCognome(
  a: { nome?: string; cognome?: string; nominativo?: string },
  b: { nome?: string; cognome?: string; nominativo?: string }
): number {
  return collator.compare(chiaveAlfabetica(a), chiaveAlfabetica(b))
}
