import fs from "fs"
import path from "path"
import type { Request, Response } from "express"
import {
  allocateQuote,
  ammCostiStore,
  BUSTA_DEFAULT_REPARTO,
  macroIdOf,
  pdfDir,
  type AmmQuota,
  type AmmSpesa,
  type AmmTipoCosto,
} from "../store/amministrazione-costi.js"
import { trovaPerNominativo, trovaRigaPerNominativo } from "../lib/nominativo-match.js"
import { parseFatturaText } from "../services/amministrazione-ocr.js"
import {
  centriCostoPredefinitiCollaboratori,
  collaboratoriDaMensilita,
  costiCollaboratoriAnno,
} from "../services/amministrazione-lpaga.js"
import {
  isCorsoId,
  isMacroCommerciale,
  isMacroServizi,
  isMacroStruttura,
  MACRO_COMMERCIALI,
  periodoIso,
  ordinaDettaglioRicavi,
  queryRicaviAmm,
  quoteRipartoFissi,
  splitEuro,
  type MacroCommerciale,
} from "../services/amministrazione-ricavi.js"
import { defaultRepartoFor, parseStipendiPdf } from "../services/amministrazione-stipendi-pdf.js"
import {
  labelCompetenza,
  ripartoCompetenza,
  spesaNellAnno,
  spesaNelMese,
} from "../services/amministrazione-utenze-competenza.js"
import { dominioLivello, listLivelli, listPersonale, nominativo } from "../store/libro-paga-db.js"
import { FIC_DEFAULT_REPARTO, ficStore } from "../store/fattureincloud.js"
import {
  classificaFatturaEmessa,
  listAcquistiMese,
  listCompanies,
  listFattureEmessePeriodo,
  pickCompany,
  publicStatus,
  resolvedConfig,
  riepilogoFattureAmm,
  shiftIsoDays,
} from "../services/fattureincloud.js"

function fail(res: Response, e: unknown) {
  const status = (e as { status?: number })?.status
  const code = typeof status === "number" && status >= 400 && status < 600 ? status : 500
  return res.status(code).json({ message: (e as Error)?.message ?? "Errore" })
}

function withCompetenza(s: AmmSpesa, meseFiltro = "") {
  const parts = ripartoCompetenza(s)
  const mesi = parts.map((p) => p.mese)
  const importoNelMese = /^\d{4}-\d{2}$/.test(meseFiltro)
    ? Math.round(parts.filter((p) => p.mese === meseFiltro).reduce((n, p) => n + p.importo, 0) * 100) / 100
    : s.totale
  return {
    ...s,
    competenzaMesi: mesi,
    competenzaLabel: labelCompetenza(mesi),
    importoNelMese,
  }
}

function quoteOfCollaboratore(
  nominativo: string,
  quote: AmmQuota[] = [],
  centriCostoLibroPaga?: Map<string, string>
): AmmQuota[] {
  const repartoId = repartoOfCollaboratore(nominativo, centriCostoLibroPaga)
  return repartoId ? [{ repartoId, percentuale: 100 }] : quote
}

function quoteTurniCollaboratore(
  nominativo: string,
  righe: { nome: string; quote: AmmQuota[]; nTurni: number }[]
): AmmQuota[] | undefined {
  return trovaRigaPerNominativo(
    righe.filter((item) => item.nTurni > 0 && item.quote?.length),
    (item) => item.nome,
    nominativo
  )?.quote
}

function repartoLibroPagaCollaboratore(
  nominativo: string,
  centriCostoLibroPaga?: Map<string, string>
): string | undefined {
  return trovaPerNominativo(centriCostoLibroPaga, nominativo)
}

function repartoOfCollaboratore(
  nominativo: string,
  centriCostoLibroPaga?: Map<string, string>
): string | undefined {
  return (
    repartoLibroPagaCollaboratore(nominativo, centriCostoLibroPaga) ??
    ammCostiStore.repartoCollaboratore(nominativo)
  )
}

async function centriCostoCollaboratoriDaLibroPaga(): Promise<Map<string, string>> {
  const reparti = ammCostiStore.listReparti(true)
  const dettagli = await centriCostoPredefinitiCollaboratori()
  return new Map(
    [...dettagli].map(([nominativo, repartoId]) => [nominativo, macroIdOf(reparti, repartoId)])
  )
}

function bodyOf(req: Request): Record<string, unknown> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const b = req.body as Record<string, unknown>
    if (typeof b.payload === "string") {
      try {
        return JSON.parse(b.payload) as Record<string, unknown>
      } catch {
        return b
      }
    }
    return b
  }
  return {}
}

function quoteFrom(raw: unknown): AmmQuota[] {
  if (!Array.isArray(raw)) return []
  return raw.map((q) => ({
    repartoId: String((q as AmmQuota)?.repartoId ?? "").trim(),
    percentuale: Number(String((q as AmmQuota)?.percentuale ?? "").replace(",", ".")),
  }))
}

export function getAmmReparti(_req: Request, res: Response) {
  try {
    res.json({
      reparti: ammCostiStore.listReparti(true),
      fornitori: ammCostiStore.listFornitori(),
      fornitoriQuote: ammCostiStore.listFornitoriQuoteMeta(),
    })
  } catch (e) {
    fail(res, e)
  }
}

export function putAmmReparto(req: Request, res: Response) {
  try {
    const row = ammCostiStore.upsertReparto({
      id: String(req.body?.id ?? req.params.id ?? "").trim() || undefined,
      nome: String(req.body?.nome ?? ""),
      codice: req.body?.codice != null ? String(req.body.codice) : undefined,
      tipo: req.body?.tipo,
      livello: req.body?.livello,
      macroId: req.body?.macroId != null ? String(req.body.macroId) : undefined,
      note: req.body?.note != null ? String(req.body.note) : undefined,
      attivo: req.body?.attivo,
      ordine: req.body?.ordine != null ? Number(req.body.ordine) : undefined,
    })
    res.json({ reparto: row })
  } catch (e) {
    fail(res, e)
  }
}

export function getAmmSpese(req: Request, res: Response) {
  try {
    ammCostiStore.riapplicaQuoteFornitoriNoti()
    ammCostiStore.riapplicaQuotePiscinaEstate()
    const mese = String(req.query.mese ?? "").trim()
    const q = String(req.query.q ?? "").trim().toLowerCase()
    let rows = ammCostiStore.listSpese()
    if (/^\d{4}-\d{2}$/.test(mese)) rows = rows.filter((s) => spesaNelMese(s, mese))
    else if (/^\d{4}$/.test(mese)) rows = rows.filter((s) => spesaNellAnno(s, mese))
    if (q) {
      rows = rows.filter(
        (s) =>
          s.fornitore.toLowerCase().includes(q) ||
          s.numeroDocumento.toLowerCase().includes(q) ||
          s.descrizione.toLowerCase().includes(q)
      )
    }
    res.json({ spese: rows.map((s) => withCompetenza(s, mese)) })
  } catch (e) {
    fail(res, e)
  }
}

function spesaFromBody(b: Record<string, unknown>, id?: string): Parameters<typeof ammCostiStore.upsertSpesa>[0] {
  return {
    id,
    fornitore: String(b.fornitore ?? ""),
    numeroDocumento: String(b.numeroDocumento ?? ""),
    dataDocumento: String(b.dataDocumento ?? ""),
    descrizione: String(b.descrizione ?? ""),
    totale: Number(String(b.totale ?? "").replace(",", ".")),
    tipoCosto: (b.tipoCosto === "variabile" ? "variabile" : "fisso") as AmmTipoCosto,
    quote: quoteFrom(b.quote),
    origine:
      b.origine === "ocr"
        ? "ocr"
        : b.origine === "excel"
          ? "excel"
          : b.origine === "fattureincloud"
            ? "fattureincloud"
            : b.origine === "manuale"
              ? "manuale"
              : undefined,
    ficId: b.ficId != null ? Number(b.ficId) : undefined,
    rememberQuote: b.rememberQuote === false ? false : b.rememberQuote === true ? true : undefined,
    quoteEccezione:
      b.rememberQuote === true ? undefined : b.rememberQuote === false || b.quoteEccezione === true ? true : undefined,
  }
}

