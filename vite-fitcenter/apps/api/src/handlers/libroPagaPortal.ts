import type { NextFunction, Request, Response } from "express"
import { deleteTurno, insertTurno, listLivelli, listPersonale, listTurni, upsertMensilita, upsertPersonale, nominativo } from "../store/libro-paga-db.js"
import { bearerLpaga, loginLpaga, logoutLpaga, meLpaga, setPersonalePassword, type LpagaSessionUser } from "../store/libro-paga-auth.js"
import {
  getDeleghe,
  alberoDaDeleghe,
  alberoConvalidaViewer,
  applicaAutoOkConvalida,
  FOGLI_ORARI_CONVALIDA,
  payloadConvalidaMese,
  proponeConvalidaMese,
  setDeleghe,
  turniNelMesePerConvalida,
  upsertTurnoConvalida,
  viewerPuoConvalidare,
  type TurnoConvalidaStato,
} from "../services/libro-paga-convalida.js"
import { livelliInseribili, livelliAssegnabiliAnagrafica, personaleRaggiungibile, personaleVisibile, resolveLivelloTree, turnoNelScope } from "../services/libro-paga-scope.js"
import { buildLibroPagaSnapshot, defaultMeseLpaga, isYmLpaga, oggiRomaYmd } from "../services/libro-paga-snapshot.js"
import type { LpagaRuolo } from "../store/libro-paga-db.js"

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
    const [personaleAll, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const repartoId = String(req.query.reparto ?? "").trim()
    let livelloTree = resolveLivelloTree(me, livelli, me.ruolo === "admin" ? repartoId : undefined)
    let visibleIds = me.ruolo === "user" ? new Set([me.id]) : undefined
    if (me.ruolo === "user") {
      const deTree = alberoDaDeleghe(me.id, personaleAll, livelli)
      if (deTree.size) livelloTree = deTree
    }
    const hideGlobal = me.ruolo !== "admin"
    const data = await buildLibroPagaSnapshot({
      mese,
      visibleIds,
      livelloTree,
      hideGlobalStats: hideGlobal,
      hideIban: me.ruolo === "user",
      viewerId: me.id,
    })
    const inseribili = livelliInseribili(me, livelli, me.ruolo === "user" ? undefined : livelloTree)
    const assegnabili = livelliAssegnabiliAnagrafica(me, livelli)
    res.json({
      ...data,
      livelliInseribili: data.livelli.filter((l) => inseribili.some((x) => x.id === l.id)),
      livelliAssegnabili: data.livelli.filter((l) => assegnabili.some((x) => x.id === l.id)),
      canValidate: viewerPuoConvalidare(me, personaleAll),
      deleghe: me.ruolo === "manager" || me.ruolo === "admin" ? getDeleghe(me.id) : [],
    })
  } catch (e) {
    fail(res, e)
  }
}

