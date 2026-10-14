import type { AmmQuota } from "../store/amministrazione-costi.js"

export type AmmStagionaleFornitore = "piscina-estate"

export type AmmFornitoreQuoteSeed = {
  match: string[]
  label: string
  quote: AmmQuota[]
  stagionale?: AmmStagionaleFornitore
}

function q(repartoId: string, percentuale = 100): AmmQuota[] {
  return [{ repartoId, percentuale }]
}

/** Nomi fatture in Cloud / anagrafica: match per sottostringa normalizzata. */
export const FORNITORI_QUOTE_SEED: AmmFornitoreQuoteSeed[] = [
  { match: ["corsini"], label: "Corsini", quote: q("costi-generali-struttura") },
  { match: ["mattonai"], label: "Studio Mattonai", quote: q("costi-generali-struttura") },
  { match: ["team system", "teamsystem"], label: "Team system", quote: q("costi-generali-struttura") },
  { match: ["danio"], label: "Danio srl", quote: q("costi-generali-struttura") },
  { match: ["compass"], label: "Compass", quote: q("costi-generali-struttura") },
  { match: ["italpower energia", "italpower"], label: "Italpower", quote: q("utenze-generali") },
  { match: ["publiacqua"], label: "Publiacqua", quote: q("utenze-generali") },
  { match: ["technogym"], label: "Technogym", quote: q("palestra-sala-pesi") },
  { match: ["de lage landen", "delage landen", "delagelanden"], label: "De Lage Landen", quote: q("palestra-sala-pesi") },
  { match: ["aquafitnes", "aquafitness"], label: "Aquafitnes", quote: q("corsi-acqua") },
  { match: ["bracali"], label: "Bracali", quote: q("corsi-acqua") },
  { match: ["mangiavacchi"], label: "Mangiavacchi", quote: q("pulizie") },
  {
    match: ["ramo rappresentanze", "ramo"],
    label: "RAMO Rappresentanze",
    quote: q("piscina-coperta"),
    stagionale: "piscina-estate",
  },
  {
    match: ["diversey"],
    label: "Diversey",
    quote: q("piscina-coperta"),
    stagionale: "piscina-estate",
  },
]

export function normFornitoreKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(srl|spa|s\.?p\.?a\.?|s\.?r\.?l\.?|snc|sas|ss|ltd|bv|nv|gmbh|societa|società)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function compact(s: string): string {
  return normFornitoreKey(s).replace(/ /g, "")
}

export function fornitoreMatch(nome: string, needles: string[]): boolean {
  const n = compact(nome)
  if (!n) return false
  return needles.some((nd) => {
    const k = compact(nd)
    return Boolean(k) && (n === k || n.includes(k) || (k.length >= 8 && k.includes(n)))
  })
}

/** Fino a maggio e da settembre: 100% piscina coperta. Giugno–agosto: 50% coperta / 50% estiva. */
export function quotePiscinaStagionale(dataDocumento: string): AmmQuota[] {
  const m = Number(String(dataDocumento ?? "").slice(5, 7))
  if (m >= 6 && m <= 8) {
    return [
      { repartoId: "piscina-coperta", percentuale: 50 },
      { repartoId: "piscina-estiva", percentuale: 50 },
    ]
  }
  return q("piscina-coperta")
}

export function seedFornitore(nome: string): AmmFornitoreQuoteSeed | null {
  const hits = FORNITORI_QUOTE_SEED.filter((s) => fornitoreMatch(nome, s.match))
  if (!hits.length) return null
  return hits.sort((a, b) => compact(b.match[0] ?? "").length - compact(a.match[0] ?? "").length)[0] ?? null
}

/** Ripartizione “secchio” dello scarico FIC, non una scelta dell’utente. */
export function isQuoteDumpDefault(quote: AmmQuota[] | undefined | null): boolean {
  if (!quote || quote.length !== 1) return false
  const q0 = quote[0]!
  return q0.repartoId === "altri-costi" && Math.abs(Number(q0.percentuale) - 100) < 0.05
}

export function resolveQuoteFornitore(opts: {
  nome: string
  dataDocumento: string
  remembered?: AmmQuota[] | null
}): AmmQuota[] | null {
  const seed = seedFornitore(opts.nome)
  if (seed?.stagionale === "piscina-estate") return quotePiscinaStagionale(opts.dataDocumento)
  const mem = (opts.remembered ?? []).filter((x) => x.repartoId && Number(x.percentuale) > 0)
  if (mem.length && !isQuoteDumpDefault(mem)) {
    return mem.map((x) => ({ repartoId: x.repartoId, percentuale: Number(x.percentuale) }))
  }
  if (seed?.quote?.length) return seed.quote.map((x) => ({ ...x }))
  return null
}
