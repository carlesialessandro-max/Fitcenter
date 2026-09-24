/**
 * Orari ufficiali prenotazioni vasche (lezioni private).
 * 25 m: 1 persona, lun–ven 8:00–14:30 e 18:30–22:00; sabato no.
 * Ludica: fino a 4 persone (2 per corsia), fasce per giorno.
 */
import type { VascaId } from "../store/lezioni-private-db.js"

export const LP_SLOT_START = 7 * 60 + 30
export const LP_SLOT_END = 22 * 60
export const LP_SLOT_STEP = 15
export const LP_LEZIONE_MIN = 30

export type LpFasciaVasca = {
  from: number
  to: number
  corsie: number
  capCorsia: number
}

function hm(h: number, m = 0): number {
  return h * 60 + m
}

function fasceDow(dow: number, vasca: VascaId): LpFasciaVasca[] {
  if (vasca === "v25") {
    if (dow >= 1 && dow <= 5) {
      return [
        { from: hm(8), to: hm(14, 30), corsie: 1, capCorsia: 1 },
        { from: hm(18, 30), to: hm(22), corsie: 1, capCorsia: 1 },
      ]
    }
    return []
  }
  if (dow === 1 || dow === 3 || dow === 4) {
    return [
      { from: hm(11, 15), to: hm(13, 30), corsie: 2, capCorsia: 2 },
      { from: hm(15, 15), to: hm(16, 15), corsie: 2, capCorsia: 2 },
      { from: hm(18, 30), to: hm(22), corsie: 2, capCorsia: 2 },
    ]
  }
  if (dow === 2 || dow === 5) {
    return [{ from: hm(7, 30), to: hm(8, 15), corsie: 2, capCorsia: 1 }]
  }
  if (dow === 6) {
    return [
      { from: hm(9), to: hm(13, 15), corsie: 2, capCorsia: 2 },
      { from: hm(17, 45), to: hm(19), corsie: 2, capCorsia: 2 },
    ]
  }
  return []
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

/** Inizio lezione valido se tutta la durata sta nella fascia. */
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
  return fasceVascaGiorno(giornoIso, vasca).find((f) => start >= f.from && end <= f.to) ?? null
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
