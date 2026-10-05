import type { Request, Response } from "express"
import {
  deleteLivello,
  deletePersonale,
  deleteTurno,
  ensureLibroPagaStorage,
  insertTurno,
  listLivelli,
  listMensilita,
  listPersonale,
  listPresenze,
  listTurni,
  upsertLivello,
  upsertMensilita,
  upsertPersonale,
  upsertPresenza,
} from "../store/libro-paga-db.js"

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
    const [livelli, personale, turni, savedMens] = await Promise.all([
      listLivelli(),
      listPersonale(),
      listTurni(mese),
      listMensilita(mese),
    ])
    const presenze = await listPresenze(turni.map((t) => t.id))
    const presenzaByTurno = new Map(presenze.map((p) => [p.turnoId, p]))
    const livById = new Map(livelli.map((x) => [x.id, x]))
    const perById = new Map(personale.map((x) => [x.id, x]))
    const turniOut = turni.map((t) => {
      const pr = presenzaByTurno.get(t.id)
      return {
        ...t,
        personaleNome: perById.get(t.personaleId)?.nome ?? "—",
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
        return {
          personaleId,
          personaleNome: perById.get(personaleId)?.nome ?? "—",
          iban: perById.get(personaleId)?.iban ?? "",
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
    res.json({ storage, mese, livelli, personale, turni: turniOut, mensilita })
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
      retribuzione,
      fissa: Boolean(req.body?.fissa),
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
      retribuzione,
      fissa: req.body?.fissa != null ? Boolean(req.body.fissa) : cur.fissa,
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
    const row = await upsertPersonale({
      nome,
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
    const row = await upsertPersonale({
      id,
      nome,
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
