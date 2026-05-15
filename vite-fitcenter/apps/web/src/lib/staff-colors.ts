/** Colori distinti per dipendente (turni reception / bagnini / sala). */

const STAFF_PALETTE = [
  "border-rose-500/50 bg-rose-950/40 text-rose-100",
  "border-sky-500/50 bg-sky-950/40 text-sky-100",
  "border-amber-500/50 bg-amber-950/40 text-amber-100",
  "border-violet-500/50 bg-violet-950/40 text-violet-100",
  "border-teal-500/50 bg-teal-950/40 text-teal-100",
  "border-orange-500/50 bg-orange-950/40 text-orange-100",
  "border-fuchsia-500/50 bg-fuchsia-950/40 text-fuchsia-100",
  "border-lime-500/50 bg-lime-950/40 text-lime-100",
  "border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
  "border-pink-500/50 bg-pink-950/40 text-pink-100",
  "border-indigo-500/50 bg-indigo-950/40 text-indigo-100",
  "border-emerald-500/45 bg-emerald-950/35 text-emerald-100",
] as const

export function staffColorKey(e: { istruttoreId?: string | null; staffDisplay?: string | null }): string {
  if (e.istruttoreId) return `id:${e.istruttoreId}`
  const s = String(e.staffDisplay ?? "")
    .trim()
    .toLowerCase()
  return s && s !== "—" ? `name:${s}` : "unknown"
}

export function staffPillClasses(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) >>> 0
  return STAFF_PALETTE[h % STAFF_PALETTE.length]!
}
