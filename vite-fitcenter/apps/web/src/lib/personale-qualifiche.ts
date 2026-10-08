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
