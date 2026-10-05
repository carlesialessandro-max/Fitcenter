import type { Request, Response } from "express"
import {
  deleteLivello,
  deletePersonale,
  deleteTurno,
  dominioLivello,
  ensureLibroPagaStorage,
  insertTurno,
  listLivelli,
  listMacroQuote,
  listMensilita,
  listPersonale,
  listPresenze,
  listTotaliReparto,
  listTurni,
  listValidazioni,
  nominativo,
  upsertLivello,
  upsertMensilita,
  upsertPersonale,
  upsertPresenza,
} from "../store/libro-paga-db.js"
import { importLibroPagaDump } from "../services/libro-paga-import.js"
import type { LpagaRuolo } from "../store/libro-paga-db.js"

function statusOf(e: unknown): number {
  const n = (e as { status?: number })?.status
  return typeof n === "number" && n >= 400 && n < 600 ? n : 500
}

function fail(res: Response, e: unknown) {
  const msg = (e as Error)?.message ?? "Errore"
  return res.status(statusOf(e)).json({ message: msg })
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isYm(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s)
}

function defaultMese(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(
      new Date()
    )
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}

export async function getLibroPaga(req: Request, res: Response) {
  try {
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYm(meseRaw) ? meseRaw : defaultMese()
    const storage = await ensureLibroPagaStorage()
    const [livelli, personale, turni, savedMens, validazioni, totaliReparto, macroQuote] = await Promise.all([
      listLivelli(),
      listPersonale(),
      listTurni(mese),
      listMensilita(mese),
      listValidazioni(),
      listTotaliReparto(),
      listMacroQuote(),
    ])
    const presenze = await listPresenze(turni.map((t) => t.id))
    const presenzaByTurno = new Map(presenze.map((p) => [p.turnoId, p]))
    const livById = new Map(livelli.map((x) => [x.id, x]))
    const perById = new Map(personale.map((x) => [x.id, x]))
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
          iban: pe?.iban ?? "",
          mese,
          ore: Math.round(agg.ore * 100) / 100,
          importo: Math.round(agg.importo * 100) / 100,
          presenzaOre: Math.round(agg.presenzaOre * 100) / 100,
          nTurni: agg.nTurni,
          nControllati: agg.nControllati,
          bonifico: saved?.bonifico ?? Math.round(agg.importo * 100) / 100,
          nota: saved?.nota ?? "",
          chiuso: saved?.chiuso ?? false,
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

    const costiMesi = totaliReparto
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
    const donutMese = totaliReparto.find((t) => t.mese === mese)
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

    const miscDonut = macroQuote.map((q) => {
      const ids = new Set<string>([q.livelloId])
      const walk = (id: string) => {
        ids.add(id)
        for (const l of livelli) if (l.parentId === id) walk(l.id)
      }
      walk(q.livelloId)
      const valore = turniOut.filter((t) => ids.has(t.livelloId)).reduce((s, t) => s + t.importo, 0)
      return { label: q.nome, value: Math.round(valore * 100) / 100 }
    })

    res.json({
      storage,
      mese,
      livelli: livelliOut,
      personale: personaleOut,
      turni: turniOut,
      mensilita,
      convalide,
      tree,
      macroQuote,
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
      },
    })
  } catch (e) {
    fail(res, e)
  }
}

export async function postImportDump(_req: Request, res: Response) {
  try {
    const result = await importLibroPagaDump()
    res.json(result)
  } catch (e) {
    fail(res, e)
  }
}

