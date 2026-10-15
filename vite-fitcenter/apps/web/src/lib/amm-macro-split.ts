import type { AmmQuota, AmmReparto } from "@/api/amministrazione"

export const PISCINA_MACRO_SPLIT_IDS = ["piscina-coperta", "piscina-estiva"] as const

/** Target per lo split «macro-aree»: al posto della macro Piscina, coperta + esterna. */
export function macroSplitTargets(reparti: AmmReparto[]): AmmReparto[] {
  const attivi = reparti.filter((r) => r.attivo)
  const byId = new Map(attivi.map((r) => [r.id, r]))
  const macros = attivi.filter((r) => r.livello === "macro").sort((a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome, "it"))
  const out: AmmReparto[] = []
  for (const m of macros) {
    if (m.id === "piscina") {
      for (const id of PISCINA_MACRO_SPLIT_IDS) {
        const s = byId.get(id)
        if (s) out.push(s)
      }
    } else {
      out.push(m)
    }
  }
  return out
}

export function macroSplitLabel(r: AmmReparto): string {
  if (r.id === "piscina-coperta") return "Piscina"
  if (r.id === "piscina-estiva") return "Piscina esterna"
  return r.nome
}

/** Quote con % sulla macro «piscina» → imputazione su piscina coperta (stesso importo). */
export function normalizeMacroSplitQuote(quote: AmmQuota[]): AmmQuota[] {
  if (!quote.some((q) => q.repartoId === "piscina")) return quote
  const out: AmmQuota[] = []
  for (const q of quote) {
    if (q.repartoId === "piscina") out.push({ repartoId: "piscina-coperta", percentuale: q.percentuale })
    else out.push(q)
  }
  const merged = new Map<string, number>()
  for (const q of out) {
    merged.set(q.repartoId, Math.round(((merged.get(q.repartoId) ?? 0) + q.percentuale) * 100) / 100)
  }
  return [...merged.entries()].map(([repartoId, percentuale]) => ({ repartoId, percentuale }))
}
