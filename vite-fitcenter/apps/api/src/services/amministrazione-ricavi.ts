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
export function classificaRicavo(voce: string): DestRicavo[] {
  const u = blob(voce)
  if (!u) return [{ macro: "altro", peso: 1 }]
  if (/\bDANZA\b/.test(u)) return []
  if (/\bSTAFF\b/.test(u) || u.includes("TESSERAMENT")) return [{ macro: "altro", peso: 1 }]
  if (/SPA|BENESSER|MASSAGG|ESTETIC|SAUNA|IDROMASSAGGIO/.test(u)) return [{ macro: "spa", peso: 1 }]
  if (/TICKET|ESTIVA|PARCO ACQU/.test(u)) return [{ macro: "piscina", peso: 1 }]
  if (
    /PISCIN|NUOTO|VASCA|SCUOLA NUOTO|BAGNIN|IDRO|ACQUATIC|ACQUAGYM|ACQUA FITNESS|H2O|CAMPUS|AGONISM/.test(u)
  ) {
    return [{ macro: "piscina", peso: 1 }]
  }
  if (
    /GYM|PALESTR|FITNESS|POLE|PERSONAL|YOGA|PILATES|SPINNING|TRX|SALA PESI|ROSSI|VERDI|PACCHETTI INGRESSI/.test(
      u
    )
  ) {
    return [{ macro: "fitness", peso: 1 }]
  }
  if (/FULL|PREMIUM|OPEN|TUTTO INCLUSO/.test(u)) {
    return [
      { macro: "piscina", peso: 0.5 },
      { macro: "fitness", peso: 0.5 },
    ]
  }
  if (/\bKIDS\b/.test(u)) return [{ macro: "piscina", peso: 1 }]
  if (/\bCLIENTE\b/.test(u) || /LEZIONI PRIVATE|PROFESSIONALE/.test(u)) return [{ macro: "fitness", peso: 1 }]
  return [{ macro: "altro", peso: 1 }]
}

export type AmmRicavoVoce = { voce: string; macro: string; importo: number; n: number }

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
    const dettaglio: AmmRicavoVoce[] = []
    for (const v of voci) {
      const dest = classificaRicavo(v.voce)
      const euro = Number(v.euro) || 0
      for (const d of dest) {
        const quota = round2(euro * d.peso)
        if (d.macro === "altro") totAltri += quota
        else byMacro[d.macro] += quota
        dettaglio.push({ voce: v.voce, macro: d.macro, importo: quota, n: v.n })
      }
    }
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
