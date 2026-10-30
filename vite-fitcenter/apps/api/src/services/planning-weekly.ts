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

/** Stesso slot Excel/gestionale (es. Pilates 18:30 vs 19:00). */
const PLANNING_SAME_SLOT_MIN = 35
/**
 * Vicino ma non lo stesso slot → lezione fantasma (es. Acqua Gym 09:00 vs 09:45).
 * Oltre questa soglia è un'altra fascia reale (Spinning 13:30 e 18:00 lo stesso giorno).
 */
const PLANNING_GHOST_MAX_MIN = 90

/**
 * Lezione vuota: se il corso è nel planning, deve cadere in un giorno in cui l'Excel
 * ha quello stesso titolo. Lo slot combacia se è entro ±35 min; uno scarto 35–90 min
 * è un fantasma (orario sbagliato). Uno scarto maggiore è un secondo orario del giorno
 * (es. Spinning 18:00 il venerdì, mentre l'Excel ha solo le 13:30) e va mostrato.
 * `null` = planning assente o corso non in orario Excel → non filtrare da qui
 * (spa / scuola nuoto / danza si escludono per titolo).
 */
export function emptyLessonFitsPlanning(titolo: string, giornoIso: string, oraInizio?: string): boolean | null {
  const events = loadPlanningEvents()
  if (!events.length) return null
  const known = events.some((e) => planningTitlesMatch(titolo, e.title))
  if (!known) return null
  const dow = ymdToJsDow(giornoIso)
  if (dow == null) return false
  const dayHits = events.filter((e) => e.dow === dow && planningTitlesMatch(titolo, e.title))
  if (!dayHits.length) return false
  const startMin = hhmmToMinutes(oraInizio)
  if (startMin == null) return true
  let closest = Infinity
  for (const e of dayHits) {
    const em = hhmmToMinutes(e.start)
    if (em == null) return true
    closest = Math.min(closest, Math.abs(em - startMin))
  }
  if (closest <= PLANNING_SAME_SLOT_MIN) return true
  if (closest <= PLANNING_GHOST_MAX_MIN) return false
  return true
}
