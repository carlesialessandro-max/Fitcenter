export const ORE_TABELLA = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
  "21:00",
  "22:00",
] as const

export const DOW_IT = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"] as const

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function toIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Settimana lun–dom che contiene `dayIso` (giorni futuri inclusi, celle vuote). */
export function weekMondaySunday(dayIso: string): { from: string; to: string; days: string[] } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayIso)
  if (!m) return { from: dayIso, to: dayIso, days: [dayIso] }
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  const dow = dt.getDay()
  const mondayOff = dow === 0 ? -6 : 1 - dow
  const mon = new Date(dt)
  mon.setDate(dt.getDate() + mondayOff)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon)
    x.setDate(mon.getDate() + i)
    days.push(toIsoLocal(x))
  }
  return { from: days[0]!, to: days[6]!, days }
}

export function avgNums(vals: Array<number | null | undefined>): number | null {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v))
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function fmtAvg(v: number | null): string {
  if (v == null) return "—"
  const r = Math.round(v * 1000) / 1000
  return String(r).replace(".", ",")
}

export function hmToMinutes(hm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Ore coperte da una lezione (inizio incluso, fine esclusa). */
export function oreCoperteLezione(oraInizio?: string, oraFine?: string): string[] {
  const s = hmToMinutes((oraInizio ?? "").trim())
  if (s == null) return []
  let e = hmToMinutes((oraFine ?? "").trim())
  if (e == null || e <= s) e = s + 60
  const out: string[] = []
  for (let m = s; m < e; m += 60) {
    const h = Math.floor(m / 60)
    if (h >= 8 && h <= 22) out.push(`${pad2(h)}:00`)
  }
  return out
}
