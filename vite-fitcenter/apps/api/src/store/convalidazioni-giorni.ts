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

function parseKey(k: string): { consulenteNome: string; anno: number; mese: number; giorno: number } | null {
  const parts = k.split("-")
  if (parts.length < 4) return null
  const giorno = Number(parts[parts.length - 1])
  const mese = Number(parts[parts.length - 2])
  const anno = Number(parts[parts.length - 3])
  if (!Number.isFinite(giorno) || !Number.isFinite(mese) || !Number.isFinite(anno)) return null
  const consulenteNome = parts.slice(0, -3).join("-")
  if (!consulenteNome) return null
  return { consulenteNome, anno, mese, giorno }
}

/** Admin: lista completa convalidazioni per mese, per consulente. */
export function getAllByMonth(anno: number, mese: number): Record<string, number[]> {
  const map = new Map<string, Set<number>>()
  for (const [k, v] of store.entries()) {
    if (!v) continue
    const p = parseKey(k)
    if (!p) continue
    if (p.anno !== anno || p.mese !== mese) continue
    const set = map.get(p.consulenteNome) ?? new Set<number>()
    set.add(p.giorno)
    map.set(p.consulenteNome, set)
  }
  const out: Record<string, number[]> = {}
  const names = Array.from(map.keys()).sort((a, b) => a.localeCompare(b))
  for (const n of names) out[n] = Array.from(map.get(n) ?? []).sort((a, b) => a - b)
  return out
}
