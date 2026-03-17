import { readJson, writeJson } from "./persist.js"

/** Giorni lavorativi convalidati da ogni consulente (anno, mese, giorno). */
const store = new Map<string, boolean>()
const PERSIST_FILE = "convalidazioni-giorni.json"

function loadPersisted() {
  const data = readJson<Record<string, boolean>>(PERSIST_FILE, {})
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "boolean") store.set(k, v)
  }
}

function persist() {
  const obj: Record<string, boolean> = {}
  store.forEach((v, k) => { obj[k] = v })
  writeJson(PERSIST_FILE, obj)
}

loadPersisted()

function key(consulenteNome: string, anno: number, mese: number, giorno: number) {
  return `${consulenteNome}-${anno}-${mese}-${giorno}`
}

export function get(consulenteNome: string, anno: number, mese: number, giorno: number): boolean {
  return store.get(key(consulenteNome, anno, mese, giorno)) ?? false
}

export function set(consulenteNome: string, anno: number, mese: number, giorno: number, convalidato: boolean): void {
  if (convalidato) store.set(key(consulenteNome, anno, mese, giorno), true)
  else store.delete(key(consulenteNome, anno, mese, giorno))
  persist()
}

export function getGiorniConvalidati(consulenteNome: string, anno: number, mese: number): number[] {
  const giorniNelMese = new Date(anno, mese, 0).getDate()
  const out: number[] = []
  for (let g = 1; g <= giorniNelMese; g++) {
    if (store.get(key(consulenteNome, anno, mese, g))) out.push(g)
  }
  return out
}
