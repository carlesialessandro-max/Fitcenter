import type { Request, Response } from "express"
import {
  deleteLivello,
  deletePersonale,
  deleteTurno,
  insertTurno,
  listLivelli,
  listPersonale,
  upsertLivello,
  upsertMensilita,
  upsertPersonale,
  upsertPresenza,
} from "../store/libro-paga-db.js"
import { importLibroPagaDump } from "../services/libro-paga-import.js"
import { buildLibroPagaSnapshot, defaultMeseLpaga, isYmLpaga } from "../services/libro-paga-snapshot.js"
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
  return isYmLpaga(s)
}

function defaultMese(): string {
  return defaultMeseLpaga()
}

export async function getLibroPaga(req: Request, res: Response) {
  try {
    const meseRaw = String(req.query.mese ?? "").trim()
    const mese = isYm(meseRaw) ? meseRaw : defaultMese()
    res.json(await buildLibroPagaSnapshot({ mese }))
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
