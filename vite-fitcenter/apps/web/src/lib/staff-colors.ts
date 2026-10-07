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

/** Reception: colori fissi chiesti in calendario. */
const STAFF_FIXED_CLASSES: Record<string, string> = {
  simo: "border-yellow-400/80 bg-yellow-500/35 text-yellow-50",
  victoria: "border-green-500/70 bg-green-700/45 text-green-50",
  irene: "border-orange-500/80 bg-orange-500/40 text-orange-50",
  tommaso: "border-sky-400/80 bg-sky-400/35 text-sky-50",
  alba: "border-blue-800/90 bg-blue-950/80 text-blue-100",
  ale: "border-lime-400/80 bg-lime-400/30 text-lime-50",
}

const STAFF_ALIAS: Record<string, string> = {
  victoria: "victoria",
  vittoria: "victoria",
  simo: "simo",
  simona: "simo",
  irene: "irene",
  ire: "irene",
  tommaso: "tommaso",
  tommano: "tommaso",
  alba: "alba",
  ale: "ale",
  alessandra: "ale",
}

/** Cognomi univoci (non "carlesi": Irene e Alessandra). */
const STAFF_SURNAME_ALIAS: Record<string, string> = {
  sallata: "alba",
  boretti: "tommaso",
  vittoria: "victoria",
}

function normStaffToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function excelStaffName(e: {
  staff?: string | null
  staffOverride?: string | null
  staffDisplay?: string | null
}): string {
  const override = String(e.staffOverride ?? "").trim()
  if (override && override !== "—") return override
  const staff = String(e.staff ?? "").trim()
  if (staff && staff !== "—") return staff
  return String(e.staffDisplay ?? "").trim()
}

export function staffAliasKey(display: string | null | undefined): string | null {
  const n = normStaffToken(String(display ?? ""))
  if (!n) return null
  if (STAFF_ALIAS[n]) return STAFF_ALIAS[n]
  if (STAFF_SURNAME_ALIAS[n]) return STAFF_SURNAME_ALIAS[n]
  const parts = n.split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (first && STAFF_ALIAS[first]) return STAFF_ALIAS[first]
  if (first && STAFF_SURNAME_ALIAS[first]) return STAFF_SURNAME_ALIAS[first]
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  if (last && STAFF_ALIAS[last]) return STAFF_ALIAS[last]
  if (last && STAFF_SURNAME_ALIAS[last]) return STAFF_SURNAME_ALIAS[last]
  return null
}

/** Corsia / colore: nome Excel prima dell'anagrafica, senza id istruttore (evita doppioni settimana). */
export function staffColorKey(e: {
  istruttoreId?: string | null
  staffDisplay?: string | null
  staff?: string | null
  staffOverride?: string | null
}): string {
  const excel = excelStaffName(e)
  const alias = staffAliasKey(excel) ?? staffAliasKey(e.staffDisplay)
  if (alias) return alias
  const s = normStaffToken(excel && excel !== "—" ? excel : String(e.staffDisplay ?? ""))
  if (!s || s === "—") return "unknown"
  const first = s.split(/\s+/).filter(Boolean)[0]
  return first ? `name:${first}` : "unknown"
}

export function staffLaneLabel(e: {
  staffDisplay?: string | null
  staff?: string | null
  staffOverride?: string | null
}): string {
  const raw = excelStaffName(e)
  const t = (raw || String(e.staffDisplay ?? "")).trim()
  if (!t || t === "—") return "—"
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2 && parts[0]!.length <= 2) return `${parts[0]} ${parts[1]}`
  return parts[0] ?? t
}

export function staffPillClasses(key: string): string {
  const fixed = STAFF_FIXED_CLASSES[key]
  if (fixed) return fixed
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) >>> 0
  return STAFF_PALETTE[h % STAFF_PALETTE.length]!
}
