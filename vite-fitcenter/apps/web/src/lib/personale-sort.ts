function normalizza(s: string): string {
  return s.trim().replace(/\s+/g, " ")
}

const collator = new Intl.Collator("it", { sensitivity: "base", ignorePunctuation: true, numeric: false })

const NOME_PLACEHOLDER = /^x+$/i

/** Per tabella personale: celle Nome / Cognome (nome, cognome) anche se in DB è invertito o «X» + «Cognome Nome». */
export function displayNomeCognome(p: {
  nome?: string
  cognome?: string
  nominativo?: string
}): { nome: string; cognome: string } {
  let nome = normalizza(p.nome ?? "")
  let cognome = normalizza(p.cognome ?? "")

  const splitCognomeNome = (full: string) => {
    const parts = full.split(" ").filter(Boolean)
    if (parts.length < 2) return null
    return { cognome: parts[0]!, nome: parts.slice(1).join(" ") }
  }

  if (NOME_PLACEHOLDER.test(nome) && cognome.includes(" ")) {
    const s = splitCognomeNome(cognome)
    if (s) return s
  }

  if (!nome && cognome.includes(" ")) {
    const s = splitCognomeNome(cognome)
    if (s) return s
  }

  const nom = normalizza(p.nominativo ?? "")
  if (nom.includes(" ") && (NOME_PLACEHOLDER.test(nome) || !nome)) {
    const s = splitCognomeNome(nom)
    if (s) return s
  }

  return { nome, cognome }
}

function chiaveNomeCognome(p: { nome?: string; cognome?: string; nominativo?: string }): string {
  const { nome, cognome } = displayNomeCognome(p)
  if (nome || cognome) return `${cognome} ${nome}`.trim()
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
