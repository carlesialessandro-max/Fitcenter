import {
  dominioLivello,
  listLivelli,
  listMensilita,
  listPersonale,
  listTurni,
  nominativo,
  type LpagaLivello,
  type LpagaMensilita,
  type LpagaPersonale,
  type LpagaTurno,
} from "../store/libro-paga-db.js"

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
  if (/\b(agonism|squadra nuoto|iscrizion.*gar|gare nuoto)\b/.test(s)) return "agonismo"
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

export type AmmLpagaCollaboratoreRiga = {
  id: string
  nome: string
  importo: number
  nTurni: number
  quote: { repartoId: string; percentuale: number }[]
}

type MeseCollaboratoriLpaga = {
  righe: AmmLpagaCollaboratoreRiga[]
  reparti: AmmLpagaRiga[]
}

function ripartoMese(
  mese: string,
  livelli: LpagaLivello[],
  personale: LpagaPersonale[],
  turni: LpagaTurno[],
  mensilita: LpagaMensilita[]
): MeseCollaboratoriLpaga {
  const livelliById = new Map(livelli.map((livello) => [livello.id, livello]))
  const byPerson = new Map<
    string,
    { importoTurni: number; nTurni: number; reparti: Map<string, { importo: number; nTurni: number }> }
  >()
  for (const turno of turni) {
    if (turno.giorno.slice(0, 7) !== mese) continue
    const persona = byPerson.get(turno.personaleId) ?? {
      importoTurni: 0,
      nTurni: 0,
      reparti: new Map<string, { importo: number; nTurni: number }>(),
    }
    const importo = Number(turno.importo || 0)
    persona.importoTurni = Math.round((persona.importoTurni + importo) * 100) / 100
    persona.nTurni += 1
    const livello = livelliById.get(turno.livelloId)
    const codice = codiceRepartoDaMansione(
      dominioLivello(livelli, turno.livelloId),
      livello?.nome ?? ""
    )
    if (codice) {
      const reparto = persona.reparti.get(codice) ?? { importo: 0, nTurni: 0 }
      reparto.importo = Math.round((reparto.importo + importo) * 100) / 100
      reparto.nTurni += 1
      persona.reparti.set(codice, reparto)
    }
    byPerson.set(turno.personaleId, persona)
  }

  const savedByPerson = new Map(mensilita.map((row) => [row.personaleId, row]))
  const personaleById = new Map(personale.map((row) => [row.id, row]))
  const ids = new Set([...byPerson.keys(), ...savedByPerson.keys()])
  const collaboratori: AmmLpagaCollaboratoreRiga[] = []
  const byReparto = new Map<string, AmmLpagaRiga>()

  for (const id of ids) {
    const agg = byPerson.get(id)
    const saved = savedByPerson.get(id)
    const importo = Math.round((saved?.bonifico ?? agg?.importoTurni ?? 0) * 100) / 100
    if (!importo) continue
    const persona = personaleById.get(id)
    const quote = [...(agg?.reparti ?? new Map()).entries()]
      .filter(([, row]) => row.importo !== 0)
      .map(([repartoId, row]) => ({ repartoId, importo: row.importo, nTurni: row.nTurni }))
    if (!quote.length) {
      const livelloId = persona?.livelloId || persona?.livelloIds?.[0] || ""
      const livello = livelliById.get(livelloId)
      const repartoId =
        codiceRepartoDaMansione(dominioLivello(livelli, livelloId), livello?.nome ?? "") ??
        "personale-condiviso"
      quote.push({ repartoId, importo: 1, nTurni: 0 })
    }
    const pesoTotale = quote.reduce((sum, row) => sum + Math.abs(row.importo), 0)
    let percentualeAssegnata = 0
    const quoteCollaboratore = quote.map((row, index) => {
      const percentuale =
        index === quote.length - 1
          ? Math.round((100 - percentualeAssegnata) * 100) / 100
          : Math.round(((Math.abs(row.importo) / pesoTotale) * 100) * 100) / 100
      percentualeAssegnata = Math.round((percentualeAssegnata + percentuale) * 100) / 100
      return { repartoId: row.repartoId, percentuale }
    })
    collaboratori.push({
      id,
      nome: persona ? nominativo(persona) : id,
      importo,
      nTurni: agg?.nTurni ?? 0,
      quote: quoteCollaboratore,
    })
    let allocato = 0
    quote.forEach((row, index) => {
      const quota = index === quote.length - 1
        ? Math.round((importo - allocato) * 100) / 100
        : Math.round((importo * (Math.abs(row.importo) / pesoTotale)) * 100) / 100
      allocato = Math.round((allocato + quota) * 100) / 100
      const reparto = byReparto.get(row.repartoId) ?? { repartoId: row.repartoId, importo: 0, nTurni: 0 }
      reparto.importo = Math.round((reparto.importo + quota) * 100) / 100
      reparto.nTurni += row.nTurni
      byReparto.set(row.repartoId, reparto)
    })
  }

  collaboratori.sort((a, b) => a.nome.localeCompare(b.nome, "it"))
  return { righe: collaboratori, reparti: [...byReparto.values()] }
}

async function datiMese(mese: string) {
  const [livelli, personale, turni, mensilita] = await Promise.all([
    listLivelli(),
    listPersonale(),
    listTurni(),
    listMensilita(mese),
  ])
  return ripartoMese(mese, livelli, personale, turni, mensilita)
}

export async function collaboratoriDaMensilita(mese: string): Promise<AmmLpagaCollaboratoreRiga[]> {
  if (!/^\d{4}-\d{2}$/.test(mese)) return []
  return (await datiMese(mese)).righe
}

export async function centriCostoPredefinitiCollaboratori(): Promise<Map<string, string>> {
  const [livelli, personale] = await Promise.all([listLivelli(), listPersonale()])
  const result = new Map<string, string>()
  // I non attivi vengono letti per primi: se un nominativo è doppio vince la scheda attiva.
  const ordinati = [...personale].sort((a, b) => Number(a.attivo !== false) - Number(b.attivo !== false))
  for (const persona of ordinati) {
    const livelloId = persona.livelloId || persona.livelloIds?.[0] || ""
    const livello = livelli.find((item) => item.id === livelloId)
    if (!livello) continue
    const repartoId = codiceRepartoDaMansione(dominioLivello(livelli, livelloId), livello.nome)
    if (!repartoId) continue
    const key = nominativo(persona)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase()
    if (key) result.set(key, repartoId)
  }
  return result
}

export async function costiCollaboratoriSportivi(mese: string): Promise<AmmLpagaRiga[]> {
  if (!/^\d{4}-\d{2}$/.test(mese)) return []
  return (await datiMese(mese)).reparti
}

export async function costiCollaboratoriAnno(
  anno: number
): Promise<{ mese: string; righe: AmmLpagaRiga[]; collaboratori: AmmLpagaCollaboratoreRiga[] }[]> {
  const [livelli, personale, turni, mensilitaByMese] = await Promise.all([
    listLivelli(),
    listPersonale(),
    listTurni(),
    Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        listMensilita(`${anno}-${String(index + 1).padStart(2, "0")}`)
      )
    ),
  ])
  return mensilitaByMese.map((mensilita, index) => {
    const mese = `${anno}-${String(index + 1).padStart(2, "0")}`
    const dati = ripartoMese(mese, livelli, personale, turni, mensilita)
    return { mese, righe: dati.reparti, collaboratori: dati.righe }
  })
}
