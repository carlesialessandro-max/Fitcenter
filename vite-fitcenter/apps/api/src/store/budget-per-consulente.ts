import { readJson, writeJson } from "./persist.js"

/** Budget per (anno, mese, consulente). Il totale mese = somma delle 3 consulenti = budget generale. */
const DEFAULT_BUDGET_PER_CONSULENTE = 2000
const CONSULENTI_LABELS = ["Carmen Severino", "Serena Del Prete", "Ombretta Zenoni"] as const

const store = new Map<string, number>()

const PERSIST_FILE = "budget-per-consulente.json"

function loadPersisted() {
  const data = readJson<Record<string, number>>(PERSIST_FILE, {})
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "number") store.set(k, v)
  }
}

function persist() {
  const obj: Record<string, number> = {}
  store.forEach((v, k) => { obj[k] = v })
  writeJson(PERSIST_FILE, obj)
}

loadPersisted()

function key(anno: number, mese: number, consulenteLabel: string) {
  return `${anno}-${mese}-${consulenteLabel}`
}

export function get(anno: number, mese: number, consulenteLabel: string): number {
  return store.get(key(anno, mese, consulenteLabel)) ?? DEFAULT_BUDGET_PER_CONSULENTE
}

export function set(anno: number, mese: number, consulenteLabel: string, budget: number): void {
  store.set(key(anno, mese, consulenteLabel), budget)
  persist()
}

/** Totale budget del mese (somma delle 3 consulenti) = budget generale. Senza decimali. */
export function getTotaleMese(anno: number, mese: number): number {
  return Math.round(CONSULENTI_LABELS.reduce((s, label) => s + get(anno, mese, label), 0))
}

/** Elenco per admin: (anno, mese, consulente, budget). Se anno non passato usa anno corrente. */
export function getAll(anno?: number): { anno: number; mese: number; consulenteLabel: string; budget: number }[] {
  const entries: { anno: number; mese: number; consulenteLabel: string; budget: number }[] = []
  const y = anno != null && !Number.isNaN(anno) ? anno : new Date().getFullYear()
  const anni = [y]
  for (const a of anni) {
    for (let m = 1; m <= 12; m++) {
      for (const label of CONSULENTI_LABELS) {
        const val = get(a, m, label)
        entries.push({ anno: a, mese: m, consulenteLabel: label, budget: Math.round(val) })
      }
    }
  }
  return entries.sort((x, y) => x.anno - y.anno || x.mese - y.mese || x.consulenteLabel.localeCompare(y.consulenteLabel))
}

export function getConsulentiLabels(): readonly string[] {
  return CONSULENTI_LABELS
}