export async function postLpagaTurno(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const tree = resolveLivelloTree(me, livelli)
    let personaleId = String(req.body?.personaleId ?? "").trim()
    if (me.ruolo === "user") personaleId = me.id
    const pe = personale.find((p) => p.id === personaleId)
    if (!pe) return res.status(400).json({ message: "Persona non trovata" })
    const livelloId = String(req.body?.livelloId ?? "").trim()
    const consentiti = new Set(livelliInseribili(me, livelli, tree).map((l) => l.id))
    if (!consentiti.has(livelloId)) return res.status(400).json({ message: "Mansione non consentita" })
    const giornoRaw = String(req.body?.giorno ?? "").trim()
    const oggi = oggiRomaYmd()
    const giorno = me.ruolo === "user" ? oggi : giornoRaw
    if (me.ruolo === "user" && isYmd(giornoRaw) && giornoRaw !== oggi) {
      return res.status(403).json({ message: "Puoi inserire turni solo per la data odierna (entro mezzanotte)" })
    }
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
    const livelli = await listLivelli()
    const tree = resolveLivelloTree(me, livelli)
    const turni = await listTurni()
    const t = turni.find((x) => x.id === id)
    if (!t) return res.status(404).json({ message: "Turno non trovato" })
    if (!turnoNelScope(t, { viewerId: me.id, ruolo: me.ruolo, tree })) {
      return res.status(403).json({ message: "Non puoi eliminare questo turno" })
    }
    if (me.ruolo === "user" && t.giorno !== oggiRomaYmd()) {
      return res.status(403).json({ message: "Puoi eliminare solo i turni di oggi" })
    }
    await deleteTurno(id)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaMensilita(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const [personale, livelli, turni] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
    const personaleId = String(req.body?.personaleId ?? "").trim()
    const canValidate = viewerPuoConvalidare(me, personale)
    if (me.ruolo === "user" && !canValidate) {
      return res.status(403).json({ message: "Gli istruttori possono solo visualizzare le mensilità" })
    }
    const tree = alberoConvalidaViewer(me, personale, livelli)
    const ids = personaleRaggiungibile(me, personale, livelli, turni, tree)
    if (!ids.has(personaleId)) {
      return res.status(403).json({
        message: me.ruolo === "user" ? "Fuori dalla delega di convalida" : "Mensilità non visibile",
      })
    }
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

function assertGestionePersonale(me: LpagaSessionUser) {
  if (me.ruolo !== "admin" && me.ruolo !== "manager") {
    const err = new Error("Solo amministratore o responsabile può gestire gli utenti")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
}

export async function postLpagaPersonale(req: Request, res: Response) {
  try {
    const me = viewer(req)
    assertGestionePersonale(me)
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const nome = String(req.body?.nome ?? "").trim()
    if (!nome) return res.status(400).json({ message: "Nome obbligatorio" })
    const username = String(req.body?.username ?? "").trim().toLowerCase()
    const password = String(req.body?.password ?? "")
    if (!username) return res.status(400).json({ message: "Username obbligatorio" })
    if (!password) return res.status(400).json({ message: "Password obbligatoria per l'accesso" })
    if (personale.some((p) => (p.username ?? "").toLowerCase() === username)) {
      return res.status(409).json({ message: "Username già in uso" })
    }
    let ruoloRaw = String(req.body?.ruolo ?? "user").toLowerCase()
    if (me.ruolo === "manager") ruoloRaw = "user"
    const ruolo: LpagaRuolo = ruoloRaw === "admin" || ruoloRaw === "manager" ? ruoloRaw : "user"
    let livelloId = String(req.body?.livelloId ?? "").trim()
    if (me.ruolo === "manager") {
      const consentiti = new Set(livelliAssegnabiliAnagrafica(me, livelli).map((l) => l.id))
      if (!livelloId) livelloId = me.livelloId ?? ""
      if (!livelloId || !consentiti.has(livelloId)) {
        return res.status(403).json({ message: "Puoi aggiungere utenti solo nel tuo reparto" })
      }
    }
    const row = await upsertPersonale({
      nome,
      cognome: String(req.body?.cognome ?? "").trim(),
      username,
      ruolo,
      livelloId: livelloId || me.livelloId,
      contratto: String(req.body?.contratto ?? "").trim(),
      iban: String(req.body?.iban ?? "").trim(),
      attivo: true,
    })
    await setPersonalePassword(row.id, username, password)
    res.status(201).json({ personale: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaPersonalePassword(req: Request, res: Response) {
  try {
    const me = viewer(req)
    assertGestionePersonale(me)
    const id = String(req.params.id ?? "").trim()
    const password = String(req.body?.password ?? "")
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const vis = personaleVisibile(me, personale, livelli)
    if (!vis.has(id)) return res.status(403).json({ message: "Utente non visibile" })
    const cur = personale.find((p) => p.id === id)
    if (!cur) return res.status(404).json({ message: "Persona non trovata" })
    if (me.ruolo === "manager" && cur.ruolo === "admin") {
      return res.status(403).json({ message: "Non puoi cambiare la password di un amministratore" })
    }
    if (!cur.username) return res.status(400).json({ message: "Username obbligatorio per la password" })
    await setPersonalePassword(cur.id, cur.username, password)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

async function loadConvalidaScope(me: LpagaSessionUser) {
  const [personale, livelli, turni] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
  if (!viewerPuoConvalidare(me, personale)) {
    const err = new Error("Non puoi convalidare le mensilità")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
  const tree = alberoConvalidaViewer(me, personale, livelli)
  const ids = personaleRaggiungibile(me, personale, livelli, turni, tree)
  return { personale, livelli, turni, tree, ids }
}

async function assertConvalidaTarget(me: LpagaSessionUser, targetId: string) {
  const scope = await loadConvalidaScope(me)
  if (!scope.ids.has(targetId)) {
    const err = new Error(me.ruolo === "user" ? "Fuori dalla delega di convalida" : "Persona fuori dal tuo reparto")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
  return scope
}

export async function getLpagaConvalida(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const personaleId = String(req.query.personaleId ?? "").trim()
    if (!personaleId) return res.status(400).json({ message: "Persona obbligatoria" })
    const { personale, livelli, turni, tree } = await assertConvalidaTarget(me, personaleId)
    const pe = personale.find((p) => p.id === personaleId)
    if (!pe) return res.status(404).json({ message: "Persona non trovata" })
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const scoped = turniNelMesePerConvalida({
      mese,
      turni,
      personale,
      livelli,
      tree,
      personaleId,
    })
    const rows = proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy })
    res.json({
      mese,
      personaleId,
      personaleNome: nominativo(pe),
      rows,
      fogli: FOGLI_ORARI_CONVALIDA,
    })
  } catch (e) {
    fail(res, e)
  }
}

export async function getLpagaConvalidaMese(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const { personale, livelli, turni, tree, ids } = await loadConvalidaScope(me)
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const scoped = turniNelMesePerConvalida({ mese, turni, personale, livelli, tree, personaleIds: ids })
    const rows = proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy })
    res.json(payloadConvalidaMese(mese, rows))
  } catch (e) {
    fail(res, e)
  }
}

export async function postLpagaConvalidaMese(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const meseRaw = String(req.body?.mese ?? req.query.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const { personale, livelli, turni, tree, ids } = await loadConvalidaScope(me)
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const scoped = turniNelMesePerConvalida({ mese, turni, personale, livelli, tree, personaleIds: ids })
    const rows = proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy })
    const confermatiOra = applicaAutoOkConvalida(rows, me.username || me.id)
    const aggiornate = proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy })
    res.json(payloadConvalidaMese(mese, aggiornate, { confermatiOra }))
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaConvalidaTurno(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const turnoId = String(req.body?.turnoId ?? "").trim()
    const statoRaw = String(req.body?.stato ?? "").trim()
    const stato = (["ok", "sostituzione", "non_svolta", "da_verificare"].includes(statoRaw)
      ? statoRaw
      : "") as TurnoConvalidaStato | ""
    if (!turnoId || !stato) return res.status(400).json({ message: "Turno e stato obbligatori" })
    const turni = await listTurni()
    const t = turni.find((x) => x.id === turnoId)
    if (!t) return res.status(404).json({ message: "Turno non trovato" })
    const { tree } = await assertConvalidaTarget(me, t.personaleId)
    if (tree && !tree.has(t.livelloId)) {
      return res.status(403).json({ message: "Turno fuori dal tuo reparto" })
    }
    const row = upsertTurnoConvalida({
      turnoId,
      stato,
      nota: String(req.body?.nota ?? "").trim(),
      sostitutoNome: String(req.body?.sostitutoNome ?? "").trim(),
      da: me.username || me.id,
    })
    res.json({ convalida: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaDeleghe(req: Request, res: Response) {
  try {
    const me = viewer(req)
    if (me.ruolo !== "admin" && me.ruolo !== "manager") {
      return res.status(403).json({ message: "Solo responsabile o admin può delegare" })
    }
    const managerId = me.ruolo === "admin" ? String(req.body?.managerId ?? me.id).trim() : me.id
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const mgr = personale.find((p) => p.id === managerId)
    if (!mgr || (mgr.ruolo !== "manager" && mgr.ruolo !== "admin")) {
      return res.status(400).json({ message: "Responsabile non valido" })
    }
    const vis = personaleVisibile(mgr, personale, livelli)
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x)) : []).filter(
      (id: string) => id && id !== managerId && vis.has(id)
    )
    const deleghe = setDeleghe(managerId, ids)
    res.json({ managerId, deleghe })
  } catch (e) {
    fail(res, e)
  }
}

export async function getLpagaDeleghe(req: Request, res: Response) {
  try {
    const me = viewer(req)
    if (me.ruolo !== "admin" && me.ruolo !== "manager") {
      return res.status(403).json({ message: "Solo responsabile o admin" })
    }
    const managerId = me.ruolo === "admin" ? String(req.query.managerId ?? me.id).trim() : me.id
    res.json({ managerId, deleghe: getDeleghe(managerId) })
  } catch (e) {
    fail(res, e)
  }
}
