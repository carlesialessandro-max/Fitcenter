export function cmpNomeCognome(
  a: { nome?: string; cognome?: string },
  b: { nome?: string; cognome?: string }
): number {
  const n = (a.nome ?? "").localeCompare(b.nome ?? "", "it", { sensitivity: "base" })
  if (n) return n
  return (a.cognome ?? "").localeCompare(b.cognome ?? "", "it", { sensitivity: "base" })
}
