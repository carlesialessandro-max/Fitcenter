/** Budget per (anno, mese, consulente). Il totale mese = somma delle 3 consulenti = budget generale. */
const DEFAULT_BUDGET_PER_CONSULENTE = 2000
const CONSULENTI_LABELS = ["Carmen Severino", "Serena Del Prete", "Ombretta Zenoni"] as const

const store = new Map<string, number>()

function key(anno: number, mese: number, consulenteLabel: string) {
  return `${anno}-${mese}-${consulenteLabel}`
}

export function get(anno: number, mese: number, consulenteLabel: string): number {
  return store.get(key(anno, mese, consulenteLabel)) ?? DEFAULT_BUDGET_PER_CONSULENTE
}

export function set(anno: number, mese: number, consulenteLabel: string, budget: number): void {
  store.set(key(anno, mese, consulenteLabel), budget)
}

/** Totale budget del mese (somma delle 3 consulenti) = budget generale. */
export function getTotaleMese(anno: number, mese: number): number {
  return CONSULENTI_LABELS.reduce((s, label) => s + get(anno, mese, label), 0)
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
        entries.push({ anno: a, mese: m, consulenteLabel: label, budget: val })
      }
    }
  }
  return entries.sort((x, y) => x.anno - y.anno || x.mese - y.mese || x.consulenteLabel.localeCompare(y.consulenteLabel))
}

export function getConsulentiLabels(): readonly string[] {
  return CONSULENTI_LABELS
}
