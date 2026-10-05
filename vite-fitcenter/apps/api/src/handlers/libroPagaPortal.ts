import type { NextFunction, Request, Response } from "express"
import { deleteTurno, insertTurno, listLivelli, listPersonale, listTurni, upsertMensilita } from "../store/libro-paga-db.js"
import { bearerLpaga, loginLpaga, logoutLpaga, meLpaga, type LpagaSessionUser } from "../store/libro-paga-auth.js"
import { livelliInseribili, personaleVisibile } from "../services/libro-paga-scope.js"
import { buildLibroPagaSnapshot, defaultMeseLpaga, isYmLpaga } from "../services/libro-paga-snapshot.js"

function statusOf(e: unknown): number {
  const n = (e as { status?: number })?.status
  return typeof n === "number" && n >= 400 && n < 600 ? n : 500
}

function fail(res: Response, e: unknown) {
  return res.status(statusOf(e)).json({ message: (e as Error)?.message ?? "Errore" })
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function requireLpaga(req: Request, res: Response, next: NextFunction) {
  const token = bearerLpaga(req)
  if (!token) return res.status(401).json({ message: "Token mancante" })
  const user = await meLpaga(token)
  if (!user) return res.status(401).json({ message: "Sessione Libro paga scaduta" })
  req.lpaga = user
  next()
}

function viewer(req: Request): LpagaSessionUser {
  const u = req.lpaga
  if (!u) {
    const err = new Error("Sessione Libro paga mancante")
    ;(err as Error & { status?: number }).status = 401
    throw err
  }
  return u
}

export async function postLpagaLogin(req: Request, res: Response) {
  try {
    const username = String(req.body?.username ?? "")
    const password = String(req.body?.password ?? "")
    const ok = await loginLpaga(username, password)
    if (!ok) return res.status(401).json({ message: "Username o password non validi" })
    res.json(ok)
  } catch (e) {
    fail(res, e)
  }
}

export async function postLpagaLogout(req: Request, res: Response) {
  const token = bearerLpaga(req)
  if (token) logoutLpaga(token)
  res.json({ ok: true })
}

export async function getLpagaMe(req: Request, res: Response) {
  try {
    res.json({ user: viewer(req) })
  } catch (e) {
    fail(res, e)
  }
}

export async function getLpagaSnapshot(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const visibleIds = personaleVisibile(me, personale, livelli)
    const hideGlobal = me.ruolo !== "admin"
    const data = await buildLibroPagaSnapshot({
      mese,
      visibleIds,
      hideGlobalStats: hideGlobal,
      hideIban: me.ruolo === "user",
      viewerId: me.id,
    })
    const inseribili = livelliInseribili(me, livelli)
    res.json({
      ...data,
      livelliInseribili: data.livelli.filter((l) => inseribili.some((x) => x.id === l.id)),
    })
  } catch (e) {
    fail(res, e)
  }
}

export async function postLpagaTurno(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const vis = personaleVisibile(me, personale, livelli)
    let personaleId = String(req.body?.personaleId ?? "").trim()
    if (me.ruolo === "user") personaleId = me.id
    if (!vis.has(personaleId)) return res.status(403).json({ message: "Non puoi inserire turni per questa persona" })
    const livelloId = String(req.body?.livelloId ?? "").trim()
    const consentiti = new Set(livelliInseribili(me, livelli).map((l) => l.id))
    if (!consentiti.has(livelloId)) return res.status(400).json({ message: "Mansione non consentita" })
    const giorno = String(req.body?.giorno ?? "").trim()
    const quantita = Number(req.body?.quantita)
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
      creatoDa: me.username || me.id,
    })
    res.status(201).json({ turno: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function removeLpagaTurno(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const id = String(req.params.id ?? "").trim()
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const vis = personaleVisibile(me, personale, livelli)
    const turni = await listTurni()
    const t = turni.find((x) => x.id === id)
    if (!t) return res.status(404).json({ message: "Turno non trovato" })
    if (!vis.has(t.personaleId)) return res.status(403).json({ message: "Non puoi eliminare questo turno" })
    await deleteTurno(id)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaMensilita(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const vis = personaleVisibile(me, personale, livelli)
    const personaleId = String(req.body?.personaleId ?? "").trim()
    if (me.ruolo === "user" && personaleId !== me.id) {
      return res.status(403).json({ message: "Puoi modificare solo la tua mensilità" })
    }
    if (!vis.has(personaleId)) return res.status(403).json({ message: "Mensilità non visibile" })
    const mese = String(req.body?.mese ?? "").trim()
    const bonifico = Number(req.body?.bonifico)
    if (!personaleId) return res.status(400).json({ message: "Persona obbligatoria" })
    if (!isYmLpaga(mese)) return res.status(400).json({ message: "Mese non valido" })
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
