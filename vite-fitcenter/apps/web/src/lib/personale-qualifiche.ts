export const PERSONALE_QUALIFICHE = [
  { id: "sicurezza_luogo_lavoro", label: "Sicurezza luogo di lavoro" },
  { id: "antincendio", label: "Antincendio" },
  { id: "primo_soccorso", label: "Primo soccorso" },
  { id: "rls", label: "RLS" },
  { id: "responsabile_piscina", label: "Responsabile piscina e impianti tecnologici" },
  { id: "blsd", label: "BLSD" },
  { id: "visita_medica", label: "Visita medica" },
] as const

export type PersonaleQualificaId = (typeof PERSONALE_QUALIFICHE)[number]["id"]

/** Validità normativa / interna per corso (anni dalla data corso). */
export const VALIDITA_ANNI_QUALIFICA: Record<PersonaleQualificaId, number> = {
  sicurezza_luogo_lavoro: 5,
  antincendio: 5,
  primo_soccorso: 3,
  rls: 1,
  responsabile_piscina: 5,
  blsd: 2,
  visita_medica: 2,
}

export function isPersonaleQualificaId(v: string): v is PersonaleQualificaId {
  return PERSONALE_QUALIFICHE.some((q) => q.id === v)
}

export function labelQualifica(id: string): string {
  return PERSONALE_QUALIFICHE.find((q) => q.id === id)?.label ?? id
}

export function validitaAnniQualifica(id: PersonaleQualificaId): number {
  return VALIDITA_ANNI_QUALIFICA[id]
}

export function labelValiditaQualifica(id: PersonaleQualificaId): string {
  const n = VALIDITA_ANNI_QUALIFICA[id]
  return n === 1 ? "1 anno" : `${n} anni`
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Scadenza inclusiva: data corso + N anni (stesso giorno/mese). */
export function scadenzaQualifica(dataCorso: string, id: PersonaleQualificaId): string | null {
  const s = String(dataCorso ?? "").trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split("-").map(Number)
  if (!y || !m || !d) return null
  const anni = VALIDITA_ANNI_QUALIFICA[id]
  return `${y + anni}-${pad2(m)}-${pad2(d)}`
}

export function qualificaScaduta(dataCorso: string, id: PersonaleQualificaId, oggi = new Date()): boolean {
  const scad = scadenzaQualifica(dataCorso, id)
  if (!scad) return false
  const t = Date.UTC(oggi.getFullYear(), oggi.getMonth(), oggi.getDate())
  const [y, m, d] = scad.split("-").map(Number)
  return t > Date.UTC(y, m - 1, d)
}

export type QualificaConData = { id: string; data?: string }

export function parseQualificheUi(v: unknown): QualificaConData[] {
  if (!Array.isArray(v)) return []
  const out: QualificaConData[] = []
  for (const item of v) {
    if (typeof item === "string") {
      const id = item.trim()
      if (isPersonaleQualificaId(id) && !out.some((x) => x.id === id)) out.push({ id })
      continue
    }
    if (!item || typeof item !== "object") continue
    const rec = item as { id?: unknown; data?: unknown }
    const id = String(rec.id ?? "").trim()
    if (!isPersonaleQualificaId(id) || out.some((x) => x.id === id)) continue
    const data = String(rec.data ?? "").trim().slice(0, 10)
    out.push(data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? { id, data } : { id })
  }
  return out
}

export function dataQualifica(list: QualificaConData[] | undefined, id: string): string {
  return list?.find((x) => x.id === id)?.data ?? ""
}

export function toggleQualificaConData(list: QualificaConData[], id: string): QualificaConData[] {
  if (list.some((q) => q.id === id)) return list.filter((q) => q.id !== id)
  return [...list, { id }]
}

export function setDataQualifica(list: QualificaConData[], id: string, data: string): QualificaConData[] {
  const t = data.trim().slice(0, 10)
  if (!list.some((q) => q.id === id)) return [...list, t ? { id, data: t } : { id }]
  return list.map((q) => (q.id === id ? (t ? { id, data: t } : { id }) : q))
}

/** Unisce la colonna legacy visitaMedica nella lista corsi sicurezza. */
export function qualificheForDisplay(persona?: {
  qualifiche?: QualificaConData[] | { id: string; data?: string }[]
  visitaMedica?: string
}): QualificaConData[] {
  const base = parseQualificheUi(persona?.qualifiche)
  const v = String(persona?.visitaMedica ?? "").trim().slice(0, 10)
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return base
  if (base.some((x) => x.id === "visita_medica")) return base
  return [...base, { id: "visita_medica", data: v }]
}

export function visitaMedicaFromQualifiche(list: QualificaConData[]): string {
  return dataQualifica(list, "visita_medica")
}
