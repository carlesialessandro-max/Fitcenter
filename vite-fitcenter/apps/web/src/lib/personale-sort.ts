function normalizza(s: string): string {
  return s.trim().replace(/\s+/g, " ")
}

const collator = new Intl.Collator("it", { sensitivity: "base", ignorePunctuation: true, numeric: false })

function chiaveNomeCognome(p: { nome?: string; cognome?: string; nominativo?: string }): string {
  const n = normalizza(p.nome ?? "")
  const c = normalizza(p.cognome ?? "")
  if (n || c) return `${c} ${n}`.trim()
  return normalizza(p.nominativo ?? "")
}

/** Dentro ogni ruolo: cognome, poi nome (ordinamento alfabetico standard). */
export function cmpNomeCognome(
  a: { nome?: string; cognome?: string; nominativo?: string },
  b: { nome?: string; cognome?: string; nominativo?: string }
): number {
  return collator.compare(chiaveNomeCognome(a), chiaveNomeCognome(b))
}

const RUOLO_ORDINE: Record<string, number> = { user: 0, manager: 1, admin: 2 }

/** Elenco personale: ruolo, poi nome, cognome. */
export function cmpRuoloNomeCognome(
  a: { ruolo?: string; nome?: string; cognome?: string; nominativo?: string },
  b: { ruolo?: string; nome?: string; cognome?: string; nominativo?: string }
): number {
  const ra = RUOLO_ORDINE[a.ruolo ?? "user"] ?? 9
  const rb = RUOLO_ORDINE[b.ruolo ?? "user"] ?? 9
  if (ra !== rb) return ra - rb
  return cmpNomeCognome(a, b)
}
