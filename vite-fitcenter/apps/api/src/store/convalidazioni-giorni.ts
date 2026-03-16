/** Giorni lavorativi convalidati da ogni consulente (anno, mese, giorno). */
const store = new Map<string, boolean>()

function key(consulenteNome: string, anno: number, mese: number, giorno: number) {
  return `${consulenteNome}-${anno}-${mese}-${giorno}`
}

export function get(consulenteNome: string, anno: number, mese: number, giorno: number): boolean {
  return store.get(key(consulenteNome, anno, mese, giorno)) ?? false
}

export function set(consulenteNome: string, anno: number, mese: number, giorno: number, convalidato: boolean): void {
  if (convalidato) store.set(key(consulenteNome, anno, mese, giorno), true)
  else store.delete(key(consulenteNome, anno, mese, giorno))
}

export function getGiorniConvalidati(consulenteNome: string, anno: number, mese: number): number[] {
  const giorniNelMese = new Date(anno, mese, 0).getDate()
  const out: number[] = []
  for (let g = 1; g <= giorniNelMese; g++) {
    if (store.get(key(consulenteNome, anno, mese, g))) out.push(g)
  }
  return out
}
