import type { Request, Response } from "express"
import {
  deleteLivello,
  deletePersonale,
  deleteTurno,
  insertTurno,
  listLivelli,
  listPersonale,
  listTurni,
  nominativo,
  upsertLivello,
  upsertMensilita,
  upsertPersonale,
  upsertPresenza,
} from "../store/libro-paga-db.js"
import { importLibroPagaDump } from "../services/libro-paga-import.js"
import { livelloSottoAlbero, personaleVisibile } from "../services/libro-paga-scope.js"
import { buildLibroPagaSnapshot, defaultMeseLpaga, isYmLpaga } from "../services/libro-paga-snapshot.js"
import {
  applicaAutoOkConvalida,
  arricchisciTornelloConvalida,
  FOGLI_ORARI_CONVALIDA,
  payloadConvalidaMese,
  proponeConvalidaMese,
  turniNelMesePerConvalida,
  upsertTurnoConvalida,
  getDeleghe,
  setDeleghe,
  type TurnoConvalidaStato,
} from "../services/libro-paga-convalida.js"
import { setPersonalePassword } from "../store/libro-paga-auth.js"
import { parseQualifichePersonale, type LpagaRuolo } from "../store/libro-paga-db.js"
import { enrichPersonaleHr, syncIstruttoreCalendarioHr } from "../services/libro-paga-hr.js"

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
  return isYmLpaga(s)
}

function defaultMese(): string {
  return defaultMeseLpaga()
}

