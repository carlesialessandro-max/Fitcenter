import { readJson, writeJson } from "./persist.js"

/** Snapshot totale mese (somma consulenti) — backup / confronti annuali. */
type BudgetMeseRow = { anno: number; mese: number; budget: number }

const store = new Map<string, BudgetMeseRow>()
const PERSIST_FILE = "budget-mese-totale.json"

function key(anno: number, mese: number) {
  return `${anno}-${mese}`
}

function loadPersisted() {
  const list = readJson<BudgetMeseRow[]>(PERSIST_FILE, [])
  if (!Array.isArray(list)) return
  for (const row of list) {
    if (row && typeof row.anno === "number" && typeof row.mese === "number" && typeof row.budget === "number") {
      store.set(key(row.anno, row.mese), row)
    }
  }
}

function persist() {
  const list = Array.from(store.values()).sort((a, b) => a.anno - b.anno || a.mese - b.mese)
  writeJson(PERSIST_FILE, list)
}

loadPersisted()

export const budgetStore = {
  get(anno: number, mese: number): number | undefined {
    return store.get(key(anno, mese))?.budget
  },
  set(anno: number, mese: number, budget: number): void {
    store.set(key(anno, mese), { anno, mese, budget: Math.round(budget) })
    persist()
  },
  getAll(): BudgetMeseRow[] {
    return Array.from(store.values()).sort((a, b) => a.anno - b.anno || a.mese - b.mese)
  },
}
