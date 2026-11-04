import type { NextFunction, Request, Response } from "express"
import { deletePersonale, deleteTurno, getTurno, insertTurno, isLpagaTeamRuolo, listLivelli, listMensilita, listPersonale, listTurni, mergePersonaleLivelli, messaggioQuantitaTurno, parseLpagaRuolo, updateTurno, upsertMensilita, upsertPersonale, nominativo, parseQualifichePersonale, normalizeLpagaEmail, type LpagaPersonale } from "../store/libro-paga-db.js"
import { importaTurniExcel, patchLivello, postLivello, removeLivello } from "./libroPaga.js"
import { bearerLpaga, deletePersonaleCredentials, loginLpaga, logoutLpaga, meLpaga, setPersonalePassword, type LpagaSessionUser } from "../store/libro-paga-auth.js"
import {
  getDeleghe,
  removePersonaleDaDeleghe,
  alberoDaDeleghe,
  alberoConvalidaViewer,
  applicaAutoOkConvalida,
  arricchisciTornelloConvalida,
  FOGLI_ORARI_CONVALIDA,
  optionsScopeConvalida,
  payloadConvalidaMese,
  proponeConvalidaMese,
  setDeleghe,
  treePerScopeConvalida,
  turniNelMesePerConvalida,
  turnoIdsFromBody,
  upsertTurnoConvalida,
  viewerPuoConvalidare,
  assertMeseTurniModificabili,
  isMeseBloccato,
  meseDaGiorno,
  meseTurniCompletamenteConvalidati,
  maybeAutoBloccaMese,
  setMeseBloccato,
  statoMeseBlocco,
  type TurnoConvalidaStato,
} from "../services/libro-paga-convalida.js"
import { alberoAssegnabileAnagrafica, livelliInseribili, livelliAssegnabiliAnagrafica, personaleRaggiungibile, personaleVisibile, personaleVisibilitaIds, resolveLivelloTree, turnoNelScope } from "../services/libro-paga-scope.js"
import { buildLibroPagaSnapshot, defaultMeseLpaga, fondereBonificoPerimetro, isYmLpaga, oggiRomaYmd, roundLpaga2 } from "../services/libro-paga-snapshot.js"
import { assertPuoModificarePersonale, enrichPersonaleHr, syncIstruttoreCalendarioHr } from "../services/libro-paga-hr.js"
import { canVedereReportCollaboratoriLpaga } from "../lib/report-collaboratori-access.js"

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

async function idsTurniDelMese(mese: string): Promise<string[]> {
  const turni = await listTurni()
  return turni.filter((t) => t.giorno.slice(0, 7) === mese).map((t) => t.id)
}

async function autoBloccaMeseSeCompleto(mese: string, da: string): Promise<boolean> {
  if (!isYmLpaga(mese)) return false
  return maybeAutoBloccaMese(mese, await idsTurniDelMese(mese), da)
}

export async function requireLpaga(req: Request, res: Response, next: NextFunction) {
  const token = bearerLpaga(req)
  if (!token) return res.status(401).json({ message: "Token mancante" })
  const user = await meLpaga(token)
  if (!user) return res.status(401).json({ message: "Sessione Libro paga scaduta" })
  req.lpaga = user
  next()
}

export function requireLpagaAdmin(req: Request, res: Response, next: NextFunction) {
  const u = req.lpaga
  if (!u) return res.status(401).json({ message: "Sessione Libro paga mancante" })
  if (u.ruolo !== "admin") {
    return res.status(403).json({ message: "Solo l’amministratore libro paga può gestire i livelli" })
  }
  next()
}

export function requireLpagaTeam(req: Request, res: Response, next: NextFunction) {
  const u = req.lpaga
  if (!u) return res.status(401).json({ message: "Sessione Libro paga mancante" })
  if (!isLpagaTeamRuolo(u.ruolo)) {
    return res.status(403).json({ message: "Solo responsabile, coordinatore o admin può gestire i livelli" })
  }
  next()
}

