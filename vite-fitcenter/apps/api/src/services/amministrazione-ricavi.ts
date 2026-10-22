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
  if (/\bSTAFF\b/.test(u) || u.includes("TESSERAMENT") || /BE ?ACTIVE|SOSPENSIONI AGGIUNT/.test(u)) {
    return [{ macro: "altro", peso: 1 }]
  }
  if (/FULL|PREMIUM|TUTTO INCLUSO/.test(u)) {
    return [
      { macro: "piscina", peso: 0.5 },
      { macro: "fitness", peso: 0.5 },
    ]
  }
  if (/\bKIDS\b/.test(u)) return [{ macro: "piscina", peso: 1 }]
  if (/\bCLIENTE\b/.test(u) || /LEZIONI PRIVATE/.test(u)) return [{ macro: "fitness", peso: 1 }]
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

function chiaveRaggruppamento(voce: string): string {
  const normalized = blob(voce)
  if (/^ROSSI ORARIO LIBERO\b/.test(normalized)) return "ROSSI - orario libero"
  if (/^SCUOLA NUOTO\b/.test(normalized)) return "SCUOLA NUOTO"
  if (/^TICKETING\b/.test(normalized)) return "TICKETING"
  return voce
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
    const key = chiaveRaggruppamento(v.voce)
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
    const dettaglio = raggruppaDettaglioRicavi(voci)
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
      dettaglio: dettaglio.sort((a, b) => b.importo - a.importo).slice(0, 40),
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
