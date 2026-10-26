import {
  cmpPersonaleNomeCognome,
  dominioLivello,
  ensureLibroPagaStorage,
  listLivelli,
  listMacroQuote,
  listMensilita,
  listPersonale,
  listPresenze,
  listTotaliReparto,
  listTurni,
  nominativo,
  repartoNomePersona,
  type LpagaLivello,
  type LpagaPersonale,
} from "../store/libro-paga-db.js"
import { enrichPersonaleHr } from "./libro-paga-hr.js"
import { personaleLivelloRadici } from "./libro-paga-scope.js"
import { buildRiepilogoConvalide, mapTurnoConvalide } from "./libro-paga-convalida.js"

function buildLivelloTreeNodes(
  livelli: LpagaLivello[],
  parentId?: string
): { id: string; nome: string; retribuibile: boolean; attivo: boolean; children?: ReturnType<typeof buildLivelloTreeNodes> }[] {
  const pid = (parentId ?? "").trim()
  return livelli
    .filter((l) => {
      const p = (l.parentId ?? "").trim()
      if (!pid) return !p || p === "0"
      return p === pid
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
    .map((l) => {
      const children = buildLivelloTreeNodes(livelli, l.id)
      return {
        id: l.id,
        nome: l.nome,
        retribuibile: l.retribuibile,
        attivo: l.attivo !== false,
        ...(children.length ? { children } : {}),
      }
    })
}

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

export function roundLpaga2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * Bonifico visibile nel perimetro del responsabile: quota delle lezioni del suo reparto.
 * Il valore salvato è della persona intera (tutti i reparti).
 */
export function bonificoNelPerimetro(
  importoPerimetro: number,
  importoPersonaMese: number,
  bonificoSalvato?: number | null
): number {
  const scoped = roundLpaga2(importoPerimetro)
  const full = roundLpaga2(importoPersonaMese)
  if (bonificoSalvato == null || !Number.isFinite(Number(bonificoSalvato))) return scoped
  const saved = roundLpaga2(bonificoSalvato)
  if (full <= 0 || Math.abs(full - scoped) < 0.005) return saved
  return roundLpaga2(saved * (scoped / full))
}

/** Reintegra la quota degli altri reparti quando il responsabile salva il bonifico del suo perimetro. */
export function fondereBonificoPerimetro(
  importoPerimetro: number,
  importoPersonaMese: number,
  bonificoSalvato: number | null | undefined,
  bonificoInserito: number
): number {
  const scoped = roundLpaga2(importoPerimetro)
  const full = roundLpaga2(importoPersonaMese)
  const inserted = roundLpaga2(bonificoInserito)
  if (full <= 0 || Math.abs(full - scoped) < 0.005) return inserted
  const prev =
    bonificoSalvato != null && Number.isFinite(Number(bonificoSalvato)) ? roundLpaga2(bonificoSalvato) : full
  const prevShare = roundLpaga2(prev * (scoped / full))
  return roundLpaga2(prev - prevShare + inserted)
}

export function oggiRomaYmd(): string {
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
}

export async function buildLibroPagaSnapshot(opts?: {
  mese?: string
  visibleIds?: Set<string>
  livelloTree?: Set<string>
  hideGlobalStats?: boolean
  hideIban?: boolean
  viewerId?: string
}) {
  const mese = opts?.mese && isYmLpaga(opts.mese) ? opts.mese : defaultMeseLpaga()
  const storage = await ensureLibroPagaStorage()
  const [livelli, personaleRaw, turniTutti, savedMens, totaliReparto, macroQuote] = await Promise.all([
    listLivelli(),
    listPersonale(),
    listTurni(),
    listMensilita(mese),
    listTotaliReparto(),
    listMacroQuote(),
  ])
  const personaleAll = await enrichPersonaleHr(personaleRaw)
  const vis = opts?.visibleIds
  const livelloTree = opts?.livelloTree
  const scopedTurni =
    livelloTree && vis
      ? turniTutti.filter((t) => livelloTree.has(t.livelloId) || vis.has(t.personaleId))
      : livelloTree
        ? turniTutti.filter((t) => livelloTree.has(t.livelloId))
        : vis
          ? turniTutti.filter((t) => vis.has(t.personaleId))
          : turniTutti
  const year = mese.slice(0, 4)
  const monthTurniPreview = scopedTurni.filter((t) => t.giorno.slice(0, 7) === mese)
  let personale = personaleAll
  if (vis && !livelloTree) {
    personale = personaleAll.filter((p) => vis.has(p.id))
  } else if (livelloTree) {
    const ids = new Set<string>()
    for (const p of personaleAll) {
      if (personaleLivelloRadici(p).some((id) => livelloTree.has(id))) ids.add(p.id)
    }
    for (const t of monthTurniPreview) ids.add(t.personaleId)
    if (opts?.viewerId) ids.add(opts.viewerId)
    if (vis) for (const id of vis) ids.add(id)
    personale = personaleAll.filter((p) => ids.has(p.id))
  }
  personale = personale.slice().sort(cmpPersonaleNomeCognome)
  const totAnnoBy = new Map<string, number>()
  for (const t of scopedTurni) {
    if (!t.giorno.startsWith(year)) continue
    totAnnoBy.set(t.personaleId, Math.round(((totAnnoBy.get(t.personaleId) ?? 0) + t.importo) * 100) / 100)
  }
  const turni = scopedTurni.filter((t) => t.giorno.slice(0, 7) === mese)
  const fullMeseByPerson = new Map<string, number>()
  if (livelloTree) {
    for (const t of turniTutti) {
      if (t.giorno.slice(0, 7) !== mese) continue
      fullMeseByPerson.set(t.personaleId, (fullMeseByPerson.get(t.personaleId) ?? 0) + t.importo)
    }
  }
  const presenze = await listPresenze(turni.map((t) => t.id))
  const presenzaByTurno = new Map(presenze.map((p) => [p.turnoId, p]))
  const livById = new Map(livelli.map((l) => [l.id, l]))
  const perById = new Map(personaleAll.map((p) => [p.id, p]))
  const todayYmd = oggiRomaYmd()
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
    repartoNome: repartoNomePersona(p, livelli),
    ...(opts?.hideIban ? { iban: p.id === opts.viewerId ? p.iban ?? "" : "" } : {}),
  }))

  const convByTurno = mapTurnoConvalide()
  const turniOut = turni.map((t) => {
    const pr = presenzaByTurno.get(t.id)
    const pe = perById.get(t.personaleId)
    const cv = convByTurno[t.id]
    return {
      ...t,
      personaleNome: pe ? nominativo(pe) : "—",
      livelloNome: livById.get(t.livelloId)?.nome ?? "—",
      presenzaValore: pr?.valore ?? null,
      presenzaDa: pr?.controllatoDa ?? null,
      presenzaAt: pr?.controllatoAt ?? null,
      convalidaStato: cv?.stato ?? null,
      convalidaDa: cv?.da ?? null,
      convalidaAt: cv?.at ?? null,
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
      const scopedImporto = roundLpaga2(agg.importo)
      const fullImporto = roundLpaga2(fullMeseByPerson.get(personaleId) ?? scopedImporto)
      return {
        personaleId,
        personaleNome: pe ? nominativo(pe) : "—",
        iban: opts?.hideIban && personaleId !== opts.viewerId ? "" : pe?.iban ?? "",
        mese,
        ore: roundLpaga2(agg.ore),
        importo: scopedImporto,
        presenzaOre: roundLpaga2(agg.presenzaOre),
        nTurni: agg.nTurni,
        nControllati: agg.nControllati,
        bonifico: livelloTree
          ? bonificoNelPerimetro(scopedImporto, fullImporto, saved?.bonifico)
          : saved?.bonifico ?? scopedImporto,
        nota: saved?.nota ?? "",
        chiuso: saved?.chiuso ?? false,
        totAnno: totAnnoBy.get(personaleId) ?? Math.round(agg.importo * 100) / 100,
      }
    })
    .sort((a, b) => cmpPersonaleNomeCognome(perById.get(a.personaleId) ?? {}, perById.get(b.personaleId) ?? {}))

  const convalideRiepilogo = buildRiepilogoConvalide({
    mese,
    turni: turniOut.map((t) => ({ id: t.id, giorno: t.giorno, livelloId: t.livelloId })),
    personale: personaleAll,
    livelli,
    viewerId: opts?.viewerId,
  })
  const convalide = convalideRiepilogo.responsabili.map((r) => {
    const giornoUltima = r.ultima ? r.ultima.slice(0, 10) : null
    return {
      personaleId: r.personaleId,
      nominativo: r.nominativo,
      reparto: r.reparto,
      ultima: r.ultima,
      okIeri: giornoUltima === yesterday || giornoUltima === todayYmd,
      nTurni: r.nTurni,
      nConfermati: r.nConfermati,
      nDaFare: r.nDaFare,
    }
  })

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
  const tree = buildLivelloTreeNodes(livelli)

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
    convalideRiepilogo,
    reparti: livelli
      .filter((l) => !l.parentId)
      .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
      .map((l) => ({ id: l.id, nome: l.nome })),
    tree,
    macroQuote: opts?.hideGlobalStats ? [] : macroQuote,
    me: viewer
      ? {
          id: viewer.id,
          nominativo: nominativo(viewer),
          ruolo: viewer.ruolo,
          livelloId: viewer.livelloId,
          repartoNome: repartoNomePersona(viewer, livelli),
        }
      : null,
    home: {
      admin: personale.filter((p) => p.ruolo === "admin").length,
      manager: personale.filter((p) => p.ruolo === "manager").length,
      user: personale.filter((p) => p.ruolo === "user").length,
      livelli: livelli.length,
      turniOggi: turni.filter((t) => t.giorno === todayYmd).length,
      convalideOggi: turniOut.filter((t) => (t.convalidaAt ?? "").slice(0, 10) === todayYmd).length,
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
