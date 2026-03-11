/** Budget mensile impostati dall'admin (override su mock/SQL) */
const store = new Map<string, { anno: number; mese: number; budget: number }>()

function key(anno: number, mese: number) {
  return `${anno}-${mese}`
}

export const budgetStore = {
  get(anno: number, mese: number): number | undefined {
    return store.get(key(anno, mese))?.budget
  },
  set(anno: number, mese: number, budget: number): void {
    store.set(key(anno, mese), { anno, mese, budget })
  },
  getAll(): { anno: number; mese: number; budget: number }[] {
    return Array.from(store.values()).sort((a, b) => a.anno - b.anno || a.mese - b.mese)
  },
}
