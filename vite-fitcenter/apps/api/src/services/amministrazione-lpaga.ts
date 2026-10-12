import { dominioLivello, listLivelli, listTurni } from "../store/libro-paga-db.js"

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Collaboratori sportivi: mappa mansione libro paga → centro di costo operativo. */
export function codiceRepartoDaMansione(dominio: string, nome: string): "piscina" | "fitness" | "manutenzione" | null {
  const s = norm(`${dominio} ${nome}`)
  if (!s) return null
  if (/\bmanutenz/.test(s)) return "manutenzione"
  if (/\b(desk|reception|segreter|amminist|ufficio|consulenz)\b/.test(s)) return null
  if (/\b(piscina|acqua|nuoto|bagnin|vasca|scuola nuoto|h20|h2o)\b/.test(s)) return "piscina"
  if (/\b(fitness|palestr|corso|corsi|pole|personal|sala pesi|trx|spinn|fit|danza|pilates|yoga|functional)\b/.test(s)) {
    return "fitness"
  }
  const d = norm(dominio)
  if (/\bpiscina|acqua/.test(d)) return "piscina"
  if (/\bpalestr|fitness/.test(d)) return "fitness"
  return null
}

export type AmmLpagaRiga = {
  repartoId: string
  importo: number
  nTurni: number
}

function aggrega(turni: Awaited<ReturnType<typeof listTurni>>, livelli: Awaited<ReturnType<typeof listLivelli>>, mese: string): AmmLpagaRiga[] {
  const by = new Map<string, AmmLpagaRiga>()
  for (const t of turni) {
    if (t.giorno.slice(0, 7) !== mese) continue
    const liv = livelli.find((l) => l.id === t.livelloId)
    const dominio = dominioLivello(livelli, t.livelloId)
    const codice = codiceRepartoDaMansione(dominio, liv?.nome ?? "")
    if (!codice) continue
    const cur = by.get(codice) ?? { repartoId: codice, importo: 0, nTurni: 0 }
    cur.importo = Math.round((cur.importo + Number(t.importo || 0)) * 100) / 100
    cur.nTurni += 1
    by.set(codice, cur)
  }
  return [...by.values()]
}

export async function costiCollaboratoriSportivi(mese: string): Promise<AmmLpagaRiga[]> {
  if (!/^\d{4}-\d{2}$/.test(mese)) return []
  const [livelli, turni] = await Promise.all([listLivelli(), listTurni()])
  return aggrega(turni, livelli, mese)
}

export async function costiCollaboratoriAnno(anno: number): Promise<{ mese: string; righe: AmmLpagaRiga[] }[]> {
  const [livelli, turni] = await Promise.all([listLivelli(), listTurni()])
  const out: { mese: string; righe: AmmLpagaRiga[] }[] = []
  for (let m = 1; m <= 12; m++) {
    const mese = `${anno}-${String(m).padStart(2, "0")}`
    out.push({ mese, righe: aggrega(turni, livelli, mese) })
  }
  return out
}
