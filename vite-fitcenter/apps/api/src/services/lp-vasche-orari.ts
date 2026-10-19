/**
 * Orari ufficiali prenotazioni vasche (lezioni private).
 * 25 m: 1 persona, lun–ven 8:00–14:30 e 18:30–22:00; sabato no.
 * Ludica lun–ven / sabato: capienza = lezioni contemporanee (2 / 4 / 6).
 */
import type { VascaId } from "../store/lezioni-private-db.js"

export const LP_SLOT_START = 7 * 60 + 30
export const LP_SLOT_END = 22 * 60
export const LP_SLOT_STEP = 30
export const LP_LEZIONE_MIN = 30

export type LpFasciaVasca = {
  from: number
  to: number
  corsie: number
  capCorsia: number
}

export type LpOrarioRiga = {
  id: string
  giorni: "lunven" | "sabato"
  vasca: VascaId
  from: string
  to: string
  corsie: number
  capCorsia: number
}

export const DEFAULT_ORARI: LpOrarioRiga[] = [
  { id: "lv-v25-a", giorni: "lunven", vasca: "v25", from: "08:00", to: "14:30", corsie: 1, capCorsia: 1 },
  { id: "lv-v25-b", giorni: "lunven", vasca: "v25", from: "18:30", to: "22:00", corsie: 1, capCorsia: 1 },
  { id: "sa-v25", giorni: "sabato", vasca: "v25", from: "08:00", to: "22:00", corsie: 0, capCorsia: 1 },
  { id: "lv-lud-a", giorni: "lunven", vasca: "ludica", from: "08:00", to: "15:15", corsie: 2, capCorsia: 1 },
  { id: "lv-lud-b", giorni: "lunven", vasca: "ludica", from: "15:15", to: "16:15", corsie: 2, capCorsia: 3 },
  { id: "lv-lud-x", giorni: "lunven", vasca: "ludica", from: "16:15", to: "18:30", corsie: 0, capCorsia: 1 },
  { id: "lv-lud-c", giorni: "lunven", vasca: "ludica", from: "18:30", to: "20:15", corsie: 2, capCorsia: 2 },
  { id: "sa-lud-a", giorni: "sabato", vasca: "ludica", from: "09:00", to: "09:45", corsie: 2, capCorsia: 3 },
  { id: "sa-lud-x1", giorni: "sabato", vasca: "ludica", from: "09:45", to: "12:00", corsie: 0, capCorsia: 1 },
  { id: "sa-lud-b", giorni: "sabato", vasca: "ludica", from: "12:00", to: "13:30", corsie: 2, capCorsia: 3 },
  { id: "sa-lud-c", giorni: "sabato", vasca: "ludica", from: "13:30", to: "14:15", corsie: 2, capCorsia: 1 },
  { id: "sa-lud-d", giorni: "sabato", vasca: "ludica", from: "14:15", to: "15:30", corsie: 2, capCorsia: 3 },
  { id: "sa-lud-x2", giorni: "sabato", vasca: "ludica", from: "15:30", to: "17:45", corsie: 0, capCorsia: 1 },
  { id: "sa-lud-e", giorni: "sabato", vasca: "ludica", from: "17:45", to: "19:30", corsie: 2, capCorsia: 3 },
]

let orariAttivi: LpOrarioRiga[] = DEFAULT_ORARI

export function applyLpOrari(orari?: LpOrarioRiga[] | null): void {
  orariAttivi = orari?.length ? orari : DEFAULT_ORARI
}

export function getLpOrari(): LpOrarioRiga[] {
  return orariAttivi
}