async function assertLpagaLivelloWritable(
  me: LpagaSessionUser | LpagaPersonale,
  opts: { livelloId?: string; parentId?: string; creating?: boolean }
) {
  if (me.ruolo === "admin") return
  const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
  const scoped = scopeMe(me as LpagaSessionUser, personale)
  const tree = alberoAssegnabileAnagrafica(scoped, livelli)
  const roots = personaleVisibilitaIds(scoped)
  const consentito = (id: string) => Boolean(id) && (tree.has(id) || roots.includes(id))
  if (opts.creating && !opts.parentId) {
    const err = new Error("Il responsabile può creare livelli solo sotto i propri reparti")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
  if (opts.parentId && !consentito(opts.parentId)) {
    const err = new Error("Padre fuori dalle tue deleghe")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
  if (opts.livelloId && !consentito(opts.livelloId)) {
    const err = new Error("Livello fuori dalle tue deleghe")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
}

export async function postLpagaLivello(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const [personale] = await Promise.all([listPersonale()])
    const me = scopeMe(sess, personale)
    await assertLpagaLivelloWritable(me, {
      creating: true,
      parentId: String(req.body?.parentId ?? "").trim(),
    })
  } catch (e) {
    return fail(res, e)
  }
  return postLivello(req, res)
}

export async function patchLpagaLivello(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const me = scopeMe(sess, personale)
    const id = String(req.params.id ?? "").trim()
    const cur = livelli.find((x) => x.id === id)
    const incomingParent = req.body?.parentId != null ? String(req.body.parentId).trim() : ""
    await assertLpagaLivelloWritable(me, {
      livelloId: id,
      parentId:
        incomingParent && incomingParent !== (cur?.parentId ?? "")
          ? incomingParent
          : undefined,
    })
  } catch (e) {
    return fail(res, e)
  }
  return patchLivello(req, res)
}

export async function removeLpagaLivello(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const [personale] = await Promise.all([listPersonale()])
    const me = scopeMe(sess, personale)
    await assertLpagaLivelloWritable(me, { livelloId: String(req.params.id ?? "").trim() })
  } catch (e) {
    return fail(res, e)
  }
  return removeLivello(req, res)
}

