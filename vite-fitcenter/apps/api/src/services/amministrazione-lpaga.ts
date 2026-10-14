import { dominioLivello, listLivelli, listTurni } from "../store/libro-paga-db.js"

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Collaboratori sportivi: mansione libro paga → sotto-reparto (o macro se non è preciso). */
export function codiceRepartoDaMansione(dominio: string, nome: string): string | null {
  const s = norm(`${dominio} ${nome}`)
  if (!s) return null
  if (/\b(desk|reception|segreter|amminist|ufficio|consulenz|direzion)\b/.test(s)) return "amministrazione-uffici"
  if (/\bpuliz/.test(s)) return "pulizie"
  if (/\bmanutenz/.test(s)) return "manutenzione-impianti"
  if (/\b(spa|benesser|massagg|estetic)/.test(s)) return "spa-benessere"
  if (/\bpole/.test(s)) return "pole-dance"
  if (/\bpersonal/.test(s)) return "personal-training"
  if (/\b(scuola nuoto bambini|snb|bimbi|baby)/.test(s)) return "scuola-nuoto-bambini"
  if (/\b(scuola nuoto adulti|master|adulti)/.test(s) && /\b(nuoto|scuola)/.test(s)) return "scuola-nuoto-adulti"
  if (/\b(acquagym|acqua fitness|corsi in acqua|idro)/.test(s)) return "corsi-acqua"
  if (/\b(sala pesi|palestr)/.test(s) && !/\bcors/.test(s)) return "palestra-sala-pesi"
  if (/\b(pilates|yoga|spinning|trx|functional|corso|corsi|fit\b|danza)/.test(s)) return "corsi-fitness"
  if (/\b(piscina|acqua|nuoto|bagnin|vasca|h20|h2o)\b/.test(s)) return "piscina"
  if (/\b(fitness|palestr)\b/.test(s)) return "fitness"
  const d = norm(dominio)
  if (/\bspa|benesser/.test(d)) return "spa"
  if (/\bpiscina|acqua|nuoto/.test(d)) return "piscina"
  if (/\bpalestr|fitness/.test(d)) return "fitness"
  return "personale-condiviso"
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