export async function getLibroPaga(req: Request, res: Response) {
  try {
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYm(meseRaw) ? meseRaw : defaultMese()
    const repartoId = String(req.query.reparto ?? "").trim()
    const livelli = await listLivelli()
    const livelloTree = repartoId ? livelloSottoAlbero(livelli, repartoId) : undefined
    res.json(await buildLibroPagaSnapshot({ mese, livelloTree }))
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
    const username = String(req.body?.username ?? "").trim().toLowerCase()
    const password = String(req.body?.password ?? "")
    if (username) {
      const all = await listPersonale()
      if (all.some((p) => (p.username ?? "").toLowerCase() === username)) {
        return res.status(409).json({ message: "Username già in uso" })
      }
      if (!password) return res.status(400).json({ message: "Password obbligatoria per l'accesso a Libro paga" })
    }
    const ruoloRaw = String(req.body?.ruolo ?? "user").toLowerCase()
    const ruolo: LpagaRuolo = ruoloRaw === "admin" || ruoloRaw === "manager" ? ruoloRaw : "user"
    const row = await upsertPersonale({
      nome,
      cognome: String(req.body?.cognome ?? "").trim(),
      username,
      ruolo,
      livelloId: String(req.body?.livelloId ?? "").trim(),
      contratto: String(req.body?.contratto ?? "").trim(),
      iban: String(req.body?.iban ?? "").trim(),
      tesseramento: String(req.body?.tesseramento ?? "").trim(),
      tesseramentoScadenza: String(req.body?.tesseramentoScadenza ?? "").trim(),
      qualifiche: parseQualifichePersonale(req.body?.qualifiche),
      attivo: req.body?.attivo !== false,
    })
    syncIstruttoreCalendarioHr(row)
    if (username && password) await setPersonalePassword(row.id, username, password)
    const [enriched] = await enrichPersonaleHr([row])
    res.status(201).json({ personale: enriched ?? row })
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
    const username =
      req.body?.username != null ? String(req.body.username).trim().toLowerCase() : cur.username ?? ""
    const password = req.body?.password != null ? String(req.body.password) : ""
    if (username && username !== (cur.username ?? "").toLowerCase()) {
      if (all.some((p) => p.id !== id && (p.username ?? "").toLowerCase() === username)) {
        return res.status(409).json({ message: "Username già in uso" })
      }
    }
    const row = await upsertPersonale({
      id,
      nome,
      cognome: req.body?.cognome != null ? String(req.body.cognome).trim() : cur.cognome,
      username,
      ruolo,
      livelloId: req.body?.livelloId != null ? String(req.body.livelloId).trim() : cur.livelloId,
      contratto: req.body?.contratto != null ? String(req.body.contratto).trim() : cur.contratto,
      iban: req.body?.iban != null ? String(req.body.iban).trim() : cur.iban,
      tesseramento:
        req.body?.tesseramento != null ? String(req.body.tesseramento).trim() : cur.tesseramento,
      tesseramentoScadenza:
        req.body?.tesseramentoScadenza != null
          ? String(req.body.tesseramentoScadenza).trim()
          : cur.tesseramentoScadenza,
      qualifiche: req.body?.qualifiche != null ? parseQualifichePersonale(req.body.qualifiche) : cur.qualifiche,
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

export async function putPersonalePassword(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    const password = String(req.body?.password ?? "")
    const all = await listPersonale()
    const cur = all.find((x) => x.id === id)
    if (!cur) return res.status(404).json({ message: "Persona non trovata" })
    if (!cur.username) return res.status(400).json({ message: "Username obbligatorio per la password" })
    await setPersonalePassword(cur.id, cur.username, password)
    res.json({ ok: true })
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

export async function getLibroPagaConvalida(req: Request, res: Response) {
  try {
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYm(meseRaw) ? meseRaw : defaultMese()
    const personaleId = String(req.query.personaleId ?? "").trim()
    if (!personaleId) return res.status(400).json({ message: "Persona obbligatoria" })
    const [personale, livelli, turniTutti] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
    const pe = personale.find((p) => p.id === personaleId)
    if (!pe) return res.status(404).json({ message: "Persona non trovata" })
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const repartoId = String(req.query.reparto ?? "").trim()
    const tree = repartoId ? livelloSottoAlbero(livelli, repartoId) : undefined
    const turni = turniNelMesePerConvalida({
      mese,
      turni: turniTutti,
      personale,
      livelli,
      tree,
      personaleId,
    })
    const rows = await arricchisciTornelloConvalida(
      mese,
      proponeConvalidaMese({ mese, turni, personaleById: perBy }),
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

export async function getLibroPagaConvalidaMese(req: Request, res: Response) {
  try {
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYm(meseRaw) ? meseRaw : defaultMese()
    const [personale, livelli, turniTutti] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const repartoId = String(req.query.reparto ?? "").trim()
    const tree = repartoId ? livelloSottoAlbero(livelli, repartoId) : undefined
    const turni = turniNelMesePerConvalida({ mese, turni: turniTutti, personale, livelli, tree })
    const rows = await arricchisciTornelloConvalida(
      mese,
      proponeConvalidaMese({ mese, turni, personaleById: perBy }),
      perBy
    )
    res.json(payloadConvalidaMese(mese, rows))
  } catch (e) {
    fail(res, e)
  }
}

export async function postLibroPagaConvalidaMese(req: Request, res: Response) {
  try {
    const meseRaw = String(req.body?.mese ?? req.query.mese ?? "").trim()
    const mese = isYm(meseRaw) ? meseRaw : defaultMese()
    const [personale, livelli, turniTutti] = await Promise.all([listPersonale(), listLivelli(), listTurni()])
    const perBy = new Map(personale.map((p) => [p.id, p]))
    const repartoId = String(req.body?.reparto ?? req.query.reparto ?? "").trim()
    const tree = repartoId ? livelloSottoAlbero(livelli, repartoId) : undefined
    const turni = turniNelMesePerConvalida({ mese, turni: turniTutti, personale, livelli, tree })
    const rows = await arricchisciTornelloConvalida(
      mese,
      proponeConvalidaMese({ mese, turni, personaleById: perBy }),
      perBy
    )
    const confermatiOra = applicaAutoOkConvalida(rows, String(req.user?.nome || req.user?.username || "admin"))
    const aggiornate = await arricchisciTornelloConvalida(
      mese,
      proponeConvalidaMese({ mese, turni, personaleById: perBy }),
      perBy
    )
    res.json(payloadConvalidaMese(mese, aggiornate, { confermatiOra }))
  } catch (e) {
    fail(res, e)
  }
}

export async function putLibroPagaConvalidaTurno(req: Request, res: Response) {
  try {
    const turnoId = String(req.body?.turnoId ?? "").trim()
    const statoRaw = String(req.body?.stato ?? "").trim()
    const stato = (["ok", "sostituzione", "non_svolta", "da_verificare"].includes(statoRaw)
      ? statoRaw
      : "") as TurnoConvalidaStato | ""
    if (!turnoId || !stato) return res.status(400).json({ message: "Turno e stato obbligatori" })
    const turni = await listTurni()
    if (!turni.some((x) => x.id === turnoId)) return res.status(404).json({ message: "Turno non trovato" })
    const row = upsertTurnoConvalida({
      turnoId,
      stato,
      nota: String(req.body?.nota ?? "").trim(),
      sostitutoNome: String(req.body?.sostitutoNome ?? "").trim(),
      da: String(req.user?.nome || req.user?.username || "admin"),
    })
    res.json({ convalida: row })
  } catch (e) {
    fail(res, e)
  }
}

export async function getLibroPagaDeleghe(req: Request, res: Response) {
  try {
    const managerId = String(req.query.managerId ?? "").trim()
    if (!managerId) return res.status(400).json({ message: "Responsabile obbligatorio" })
    res.json({ managerId, deleghe: getDeleghe(managerId) })
  } catch (e) {
    fail(res, e)
  }
}

export async function putLibroPagaDeleghe(req: Request, res: Response) {
  try {
    const managerId = String(req.body?.managerId ?? "").trim()
    if (!managerId) return res.status(400).json({ message: "Responsabile obbligatorio" })
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
