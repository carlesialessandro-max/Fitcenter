export const PERSONALE_QUALIFICHE = [
  { id: "sicurezza_luogo_lavoro", label: "Sicurezza luogo di lavoro" },
  { id: "antincendio", label: "Antincendio" },
  { id: "primo_soccorso", label: "Primo soccorso" },
  { id: "rls", label: "RLS" },
  { id: "responsabile_piscina", label: "Responsabile piscina" },
] as const

export type PersonaleQualificaId = (typeof PERSONALE_QUALIFICHE)[number]["id"]

export function isPersonaleQualificaId(v: string): v is PersonaleQualificaId {
  return PERSONALE_QUALIFICHE.some((q) => q.id === v)
}

export function labelQualifica(id: string): string {
  return PERSONALE_QUALIFICHE.find((q) => q.id === id)?.label ?? id
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
