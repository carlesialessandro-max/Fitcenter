import {
  dominioLivello,
  ensureLibroPagaStorage,
  listLivelli,
  listMacroQuote,
  listMensilita,
  listPersonale,
  listPresenze,
  listTotaliReparto,
  listTurni,
  listValidazioni,
  nominativo,
  type LpagaPersonale,
} from "../store/libro-paga-db.js"

export function defaultMeseLpaga(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(
      new Date()
    )
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}

export function isYmLpaga(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s)
}

export async function buildLibroPagaSnapshot(opts?: {
  mese?: string
  visibleIds?: Set<string>
  hideGlobalStats?: boolean
  hideIban?: boolean
  viewerId?: string
}) {
  const mese = opts?.mese && isYmLpaga(opts.mese) ? opts.mese : defaultMeseLpaga()
  const storage = await ensureLibroPagaStorage()
  const [livelli, personaleAll, turniTutti, savedMens, validazioni, totaliReparto, macroQuote] = await Promise.all([
    listLivelli(),
    listPersonale(),
    listTurni(),
    listMensilita(mese),
    listValidazioni(),
    listTotaliReparto(),
    listMacroQuote(),
  ])
  const vis = opts?.visibleIds
  const personale = vis ? personaleAll.filter((p) => vis.has(p.id)) : personaleAll
  const scopedTurni = vis ? turniTutti.filter((t) => vis.has(t.personaleId)) : turniTutti
  const year = mese.slice(0, 4)
  const totAnnoBy = new Map<string, number>()
  for (const t of scopedTurni) {
    if (!t.giorno.startsWith(year)) continue
    totAnnoBy.set(t.personaleId, Math.round(((totAnnoBy.get(t.personaleId) ?? 0) + t.importo) * 100) / 100)
  }
  const turni = scopedTurni.filter((t) => t.giorno.slice(0, 7) === mese)
  const presenze = await listPresenze(turni.map((t) => t.id))
  const presenzaByTurno = new Map(presenze.map((p) => [p.turnoId, p]))
  const livById = new Map(livelli.map((l) => [l.id, l]))
  const perById = new Map(personaleAll.map((p) => [p.id, p]))
  const todayYmd = (() => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
    } catch {
      return new Date().toISOString().slice(0, 10)
    }
  })()
  const yesterday = (() => {
    const d = new Date(`${todayYmd}T12:00:00`)
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()

  const livelliOut = livelli.map((l) => ({
    ...l,
    parentNome: l.parentId ? livById.get(l.parentId)?.nome ?? "—" : "—",
    dominio: dominioLivello(livelli, l.id),
  }))

  const personaleOut = personale.map((p) => ({
    ...p,
    nominativo: nominativo(p),
    repartoNome: p.livelloId ? livById.get(p.livelloId)?.nome ?? "—" : "—",
    ...(opts?.hideIban ? { iban: p.id === opts.viewerId ? p.iban ?? "" : "" } : {}),
  }))

  const turniOut = turni.map((t) => {
    const pr = presenzaByTurno.get(t.id)
    const pe = perById.get(t.personaleId)
    return {
      ...t,
      personaleNome: pe ? nominativo(pe) : "—",
      livelloNome: livById.get(t.livelloId)?.nome ?? "—",
      presenzaValore: pr?.valore ?? null,
      presenzaDa: pr?.controllatoDa ?? null,
      presenzaAt: pr?.controllatoAt ?? null,
    }
  })

  const byPerson = new Map<
    string,
    { ore: number; importo: number; presenzaOre: number; nTurni: number; nControllati: number }
  >()
  for (const t of turniOut) {
    const cur = byPerson.get(t.personaleId) ?? { ore: 0, importo: 0, presenzaOre: 0, nTurni: 0, nControllati: 0 }
    cur.ore += t.quantita
    cur.importo += t.importo
    cur.nTurni += 1
    if (t.presenzaValore != null) {
      cur.presenzaOre += t.presenzaValore
      cur.nControllati += 1
    }
    byPerson.set(t.personaleId, cur)
  }
  const mensilita = [...byPerson.entries()]
    .map(([personaleId, agg]) => {
      const saved = savedMens.find((m) => m.personaleId === personaleId)
      const pe = perById.get(personaleId)
      return {
        personaleId,
        personaleNome: pe ? nominativo(pe) : "—",
        iban: opts?.hideIban && personaleId !== opts.viewerId ? "" : pe?.iban ?? "",
        mese,
        ore: Math.round(agg.ore * 100) / 100,
        importo: Math.round(agg.importo * 100) / 100,
        presenzaOre: Math.round(agg.presenzaOre * 100) / 100,
        nTurni: agg.nTurni,
        nControllati: agg.nControllati,
        bonifico: saved?.bonifico ?? Math.round(agg.importo * 100) / 100,
        nota: saved?.nota ?? "",
        chiuso: saved?.chiuso ?? false,
        totAnno: totAnnoBy.get(personaleId) ?? Math.round(agg.importo * 100) / 100,
      }
    })
    .sort((a, b) => a.personaleNome.localeCompare(b.personaleNome, "it"))

  const lastValByPerson = new Map<string, { giorno: string; stamp: string }>()
  for (const v of validazioni) {
    const prev = lastValByPerson.get(v.personaleId)
    if (!prev || v.giorno > prev.giorno || (v.giorno === prev.giorno && v.stamp > prev.stamp)) {
      lastValByPerson.set(v.personaleId, { giorno: v.giorno, stamp: v.stamp })
    }
  }
  const convalide = personale
    .filter((p) => p.ruolo === "manager")
    .map((p) => {
      const last = lastValByPerson.get(p.id)
      return {
        personaleId: p.id,
        nominativo: nominativo(p),
        reparto: p.livelloId ? livById.get(p.livelloId)?.nome ?? "—" : "—",
        ultima: last?.stamp ?? null,
        okIeri: last?.giorno === yesterday,
      }
    })
    .sort((a, b) => a.nominativo.localeCompare(b.nominativo, "it"))

  const costiMesi = opts?.hideGlobalStats
    ? []
    : totaliReparto
        .slice()
        .sort((a, b) => a.mese.localeCompare(b.mese))
        .slice(-13)
        .map((t) => ({
          mese: t.mese,
          totale: t.totale,
          piscina: t.piscina,
          palestra: t.palestra,
          ristorante: t.ristorante,
          miscellanea: t.miscellanea,
        }))
  const donutMese = opts?.hideGlobalStats ? undefined : totaliReparto.find((t) => t.mese === mese)
  const tree = livelli
    .filter((l) => !l.parentId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
    .map((root) => ({
      id: root.id,
      nome: root.nome,
      children: livelli
        .filter((l) => l.parentId === root.id)
        .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
        .map((ch) => ({
          id: ch.id,
          nome: ch.nome,
          retribuibile: ch.retribuibile,
          children: livelli
            .filter((l) => l.parentId === ch.id)
            .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
            .map((g) => ({ id: g.id, nome: g.nome, retribuibile: g.retribuibile })),
        })),
    }))

  const miscDonut = opts?.hideGlobalStats
    ? []
    : macroQuote.map((q) => {
        const ids = new Set<string>([q.livelloId])
        const walk = (id: string) => {
          ids.add(id)
          for (const l of livelli) if (l.parentId === id) walk(l.id)
        }
        walk(q.livelloId)
        const valore = turniOut.filter((t) => ids.has(t.livelloId)).reduce((s, t) => s + t.importo, 0)
        return { label: q.nome, value: Math.round(valore * 100) / 100 }
      })

  const mio = opts?.viewerId ? byPerson.get(opts.viewerId) : undefined
  const viewer: LpagaPersonale | undefined = opts?.viewerId
    ? personaleAll.find((p) => p.id === opts.viewerId)
    : undefined

  return {
    storage,
    mese,
    livelli: livelliOut,
    personale: personaleOut,
    turni: turniOut,
    mensilita,
    convalide,
    tree,
    macroQuote: opts?.hideGlobalStats ? [] : macroQuote,
    me: viewer
      ? {
          id: viewer.id,
          nominativo: nominativo(viewer),
          ruolo: viewer.ruolo,
          repartoNome: viewer.livelloId ? livById.get(viewer.livelloId)?.nome ?? "—" : "—",
        }
      : null,
    home: {
      admin: personale.filter((p) => p.ruolo === "admin").length,
      manager: personale.filter((p) => p.ruolo === "manager").length,
      user: personale.filter((p) => p.ruolo === "user").length,
      livelli: livelli.length,
      turniOggi: turni.filter((t) => t.giorno === todayYmd).length,
      convalideOggi: validazioni.filter((v) => v.giorno === todayYmd || v.stamp.slice(0, 10) === todayYmd).length,
      costiMesi,
      donut: donutMese
        ? [
            { label: "piscina", value: donutMese.piscina },
            { label: "fitness", value: donutMese.palestra },
            { label: "aqua", value: donutMese.ristorante },
            { label: "miscellanea", value: donutMese.miscellanea },
          ]
        : [],
      miscDonut,
      mioOre: Math.round((mio?.ore ?? 0) * 100) / 100,
      mioImporto: Math.round((mio?.importo ?? 0) * 100) / 100,
      mioTurni: mio?.nTurni ?? 0,
    },
  }
}