export async function postLivello(req: Request, res: Response) {
  try {
    const nome = String(req.body?.nome ?? "").trim()
    if (!nome) return res.status(400).json({ message: "Nome obbligatorio" })
    const retribuzione = Number(req.body?.retribuzione)
    if (!Number.isFinite(retribuzione) || retribuzione < 0) {
      return res.status(400).json({ message: "Retribuzione non valida" })
    }
    const row = await upsertLivello({
      nome,
      parentId: String(req.body?.parentId ?? "").trim() || undefined,
      retribuzione,
      fissa: Boolean(req.body?.fissa),
      retribuibile: req.body?.retribuibile !== false,
      statistica: Boolean(req.body?.statistica),
      speciale: Boolean(req.body?.speciale),
      attivo: req.body?.attivo !== false,
    })
    res.status(201).json({ livello: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function patchLivello(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    const all = await listLivelli()
    const cur = all.find((x) => x.id === id)
    if (!cur) return res.status(404).json({ message: "Livello non trovato" })
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : cur.nome
    if (!nome) return res.status(400).json({ message: "Nome obbligatorio" })
    const retribuzione = req.body?.retribuzione != null ? Number(req.body.retribuzione) : cur.retribuzione
    if (!Number.isFinite(retribuzione) || retribuzione < 0) {
      return res.status(400).json({ message: "Retribuzione non valida" })
    }
    const row = await upsertLivello({
      id,
      nome,
      parentId: req.body?.parentId != null ? String(req.body.parentId).trim() : cur.parentId,
      retribuzione,
      fissa: req.body?.fissa != null ? Boolean(req.body.fissa) : cur.fissa,
      retribuibile: req.body?.retribuibile != null ? Boolean(req.body.retribuibile) : cur.retribuibile,
      statistica: req.body?.statistica != null ? Boolean(req.body.statistica) : cur.statistica,
      speciale: req.body?.speciale != null ? Boolean(req.body.speciale) : cur.speciale,
      attivo: req.body?.attivo != null ? Boolean(req.body.attivo) : cur.attivo,
    })
    res.json({ livello: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function removeLivello(req: Request, res: Response) {
  try {
    await deleteLivello(String(req.params.id ?? "").trim())
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export async function postPersonale(req: Request, res: Response) {
  try {
    const nome = String(req.body?.nome ?? "").trim()
    if (!nome) return res.status(400).json({ message: "Nome obbligatorio" })
    const ruoloRaw = String(req.body?.ruolo ?? "user").toLowerCase()
    const ruolo: LpagaRuolo = ruoloRaw === "admin" || ruoloRaw === "manager" ? ruoloRaw : "user"
    const row = await upsertPersonale({
      nome,
      cognome: String(req.body?.cognome ?? "").trim(),
      username: String(req.body?.username ?? "").trim(),
      ruolo,
      livelloId: String(req.body?.livelloId ?? "").trim(),
      contratto: String(req.body?.contratto ?? "").trim(),
      iban: String(req.body?.iban ?? "").trim(),
      attivo: req.body?.attivo !== false,
    })
    res.status(201).json({ personale: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function patchPersonale(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    const all = await listPersonale()
    const cur = all.find((x) => x.id === id)
    if (!cur) return res.status(404).json({ message: "Persona non trovata" })
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : cur.nome
    if (!nome) return res.status(400).json({ message: "Nome obbligatorio" })
    const ruoloRaw = req.body?.ruolo != null ? String(req.body.ruolo).toLowerCase() : cur.ruolo
    const ruolo: LpagaRuolo = ruoloRaw === "admin" || ruoloRaw === "manager" ? ruoloRaw : "user"
    const row = await upsertPersonale({
      id,
      nome,
      cognome: req.body?.cognome != null ? String(req.body.cognome).trim() : cur.cognome,
      username: req.body?.username != null ? String(req.body.username).trim() : cur.username,
      ruolo,
      livelloId: req.body?.livelloId != null ? String(req.body.livelloId).trim() : cur.livelloId,
      contratto: req.body?.contratto != null ? String(req.body.contratto).trim() : cur.contratto,
      iban: req.body?.iban != null ? String(req.body.iban).trim() : cur.iban,
      attivo: req.body?.attivo != null ? Boolean(req.body.attivo) : cur.attivo,
    })
    res.json({ personale: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function removePersonale(req: Request, res: Response) {
  try {
    await deletePersonale(String(req.params.id ?? "").trim())
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export async function postTurno(req: Request, res: Response) {
  try {
    const personaleId = String(req.body?.personaleId ?? "").trim()
    const livelloId = String(req.body?.livelloId ?? "").trim()
    const giorno = String(req.body?.giorno ?? "").trim()
    const quantita = Number(req.body?.quantita)
    if (!personaleId || !livelloId) return res.status(400).json({ message: "Persona e livello obbligatori" })
    if (!isYmd(giorno)) return res.status(400).json({ message: "Data non valida" })
    if (!Number.isFinite(quantita) || quantita <= 0 || quantita > 24) {
      return res.status(400).json({ message: "Quantità non valida (1–24)" })
    }
    const row = await insertTurno({
      personaleId,
      livelloId,
      giorno,
      quantita,
      note: String(req.body?.note ?? "").trim(),
      creatoDa: req.user?.nome || req.user?.username || "admin",
    })
    res.status(201).json({ turno: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function removeTurno(req: Request, res: Response) {
  try {
    await deleteTurno(String(req.params.id ?? "").trim())
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export async function putPresenza(req: Request, res: Response) {
  try {
    const turnoId = String(req.params.id ?? "").trim()
    const valore = Number(req.body?.valore)
    if (!turnoId) return res.status(400).json({ message: "Turno mancante" })
    if (!Number.isFinite(valore) || valore < 0 || valore > 24) {
      return res.status(400).json({ message: "Valore presenza non valido" })
    }
    const row = await upsertPresenza({
      turnoId,
      valore,
      controllatoDa: req.user?.nome || req.user?.username || "admin",
    })
    res.json({ presenza: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function putMensilita(req: Request, res: Response) {
  try {
    const personaleId = String(req.body?.personaleId ?? "").trim()
    const mese = String(req.body?.mese ?? "").trim()
    const bonifico = Number(req.body?.bonifico)
    if (!personaleId) return res.status(400).json({ message: "Persona obbligatoria" })
    if (!isYm(mese)) return res.status(400).json({ message: "Mese non valido" })
    if (!Number.isFinite(bonifico) || bonifico < 0) {
      return res.status(400).json({ message: "Importo bonifico non valido" })
    }
    const row = await upsertMensilita({
      personaleId,
      mese,
      bonifico,
      nota: String(req.body?.nota ?? "").trim(),
      chiuso: Boolean(req.body?.chiuso),
    })
    res.json({ mensilita: row })
  } catch (e) {
    fail(res, e)
  }
}