export function sanitizeLpOrari(raw: unknown): LpOrarioRiga[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ORARI]
  const out: LpOrarioRiga[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const giorni = r.giorni === "sabato" ? "sabato" : r.giorni === "lunven" ? "lunven" : null
    const vasca = r.vasca === "v25" || r.vasca === "ludica" ? r.vasca : null
    const from = parseHm(String(r.from ?? ""))
    const to = parseHm(String(r.to ?? ""))
    if (!giorni || !vasca || from == null || to == null || to <= from) continue
    const corsie = Math.max(0, Math.min(4, Math.round(Number(r.corsie) || 0)))
    const capCorsia = Math.max(1, Math.min(6, Math.round(Number(r.capCorsia) || 1)))
    const id = String(r.id ?? `${giorni}-${vasca}-${formatHm(from)}`).trim() || `r${out.length}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, giorni, vasca, from: formatHm(from), to: formatHm(to), corsie, capCorsia })
  }
  return out.length ? out : [...DEFAULT_ORARI]
}

function matchGiorni(giorni: LpOrarioRiga["giorni"], dow: number): boolean {
  if (giorni === "lunven") return dow >= 1 && dow <= 5
  if (giorni === "sabato") return dow === 6
  return false
}

function fasceDow(dow: number, vasca: VascaId): LpFasciaVasca[] {
  const out: LpFasciaVasca[] = []
  for (const r of orariAttivi) {
    if (r.vasca !== vasca || !matchGiorni(r.giorni, dow) || r.corsie <= 0) continue
    const from = parseHm(r.from)
    const to = parseHm(r.to)
    if (from == null || to == null || to <= from) continue
    out.push({ from, to, corsie: r.corsie, capCorsia: r.capCorsia })
  }
  return out.sort((a, b) => a.from - b.from)
}

export function dowFromIso(giornoIso: string): number {
  const dt = new Date(`${giornoIso}T12:00:00`)
  return Number.isNaN(dt.getTime()) ? -1 : dt.getDay()
}

export function fasceVascaGiorno(giornoIso: string, vasca: VascaId): LpFasciaVasca[] {
  const dow = dowFromIso(giornoIso)
  if (dow < 0) return []
  return fasceDow(dow, vasca)
}

/** Inizio lezione valido: 30 min, allineato all’inizio fascia (niente slot ogni 15 min). */
export function fasciaPerInizio(
  giornoIso: string,
  ora: string,
  vasca: VascaId,
  durataMin = LP_LEZIONE_MIN,
): LpFasciaVasca | null {
  const start = parseHm(ora)
  if (start == null) return null
  const dur = Number.isFinite(durataMin) && durataMin > 0 ? durataMin : LP_LEZIONE_MIN
  const end = start + dur
  return (
    fasceVascaGiorno(giornoIso, vasca).find(
      (f) => start >= f.from && end <= f.to && (start - f.from) % LP_SLOT_STEP === 0,
    ) ?? null
  )
}

export function corsieAperteGiorno(giornoIso: string, vasca: VascaId): number {
  return fasceVascaGiorno(giornoIso, vasca).reduce((m, f) => Math.max(m, f.corsie), 0)
}

export function slotAperto(
  giornoIso: string,
  ora: string,
  vasca: VascaId,
  corsia: number,
  durataMin = LP_LEZIONE_MIN,
): LpFasciaVasca | null {
  const f = fasciaPerInizio(giornoIso, ora, vasca, durataMin)
  if (!f) return null
  if (corsia < 1 || corsia > f.corsie) return null
  return f
}

export function parseHm(hmStr: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hmStr ?? "").trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function formatHm(n: number): string {
  const h = Math.floor(n / 60)
  const m = n % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function lpOreSlotsTutti(): string[] {
  const out: string[] = []
  for (let m = LP_SLOT_START; m < LP_SLOT_END; m += LP_SLOT_STEP) out.push(formatHm(m))
  return out
}

/** Union degli inizi validi (almeno una vasca/corsia) nei giorni dati. */
export function lpOreSlotsAperti(giorniIso: string[], durataMin = LP_LEZIONE_MIN): string[] {
  const set = new Set<string>()
  for (const g of giorniIso) {
    for (const vasca of ["v25", "ludica"] as const) {
      for (const f of fasceVascaGiorno(g, vasca)) {
        for (let t = f.from; t + durataMin <= f.to; t += LP_SLOT_STEP) {
          set.add(formatHm(t))
        }
      }
    }
  }
  return [...set].sort()
}

/** Lunedì–domenica di una settimana tipo, per l’elenco orari. */
export function lpOreSlotsSettimanaTipo(durataMin = LP_LEZIONE_MIN): string[] {
  const lun = "2026-01-05"
  const giorni = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = new Date(`${lun}T12:00:00`)
    d.setDate(d.getDate() + i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  })
  return lpOreSlotsAperti(giorni, durataMin)
}

export function postiGiorno(giornoIso: string, durataMin = LP_LEZIONE_MIN): { totali: number; v25: number; ludica: number } {
  let totali = 0
  const v25 = corsieAperteGiorno(giornoIso, "v25")
  const ludica = corsieAperteGiorno(giornoIso, "ludica")
  for (const vasca of ["v25", "ludica"] as const) {
    for (const f of fasceVascaGiorno(giornoIso, vasca)) {
      for (let t = f.from; t + durataMin <= f.to; t += LP_SLOT_STEP) {
        totali += f.corsie * f.capCorsia
      }
    }
  }
  return { totali, v25, ludica }
}