export function postAmmImport(req: Request, res: Response) {
  try {
    const righe = Array.isArray(req.body?.righe) ? req.body.righe : []
    if (!righe.length) return res.status(400).json({ message: "Nessuna riga da importare" })
    let inserite = 0
    let saltate = 0
    const errori: { riga: number; message: string }[] = []
    righe.forEach((raw: Record<string, unknown>, i: number) => {
      const riga = Number(raw.riga) || i + 1
      try {
        const fornitore = String(raw.fornitore ?? "").trim()
        const numeroDocumento = String(raw.numeroDocumento ?? "").trim()
        const dataDocumento = String(raw.dataDocumento ?? "").slice(0, 10)
        const totale = Number(String(raw.totale ?? "").replace(",", "."))
        const dup = ammCostiStore.findDuplicate(fornitore, numeroDocumento, dataDocumento, totale)
        if (dup) {
          saltate += 1
          return
        }
        const quoteIn = quoteFrom(raw.quote)
        const quote = quoteIn.length ? quoteIn : ammCostiStore.quoteForFornitore(fornitore, dataDocumento)
        ammCostiStore.upsertSpesa({
          fornitore,
          numeroDocumento,
          dataDocumento,
          descrizione: String(raw.descrizione ?? ""),
          totale,
          tipoCosto: raw.tipoCosto === "variabile" ? "variabile" : "fisso",
          quote,
          origine: "excel",
        })
        inserite += 1
      } catch (e) {
        errori.push({ riga, message: (e as Error)?.message ?? "Riga non valida" })
      }
    })
    res.json({ inserite, saltate, errori })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmSpesa(req: Request, res: Response) {
  try {
    const b = bodyOf(req)
    const row = ammCostiStore.upsertSpesa(spesaFromBody(b))
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (file?.buffer?.length) {
      const name = `${row.id}.pdf`
      fs.writeFileSync(path.join(pdfDir(), name), file.buffer)
      ammCostiStore.setPdf(row.id, name)
      row.pathPdf = name
    }
    res.json({ spesa: ammCostiStore.getSpesa(row.id) })
  } catch (e) {
    fail(res, e)
  }
}

export function putAmmSpesa(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id mancante" })
    const cur = ammCostiStore.getSpesa(id)
    if (!cur) return res.status(404).json({ message: "Spesa non trovata" })
    const b = bodyOf(req)
    const row = ammCostiStore.upsertSpesa(spesaFromBody({ ...cur, ...b }, id))
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (file?.buffer?.length) {
      const name = `${row.id}.pdf`
      fs.writeFileSync(path.join(pdfDir(), name), file.buffer)
      ammCostiStore.setPdf(row.id, name)
    }
    res.json({ spesa: ammCostiStore.getSpesa(row.id) })
  } catch (e) {
    fail(res, e)
  }
}

export function deleteAmmSpesa(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id mancante" })
    ammCostiStore.deleteSpesa(id)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export function getAmmSpesaPdf(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    const row = ammCostiStore.getSpesa(id)
    if (!row?.pathPdf) return res.status(404).json({ message: "Nessun PDF" })
    const fp = path.join(pdfDir(), path.basename(row.pathPdf))
    if (!fs.existsSync(fp)) return res.status(404).json({ message: "File non trovato" })
    res.setHeader("Content-Type", "application/pdf")
    res.sendFile(fp)
  } catch (e) {
    fail(res, e)
  }
}

function dettaglioBusteFromBody(
  value: unknown,
): { nominativo: string; totale: number }[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value)) {
    throw Object.assign(new Error("Dettaglio dipendenti non valido"), { status: 400 })
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw Object.assign(new Error("Riga di dettaglio dipendente non valida"), { status: 400 })
    }
    const row = raw as Record<string, unknown>
    return {
      nominativo: String(row.nominativo ?? ""),
      totale: Number(String(row.totale ?? "").replace(",", ".")),
    }
  })
}

function bustaFromBody(b: Record<string, unknown>, id?: string): Parameters<typeof ammCostiStore.upsertBusta>[0] {
  let quote = quoteFrom(b.quote)
  if (!quote.length && b.repartoId) {
    quote = [{ repartoId: String(b.repartoId), percentuale: 100 }]
  }
  if (!quote.length) quote = [{ repartoId: BUSTA_DEFAULT_REPARTO, percentuale: 100 }]
  return {
    id,
    nominativo: String(b.nominativo ?? ""),
    mese: String(b.mese ?? "").slice(0, 7),
    descrizione: String(b.descrizione ?? ""),
    totale: Number(String(b.totale ?? "").replace(",", ".")),
    quote,
    origine: b.origine === "mastrino" ? "mastrino" : b.origine === "pdf" ? "pdf" : "manuale",
    dettaglioDipendenti: dettaglioBusteFromBody(b.dettaglioDipendenti),
  }
}

