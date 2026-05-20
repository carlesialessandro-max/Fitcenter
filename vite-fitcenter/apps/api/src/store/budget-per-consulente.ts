import { readJson, writeJson } from "./persist.js"

/** Budget per (anno, mese, consulente). Valori espliciti salvati dall'admin — niente default silenziosi in lettura. */
export const DEFAULT_BUDGET_PER_CONSULENTE = 20000
const CONSULENTI_LABELS = ["Carmen Severino", "Serena Del Prete", "Ombretta Zenoni"] as const

const store = new Map<string, number>()
const PERSIST_FILE = "budget-per-consulente.json"

function loadPersisted() {
  const data = readJson<Record<string, number>>(PERSIST_FILE, {})
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "number" && Number.isFinite(v)) store.set(k, Math.round(v))
  }
}

function persist() {
  const obj: Record<string, number> = {}
  store.forEach((v, k) => {
    obj[k] = v
  })
  writeJson(PERSIST_FILE, obj)
}

loadPersisted()

function key(anno: number, mese: number, consulenteLabel: string) {
  return `${anno}-${mese}-${consulenteLabel}`
}

function parseKey(k: string): { anno: number; mese: number; consulenteLabel: string } | null {
  const m = /^(\d+)-(\d+)-(.+)$/.exec(k)
  if (!m) return null
  const anno = Number(m[1])
  const mese = Number(m[2])
  const consulenteLabel = m[3] ?? ""
  if (!Number.isFinite(anno) || !Number.isFinite(mese) || mese < 1 || mese > 12 || !consulenteLabel) return null
  return { anno, mese, consulenteLabel }
}

export function has(anno: number, mese: number, consulenteLabel: string): boolean {
  return store.has(key(anno, mese, consulenteLabel))
}

/** Valore salvato; undefined se il mese/consulente non è stato impostato. */
export function getSaved(anno: number, mese: number, consulenteLabel: string): number | undefined {
  const v = store.get(key(anno, mese, consulenteLabel))
  return typeof v === "number" ? v : undefined
}

/** Solo per UI modale (placeholder prima del primo salvataggio). */
export function get(anno: number, mese: number, consulenteLabel: string): number {
  return getSaved(anno, mese, consulenteLabel) ?? DEFAULT_BUDGET_PER_CONSULENTE
}

export function set(anno: number, mese: number, consulenteLabel: string, budget: number): void {
  store.set(key(anno, mese, consulenteLabel), Math.round(budget))
  persist()
}

/** Totale budget del mese = somma solo dei valori salvati esplicitamente. */
export function getTotaleMese(anno: number, mese: number): number {
  return Math.round(
    CONSULENTI_LABELS.reduce((s, label) => {
      const v = getSaved(anno, mese, label)
      return s + (typeof v === "number" ? v : 0)
    }, 0)
  )
}

export function getMeseSalvato(anno: number, mese: number): boolean {
  return CONSULENTI_LABELS.some((label) => has(anno, mese, label))
}

/** Tutte le righe salvate (tutti gli anni), opzionale filtro anno. */
export function getAll(anno?: number): { anno: number; mese: number; consulenteLabel: string; budget: number }[] {
  const entries: { anno: number; mese: number; consulenteLabel: string; budget: number }[] = []
  for (const [k, budget] of store.entries()) {
    const parsed = parseKey(k)
    if (!parsed) continue
    if (anno != null && !Number.isNaN(anno) && parsed.anno !== anno) continue
    entries.push({ ...parsed, budget })
  }
  return entries.sort(
    (x, y) => x.anno - y.anno || x.mese - y.mese || x.consulenteLabel.localeCompare(y.consulenteLabel)
  )
}

export function getAnniDisponibili(): number[] {
  const anni = new Set<number>()
  for (const k of store.keys()) {
    const p = parseKey(k)
    if (p) anni.add(p.anno)
  }
  const y = new Date().getFullYear()
  anni.add(y)
  return Array.from(anni).sort((a, b) => b - a)
}

export type BudgetStoricoMese = {
  anno: number
  mese: number
  totale: number
  perConsulente: Record<string, number>
  salvato: boolean
}

/** Griglia 12 mesi per anno con totali e breakdown consulenti (solo valori salvati). */
export function getStoricoAnno(anno: number): BudgetStoricoMese[] {
  const out: BudgetStoricoMese[] = []
  for (let mese = 1; mese <= 12; mese++) {
    const perConsulente: Record<string, number> = {}
    for (const label of CONSULENTI_LABELS) {
      const v = getSaved(anno, mese, label)
      if (typeof v === "number") perConsulente[label] = v
    }
    out.push({
      anno,
      mese,
      perConsulente,
      totale: getTotaleMese(anno, mese),
      salvato: getMeseSalvato(anno, mese),
    })
  }
  return out
}

export function getConsulentiLabels(): readonly string[] {
  return CONSULENTI_LABELS
}
