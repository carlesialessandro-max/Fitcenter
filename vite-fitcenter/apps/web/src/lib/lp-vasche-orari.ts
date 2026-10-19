import type { VascaId } from "@/api/lezioniPrivate"

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
  return (
    fasceVascaGiorno(giornoIso, vasca).find(
      (f) => start >= f.from && end <= f.to && (start - f.from) % LP_SLOT_STEP === 0,
    ) ?? null
  )
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

export function lpOreSlotsTutti(): string[] {
  const out: string[] = []
  for (let m = 7 * 60 + 30; m < 22 * 60; m += 30) {
    const h = Math.floor(m / 60)
    const min = m % 60
    out.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`)
  }
  return out
}

export function postiLabelOrario(r: LpOrarioRiga): string {
  if (r.corsie <= 0) return "chiusa"
  const n = r.corsie * r.capCorsia
  return n === 1 ? "1 persona" : `${n} lez.`
}

export function lpOrariLegenda(orari: LpOrarioRiga[] = getLpOrari()) {
  return orari.map((r) => ({
    id: r.id,
    giorni: r.giorni === "sabato" ? "Sabato" : "Lun–Ven",
    vasca: r.vasca === "v25" ? "25 m" : "Ludica",
    orari: `${r.from}–${r.to}`,
    posti: postiLabelOrario(r),
  }))
}

export const LP_VASCHE_LEGENDA = lpOrariLegenda(DEFAULT_ORARI)
