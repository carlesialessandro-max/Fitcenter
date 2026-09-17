import { readJson, writeJson } from "./persist.js"

const FILE = "nuoto-libero.json"

export type NuotoLiberoCell = {
  n: number
  at: string
  by?: string
}

export type NuotoLiberoDb = {
  /** giorno ISO → ora HH:00 → conteggio */
  byDay: Record<string, Record<string, NuotoLiberoCell>>
}

const DEFAULT: NuotoLiberoDb = { byDay: {} }

export function readNuotoLiberoDb(): NuotoLiberoDb {
  const raw = readJson<Partial<NuotoLiberoDb>>(FILE, DEFAULT)
  const byDay: Record<string, Record<string, NuotoLiberoCell>> = {}
  if (raw.byDay && typeof raw.byDay === "object") {
    for (const [day, hours] of Object.entries(raw.byDay)) {
      if (!hours || typeof hours !== "object") continue
      const row: Record<string, NuotoLiberoCell> = {}
      for (const [ora, cell] of Object.entries(hours)) {
        if (!cell || typeof cell !== "object") continue
        const n = Number((cell as NuotoLiberoCell).n)
        if (!Number.isFinite(n) || n < 0) continue
        row[ora] = {
          n: Math.min(500, Math.round(n)),
          at: String((cell as NuotoLiberoCell).at ?? ""),
          by: String((cell as NuotoLiberoCell).by ?? "").trim() || undefined,
        }
      }
      if (Object.keys(row).length) byDay[day] = row
    }
  }
  return { byDay }
}

export function writeNuotoLiberoDb(db: NuotoLiberoDb): void {
  writeJson(FILE, db)
}