export function getAmmBuste(req: Request, res: Response) {
  try {
    const mese = String(req.query.mese ?? "").trim()
    let rows = ammCostiStore.listBuste()
    if (/^\d{4}-\d{2}$/.test(mese)) rows = rows.filter((b) => b.mese === mese)
    else if (/^\d{4}$/.test(mese)) rows = rows.filter((b) => b.mese.startsWith(mese))
    res.json({ buste: rows })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmBusta(req: Request, res: Response) {
  try {
    const row = ammCostiStore.upsertBusta(bustaFromBody(bodyOf(req)))
    res.json({ busta: row })
  } catch (e) {
    fail(res, e)
  }
}

export function putAmmBusta(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id mancante" })
    const cur = ammCostiStore.getBusta(id)
    if (!cur) return res.status(404).json({ message: "Busta paga non trovata" })
    const row = ammCostiStore.upsertBusta(bustaFromBody({ ...cur, ...bodyOf(req) }, id))
    res.json({ busta: row })
  } catch (e) {
    fail(res, e)
  }
}

export function deleteAmmBusta(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id mancante" })
    ammCostiStore.deleteBusta(id)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmBusteImport(req: Request, res: Response) {
  try {
    const righe = Array.isArray(req.body?.righe) ? req.body.righe : []
    if (!righe.length) return res.status(400).json({ message: "Nessuna riga da importare" })
    let inserite = 0
    let saltate = 0
    const errori: { riga: number; message: string }[] = []
    righe.forEach((raw: Record<string, unknown>, i: number) => {
      const riga = Number(raw.riga) || i + 1
      try {
        const nominativo = String(raw.nominativo ?? "").trim()
        const mese = String(raw.mese ?? "").slice(0, 7)
        const totale = Number(String(raw.totale ?? "").replace(",", "."))
        const dup = ammCostiStore.findBustaDup(nominativo, mese, totale)
        if (dup) {
          saltate += 1
          return
        }
        ammCostiStore.upsertBusta(bustaFromBody({ ...raw, origine: raw.origine === "pdf" ? "pdf" : "mastrino" }))
        inserite += 1
      } catch (e) {
        errori.push({ riga, message: (e as Error)?.message ?? "Riga non valida" })
      }
    })
    res.json({ inserite, saltate, errori })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmBusteConsuntivoImport(req: Request, res: Response) {
  try {
    const raw = req.body?.riga
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return res.status(400).json({ message: "Riga del consuntivo mancante" })
    }
    const riga = raw as Record<string, unknown>
    if (riga.tipo !== "dipendente") {
      return res.status(400).json({ message: "Il PDF non contiene un consuntivo dei dipendenti fissi" })
    }
    const { busta, sostituite } = ammCostiStore.replacePdfBusteMese(
      bustaFromBody({ ...riga, origine: "pdf" }),
    )
    res.json({ inserite: 1, saltate: 0, sostituite, errori: [], busta })
  } catch (e) {
    fail(res, e)
  }
}

export async function getAmmCollaboratori(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno) || new Date().getFullYear()
    const meseQ = String(req.query.mese ?? "").trim()
    const mese = /^\d{2}$/.test(meseQ) ? `${anno}-${meseQ}` : /^\d{4}-\d{2}$/.test(meseQ) ? meseQ : ""
    const centriCostoLibroPaga = await centriCostoCollaboratoriDaLibroPaga()
    const righeTurniMese = mese ? await collaboratoriDaMensilita(mese) : []
    const rimborsi = ammCostiStore
      .listCollaboratoriRimborsi()
      .filter((r) => (mese ? r.mese === mese : r.mese.startsWith(String(anno))))
      .map((r) => ({
        ...r,
        quote:
          quoteTurniCollaboratore(r.nominativo, righeTurniMese) ??
          quoteOfCollaboratore(r.nominativo, r.quote, centriCostoLibroPaga),
      }))
    const totRimborsi = Math.round(rimborsi.reduce((sum, r) => sum + r.totale, 0) * 100) / 100
    const stored = ammCostiStore
      .listCollaboratori()
      .filter((c) => (mese ? c.mese === mese : c.mese.startsWith(String(anno))) && c.totale > 0)
    const tot = Math.round(stored.reduce((s, c) => s + c.totale, 0) * 100) / 100
    res.json({
      anno,
      mese: mese || null,
      tot,
      totRimborsi,
      rimborsi,
      fonte: stored.length ? "riepilogo" : "nessuno",
      righe: stored.map((c) => ({
        id: c.id,
        nome: c.nominativo,
        importo: c.totale,
        nTurni: 0,
        tipo: c.tipo,
        descrizione: c.descrizione,
        quote:
          quoteTurniCollaboratore(c.nominativo, righeTurniMese) ??
          quoteOfCollaboratore(c.nominativo, c.quote, centriCostoLibroPaga),
        repartoId: repartoOfCollaboratore(c.nominativo, centriCostoLibroPaga),
        repartoDaLibroPaga: Boolean(repartoLibroPagaCollaboratore(c.nominativo, centriCostoLibroPaga)),
        ripartizioneDaTurni: Boolean(quoteTurniCollaboratore(c.nominativo, righeTurniMese)),
      })),
    })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmCollaboratoreCentroCosto(req: Request, res: Response) {
  try {
    const nominativo = String(req.body?.nominativo ?? "").trim()
    const repartoId = String(req.body?.repartoId ?? "").trim()
    if (!nominativo) return res.status(400).json({ message: "Seleziona il collaboratore" })
    const reparto = ammCostiStore.listReparti(true).find((item) => item.id === repartoId)
    if (!reparto || reparto.livello !== "macro") {
      return res.status(400).json({ message: "Seleziona un centro di costo valido" })
    }
    const row = ammCostiStore.setRepartoCollaboratore(nominativo, repartoId)
    res.json({ row })
  } catch (e) {
    fail(res, e)
  }
}

export async function postAmmCollaboratoreRimborso(req: Request, res: Response) {
  try {
    const nominativo = String(req.body?.nominativo ?? "").trim()
    const mese = String(req.body?.mese ?? "").slice(0, 7)
    const totale = Number(String(req.body?.totale ?? "").replace(",", "."))
    const descrizione = String(req.body?.descrizione ?? "").trim()
    if (!nominativo) return res.status(400).json({ message: "Seleziona il collaboratore" })
    if (!/^\d{4}-\d{2}$/.test(mese)) return res.status(400).json({ message: "Mese non valido" })
    if (!descrizione) return res.status(400).json({ message: "Inserisci la descrizione del rimborso" })
    if (!Number.isFinite(totale) || totale <= 0) return res.status(400).json({ message: "Importo non valido" })

    const centriCostoLibroPaga = await centriCostoCollaboratoriDaLibroPaga()
    const righeTurni = await collaboratoriDaMensilita(mese)
    const quoteTurni = quoteTurniCollaboratore(
      nominativo,
      righeTurni
    )
    const stored = ammCostiStore.listCollaboratori().filter((c) => c.mese === mese && c.totale > 0)
    const riepilogo = stored.filter((c) => c.origine === "riepilogo")
    let quote: AmmQuota[] | undefined
    if (quoteTurni) quote = quoteTurni
    const assignedReparto = repartoOfCollaboratore(nominativo, centriCostoLibroPaga)
    if (!quote && assignedReparto) quote = [{ repartoId: assignedReparto, percentuale: 100 }]
    if (riepilogo.length) {
      quote ??= trovaRigaPerNominativo(riepilogo, (c) => c.nominativo, nominativo)?.quote
    } else if (!quote) {
      quote = righeTurni.length
        ? trovaRigaPerNominativo(righeTurni, (c) => c.nome, nominativo)?.quote
        : trovaRigaPerNominativo(stored, (c) => c.nominativo, nominativo)?.quote
    }
    if (!quote?.length) {
      return res.status(400).json({ message: "Collaboratore non trovato nel riepilogo del mese selezionato" })
    }
    const rimborso = ammCostiStore.upsertCollaboratoreRimborso({
      nominativo,
      mese,
      descrizione,
      totale,
      quote,
    })
    res.status(201).json({ rimborso })
  } catch (e) {
    fail(res, e)
  }
}

export function deleteAmmCollaboratoreRimborso(req: Request, res: Response) {
  try {
    ammCostiStore.deleteCollaboratoreRimborso(String(req.params.id ?? ""))
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmStipendiPdf(req: Request, res: Response) {
  try {
    const text = String(req.body?.text ?? "")
    const filename = String(req.body?.filename ?? "")
    const mese = String(req.body?.mese ?? "").slice(0, 7)
    if (text.trim().length < 20) return res.status(400).json({ message: "Testo PDF insufficiente" })
    const parsed = parseStipendiPdf(text, filename, mese)
    const sportivi = parsed.filter((r) => r.tipo === "sportivo")
    const gestionali = parsed.filter((r) => r.tipo === "gestionale")
    const dipendenti = parsed.filter((r) => r.tipo === "dipendente")
    const withQuote = parsed.map((r) => ({
      ...r,
      quote: [{ repartoId: defaultRepartoFor(r), percentuale: 100 }],
    }))
    res.json({
      mese: parsed[0]?.mese || mese,
      sportivi: withQuote.filter((r) => r.tipo === "sportivo"),
      gestionali: withQuote.filter((r) => r.tipo === "gestionale"),
      dipendenti: withQuote.filter((r) => r.tipo === "dipendente"),
      totSportivi: Math.round(sportivi.reduce((s, r) => s + r.totale, 0) * 100) / 100,
      totGestionali: Math.round(gestionali.reduce((s, r) => s + r.totale, 0) * 100) / 100,
      totDipendenti: Math.round(dipendenti.reduce((s, r) => s + r.totale, 0) * 100) / 100,
    })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmCollaboratoriImport(req: Request, res: Response) {
  try {
    const righe = Array.isArray(req.body?.righe) ? req.body.righe : []
    if (!righe.length) return res.status(400).json({ message: "Nessuna riga da importare" })
    const mese = String(righe[0]?.mese ?? req.body?.mese ?? "").slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(mese)) return res.status(400).json({ message: "Mese non valido" })
    const errori: { riga: number; message: string }[] = []
    const pronte: Parameters<typeof ammCostiStore.replaceCollaboratoriMese>[1] = []
    righe.forEach((raw: Record<string, unknown>, i: number) => {
      const riga = Number(raw.riga) || i + 1
      try {
        const nominativo = String(raw.nominativo ?? "").trim()
        const totale = Number(String(raw.totale ?? "").replace(",", "."))
        if (!nominativo) throw new Error("Nominativo mancante")
        if (!Number.isFinite(totale) || totale <= 0) return
        const quote = quoteFrom(raw.quote)
        pronte.push({
          nominativo,
          mese,
          totale,
          descrizione: String(raw.descrizione ?? ""),
          tipo: raw.tipo === "gestionale" ? "gestionale" : "sportivo",
          origine: "riepilogo",
          quote: quote.length
            ? quote
            : [{ repartoId: raw.tipo === "gestionale" ? "amministrazione-uffici" : "personale-condiviso", percentuale: 100 }],
        })
      } catch (e) {
        errori.push({ riga, message: (e as Error)?.message ?? "Riga non valida" })
      }
    })
    const { inserite, sostituite } = ammCostiStore.replaceCollaboratoriMese(mese, pronte)
    res.json({ inserite, saltate: 0, sostituite, errori })
  } catch (e) {
    fail(res, e)
  }
}

export function deleteAmmCollaboratore(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id mancante" })
    ammCostiStore.deleteCollaboratore(id)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
}

const MESI_LABEL = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]
const REPARTO_SENZA = "Senza reparto"
const REPARTO_AMM = "Amministrazione"
const REPARTO_ORDINE = [
  "piscina",
  "acqua",
  "nuoto",
  "palestra",
  "fitness",
  "sala",
  "ristorante",
  "bar",
  "spa",
  "miscellanea",
  "amministrazione",
  "gestione",
]

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .sort()
}

function nameKey(s: string): string {
  return nameTokens(s).join(" ")
}

function ordineReparto(nome: string): number {
  const n = nome.toLowerCase()
  if (n === REPARTO_SENZA.toLowerCase()) return 900
  const i = REPARTO_ORDINE.findIndex((k) => n.includes(k))
  return i >= 0 ? i : 80
}

type AnagReparto = { key: string; tokens: string[]; dominio: string; mansione: string }

async function anagraficaReparti(): Promise<AnagReparto[]> {
  try {
    const [pers, liv] = await Promise.all([listPersonale(), listLivelli()])
    return pers.map((p) => {
      const mansione = p.livelloId ? liv.find((l) => l.id === p.livelloId)?.nome ?? "" : ""
      const dominio = p.livelloId ? dominioLivello(liv, p.livelloId) : ""
      return {
        key: nameKey(nominativo(p)),
        tokens: nameTokens(nominativo(p)),
        dominio: (dominio && dominio !== "—" ? dominio : mansione).trim(),
        mansione: mansione.trim(),
      }
    })
  } catch {
    return []
  }
}

function matchAnag(nominativoRiga: string, anag: AnagReparto[]): AnagReparto | null {
  const key = nameKey(nominativoRiga)
  if (!key) return null
  const exact = anag.filter((a) => a.key === key)
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return exact.find((a) => a.dominio) ?? exact[0]!
  const tokens = nameTokens(nominativoRiga)
  if (tokens.length < 2) return null
  const fuzzy = anag.filter((a) => {
    if (a.tokens.length < 2) return false
    return tokens.every((t) => a.tokens.includes(t)) || a.tokens.every((t) => tokens.includes(t))
  })
  if (fuzzy.length === 1) return fuzzy[0]!
  return null
}

function labelReparto(tipo: "sportivo" | "gestionale", hit: AnagReparto | null): string {
  if (hit?.dominio) return hit.dominio
  if (tipo === "gestionale") return REPARTO_AMM
  return REPARTO_SENZA
}

export async function getAmmCollaboratoriReport(req: Request, res: Response) {
  try {
    const now = new Date()
    const anno = Number(req.query.anno) || now.getFullYear()
    const stored = ammCostiStore.listCollaboratori().filter((c) => c.mese.startsWith(`${anno}-`))
    const rimanenzeAnno = ammCostiStore.listRimanenze(anno)
    const mesi = Array.from({ length: 12 }, (_, i) => `${anno}-${String(i + 1).padStart(2, "0")}`)
    const anag = await anagraficaReparti()
    const byNome = new Map<
      string,
      { nominativo: string; tipo: "sportivo" | "gestionale"; mesi: Record<string, { id: string; totale: number; origine: string }> }
    >()
    for (const c of stored) {
      const key = c.nominativo.trim().toLowerCase()
      const cur = byNome.get(key) ?? {
        nominativo: c.nominativo.trim(),
        tipo: c.tipo,
        mesi: {},
      }
      if (c.tipo === "gestionale") cur.tipo = "gestionale"
      cur.mesi[c.mese] = { id: c.id, totale: c.totale, origine: c.origine }
      byNome.set(key, cur)
    }
    for (const r of rimanenzeAnno) {
      const key = r.nominativo.trim().toLowerCase()
      if (byNome.has(key)) continue
      byNome.set(key, { nominativo: r.nominativo.trim(), tipo: "sportivo", mesi: {} })
    }
    const rimByNome = new Map(rimanenzeAnno.map((r) => [r.nominativo.trim().toLowerCase(), r.importo]))
    const righe = [...byNome.values()]
      .map((r) => {
        const mesiTot = Math.round(mesi.reduce((s, m) => s + (r.mesi[m]?.totale ?? 0), 0) * 100) / 100
        const rimanenze = rimByNome.get(r.nominativo.trim().toLowerCase()) ?? 0
        const tot = Math.round((mesiTot + rimanenze) * 100) / 100
        const hit = matchAnag(r.nominativo, anag)
        return {
          nominativo: r.nominativo,
          tipo: r.tipo,
          reparto: labelReparto(r.tipo, hit),
          mansione: hit?.mansione || "",
          mesi: r.mesi,
          rimanenze,
          tot,
          oltre5000: Math.max(0, Math.round((tot - 5000) * 100) / 100),
          oltre15000: Math.max(0, Math.round((tot - 15000) * 100) / 100),
        }
      })
      .sort((a, b) => {
        const ra = a.reparto || REPARTO_SENZA
        const rb = b.reparto || REPARTO_SENZA
        const o = ordineReparto(ra) - ordineReparto(rb)
        if (o) return o
        const c = ra.localeCompare(rb, "it")
        if (c) return c
        return a.nominativo.localeCompare(b.nominativo, "it")
      })
    const totMese: Record<string, number> = {}
    for (const m of mesi) {
      totMese[m] = Math.round(righe.reduce((s, r) => s + (r.mesi[m]?.totale ?? 0), 0) * 100) / 100
    }
    const totAnno = Math.round(righe.reduce((s, r) => s + r.tot, 0) * 100) / 100
    const totRimanenze = Math.round(righe.reduce((s, r) => s + r.rimanenze, 0) * 100) / 100
    res.json({
      anno,
      mesi: mesi.map((id, i) => ({ id, label: MESI_LABEL[i] ?? id })),
      righe,
      totMese,
      totRimanenze,
      totAnno,
      n: righe.length,
      audit: ammCostiStore.listCollaboratoriAudit(60),
    })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmCollaboratoriReportImport(req: Request, res: Response) {
  try {
    const anno = Number(req.body?.anno)
    const righe = Array.isArray(req.body?.righe) ? req.body.righe : []
    if (!righe.length) return res.status(400).json({ message: "Nessuna riga da importare" })
    const user = String(req.user?.nome || req.user?.username || req.lpaga?.nominativo || req.lpaga?.username || "").trim()
    const rimanenze = Array.isArray(req.body?.rimanenze) ? req.body.rimanenze : []
    const { inserite, sostituite, nPersone } = ammCostiStore.importCollaboratoriReport(
      anno,
      righe.map((raw: Record<string, unknown>) => ({
        nominativo: String(raw.nominativo ?? "").trim(),
        mese: String(raw.mese ?? "").slice(0, 7),
        totale: Number(String(raw.totale ?? "").replace(",", ".")),
        tipo: raw.tipo === "gestionale" ? "gestionale" : "sportivo",
      })),
      user,
      rimanenze.map((raw: Record<string, unknown>) => ({
        nominativo: String(raw.nominativo ?? "").trim(),
        importo: Number(String(raw.importo ?? "").replace(",", ".")),
      }))
    )
    res.json({ inserite, saltate: 0, sostituite, nPersone, errori: [] })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmCollaboratoreImporto(req: Request, res: Response) {
  try {
    const nominativo = String(req.body?.nominativo ?? "").trim()
    const mese = String(req.body?.mese ?? "").slice(0, 7)
    const totale = Number(String(req.body?.totale ?? "").replace(",", "."))
    const tipo = req.body?.tipo === "gestionale" ? "gestionale" : req.body?.tipo === "sportivo" ? "sportivo" : undefined
    const user = String(req.user?.nome || req.user?.username || req.lpaga?.nominativo || req.lpaga?.username || "").trim()
    const row = ammCostiStore.setImportoCollaboratore({ nominativo, mese, totale, tipo, user })
    res.json({ row })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmCollaboratoreRimanenze(req: Request, res: Response) {
  try {
    const nominativo = String(req.body?.nominativo ?? "").trim()
    const anno = Number(req.body?.anno)
    const importo = Number(String(req.body?.importo ?? "").replace(",", "."))
    const user = String(req.user?.nome || req.user?.username || req.lpaga?.nominativo || req.lpaga?.username || "").trim()
    const row = ammCostiStore.setRimanenzaCollaboratore({ nominativo, anno, importo, user })
    res.json({ row })
  } catch (e) {
    fail(res, e)
  }
}

export function postAmmOcr(req: Request, res: Response) {
  try {
    const text = String(req.body?.text ?? "")
    const filename = String(req.body?.filename ?? "")
    if (text.trim().length < 8) return res.status(400).json({ message: "Testo PDF insufficiente" })
    const parsed = parseFatturaText(text, filename)
    const fornitori = ammCostiStore.listFornitori()
    const n = parsed.fornitore.toLowerCase()
    const match = fornitori.find((f) => f.ragioneSociale.toLowerCase() === n || (n && f.ragioneSociale.toLowerCase().includes(n)))
    const quoteSuggerite = parsed.fornitore
      ? ammCostiStore.quoteForFornitore(match?.ragioneSociale || parsed.fornitore, parsed.dataDocumento || "")
      : []
    res.json({ parsed, fornitoreNoto: match ?? null, fornitori, quoteSuggerite })
  } catch (e) {
    fail(res, e)
  }
}

type Slice = {
  repartoId: string
  nome: string
  importo: number
  fonte: "spesa" | "libro-paga" | "busta" | "rimborso"
}

export async function getAmmDashboard(req: Request, res: Response) {
  try {
    ammCostiStore.riapplicaQuoteFornitoriNoti()
    ammCostiStore.riapplicaQuotePiscinaEstate()
    const anno = Number(req.query.anno) || new Date().getFullYear()
    const meseQ = String(req.query.mese ?? "").trim()
    const mese = /^\d{2}$/.test(meseQ) ? `${anno}-${meseQ}` : /^\d{4}-\d{2}$/.test(meseQ) ? meseQ : ""
    const repartoId = String(req.query.reparto ?? "").trim()
    const reparti = ammCostiStore.listReparti(true)
    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
    const nomeOf = (id: string) => reparti.find((r) => r.id === id)?.nome ?? id
    const filtroIds = (() => {
      if (!repartoId) return null as Set<string> | null
      const r = reparti.find((x) => x.id === repartoId)
      if (r?.livello === "macro") {
        return new Set([r.id, ...reparti.filter((x) => x.macroId === r.id).map((x) => x.id)])
      }
      return new Set([repartoId])
    })()
    const inFiltro = (id: string) => !filtroIds || filtroIds.has(id)
    const speseParti = ammCostiStore.listSpese().flatMap((s) =>
      ripartoCompetenza(s)
        .filter((p) => (mese ? p.mese === mese : p.mese.startsWith(String(anno))))
        .map((p) => ({ spesa: s, mese: p.mese, importo: p.importo }))
    )

    function slicesOf(s: AmmSpesa, importo = s.totale): Slice[] {
      return allocateQuote(importo, s.quote)
        .filter((a) => inFiltro(a.repartoId))
        .map((a) => ({
          repartoId: a.repartoId,
          nome: nomeOf(a.repartoId),
          importo: a.importo,
          fonte: "spesa" as const,
        }))
    }

    const busteAll = ammCostiStore.listBuste().filter((b) => (mese ? b.mese === mese : b.mese.startsWith(String(anno))))
    const bustaSlices: Slice[] = []
    const pnlAlloc: { repartoId: string; importo: number }[] = []
    const pnlVoci: { repartoId: string; importo: number; voce: string }[] = []
    const labelSpesa = (s: AmmSpesa) => {
      const bits = [s.fornitore, s.descrizione, s.numeroDocumento].map((x) => String(x || "").trim()).filter(Boolean)
      return bits.length ? `Fattura · ${bits.join(" · ")}` : "Fattura"
    }
    const pushPnl = (alloc: { repartoId: string; importo: number }[], voce: string) => {
      pnlAlloc.push(...alloc)
      for (const a of alloc) {
        if (Math.abs(a.importo) > 0.009) pnlVoci.push({ repartoId: a.repartoId, importo: a.importo, voce })
      }
    }
    for (const p of speseParti) pushPnl(allocateQuote(p.importo, p.spesa.quote), labelSpesa(p.spesa))
    for (const b of busteAll) {
      const alloc = allocateQuote(b.totale, b.quote)
      pnlAlloc.push(...alloc)
      const dipendenti = (b.dettaglioDipendenti ?? []).filter((d) => d.nominativo && Math.abs(d.totale) > 0.009)
      if (dipendenti.length && Math.abs(b.totale) > 0.009) {
        for (const d of dipendenti) {
          const share = d.totale / b.totale
          for (const a of alloc) {
            const importo = round2(a.importo * share)
            if (Math.abs(importo) > 0.009) {
              pnlVoci.push({ repartoId: a.repartoId, importo, voce: `Busta paga · ${d.nominativo}` })
            }
          }
        }
      } else {
        for (const a of alloc) {
          if (Math.abs(a.importo) > 0.009) {
            pnlVoci.push({
              repartoId: a.repartoId,
              importo: a.importo,
              voce: `Busta paga · ${b.nominativo}${b.descrizione ? ` · ${b.descrizione}` : ""}`,
            })
          }
        }
      }
      for (const a of alloc.filter((x) => inFiltro(x.repartoId))) {
        bustaSlices.push({
          repartoId: a.repartoId,
          nome: nomeOf(a.repartoId),
          importo: a.importo,
          fonte: "busta",
        })
      }
    }

    const collabAll = ammCostiStore.listCollaboratori()
    const lpAnno = await costiCollaboratoriAnno(anno)
    const centriCostoLibroPaga = await centriCostoCollaboratoriDaLibroPaga()
    const lpSlices: Slice[] = []
    function quoteTurniDelMese(ym: string, nominativo: string): AmmQuota[] | undefined {
      const meseLp = lpAnno.find((item) => item.mese === ym)
      return meseLp ? quoteTurniCollaboratore(nominativo, meseLp.collaboratori) : undefined
    }
    let totCollaboratoriAziendaRaw = 0
    const mesiTarget = mese
      ? [mese]
      : Array.from({ length: 12 }, (_, i) => `${anno}-${String(i + 1).padStart(2, "0")}`)
    for (const ym of mesiTarget) {
      const stored = collabAll.filter((c) => c.mese === ym)
      if (stored.length) {
        totCollaboratoriAziendaRaw += stored.reduce((sum, c) => sum + (Number(c.totale) || 0), 0)
        for (const c of stored) {
          const alloc = allocateQuote(
            c.totale,
            quoteTurniDelMese(ym, c.nominativo) ??
              quoteOfCollaboratore(c.nominativo, c.quote, centriCostoLibroPaga)
          )
          pushPnl(alloc, `Libro paga · ${c.nominativo}`)
          for (const a of alloc.filter((x) => inFiltro(x.repartoId))) {
            lpSlices.push({
              repartoId: a.repartoId,
              nome: nomeOf(a.repartoId),
              importo: a.importo,
              fonte: "libro-paga",
            })
          }
        }
        continue
      }
    }
    const rimborsiAnno = ammCostiStore
      .listCollaboratoriRimborsi()
      .filter((r) => r.mese.startsWith(String(anno)))
    const rimborsiAll = rimborsiAnno.filter((r) => !mese || r.mese === mese)
    const rimborsoSlices: Slice[] = rimborsiAll.flatMap((r) =>
      allocateQuote(
        r.totale,
        quoteTurniDelMese(r.mese, r.nominativo) ??
          quoteOfCollaboratore(r.nominativo, r.quote, centriCostoLibroPaga)
      )
        .filter((a) => inFiltro(a.repartoId))
        .map((a) => ({
          repartoId: a.repartoId,
          nome: nomeOf(a.repartoId),
          importo: a.importo,
          fonte: "rimborso" as const,
        })),
    )
    for (const r of rimborsiAll) {
      pushPnl(
        allocateQuote(
          r.totale,
          quoteTurniDelMese(r.mese, r.nominativo) ??
            quoteOfCollaboratore(r.nominativo, r.quote, centriCostoLibroPaga)
        ),
        `Rimborso · ${r.nominativo}${r.descrizione ? ` · ${r.descrizione}` : ""}`,
      )
    }

    const ricavi = await queryRicaviAmm(anno, mese || undefined)
    let fattureEmesseDisponibili = false
    let ricaviErrore = ""
    let fattureAmm = {
      ricaviDanza: 0,
      nFattureDanza: 0,
      ricaviAffitti: 0,
      nFattureAffitti: 0,
      ricaviConvenzioni: 0,
      nFattureConvenzioni: 0,
      recuperiUtenze: 0,
      recuperiUtenzePerMese: {} as Record<string, number>,
    }
    let fattureAmmAnno = fattureAmm
    let fattureEmesseDettaglio: {
      numeroDocumento: string
      dataDocumento: string
      cliente: string
      descrizione: string
      tipo: "Danza" | "Recupero utenze" | "Affitto spazi" | "Convenzione"
      totale: number
    }[] = []
    const ficCfg = resolvedConfig().cfg
    if (!ficCfg?.accessToken || !ficCfg.companyId) {
      ricaviErrore = "Collega Fatture in Cloud per leggere le fatture emesse."
    } else {
      try {
        const periodoAnno = periodoIso(anno)
        const docsAnno = await listFattureEmessePeriodo(
          ficCfg,
          shiftIsoDays(periodoAnno.from, -45),
          shiftIsoDays(periodoAnno.to, 45)
        )
        fattureAmmAnno = riepilogoFattureAmm(docsAnno, periodoAnno)
        fattureAmm = riepilogoFattureAmm(docsAnno, { from: ricavi.from, to: ricavi.to })
        fattureEmesseDettaglio = docsAnno.flatMap((doc) => {
          const tipo = classificaFatturaEmessa(doc)
          if (!tipo) return []
          const competenza = doc.competenzaMese || doc.dataDocumento.slice(0, 7)
          const inPeriodo =
            tipo === "Recupero utenze"
              ? competenza >= ricavi.from.slice(0, 7) && competenza <= ricavi.to.slice(0, 7)
              : doc.dataDocumento >= ricavi.from && doc.dataDocumento <= ricavi.to
          if (!inPeriodo) return []
          return [
            {
              numeroDocumento: doc.numeroDocumento,
              dataDocumento: doc.dataDocumento,
              cliente: doc.cliente,
              descrizione: doc.descrizione,
              tipo,
              totale: doc.totale,
            },
          ]
        })
        fattureEmesseDisponibili = true
      } catch (e) {
        ricaviErrore = (e as Error)?.message ?? "Lettura delle fatture emesse da Fatture in Cloud non riuscita."
      }
    }
    if (fattureEmesseDisponibili) {
      const danzaCassa = round2(
        ricavi.dettaglio
          .filter((v) => v.voce === "Danza (incassi gestionale)")
          .reduce((s, v) => s + (Number(v.importo) || 0), 0),
      )
      if (fattureAmm.ricaviDanza && danzaCassa < 0.01) {
        ricavi.byMacro.fitness = round2(ricavi.byMacro.fitness + fattureAmm.ricaviDanza)
        ricavi.dettaglio.push({
          voce: "Fatture Danza · Fatture in Cloud",
          macro: "fitness",
          importo: fattureAmm.ricaviDanza,
          n: fattureAmm.nFattureDanza,
        })
      }
      if (fattureAmm.ricaviAffitti) {
        ricavi.totAltri = round2(ricavi.totAltri + fattureAmm.ricaviAffitti)
        ricavi.dettaglio.push({
          voce: "Affitti spazi · Fatture in Cloud",
          macro: "altro",
          importo: fattureAmm.ricaviAffitti,
          n: fattureAmm.nFattureAffitti,
        })
      }
      if (fattureAmm.ricaviConvenzioni) {
        ricavi.totAltri = round2(ricavi.totAltri + fattureAmm.ricaviConvenzioni)
        ricavi.dettaglio.push({
          voce: "Convenzioni · Fatture in Cloud",
          macro: "altro",
          importo: fattureAmm.ricaviConvenzioni,
          n: fattureAmm.nFattureConvenzioni,
        })
      }
      ricavi.dettaglio = ordinaDettaglioRicavi(ricavi.dettaglio).slice(0, 80)
      ricavi.totCommerciali = round2(MACRO_COMMERCIALI.reduce((sum, id) => sum + ricavi.byMacro[id], 0))
      ricavi.tot = round2(ricavi.totCommerciali + ricavi.totAltri)
    }
    const ricaviDisponibili = ricavi.disponibile && fattureEmesseDisponibili
    const recuperoUtenze = fattureEmesseDisponibili ? fattureAmm.recuperiUtenze : 0
    const recoverySlices: Slice[] =
      recuperoUtenze && inFiltro("utenze-generali")
        ? [
            {
              repartoId: "utenze-generali",
              nome: nomeOf("utenze-generali"),
              importo: -recuperoUtenze,
              fonte: "spesa",
            },
          ]
        : []
    if (recuperoUtenze) pushPnl([{ repartoId: "utenze-generali", importo: -recuperoUtenze }], "Recupero utenze")

    const allSlices = [
      ...speseParti.flatMap((p) => slicesOf(p.spesa, p.importo)),
      ...lpSlices,
      ...bustaSlices,
      ...rimborsoSlices,
      ...recoverySlices,
    ]
    const tot = Math.round(allSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100

    let totFisso = bustaSlices.reduce((s, x) => s + x.importo, 0)
    let totVariabile =
      lpSlices.reduce((s, x) => s + x.importo, 0) + rimborsoSlices.reduce((s, x) => s + x.importo, 0)
    for (const p of speseParti) {
      const alloc = allocateQuote(p.importo, p.spesa.quote).filter((a) => inFiltro(a.repartoId))
      const sub = alloc.reduce((n, a) => n + a.importo, 0)
      if (p.spesa.tipoCosto === "fisso") totFisso += sub
      else totVariabile += sub
    }
    if (inFiltro("utenze-generali")) totFisso -= recuperoUtenze
    totFisso = Math.round(totFisso * 100) / 100
    totVariabile = Math.round(totVariabile * 100) / 100

    const byRepartoMap = new Map<string, number>()
    for (const x of allSlices) {
      byRepartoMap.set(x.repartoId, Math.round(((byRepartoMap.get(x.repartoId) ?? 0) + x.importo) * 100) / 100)
    }
    const byReparto = [...byRepartoMap.entries()]
      .map(([id, importo]) => ({
        id,
        nome: nomeOf(id),
        macroId: macroIdOf(reparti, id),
        importo,
      }))
      .filter((r) => r.importo)
      .sort((a, b) => b.importo - a.importo)
    const byMacroMap = new Map<string, number>()
    for (const r of byReparto) {
      const mid = r.macroId || r.id
      byMacroMap.set(mid, Math.round(((byMacroMap.get(mid) ?? 0) + r.importo) * 100) / 100)
    }
    const byMacro = [...byMacroMap.entries()]
      .map(([id, importo]) => ({ id, nome: nomeOf(id), importo }))
      .filter((r) => r.importo)
      .sort((a, b) => b.importo - a.importo)

    const byMeseMap = new Map<string, number>()
    for (let i = 1; i <= 12; i++) byMeseMap.set(`${anno}-${String(i).padStart(2, "0")}`, 0)
    for (const s of ammCostiStore.listSpese()) {
      for (const p of ripartoCompetenza(s)) {
        if (!p.mese.startsWith(String(anno))) continue
        const alloc = allocateQuote(p.importo, s.quote).filter((a) => inFiltro(a.repartoId))
        const sub = alloc.reduce((n, a) => n + a.importo, 0)
        byMeseMap.set(p.mese, Math.round(((byMeseMap.get(p.mese) ?? 0) + sub) * 100) / 100)
      }
    }
    for (const ym of Array.from({ length: 12 }, (_, i) => `${anno}-${String(i + 1).padStart(2, "0")}`)) {
      const stored = collabAll.filter((c) => c.mese === ym)
      let sub = 0
      if (stored.length) {
        sub = stored.reduce(
          (n, c) =>
            n +
            allocateQuote(
              c.totale,
              quoteTurniDelMese(ym, c.nominativo) ??
                quoteOfCollaboratore(c.nominativo, c.quote, centriCostoLibroPaga)
            )
              .filter((a) => inFiltro(a.repartoId))
              .reduce((x, a) => x + a.importo, 0),
          0,
        )
      }
      byMeseMap.set(ym, Math.round(((byMeseMap.get(ym) ?? 0) + sub) * 100) / 100)
    }
    for (const r of rimborsiAnno) {
      const sub = allocateQuote(
        r.totale,
        quoteTurniDelMese(r.mese, r.nominativo) ??
          quoteOfCollaboratore(r.nominativo, r.quote, centriCostoLibroPaga)
      )
        .filter((a) => inFiltro(a.repartoId))
        .reduce((sum, a) => sum + a.importo, 0)
      byMeseMap.set(r.mese, round2((byMeseMap.get(r.mese) ?? 0) + sub))
    }
    for (const b of ammCostiStore.listBuste()) {
      if (!b.mese.startsWith(String(anno))) continue
      const sub = allocateQuote(b.totale, b.quote).filter((a) => inFiltro(a.repartoId)).reduce((n, a) => n + a.importo, 0)
      byMeseMap.set(b.mese, Math.round(((byMeseMap.get(b.mese) ?? 0) + sub) * 100) / 100)
    }
    if (inFiltro("utenze-generali")) {
      for (const [meseRecupero, importo] of Object.entries(fattureAmmAnno.recuperiUtenzePerMese)) {
        if (!meseRecupero.startsWith(String(anno))) continue
        byMeseMap.set(
          meseRecupero,
          round2((byMeseMap.get(meseRecupero) ?? 0) - importo)
        )
      }
    }
    const byMese = [...byMeseMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([meseKey, importo]) => ({
      mese: meseKey,
      label: meseKey.slice(5),
      importo,
    }))

    const totLpaga = Math.round(lpSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100
    const totBuste = Math.round(bustaSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100
    const totRimborsi = round2(rimborsiAll.reduce((sum, r) => sum + r.totale, 0))
    const totSpese = Math.round((tot - totLpaga - totBuste - totRimborsi) * 100) / 100

    const diretti: Record<MacroCommerciale, number> = { piscina: 0, fitness: 0, spa: 0 }
    let totStruttura = 0
    let totServizi = 0
    const strutturaByMacro = new Map<string, number>()
    const serviziByMacro = new Map<string, number>()
    for (const x of pnlAlloc) {
      const mid = macroIdOf(reparti, x.repartoId)
      if (isMacroCommerciale(mid)) diretti[mid] = round2(diretti[mid] + x.importo)
      else if (isMacroStruttura(mid)) {
        totStruttura = round2(totStruttura + x.importo)
        strutturaByMacro.set(mid, round2((strutturaByMacro.get(mid) ?? 0) + x.importo))
      } else if (isMacroServizi(mid)) {
        totServizi = round2(totServizi + x.importo)
        serviziByMacro.set(mid, round2((serviziByMacro.get(mid) ?? 0) + x.importo))
      }
    }
    const ripartoPct = quoteRipartoFissi(ricavi.byMacro)
    const pesiMacro = MACRO_COMMERCIALI.map((id) => ricavi.byMacro[id])
    const qfMacro = splitEuro(totStruttura, pesiMacro)
    const qsMacro = splitEuro(totServizi, pesiMacro)
    const risultato = MACRO_COMMERCIALI.map((id, i) => {
      const ricavo = round2(ricavi.byMacro[id])
      const costoDiretto = round2(diretti[id])
      const quotaFissi = qfMacro[i] ?? 0
      const quotaServizi = qsMacro[i] ?? 0
      const costoTotale = round2(costoDiretto + quotaFissi + quotaServizi)
      const utile = round2(ricavo - costoTotale)
      const marginePct = ricavo > 0.009 ? Math.round((utile / ricavo) * 1000) / 10 : null
      return {
        id,
        nome: nomeOf(id),
        ricavi: ricavo,
        costiDiretti: costoDiretto,
        quotaFissi,
        quotaServizi,
        costoTotale,
        utile,
        marginePct,
        ripartoFissiPct: ripartoPct[id],
      }
    })
    const totSpeseGeneraliStruttura = round2(totStruttura + totServizi)
    const costiByReparto = new Map<string, number>()
    for (const x of pnlAlloc) {
      costiByReparto.set(x.repartoId, round2((costiByReparto.get(x.repartoId) ?? 0) + x.importo))
    }
    const sottoCommerciali = reparti
      .filter((r) => r.livello === "sotto" && r.macroId && isMacroCommerciale(r.macroId))
      .sort((a, b) => a.ordine - b.ordine)
    const idsSottoByMacro = (macro: MacroCommerciale) => {
      const seen = new Set<string>()
      const out: { id: string; nome: string }[] = []
      for (const s of sottoCommerciali.filter((r) => r.macroId === macro)) {
        seen.add(s.id)
        out.push({ id: s.id, nome: s.nome })
      }
      for (const id of [...costiByReparto.keys(), ...Object.keys(ricavi.bySotto ?? {})]) {
        if (seen.has(id) || id === macro) continue
        if (macroIdOf(reparti, id) !== macro) continue
        seen.add(id)
        out.push({ id, nome: nomeOf(id) })
      }
      return out
    }
    const raggruppaVoci = (items: { voce: string; importo: number }[]) => {
      const m = new Map<string, number>()
      for (const it of items) m.set(it.voce, round2((m.get(it.voce) ?? 0) + it.importo))
      return [...m.entries()]
        .map(([voce, importo]) => ({ voce, importo }))
        .filter((x) => Math.abs(x.importo) > 0.009)
        .sort((a, b) => Math.abs(b.importo) - Math.abs(a.importo))
    }
    const risultatoDettaglio: {
      id: string
      nome: string
      macroId: MacroCommerciale
      macroNome: string
      ricavi: number
      costiDiretti: number
      quotaFissi: number
      quotaServizi: number
      costoTotale: number
      utile: number
      marginePct: number | null
      ripartoPct: number
      corso: boolean
      voci?: { voce: string; importo: number }[]
    }[] = []
    for (const macro of MACRO_COMMERCIALI) {
      const parent = risultato.find((r) => r.id === macro)
      if (!parent) continue
      const sottoElenco = idsSottoByMacro(macro)
      const namedSotto = new Set(sottoElenco.map((s) => s.id))
      const rows: {
        id: string
        nome: string
        ricavi: number
        costiDiretti: number
        voci?: { voce: string; importo: number }[]
      }[] = []
      for (const s of sottoElenco) {
        const ricavo = round2(ricavi.bySotto?.[s.id] ?? 0)
        const costo = round2(costiByReparto.get(s.id) ?? 0)
        if (Math.abs(ricavo) > 0.009 || Math.abs(costo) > 0.009) {
          rows.push({ id: s.id, nome: s.nome, ricavi: ricavo, costiDiretti: costo })
        }
      }
      const residuoRic = round2(parent.ricavi - rows.reduce((s, r) => s + r.ricavi, 0))
      const residuoDir = round2(parent.costiDiretti - rows.reduce((s, r) => s + r.costiDiretti, 0))
      if (Math.abs(residuoRic) > 0.009 || Math.abs(residuoDir) > 0.009) {
        const vociCosti = raggruppaVoci(
          pnlVoci
            .filter((x) => macroIdOf(reparti, x.repartoId) === macro && !namedSotto.has(x.repartoId))
            .map((x) => ({ voce: x.voce, importo: x.importo })),
        )
        const vociRicavi = raggruppaVoci(
          (ricavi.dettaglio ?? []).flatMap((v) => {
            const quotaMacro =
              v.ripartizione?.find((q) => q.macro === macro)?.importo ??
              (v.macro === macro || v.macro.split("+").map((part) => part.trim()).includes(macro)
                ? v.importo
                : 0)
            const sottoTot = (v.ripartizioneSotto ?? [])
              .filter((s) => namedSotto.has(s.id))
              .reduce((sum, s) => sum + s.importo, 0)
            const residuo = round2(quotaMacro - sottoTot)
            return Math.abs(residuo) > 0.009 ? [{ voce: `Ricavo · ${v.voce}`, importo: residuo }] : []
          }),
        )
        rows.push({
          id: `${macro}-altri`,
          nome: `Altri ${parent.nome}`,
          ricavi: residuoRic,
          costiDiretti: residuoDir,
          voci: [...vociCosti, ...vociRicavi],
        })
      }
      if (!rows.length) continue
      const qf = splitEuro(parent.quotaFissi, rows.map((r) => r.ricavi))
      const qs = splitEuro(parent.quotaServizi ?? 0, rows.map((r) => r.ricavi))
      rows.forEach((r, i) => {
        const quotaFissi = qf[i] ?? 0
        const quotaServizi = qs[i] ?? 0
        const costoTotale = round2(r.costiDiretti + quotaFissi + quotaServizi)
        const utile = round2(r.ricavi - costoTotale)
        risultatoDettaglio.push({
          id: r.id,
          nome: r.nome,
          macroId: macro,
          macroNome: parent.nome,
          ricavi: r.ricavi,
          costiDiretti: r.costiDiretti,
          quotaFissi,
          quotaServizi,
          costoTotale,
          utile,
          marginePct: r.ricavi > 0.009 ? Math.round((utile / r.ricavi) * 1000) / 10 : null,
          ripartoPct: parent.ricavi > 0.009 ? round2((r.ricavi / parent.ricavi) * parent.ripartoFissiPct) : 0,
          corso: isCorsoId(r.id),
          ...(r.voci?.length ? { voci: r.voci } : {}),
        })
      })
    }
    const totRicavi = round2(risultato.reduce((s, r) => s + r.ricavi, 0))
    const totCostoPnl = round2(risultato.reduce((s, r) => s + r.costoTotale, 0))
    const totUtile = round2(totRicavi - totCostoPnl)
    const totRicaviAzienda = round2(ricavi.tot)
    const totCostiAzienda = round2(
      speseParti.reduce((sum, p) => sum + (Number(p.importo) || 0), 0) -
        recuperoUtenze +
        busteAll.reduce((sum, b) => sum + (Number(b.totale) || 0), 0) +
        totCollaboratoriAziendaRaw +
        totRimborsi,
    )
    const totCostiFuoriReparti = round2(totCostiAzienda - totCostoPnl)
    const totUtileAzienda = round2(totRicaviAzienda - totCostiAzienda)
    const byCollaboratoriMap = new Map<string, number>()
    for (const x of lpSlices) {
      byCollaboratoriMap.set(x.repartoId, Math.round(((byCollaboratoriMap.get(x.repartoId) ?? 0) + x.importo) * 100) / 100)
    }
    const byCollaboratori = [...byCollaboratoriMap.entries()]
      .map(([id, importo]) => ({ id, nome: nomeOf(id), macroId: macroIdOf(reparti, id), importo }))
      .filter((r) => r.importo)
      .sort((a, b) => b.importo - a.importo)
    const byBusteMap = new Map<string, number>()
    for (const x of bustaSlices) {
      byBusteMap.set(x.repartoId, Math.round(((byBusteMap.get(x.repartoId) ?? 0) + x.importo) * 100) / 100)
    }
    const byBuste = [...byBusteMap.entries()]
      .map(([id, importo]) => ({ id, nome: nomeOf(id), macroId: macroIdOf(reparti, id), importo }))
      .filter((r) => r.importo)
      .sort((a, b) => b.importo - a.importo)

    res.json({
      anno,
      mese: mese || null,
      repartoId: repartoId || null,
      tot,
      totFisso,
      totVariabile,
      totSpese: Math.round(totSpese * 100) / 100,
      totCollaboratori: totLpaga,
      totRimborsi,
      totBuste,
      totPersonale: Math.round((totLpaga + totBuste + totRimborsi) * 100) / 100,
      byMacro,
      byReparto,
      byMese,
      byCollaboratori,
      byBuste,
      nSpese: new Set(speseParti.map((p) => p.spesa.id)).size,
      nBuste: busteAll.length,
      ricaviDisponibili,
      ricaviErrore: ricavi.disponibile ? ricaviErrore : "Incassi del gestionale non disponibili.",
      nFattureDanza: fattureAmm.nFattureDanza,
      totRicaviDanza: fattureEmesseDisponibili ? fattureAmm.ricaviDanza : 0,
      totRecuperiUtenze: recuperoUtenze,
      fattureEmesseDettaglio,
      totRicavi,
      totRicaviAltri: ricavi.totAltri,
      totRicaviAzienda,
      totCostiAzienda,
      totCostiFuoriReparti,
      totUtileAzienda,
      margineAziendaPct: totRicaviAzienda > 0.009 ? Math.round((totUtileAzienda / totRicaviAzienda) * 1000) / 10 : null,
      totStruttura,
      totServizi,
      totSpeseGeneraliStruttura,
      risultatoDettaglio,
      totCostoPnl,
      totUtile,
      marginePct: totRicavi > 0.009 ? Math.round((totUtile / totRicavi) * 1000) / 10 : null,
      strutturaByMacro: [...strutturaByMacro.entries()]
        .map(([id, importo]) => ({ id, nome: nomeOf(id), importo }))
        .filter((r) => r.importo)
        .sort((a, b) => b.importo - a.importo),
      serviziByMacro: [...serviziByMacro.entries()]
        .map(([id, importo]) => ({ id, nome: nomeOf(id), importo }))
        .filter((r) => r.importo)
        .sort((a, b) => b.importo - a.importo),
      risultato,
      ricaviDettaglio: ricavi.dettaglio,
    })
  } catch (e) {
    fail(res, e)
  }
}

export function getFicStatus(_req: Request, res: Response) {
  try {
    res.json(publicStatus())
  } catch (e) {
    fail(res, e)
  }
}

export async function postFicConnect(req: Request, res: Response) {
  try {
    const token = String(req.body?.accessToken ?? "").trim() || resolvedConfig().cfg?.accessToken || ""
    if (!token) return res.status(400).json({ message: "Incolla il token di Fatture in Cloud" })
    const companies = await listCompanies(token)
    if (!companies.length) {
      return res.status(400).json({ message: "Nessuna azienda collegata a questo token" })
    }
    const wanted = Number(req.body?.companyId)
    const company = pickCompany(companies, Number.isFinite(wanted) && wanted > 0 ? wanted : undefined)
    if (!company) return res.status(400).json({ message: "Azienda non trovata" })
    const defaultRepartoId = String(req.body?.defaultRepartoId ?? "").trim() || FIC_DEFAULT_REPARTO
    const ids = new Set(ammCostiStore.listReparti(true).map((r) => r.id))
    if (!ids.has(defaultRepartoId)) {
      return res.status(400).json({ message: "Reparto predefinito non valido" })
    }
    ficStore.save({
      accessToken: company.accessToken || token,
      companyId: company.id,
      companyName: company.name,
      defaultRepartoId,
      connectedAt: new Date().toISOString(),
      lastSyncAt: ficStore.get()?.lastSyncAt,
    })
    res.json({
      ...publicStatus(),
      companies: companies.map((c) => ({ id: c.id, name: c.name })),
    })
  } catch (e) {
    fail(res, e)
  }
}

export function postFicDisconnect(_req: Request, res: Response) {
  try {
    ficStore.clear()
    res.json(publicStatus())
  } catch (e) {
    fail(res, e)
  }
}

export async function postFicSync(req: Request, res: Response) {
  try {
    const mese = String(req.body?.mese ?? req.query.mese ?? "").trim()
    if (!/^\d{4}-\d{2}$/.test(mese)) return res.status(400).json({ message: "Mese non valido" })
    const { cfg } = resolvedConfig()
    if (!cfg?.accessToken || !cfg.companyId) {
      return res.status(400).json({ message: "Collega prima Fatture in Cloud" })
    }
    if (!cfg.companyName) {
      try {
        const companies = await listCompanies(cfg.accessToken)
        const company = pickCompany(companies, cfg.companyId)
        if (company) {
          ficStore.save({ ...cfg, companyName: company.name, accessToken: company.accessToken || cfg.accessToken })
        }
      } catch {
        /* nome azienda opzionale */
      }
    }
    ammCostiStore.riapplicaQuoteFornitoriNoti()
    const docs = await listAcquistiMese(ficStore.get() ?? cfg, mese)
    const repartoId = String(req.body?.repartoId ?? cfg.defaultRepartoId ?? FIC_DEFAULT_REPARTO).trim() || FIC_DEFAULT_REPARTO
    const ids = new Set(ammCostiStore.listReparti(true).map((r) => r.id))
    if (!ids.has(repartoId)) return res.status(400).json({ message: "Reparto predefinito non valido" })
    let inserite = 0
    let saltate = 0
    const errori: { riga: number; message: string }[] = []
    docs.forEach((doc, i) => {
      try {
        if (ammCostiStore.findByFicId(doc.id) || ammCostiStore.findDuplicate(doc.fornitore, doc.numeroDocumento, doc.dataDocumento, doc.totale)) {
          saltate += 1
          return
        }
        ammCostiStore.upsertSpesa({
          fornitore: doc.fornitore,
          numeroDocumento: doc.numeroDocumento,
          dataDocumento: doc.dataDocumento,
          descrizione: doc.descrizione,
          totale: doc.totale,
          tipoCosto: "fisso",
          quote: ammCostiStore.quoteForFornitore(doc.fornitore, doc.dataDocumento, repartoId, doc.descrizione),
          origine: "fattureincloud",
          ficId: doc.id,
        })
        inserite += 1
      } catch (e) {
        errori.push({ riga: i + 1, message: (e as Error)?.message ?? "Documento non importabile" })
      }
    })
    ammCostiStore.riapplicaQuotePiscinaEstate()
    ficStore.markSynced()
    res.json({
      inserite,
      saltate,
      errori,
      lette: docs.length,
      companyName: (ficStore.get() ?? cfg).companyName,
    })
  } catch (e) {
    fail(res, e)
  }
}
