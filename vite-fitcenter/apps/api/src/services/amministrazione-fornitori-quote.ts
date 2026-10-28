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
  { match: ["tip energia", "tipenergia"], label: "Tip energia", quote: q("utenze-generali") },
  { match: ["tres energia", "tresenergia"], label: "Tres Energia", quote: q("utenze-generali") },
  { match: ["sima energia", "simaenergia"], label: "Sima energia", quote: q("utenze-generali") },
  { match: ["publiacqua", "pubbliacqua"], label: "Publiacqua", quote: q("utenze-generali") },
  { match: ["technogym"], label: "Technogym", quote: q("palestra-sala-pesi") },
  { match: ["de lage landen", "delage landen", "delagelanden"], label: "De Lage Landen", quote: q("palestra-sala-pesi") },
  { match: ["aquafitnes", "aquafitness"], label: "Aquafitnes", quote: q("corsi-acqua") },
  { match: ["bracali"], label: "Bracali", quote: q("corsi-acqua") },
  { match: ["mangiavacchi"], label: "Mangiavacchi", quote: q("pulizie") },
  {
    match: ["ramo rappresentanze", "ra.mo", "ra mo", "ramo"],
    label: "RA.MO",
    quote: q("piscina-coperta"),
    stagionale: "piscina-estate",
  },
  {
    match: ["diversey"],
    label: "Diversey",
    quote: q("piscina-coperta"),
    stagionale: "piscina-estate",
  },
  {
    match: ["toscochimica", "tosco chimica"],
    label: "Toscochimica S.p.A.",
    quote: q("piscina-coperta"),
    stagionale: "piscina-estate",
  },
]

export type AmmSpesaQuoteCtx = { id?: string; fornitore: string; dataDocumento: string }

function annoMese(dataDocumento: string): { anno: number; mese: number } | null {
  const s = String(dataDocumento ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return { anno: Number(s.slice(0, 4)), mese: Number(s.slice(5, 7)) }
}

export function speseStessoFornitoreStagionale(nome: string, fornitoreSpesa: string): boolean {
  const seed = seedFornitore(nome)
  if (seed) return fornitoreMatch(fornitoreSpesa, seed.match)
  const a = normFornitoreKey(nome)
  const b = normFornitoreKey(fornitoreSpesa)
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)))
}

/** Giugno–agosto sempre. Settembre: fino alla prima fornitura del fornitore (apertura piscina esterna), inclusa. */
export function inFinestraPiscinaEstate(
  dataDocumento: string,
  nomeFornitore: string,
  spese?: AmmSpesaQuoteCtx[],
  _excludeSpesaId?: string
): boolean {
  const am = annoMese(dataDocumento)
  if (!am) return false
  const { anno, mese } = am
  const doc = String(dataDocumento ?? "").slice(0, 10)
  if (mese < 6 || mese > 9) return false
  if (mese >= 6 && mese <= 8) return true
  const settembre = [
    ...(spese ?? [])
      .filter((s) => speseStessoFornitoreStagionale(nomeFornitore, s.fornitore))
      .map((s) => String(s.dataDocumento).slice(0, 10)),
    doc,
  ]
    .filter((d) => d.startsWith(`${anno}-09`))
    .sort()
  const prima = settembre[0]
  if (!prima) return true
  return doc <= prima
}

export function quotesMatch(a: AmmQuota[], b: AmmQuota[]): boolean {
  if (a.length !== b.length) return false
  const map = new Map(b.map((x) => [x.repartoId, Number(x.percentuale)]))
  return a.every((x) => Math.abs((map.get(x.repartoId) ?? NaN) - Number(x.percentuale)) < 0.05)
}

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

/** Fuori finestra: 100% piscina coperta. In finestra: 75% estiva / 25% coperta. */
export function quotePiscinaStagionale(
  dataDocumento: string,
  opts?: { fornitore?: string; spese?: AmmSpesaQuoteCtx[]; excludeSpesaId?: string }
): AmmQuota[] {
  const inWindow = opts?.fornitore
    ? inFinestraPiscinaEstate(dataDocumento, opts.fornitore, opts.spese, opts.excludeSpesaId)
    : (() => {
        const m = Number(String(dataDocumento ?? "").slice(5, 7))
        return m >= 6 && m <= 8
      })()
  if (inWindow) {
    return [
      { repartoId: "piscina-estiva", percentuale: 75 },
      { repartoId: "piscina-coperta", percentuale: 25 },
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

export function inferQuoteDaTesto(nome: string, descrizione = ""): AmmQuota[] | null {
  const n = normFornitoreKey(`${nome} ${descrizione}`)
  if (!n) return null
  if (/affitt|locazion|canone locat|convenzion/.test(n)) return q("costi-generali-struttura")
  const piscina = /piscin|vasca|nuoto|idro|acquatic|cloro|filtri/.test(n)
  const fitness = /palestr|fitness|\bgym\b|sala pesi|pole/.test(n)
  const spa = /\bspa\b|benesser|sauna/.test(n)
  const pulizie = /puliz/.test(n)
  const manutenzione = /manutenz|riparaz|impiant|caldaia|elettric|idraulic/.test(n)
  if (pulizie || manutenzione) {
    const hits: AmmQuota[] = []
    if (piscina) hits.push({ repartoId: "piscina-coperta", percentuale: 0 })
    if (fitness) hits.push({ repartoId: "palestra-sala-pesi", percentuale: 0 })
    if (spa) hits.push({ repartoId: "spa-benessere", percentuale: 0 })
    if (hits.length === 1) return [{ repartoId: hits[0]!.repartoId, percentuale: 100 }]
    if (hits.length > 1) {
      const pct = Math.round((100 / hits.length) * 100) / 100
      return hits.map((h, i) => ({
        repartoId: h.repartoId,
        percentuale: i === hits.length - 1 ? Math.round((100 - pct * (hits.length - 1)) * 100) / 100 : pct,
      }))
    }
    return q(pulizie ? "pulizie" : "manutenzione-impianti")
  }
  return null
}

export function resolveQuoteFornitore(opts: {
  nome: string
  dataDocumento: string
  descrizione?: string
  remembered?: AmmQuota[] | null
  spese?: AmmSpesaQuoteCtx[]
  excludeSpesaId?: string
}): AmmQuota[] | null {
  const seed = seedFornitore(opts.nome)
  if (seed?.stagionale === "piscina-estate") {
    return quotePiscinaStagionale(opts.dataDocumento, {
      fornitore: opts.nome,
      spese: opts.spese,
      excludeSpesaId: opts.excludeSpesaId,
    })
  }
  const mem = (opts.remembered ?? []).filter((x) => x.repartoId && Number(x.percentuale) > 0)
  if (mem.length && !isQuoteDumpDefault(mem)) {
    return mem.map((x) => ({ repartoId: x.repartoId, percentuale: Number(x.percentuale) }))
  }
  if (seed?.quote?.length) return seed.quote.map((x) => ({ ...x }))
  return inferQuoteDaTesto(opts.nome, opts.descrizione)
}
