/**
 * Abbinamento tollerante dei nominativi (es. PDF commercialista ↔ anagrafica Libro paga).
 * Ignora maiuscole, accenti, punteggiatura e ordine nome/cognome.
 */

export function normalizzaNominativo(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
}

type IndiceNomi = { key: string; tokens: string[] }[]

const indiciCache = new WeakMap<Map<string, unknown>, IndiceNomi>()

function indiceDi(map: Map<string, unknown>): IndiceNomi {
  let idx = indiciCache.get(map)
  if (!idx) {
    idx = [...map.keys()].map((key) => ({ key, tokens: key.split(" ").filter(Boolean) }))
    indiciCache.set(map, idx)
  }
  return idx
}

function stessiToken(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((t, i) => t === sb[i])
}

function sottoinsieme(piccolo: string[], grande: string[]): boolean {
  const set = new Set(grande)
  return piccolo.every((t) => set.has(t))
}

/**
 * Cerca un nominativo in una mappa le cui chiavi sono nominativi già normalizzati.
 * 1) chiave identica; 2) stessi termini in ordine diverso; 3) nome doppio (almeno 2 termini
 * in comune e uno dei due contenuto nell'altro). Se i candidati sono più di uno, non assegna.
 */
export function trovaPerNominativo<T>(map: Map<string, T> | undefined, nominativo: string): T | undefined {
  if (!map || !map.size) return undefined
  const key = normalizzaNominativo(nominativo)
  if (!key) return undefined
  const exact = map.get(key)
  if (exact !== undefined) return exact

  const tokens = key.split(" ").filter(Boolean)
  if (tokens.length < 2) return undefined
  const indice = indiceDi(map)

  const stessi = indice.filter((r) => stessiToken(r.tokens, tokens))
  if (stessi.length === 1) return map.get(stessi[0]!.key)
  if (stessi.length > 1) return undefined

  const parziali = indice.filter((r) => {
    if (r.tokens.length < 2) return false
    const [piccolo, grande] = r.tokens.length <= tokens.length ? [r.tokens, tokens] : [tokens, r.tokens]
    return sottoinsieme(piccolo, grande)
  })
  if (parziali.length === 1) return map.get(parziali[0]!.key)
  return undefined
}
