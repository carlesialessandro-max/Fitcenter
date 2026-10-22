import { isGestionaleConfigured, queryIncassiPerVoce } from "./gestionale-sql.js"

export const MACRO_COMMERCIALI = ["piscina", "fitness", "spa"] as const
export type MacroCommerciale = (typeof MACRO_COMMERCIALI)[number]
/** Solo questi due centri: la somma è il pool dei fissi di struttura da ripartire sui reparti. */
export const MACRO_STRUTTURA = ["gestione", "generali"] as const

export function isMacroStruttura(macroId: string): boolean {
  return (MACRO_STRUTTURA as readonly string[]).includes(macroId)
}

export function isMacroCommerciale(id: string): id is MacroCommerciale {
  return (MACRO_COMMERCIALI as readonly string[]).includes(id)
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function blob(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
}

export type DestRicavo = { macro: MacroCommerciale | "altro"; peso: number }

/** Voce incasso gestionale → macro commerciale (o split full). */
export function classificaRicavo(voce: string, contesto = ""): DestRicavo[] {
  const u = blob(`${voce} ${contesto}`)
  const child = blob(contesto)
  if (!u) return [{ macro: "altro", peso: 1 }]
  if (
    /\bDANZA\b/.test(u) ||
    /\bPROFESSIONALE\b/.test(u) ||
    /\b1\s*M MENSILE 2VS\b/.test(u) ||
    (/\b3 GRADO\b/.test(u) && /\b1\s*M MENSILE\b/.test(u))
  ) {
    return []
  }
  if (/\bOPEN\b/.test(u)) {
    return [
      { macro: "piscina", peso: 0.5 },
      { macro: "fitness", peso: 0.5 },
    ]
  }
  if (/\bSMILE FIT\b/.test(u)) return [{ macro: "fitness", peso: 1 }]
  if (/\bSMILE H2O\b/.test(u)) return [{ macro: "piscina", peso: 1 }]
  const childPiscina = /PISCIN|NUOTO|VASCA|SCUOLA NUOTO|BAGNIN|IDRO|ACQUATIC|ACQUAGYM|ACQUA FITNESS|H2O|CAMPUS|AGONISM/.test(child)
  const childFitness =
    /MAMME FIT|ABBONAMENTI STAFF FITNESS|GYM|PALESTR|FITNESS|POLE|PERSONAL|YOGA|PILATES|SPINNING|TRX|SALA PESI|PACCHETTI INGRESSI/.test(
      child
    ) || /\bFIT\b/.test(child)
  if (childPiscina && childFitness) {
    return [
      { macro: "piscina", peso: 0.5 },
      { macro: "fitness", peso: 0.5 },
    ]
  }
  if (childPiscina) return [{ macro: "piscina", peso: 1 }]
  if (childFitness) return [{ macro: "fitness", peso: 1 }]
  if (/SPA|BENESSER|MASSAGG|ESTETIC|SAUNA|IDROMASSAGGIO/.test(u)) return [{ macro: "spa", peso: 1 }]
  if (/TICKET|ESTIVA|PARCO ACQU/.test(u)) return [{ macro: "piscina", peso: 1 }]
  if (
    /PISCIN|NUOTO|VASCA|SCUOLA NUOTO|BAGNIN|IDRO|ACQUATIC|ACQUAGYM|ACQUA FITNESS|H2O|CAMPUS|AGONISM/.test(u)
  ) {
    return [{ macro: "piscina", peso: 1 }]
  }
  if (
    /MAMME FIT|ABBONAMENTI STAFF FITNESS|GYM|PALESTR|FITNESS|POLE|PERSONAL|YOGA|PILATES|SPINNING|TRX|SALA PESI|PACCHETTI INGRESSI/.test(u)
  ) {
    return [{ macro: "fitness", peso: 1 }]
  }
  if (/FULL|PREMIUM|TUTTO INCLUSO/.test(u)) {
    return [
      { macro: "piscina", peso: 0.5 },
      { macro: "fitness", peso: 0.5 },
    ]
  }
  if (/\bKIDS\b/.test(u) && !/TESSERAMENT|BE ?ACTIVE|SOSPENSIONI AGGIUNT|\bASI\b|\bUISP\b|\bFITRI\b/.test(u)) {
    return [{ macro: "piscina", peso: 1 }]
  }
  if (
    (/\bCLIENTE\b/.test(u) || /LEZIONI PRIVATE/.test(u)) &&
    !/TESSERAMENT|BE ?ACTIVE|SOSPENSIONI AGGIUNT|\bASI\b|\bUISP\b|\bFITRI\b/.test(u)
  ) {
    return [{ macro: "fitness", peso: 1 }]
  }
  if (
    /\bSTAFF\b/.test(u) ||
    u.includes("TESSERAMENT") ||
    /BE ?ACTIVE|SOSPENSIONI AGGIUNT/.test(u) ||
    (/\bBADGE\b/.test(u) && /\bMERCHANDISING\b/.test(u))
  ) {
    return [{ macro: "altro", peso: 1 }]
  }
  return [{ macro: "altro", peso: 1 }]
}

export type AmmRicavoVoce = {
  voce: string
  macro: string
  importo: number
  n: number
  ripartizione?: { macro: string; importo: number }[]
}
type RicavoVoceGestionale = { voce: string; contesto: string; euro: number; n: number; danza: boolean }

function titoloVocePerRaggruppamento(voce: string, contesto: string): string {
  const v = voce.trim()
  const rata = /^PAGAMENTO\s+RATA\s+del\s+\d{1,2}\/\d{1,2}\/\d{4}\s*:\s*(.+)$/i.exec(v)
  if (rata?.[1]) {
    return rata[1].replace(/\s+dal\s+\d{1,2}\/\d{1,2}\/\d{4}\s+al\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/i, "").trim()
  }
  if (v && v !== "Altro") return v
  const ctx = contesto.trim()
  if (!ctx) return v || "Altro"
  const senzaRata = ctx.replace(/^PAGAMENTO\s+RATA\s+del\s+\d{1,2}\/\d{1,2}\/\d{4}\s*:\s*/i, "").trim()
  return senzaRata.split(/\s{2,}/)[0]?.trim() || ctx.slice(0, 120)
}

function chiaveRaggruppamento(voce: string, contesto = ""): string {
  const titolo = titoloVocePerRaggruppamento(voce, contesto)
  const normalized = blob(titolo)
  if (!normalized) return "Altro"
  if (/^ROSSI ORARIO LIBERO\b/.test(normalized)) return "ROSSI - orario libero"
  if (/^SCUOLA NUOTO\b/.test(normalized)) return "SCUOLA NUOTO"
  if (/^TICKETING\b/.test(normalized)) return "TICKETING"
  if (/^GYM\b/.test(normalized) || /\bGIN\b/.test(normalized)) return "GYM - abbonamenti palestra"
  if (/\bSMILE FIT\b/.test(normalized)) return "SMILE FIT"
  if (/\bSMILE H2O\b/.test(normalized)) return "SMILE H2O"
  if (/\b1\s*M MENSILE 3VS\b/.test(normalized)) return "1 M MENSILE 3VS"
  if (/\b1\s*M MENSILE 2VS\b/.test(normalized)) return "1 M MENSILE 2VS"
  if (/\bLEZIONI PRIVATE\b/.test(normalized)) return "Lezioni private"
  if (/\bTESSERAMENT\b/.test(normalized)) return "Tesseramenti"
  if (/^PACCHETTI INGRESSI\b/.test(normalized)) return "Pacchetti ingressi"
  if (/^CAMPUS\b/.test(normalized)) return "Campus"
  return titolo.length > 96 ? `${titolo.slice(0, 93)}…` : titolo
}

const ORDINE_MACRO_DETTAGLIO = ["piscina", "fitness", "spa", "altro"] as const

export function macroPrimarioDettaglioRicavo(row: {
  macro: string
  ripartizione?: { macro: string; importo: number }[]
}): string {
  if (row.ripartizione?.length === 1) return row.ripartizione[0]!.macro
  if (row.ripartizione?.length) {
    return row.ripartizione.reduce((best, q) => (q.importo > best.importo ? q : best)).macro
  }
  const first = row.macro.split("+")[0]?.trim().toLowerCase()
  return first || "altro"
}

export function ordinaDettaglioRicavi(rows: AmmRicavoVoce[]): AmmRicavoVoce[] {
  const rank = (m: string) => {
    const i = ORDINE_MACRO_DETTAGLIO.indexOf(m as (typeof ORDINE_MACRO_DETTAGLIO)[number])
    return i >= 0 ? i : ORDINE_MACRO_DETTAGLIO.length
  }
  return [...rows].sort((a, b) => {
    const ma = macroPrimarioDettaglioRicavo(a)
    const mb = macroPrimarioDettaglioRicavo(b)
    const dr = rank(ma) - rank(mb)
    if (dr !== 0) return dr
    return b.importo - a.importo
  })
}

export function raggruppaDettaglioRicavi(voci: RicavoVoceGestionale[]): AmmRicavoVoce[] {
  const grouped = new Map<
    string,
    { voce: string; importo: number; n: number; ripartizione: Map<string, number> }
  >()
  for (const v of voci) {
    if (v.danza) continue
    const dest = classificaRicavo(v.voce, v.contesto)
    if (dest.length === 0) continue
    const key = chiaveRaggruppamento(v.voce, v.contesto)
    const current = grouped.get(key) ?? {
      voce: key,
      importo: 0,
      n: 0,
      ripartizione: new Map<string, number>(),
    }
    current.n += v.n
    for (const d of dest) {
      const quota = round2(Number(v.euro || 0) * d.peso)
      current.importo = round2(current.importo + quota)
      current.ripartizione.set(d.macro, round2((current.ripartizione.get(d.macro) ?? 0) + quota))
    }
    grouped.set(key, current)
  }
  return [...grouped.values()].map((row) => ({
    voce: row.voce,
    macro: [...row.ripartizione.keys()].join(" + "),
    importo: row.importo,
    n: row.n,
    ripartizione: [...row.ripartizione.entries()].map(([macro, importo]) => ({ macro, importo })),
  }))
}

export type AmmRicaviPeriodo = {
  from: string
  to: string
  tot: number
  totCommerciali: number
  totAltri: number
  byMacro: Record<MacroCommerciale, number>
  dettaglio: AmmRicavoVoce[]
  disponibile: boolean
}

function emptyRicavi(from: string, to: string): AmmRicaviPeriodo {
  return {
    from,
    to,
    tot: 0,
    totCommerciali: 0,
    totAltri: 0,
    byMacro: { piscina: 0, fitness: 0, spa: 0 },
    dettaglio: [],
    disponibile: false,
  }
}

export function periodoIso(anno: number, mese?: string): { from: string; to: string } {
  if (mese && /^\d{4}-\d{2}$/.test(mese)) {
    const y = Number(mese.slice(0, 4))
    const m = Number(mese.slice(5, 7))
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    return { from: `${mese}-01`, to }
  }
  return { from: `${anno}-01-01`, to: `${anno}-12-31` }
}

export async function queryRicaviAmm(anno: number, mese?: string): Promise<AmmRicaviPeriodo> {
  const { from, to } = periodoIso(anno, mese)
  if (!isGestionaleConfigured()) return emptyRicavi(from, to)
  try {
    const voci = await queryIncassiPerVoce({ from, to })
    const byMacro: Record<MacroCommerciale, number> = { piscina: 0, fitness: 0, spa: 0 }
    let totAltri = 0
    for (const v of voci) {
      if (v.danza) continue
      const dest = classificaRicavo(v.voce, v.contesto)
      const euro = Number(v.euro) || 0
      for (const d of dest) {
        const quota = round2(euro * d.peso)
        if (d.macro === "altro") totAltri += quota
        else byMacro[d.macro] += quota
      }
    }
    const dettaglio = ordinaDettaglioRicavi(raggruppaDettaglioRicavi(voci))
    for (const k of MACRO_COMMERCIALI) byMacro[k] = round2(byMacro[k])
    totAltri = round2(totAltri)
    const totCommerciali = round2(MACRO_COMMERCIALI.reduce((s, k) => s + byMacro[k], 0))
    return {
      from,
      to,
      tot: round2(totCommerciali + totAltri),
      totCommerciali,
      totAltri,
      byMacro,
      dettaglio,
      disponibile: true,
    }
  } catch (e) {
    console.warn("[amm] ricavi gestionale:", (e as Error)?.message ?? e)
    return emptyRicavi(from, to)
  }
}

export function quoteRipartoFissi(ricavi: Record<MacroCommerciale, number>): Record<MacroCommerciale, number> {
  const tot = MACRO_COMMERCIALI.reduce((s, k) => s + (ricavi[k] || 0), 0)
  if (tot > 0.009) {
    const out = { piscina: 0, fitness: 0, spa: 0 } as Record<MacroCommerciale, number>
    let acc = 0
    MACRO_COMMERCIALI.forEach((k, i) => {
      const last = i === MACRO_COMMERCIALI.length - 1
      const q = last ? round2(100 - acc) : round2(((ricavi[k] || 0) / tot) * 100)
      acc = round2(acc + q)
      out[k] = q
    })
    return out
  }
  return { piscina: round2(100 / 3), fitness: round2(100 / 3), spa: round2(100 - 2 * round2(100 / 3)) }
}
