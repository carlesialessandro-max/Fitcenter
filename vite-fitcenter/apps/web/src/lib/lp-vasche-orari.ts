import type { VascaId } from "@/api/lezioniPrivate"

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
  if (dow === 1 || dow === 3) {
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

export function parseHm(hmStr: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hmStr ?? "").trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

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

export const LP_VASCHE_LEGENDA = [
  { giorni: "Lun–Ven", vasca: "25 m", orari: "08:00–14:30 e 18:30–22:00", posti: "1 persona" },
  { giorni: "Sabato", vasca: "25 m", orari: "chiusa", posti: "—" },
  { giorni: "Lun e Mer", vasca: "Ludica", orari: "11:15–13:30 · 15:15–16:15 · 18:30–22:00", posti: "4 pers. (2/corsia)" },
  { giorni: "Mar e Ven", vasca: "Ludica", orari: "07:30–08:15", posti: "2 pers. (1/corsia)" },
  { giorni: "Giovedì", vasca: "Ludica", orari: "chiusa", posti: "—" },
  { giorni: "Sabato", vasca: "Ludica", orari: "09:00–13:15 · 17:45–19:00", posti: "4 pers. (2/corsia)" },
] as const
