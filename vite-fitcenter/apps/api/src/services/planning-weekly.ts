import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

type PlanningEvent = { dow: number; start: string; title: string }

let cache: PlanningEvent[] | null = null

function planningJsonCandidates(): string[] {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return [
    path.join(__dirname, "../../../web/src/data/planning-weekly.json"),
    path.join(process.cwd(), "apps/web/src/data/planning-weekly.json"),
    path.join(process.cwd(), "vite-fitcenter/apps/web/src/data/planning-weekly.json"),
    path.join(process.cwd(), "web/src/data/planning-weekly.json"),
  ]
}

function loadPlanningEvents(): PlanningEvent[] {
  if (cache) return cache
  for (const p of planningJsonCandidates()) {
    try {
      if (!existsSync(p)) continue
      const j = JSON.parse(readFileSync(p, "utf8")) as { events?: PlanningEvent[] }
      cache = Array.isArray(j.events) ? j.events : []
      return cache
    } catch {
      /* continue */
    }
  }
  cache = []
  return cache
}

export function compactPlanningTitle(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/^(FITNESS|H2O|CORSIAPAGAMENTO|CORSIPAGAMENTODANZA)+/, "")
    .replace(/[^A-Z0-9]/g, "")
}

/** Match titoli planning: uguaglianza o contenimento solo se il più corto ha almeno 8 caratteri (evita TERRA ⊂ SBARRATERRA). */
export function planningTitlesMatch(servizio: string, eventTitle: string): boolean {
  const a = compactPlanningTitle(servizio)
  const b = compactPlanningTitle(eventTitle)
  if (!a || !b) return false
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return shorter.length >= 8 && longer.includes(shorter)
}

function ymdToJsDow(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
}

function hhmmToMinutes(t: string | undefined): number | null {
  const s = String(t ?? "").trim()
  const m = /^(\d{1,2})[:\.](\d{2})/.exec(s)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Lezione vuota: se il corso è nel planning, deve esserci uno slot quel giorno (±35 min).
 * 35 min copre scarti gestionale/Excel (es. Pilates 18:30 vs 19:00) e tiene fuori
 * i fantasmi lontani (es. Acqua Gym 09:00 vs 09:45).
 * `null` = planning assente o corso sconosciuto → non filtrare.
 */
export function emptyLessonFitsPlanning(titolo: string, giornoIso: string, oraInizio?: string): boolean | null {
  const events = loadPlanningEvents()
  if (!events.length) return null
  const known = events.some((e) => planningTitlesMatch(titolo, e.title))
  if (!known) return null
  const dow = ymdToJsDow(giornoIso)
  if (dow == null) return false
  const startMin = hhmmToMinutes(oraInizio)
  const hit = events.some((e) => {
    if (e.dow !== dow) return false
    if (!planningTitlesMatch(titolo, e.title)) return false
    if (startMin == null) return true
    const em = hhmmToMinutes(e.start)
    if (em == null) return true
    return Math.abs(em - startMin) <= 35
  })
  return hit
}