/** Report collaboratori sportivi: admin del libro paga (Alberto) o nominativo Alberto. */
export function requireLpagaAlberto(req: Request, res: Response, next: NextFunction) {
  const u = req.lpaga
  if (!u) return res.status(401).json({ message: "Sessione Libro paga mancante" })
  if (!canVedereReportCollaboratoriLpaga(u)) {
    return res.status(403).json({ message: "Pagina riservata ad admin del libro paga e Alberto" })
  }
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

/** Scope da anagrafica (tutti i livelloIds), non solo il primo livelloId della sessione. */
function scopeMe(me: LpagaSessionUser, personale: LpagaPersonale[]): LpagaPersonale | LpagaSessionUser {
  return personale.find((p) => p.id === me.id) ?? me
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
    const sess = viewer(req)
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const [personaleAll, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const me = scopeMe(sess, personaleAll)
    const repartoId = String(req.query.reparto ?? "").trim()
    let livelloTree = resolveLivelloTree(me, livelli, me.ruolo === "admin" ? repartoId : undefined)
    let visibleIds = me.ruolo === "user" ? new Set([me.id]) : undefined
    if (me.ruolo === "manager" || me.ruolo === "coordinator") {
      visibleIds = personaleVisibile(me, personaleAll, livelli)
    }
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
      turniSoloAlbero: me.ruolo === "coordinator",
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
    const sess = viewer(req)
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const me = scopeMe(sess, personale)
    const tree = resolveLivelloTree(me, livelli)
    let personaleId = String(req.body?.personaleId ?? "").trim()
    if (me.ruolo === "user") personaleId = me.id
    const pe = personale.find((p) => p.id === personaleId)
    if (!pe) return res.status(400).json({ message: "Persona non trovata" })
    const livelloId = String(req.body?.livelloId ?? "").trim()
    const consentiti = new Set(livelliInseribili(me, livelli, tree).map((l) => l.id))
    if (personaleId !== me.id && tree && !tree.has(livelloId)) {
      return res.status(400).json({ message: "Mansione non consentita" })
    }
    if (!consentiti.has(livelloId)) return res.status(400).json({ message: "Mansione non consentita" })
    const giornoRaw = String(req.body?.giorno ?? "").trim()
    const oggi = oggiRomaYmd()
    const giorno = me.ruolo === "user" ? oggi : giornoRaw
    if (me.ruolo === "user" && isYmd(giornoRaw) && giornoRaw !== oggi) {
      return res.status(403).json({ message: "Puoi inserire turni solo per la data odierna (entro mezzanotte)" })
    }
    const quantita = Number(String(req.body?.quantita ?? "").replace(",", "."))
    if (!isYmd(giorno)) return res.status(400).json({ message: "Data non valida" })
    const livello = livelli.find((x) => x.id === livelloId)
    if (!livello) return res.status(400).json({ message: "Mansione non trovata" })
    const qErr = messaggioQuantitaTurno(livello, quantita)
    if (qErr) return res.status(400).json({ message: qErr })
    assertMeseTurniModificabili(meseDaGiorno(giorno), me.ruolo)
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

export async function patchLpagaTurno(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const me = scopeMe(sess, personale)
    if (!isLpagaTeamRuolo(me.ruolo)) {
      return res.status(403).json({ message: "Solo responsabile, coordinatore o admin può modificare i turni" })
    }
    const id = String(req.params.id ?? "").trim()
    const cur = await getTurno(id)
    if (!cur) return res.status(404).json({ message: "Turno non trovato" })
    const tree = resolveLivelloTree(me, livelli)
    if (!turnoNelScope(cur, { viewerId: me.id, ruolo: me.ruolo, tree })) {
      return res.status(403).json({ message: "Non puoi modificare questo turno" })
    }
    const personaleId = String(req.body?.personaleId ?? cur.personaleId).trim()
    if (me.ruolo !== "admin") {
      const vis = personaleVisibile(me, personale, livelli)
      if (!vis.has(personaleId)) return res.status(403).json({ message: "Persona fuori dal tuo reparto" })
    }
    const livelloId = String(req.body?.livelloId ?? cur.livelloId).trim()
    const consentiti = new Set(livelliInseribili(me, livelli, tree).map((l) => l.id))
    if (personaleId !== me.id && tree && !tree.has(livelloId) && livelloId !== cur.livelloId) {
      return res.status(400).json({ message: "Mansione non consentita" })
    }
    if (!consentiti.has(livelloId) && livelloId !== cur.livelloId) {
      return res.status(400).json({ message: "Mansione non consentita" })
    }
    const giorno = String(req.body?.giorno ?? cur.giorno).trim()
    const quantita = Number(String(req.body?.quantita ?? cur.quantita).replace(",", "."))
    if (!isYmd(giorno)) return res.status(400).json({ message: "Data non valida" })
    const livello = livelli.find((x) => x.id === livelloId)
    if (!livello) return res.status(400).json({ message: "Mansione non trovata" })
    const qErr = messaggioQuantitaTurno(livello, quantita)
    if (qErr) return res.status(400).json({ message: qErr })
    assertMeseTurniModificabili(meseDaGiorno(cur.giorno), me.ruolo)
    assertMeseTurniModificabili(meseDaGiorno(giorno), me.ruolo)
    const row = await updateTurno(id, {
      personaleId,
      livelloId,
      giorno,
      quantita,
      note: req.body?.note != null ? String(req.body.note) : cur.note,
    })
    res.json({ turno: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function postLpagaImportTurniExcel(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const rows = Array.isArray(req.body?.righe) ? req.body.righe : []
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const me = scopeMe(sess, personale)
    if (!isLpagaTeamRuolo(me.ruolo)) {
      return res.status(403).json({ message: "Importazione riservata ad amministratori, responsabili e coordinatori" })
    }
    const tree = resolveLivelloTree(me, livelli)
    const scope = me.ruolo === "admin"
      ? undefined
      : {
          personaleIds: personaleVisibile(me, personale, livelli),
          livelloIds: new Set(livelliInseribili(me, livelli, tree).map((livello) => livello.id)),
        }
    const result = await importaTurniExcel(rows, me.username || me.id, {
      ...scope,
      skipMesiBloccati: me.ruolo !== "admin",
    })
    res.json(result)
  } catch (e) {
    fail(res, e)
  }
}

export async function removeLpagaTurno(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const id = String(req.params.id ?? "").trim()
    const [personale, livelli] = await Promise.all([listPersonale(), listLivelli()])
    const me = scopeMe(sess, personale)
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
    assertMeseTurniModificabili(meseDaGiorno(t.giorno), me.ruolo)
    await deleteTurno(id)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaMensilita(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const [personale, livelli, turni] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
    const me = scopeMe(sess, personale)
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
    if (!personaleId) return res.status(400).json({ message: "Persona obbligatoria" })
    if (!isYmLpaga(mese)) return res.status(400).json({ message: "Mese non valido" })
    const perimetro = resolveLivelloTree(me, livelli)
    const meseTurni = turni.filter((t) => t.personaleId === personaleId && t.giorno.slice(0, 7) === mese)
    const importoPersonaMese = roundLpaga2(meseTurni.reduce((s, t) => s + t.importo, 0))
    const importoPerimetro = perimetro
      ? roundLpaga2(meseTurni.filter((t) => perimetro.has(t.livelloId)).reduce((s, t) => s + t.importo, 0))
      : importoPersonaMese
    const saved = (await listMensilita(mese)).find((m) => m.personaleId === personaleId)
    const rawBonifico = req.body?.bonifico
    const bonificoInserito =
      rawBonifico === undefined || rawBonifico === null || rawBonifico === ""
        ? undefined
        : Number(rawBonifico)
    if (bonificoInserito !== undefined && (!Number.isFinite(bonificoInserito) || bonificoInserito < 0)) {
      return res.status(400).json({ message: "Importo non valido" })
    }
    const bonifico =
      bonificoInserito === undefined
        ? (saved?.bonifico ?? 0)
        : fondereBonificoPerimetro(
            importoPerimetro,
            importoPersonaMese,
            saved?.bonifico,
            bonificoInserito
          )
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
  if (!isLpagaTeamRuolo(me.ruolo)) {
    const err = new Error("Solo amministratore, responsabile o coordinatore può gestire gli utenti")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
}

function livelliFromBody(body: Record<string, unknown>) {
  const ids = Array.isArray(body.livelloIds)
    ? body.livelloIds.map((x) => String(x).trim()).filter(Boolean)
    : undefined
  const livelloId = body.livelloId != null ? String(body.livelloId).trim() : undefined
  return mergePersonaleLivelli(livelloId, ids)
}

function repartiFromBody(body: Record<string, unknown>): { repartoIds?: string[] } {
  if (body.repartoIds == null) return {}
  const ids = Array.isArray(body.repartoIds)
    ? body.repartoIds.map((x) => String(x).trim()).filter(Boolean)
    : []
  return { repartoIds: [...new Set(ids)] }
}

function idsLivelli(assigned: { livelloId?: string; livelloIds?: string[] }): string[] {
  if (assigned.livelloIds?.length) return assigned.livelloIds
  return assigned.livelloId ? [assigned.livelloId] : []
}

function assertLivelliAnagraficaConsentiti(
  me: Pick<LpagaPersonale, "ruolo" | "livelloId" | "livelloIds" | "repartoIds">,
  livelli: Awaited<ReturnType<typeof listLivelli>>,
  assigned: { livelloId?: string; livelloIds?: string[] },
  giaAssegnati: string[] = []
) {
  if (me.ruolo !== "manager" && me.ruolo !== "coordinator") return
  const tree = alberoAssegnabileAnagrafica(me, livelli)
  const ids = idsLivelli(assigned)
  const gia = new Set(giaAssegnati)
  if (!ids.length || ids.some((id) => !tree.has(id) && !gia.has(id))) {
    const err = new Error("Puoi modificare utenti solo nel tuo reparto")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
}

function livelliPatchNelPerimetro(
  me: Pick<LpagaPersonale, "ruolo" | "livelloId" | "livelloIds" | "repartoIds">,
  livelli: Awaited<ReturnType<typeof listLivelli>>,
  cur: Pick<LpagaPersonale, "livelloId" | "livelloIds">,
  incoming: { livelloId?: string; livelloIds?: string[] }
): { livelloId?: string; livelloIds?: string[] } {
  const tree = alberoAssegnabileAnagrafica(me, livelli)
  const esistenti = idsLivelli(mergePersonaleLivelli(cur.livelloId, cur.livelloIds))
  const scelti = idsLivelli(incoming)
  const fuori = esistenti.filter((id) => !tree.has(id))
  const dentro = scelti.filter((id) => tree.has(id))
  return mergePersonaleLivelli(undefined, [...fuori, ...dentro])
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
    if (me.ruolo === "manager" || me.ruolo === "coordinator") ruoloRaw = "user"
    const ruolo = parseLpagaRuolo(ruoloRaw)
    const livelliAssegnati = livelliFromBody(req.body ?? {})
    const livelliFinali =
      livelliAssegnati.livelloId || (livelliAssegnati.livelloIds && livelliAssegnati.livelloIds.length)
        ? livelliAssegnati
        : mergePersonaleLivelli(me.livelloId, me.livelloIds)
    if (me.ruolo === "manager" || me.ruolo === "coordinator") {
      try {
        assertLivelliAnagraficaConsentiti(me, livelli, livelliFinali)
      } catch (e) {
        return res.status(403).json({ message: (e as Error).message })
      }
    }
    const visibilita = me.ruolo === "admin" ? repartiFromBody(req.body ?? {}) : {}
    const row = await upsertPersonale({
      nome,
      cognome: String(req.body?.cognome ?? "").trim(),
      username,
      ruolo,
      ...livelliFinali,
      ...visibilita,
      contratto: String(req.body?.contratto ?? "").trim(),
      iban: String(req.body?.iban ?? "").trim(),
      email: normalizeLpagaEmail(req.body?.email),
      tesseramento: String(req.body?.tesseramento ?? "").trim(),
      tesseramentoScadenza: String(req.body?.tesseramentoScadenza ?? "").trim(),
      ...(me.ruolo === "admin"
        ? {
            visitaMedica: String(req.body?.visitaMedica ?? "").trim(),
            qualifiche: parseQualifichePersonale(req.body?.qualifiche),
          }
        : {}),
      attivo: true,
    })
    syncIstruttoreCalendarioHr(row)
    await setPersonalePassword(row.id, username, password)
    const [enriched] = await enrichPersonaleHr([row])
    res.status(201).json({ personale: enriched ?? row })
  } catch (e) {
    fail(res, e)
  }
}

export async function patchLpagaPersonale(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const id = String(req.params.id ?? "").trim()
    const self = sess.id === id
    if (!self) assertGestionePersonale(sess)
    const [personale, livelli, turni] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
    const me = scopeMe(sess, personale)
    const vis = personaleRaggiungibile(me, personale, livelli, turni)
    const incoming =
      req.body?.livelloIds != null || req.body?.livelloId != null ? livelliFromBody(req.body ?? {}) : {}
    const tree = alberoAssegnabileAnagrafica(me, livelli)
    const entraNelPerimetro = idsLivelli(incoming).some((x) => tree.has(x))
    if (!vis.has(id) && !self && !entraNelPerimetro) {
      return res.status(403).json({
        message:
          "Non puoi modificare questo utente: non è nel tuo reparto (né in anagrafica né per i turni).",
      })
    }
    const cur = personale.find((p) => p.id === id)
    if (!cur) return res.status(404).json({ message: "Persona non trovata" })
    const password = req.body?.password != null ? String(req.body.password) : ""
    if (self && me.ruolo === "user") {
      const email = req.body?.email != null ? normalizeLpagaEmail(req.body.email) : cur.email ?? ""
      const iban = req.body?.iban != null ? String(req.body.iban).trim() : cur.iban ?? ""
      const row = await upsertPersonale({
        id,
        nome: cur.nome,
        cognome: cur.cognome,
        username: cur.username,
        ruolo: cur.ruolo,
        livelloId: cur.livelloId,
        livelloIds: cur.livelloIds,
        repartoIds: cur.repartoIds,
        contratto: cur.contratto,
        iban,
        email,
        tesseramento: cur.tesseramento,
        tesseramentoScadenza: cur.tesseramentoScadenza,
        visitaMedica: cur.visitaMedica,
        qualifiche: cur.qualifiche,
        attivo: cur.attivo,
      })
      if (password) {
        if (!row.username) return res.status(400).json({ message: "Username obbligatorio per la password" })
        await setPersonalePassword(row.id, row.username, password)
      }
      const [enriched] = await enrichPersonaleHr([row])
      return res.json({ personale: enriched ?? row })
    }
    const ruoloRaw = req.body?.ruolo != null ? String(req.body.ruolo).toLowerCase() : cur.ruolo
    const ruolo = parseLpagaRuolo(ruoloRaw)
    assertPuoModificarePersonale(me, cur, ruolo)
    let livelliPatch =
      req.body?.livelloIds != null || req.body?.livelloId != null ? livelliFromBody(req.body ?? {}) : {}
    if (me.ruolo === "manager" || me.ruolo === "coordinator") {
      const esistenti = idsLivelli(mergePersonaleLivelli(cur.livelloId, cur.livelloIds))
      const nextLivelli =
        livelliPatch.livelloId || (livelliPatch.livelloIds && livelliPatch.livelloIds.length)
          ? livelliPatchNelPerimetro(me, livelli, cur, livelliPatch)
          : mergePersonaleLivelli(cur.livelloId, cur.livelloIds)
      try {
        assertLivelliAnagraficaConsentiti(me, livelli, nextLivelli, esistenti)
      } catch (e) {
        return res.status(403).json({ message: (e as Error).message })
      }
      if (livelliPatch.livelloId || (livelliPatch.livelloIds && livelliPatch.livelloIds.length)) {
        livelliPatch = nextLivelli
      }
    }
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : cur.nome
    if (!nome) return res.status(400).json({ message: "Nome obbligatorio" })
    const username =
      req.body?.username != null ? String(req.body.username).trim().toLowerCase() : cur.username ?? ""
    if (username && username !== (cur.username ?? "").toLowerCase()) {
      if (personale.some((p) => p.id !== id && (p.username ?? "").toLowerCase() === username)) {
        return res.status(409).json({ message: "Username già in uso" })
      }
    }
    const row = await upsertPersonale({
      id,
      nome,
      cognome: req.body?.cognome != null ? String(req.body.cognome).trim() : cur.cognome,
      username,
      ruolo:
        me.ruolo === "admin" ? ruolo : me.ruolo === "manager" ? (ruolo === "admin" ? cur.ruolo : ruolo) : cur.ruolo,
      ...livelliPatch,
      ...(me.ruolo === "admin" ? repartiFromBody(req.body ?? {}) : {}),
      contratto: req.body?.contratto != null ? String(req.body.contratto).trim() : cur.contratto,
      iban: req.body?.iban != null ? String(req.body.iban).trim() : cur.iban,
      email: req.body?.email != null ? normalizeLpagaEmail(req.body.email) : cur.email,
      tesseramento:
        req.body?.tesseramento != null ? String(req.body.tesseramento).trim() : cur.tesseramento,
      tesseramentoScadenza:
        req.body?.tesseramentoScadenza != null
          ? String(req.body.tesseramentoScadenza).trim()
          : cur.tesseramentoScadenza,
      visitaMedica:
        me.ruolo === "admin" && req.body?.visitaMedica != null
          ? String(req.body.visitaMedica).trim()
          : cur.visitaMedica,
      qualifiche:
        me.ruolo === "admin" && req.body?.qualifiche != null
          ? parseQualifichePersonale(req.body.qualifiche)
          : cur.qualifiche,
      attivo: req.body?.attivo != null ? Boolean(req.body.attivo) : cur.attivo,
    })
    if (req.body?.tesseramento != null || req.body?.tesseramentoScadenza != null || req.body?.qualifiche != null) {
      syncIstruttoreCalendarioHr(row)
    }
    if (password) {
      if (!row.username) return res.status(400).json({ message: "Username obbligatorio per la password" })
      await setPersonalePassword(row.id, row.username, password)
    }
    const [enriched] = await enrichPersonaleHr([row])
    res.json({ personale: enriched ?? row })
  } catch (e) {
    fail(res, e)
  }
}

export async function removeLpagaPersonale(req: Request, res: Response) {
  try {
    const me = viewer(req)
    if (me.ruolo !== "admin") {
      return res.status(403).json({ message: "Solo l'amministratore può eliminare un utente" })
    }
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Persona mancante" })
    if (id === me.id) return res.status(400).json({ message: "Non puoi eliminare il tuo utente" })
    const personale = await listPersonale()
    const cur = personale.find((p) => p.id === id)
    if (!cur) return res.status(404).json({ message: "Persona non trovata" })
    await deletePersonale(id)
    deletePersonaleCredentials(id)
    removePersonaleDaDeleghe(id)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaPersonalePassword(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    assertGestionePersonale(sess)
    const id = String(req.params.id ?? "").trim()
    const password = String(req.body?.password ?? "")
    const [personale, livelli, turni] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
    const me = scopeMe(sess, personale)
    const vis = personaleRaggiungibile(me, personale, livelli, turni)
    if (!vis.has(id)) {
      return res.status(403).json({
        message:
          "Non puoi modificare questo utente: non è nel tuo reparto (né in anagrafica né per i turni).",
      })
    }
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

async function loadConvalidaScope(sess: LpagaSessionUser) {
  const [personale, livelli, turni] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
  const me = scopeMe(sess, personale)
  if (!viewerPuoConvalidare(me, personale)) {
    const err = new Error("Non puoi convalidare le mensilità")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
  const tree = alberoConvalidaViewer(me, personale, livelli)
  const ids = personaleRaggiungibile(me, personale, livelli, turni, tree)
  return { personale, livelli, turni, tree, ids, me }
}

function filtriConvalidaMese(
  req: Request,
  tree: Set<string> | undefined,
  me: { ruolo: string; livelloId?: string; livelloIds?: string[]; repartoIds?: string[] },
  livelli: import("../store/libro-paga-db.js").LpagaLivello[]
) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const scopeId = String(req.query.scope ?? body.scope ?? req.query.reparto ?? body.reparto ?? "").trim()
  const from = String(req.query.from ?? body.from ?? "").trim()
  const to = String(req.query.to ?? body.to ?? "").trim()
  const scopedTree = treePerScopeConvalida(livelli, tree, scopeId)
  const roots =
    me.ruolo === "admin"
      ? livelli.filter((l) => !l.parentId).map((l) => l.id)
      : personaleVisibilitaIds(me)
  const scopeOpzioni = optionsScopeConvalida(livelli, roots, tree)
  return { scopeId, from, to, tree: scopedTree, scopeOpzioni }
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
    const rows = await arricchisciTornelloConvalida(
      mese,
      await proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy }),
      perBy
    )
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
    const sess = viewer(req)
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const { personale, livelli, turni, tree, ids, me } = await loadConvalidaScope(sess)
    const filtri = filtriConvalidaMese(req, tree, me, livelli)
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const scoped = turniNelMesePerConvalida({
      mese,
      turni,
      personale,
      livelli,
      tree: filtri.tree,
      personaleIds: ids,
      from: filtri.from,
      to: filtri.to,
    })
    const rows = await arricchisciTornelloConvalida(
      mese,
      await proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy }),
      perBy
    )
    res.json(
      payloadConvalidaMese(mese, rows, {
        scopeId: filtri.scopeId,
        from: filtri.from,
        to: filtri.to,
        scopeOpzioni: filtri.scopeOpzioni,
      })
    )
  } catch (e) {
    fail(res, e)
  }
}

export async function postLpagaConvalidaMese(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const meseRaw = String(req.body?.mese ?? req.query.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const { personale, livelli, turni, tree, ids, me } = await loadConvalidaScope(sess)
    const filtri = filtriConvalidaMese(req, tree, me, livelli)
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const scoped = turniNelMesePerConvalida({
      mese,
      turni,
      personale,
      livelli,
      tree: filtri.tree,
      personaleIds: ids,
      from: filtri.from,
      to: filtri.to,
    })
    const rows = await arricchisciTornelloConvalida(
      mese,
      await proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy }),
      perBy
    )
    if (isMeseBloccato(mese) && me.ruolo !== "admin") {
      return res.status(403).json({ message: "Mese chiuso dopo le convalide: solo un amministratore può modificarlo." })
    }
    const confermatiOra = applicaAutoOkConvalida(rows, sess.nominativo || sess.username || sess.id)
    await autoBloccaMeseSeCompleto(mese, sess.nominativo || sess.username || sess.id)
    const aggiornate = await arricchisciTornelloConvalida(
      mese,
      await proponeConvalidaMese({ mese, turni: scoped, personaleById: perBy }),
      perBy
    )
    res.json(
      payloadConvalidaMese(mese, aggiornate, {
        confermatiOra,
        scopeId: filtri.scopeId,
        from: filtri.from,
        to: filtri.to,
        scopeOpzioni: filtri.scopeOpzioni,
      })
    )
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaConvalidaTurno(req: Request, res: Response) {
  try {
    const me = viewer(req)
    const ids = turnoIdsFromBody(req.body)
    const statoRaw = String(req.body?.stato ?? "").trim()
    const stato = (["ok", "sostituzione", "non_svolta", "da_verificare"].includes(statoRaw)
      ? statoRaw
      : "") as TurnoConvalidaStato | ""
    if (!ids.length || !stato) return res.status(400).json({ message: "Turno e stato obbligatori" })
    const turni = await listTurni()
    const byId = new Map(turni.map((x) => [x.id, x]))
    const found = ids.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    if (!found.length) return res.status(404).json({ message: "Turno non trovato" })
    const da = me.nominativo || me.username || me.id
    const nota = String(req.body?.nota ?? "").trim()
    const sostitutoNome = String(req.body?.sostitutoNome ?? "").trim()
    const scope = await loadConvalidaScope(me)
    const rows = []
    const mesi = new Set<string>()
    for (const t of found) {
      if (!scope.ids.has(t.personaleId)) {
        return res.status(403).json({
          message: me.ruolo === "user" ? "Fuori dalla delega di convalida" : "Persona fuori dal tuo reparto",
        })
      }
      if (scope.tree && !scope.tree.has(t.livelloId)) {
        return res.status(403).json({ message: "Turno fuori dal tuo reparto" })
      }
      const mese = meseDaGiorno(t.giorno)
      if (isMeseBloccato(mese) && me.ruolo !== "admin") {
        return res.status(403).json({ message: "Mese chiuso dopo le convalide: solo un amministratore può modificarlo." })
      }
      rows.push(
        upsertTurnoConvalida({
          turnoId: t.id,
          stato,
          nota,
          sostitutoNome,
          da,
        })
      )
      mesi.add(mese)
    }
    for (const mese of mesi) await autoBloccaMeseSeCompleto(mese, da)
    res.json({ convalida: rows[0], n: rows.length })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLpagaMeseBlocco(req: Request, res: Response) {
  try {
    const sess = viewer(req)
    const personale = await listPersonale()
    const me = scopeMe(sess, personale)
    const meseRaw = String(req.body?.mese ?? "").trim()
    const mese = isYmLpaga(meseRaw) ? meseRaw : defaultMeseLpaga()
    const bloccato = Boolean(req.body?.bloccato)
    const da = sess.nominativo || sess.username || sess.id
    const ids = await idsTurniDelMese(mese)
    if (bloccato) {
      if (!isLpagaTeamRuolo(me.ruolo)) {
        return res.status(403).json({ message: "Solo responsabile, coordinatore o admin può chiudere il mese" })
      }
      if (!meseTurniCompletamenteConvalidati(ids)) {
        return res.status(400).json({
          message: "Prima conferma tutti i turni del mese (anche gli altri reparti). Poi il mese si può chiudere.",
        })
      }
      setMeseBloccato(mese, true, da)
    } else {
      if (me.ruolo !== "admin") {
        return res.status(403).json({ message: "Solo un amministratore può sbloccare il mese in casi eccezionali" })
      }
      setMeseBloccato(mese, false, da)
    }
    res.json({ mese, meseBlocco: statoMeseBlocco(mese, ids) })
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
