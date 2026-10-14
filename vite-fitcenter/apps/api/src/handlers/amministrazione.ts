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
import { parseFatturaText } from "../services/amministrazione-ocr.js"
import { costiCollaboratoriAnno } from "../services/amministrazione-lpaga.js"
import {
  isMacroCommerciale,
  isMacroStruttura,
  MACRO_COMMERCIALI,
  queryRicaviAmm,
  quoteRipartoFissi,
  type MacroCommerciale,
} from "../services/amministrazione-ricavi.js"
import { defaultRepartoFor, parseStipendiPdf } from "../services/amministrazione-stipendi-pdf.js"
import { dominioLivello, listLivelli, listPersonale, nominativo } from "../store/libro-paga-db.js"
import { FIC_DEFAULT_REPARTO, ficStore } from "../store/fattureincloud.js"
import { listAcquistiMese, listCompanies, pickCompany, publicStatus, resolvedConfig } from "../services/fattureincloud.js"

function fail(res: Response, e: unknown) {
  const status = (e as { status?: number })?.status
  const code = typeof status === "number" && status >= 400 && status < 600 ? status : 500
  return res.status(code).json({ message: (e as Error)?.message ?? "Errore" })
}

function meseOf(iso: string): string {
  return String(iso ?? "").slice(0, 7)
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
    res.json({ reparti: ammCostiStore.listReparti(true), fornitori: ammCostiStore.listFornitori() })
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
    const mese = String(req.query.mese ?? "").trim()
    const q = String(req.query.q ?? "").trim().toLowerCase()
    let rows = ammCostiStore.listSpese()
    if (/^\d{4}-\d{2}$/.test(mese)) rows = rows.filter((s) => meseOf(s.dataDocumento) === mese)
    else if (/^\d{4}$/.test(mese)) rows = rows.filter((s) => s.dataDocumento.startsWith(mese))
    if (q) {
      rows = rows.filter(
        (s) =>
          s.fornitore.toLowerCase().includes(q) ||
          s.numeroDocumento.toLowerCase().includes(q) ||
          s.descrizione.toLowerCase().includes(q)
      )
    }
    res.json({ spese: rows })
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
        ammCostiStore.upsertSpesa({
          fornitore,
          numeroDocumento,
          dataDocumento,
          descrizione: String(raw.descrizione ?? ""),
          totale,
          tipoCosto: raw.tipoCosto === "variabile" ? "variabile" : "fisso",
          quote: quoteFrom(raw.quote),
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

export async function getAmmCollaboratori(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno) || new Date().getFullYear()
    const meseQ = String(req.query.mese ?? "").trim()
    const mese = /^\d{2}$/.test(meseQ) ? `${anno}-${meseQ}` : /^\d{4}-\d{2}$/.test(meseQ) ? meseQ : ""
    const stored = ammCostiStore
      .listCollaboratori()
      .filter((c) => (mese ? c.mese === mese : c.mese.startsWith(String(anno))))
    if (stored.length) {
      const tot = Math.round(stored.reduce((s, c) => s + c.totale, 0) * 100) / 100
      res.json({
        anno,
        mese: mese || null,
        tot,
        fonte: "riepilogo",
        righe: stored.map((c) => ({
          id: c.id,
          nome: c.nominativo,
          importo: c.totale,
          nTurni: 0,
          tipo: c.tipo,
          descrizione: c.descrizione,
        })),
      })
      return
    }
    const reparti = ammCostiStore.listReparti(true)
    const nomeOf = (id: string) => reparti.find((r) => r.id === id)?.nome ?? id
    const lpAnno = await costiCollaboratoriAnno(anno)
    const lpMesi = mese ? lpAnno.filter((m) => m.mese === mese) : lpAnno
    const by = new Map<string, { importo: number; nTurni: number }>()
    for (const m of lpMesi) {
      for (const r of m.righe) {
        const cur = by.get(r.repartoId) ?? { importo: 0, nTurni: 0 }
        cur.importo = Math.round((cur.importo + r.importo) * 100) / 100
        cur.nTurni += r.nTurni
        by.set(r.repartoId, cur)
      }
    }
    const righe = [...by.entries()]
      .map(([id, v]) => ({ id, nome: nomeOf(id), macroId: macroIdOf(reparti, id), importo: v.importo, nTurni: v.nTurni }))
      .filter((r) => r.importo)
      .sort((a, b) => b.importo - a.importo)
    const tot = Math.round(righe.reduce((s, r) => s + r.importo, 0) * 100) / 100
    res.json({ anno, mese: mese || null, tot, fonte: "libro-paga", righe })
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
    res.json({ parsed, fornitoreNoto: match ?? null, fornitori })
  } catch (e) {
    fail(res, e)
  }
}

type Slice = { repartoId: string; nome: string; importo: number; fonte: "spesa" | "libro-paga" | "busta" }

export async function getAmmDashboard(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno) || new Date().getFullYear()
    const meseQ = String(req.query.mese ?? "").trim()
    const mese = /^\d{2}$/.test(meseQ) ? `${anno}-${meseQ}` : /^\d{4}-\d{2}$/.test(meseQ) ? meseQ : ""
    const repartoId = String(req.query.reparto ?? "").trim()
    const reparti = ammCostiStore.listReparti(true)
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
    const spese = ammCostiStore.listSpese().filter((s) => {
      const ym = meseOf(s.dataDocumento)
      if (mese) return ym === mese
      return ym.startsWith(String(anno))
    })

    function slicesOf(s: AmmSpesa): Slice[] {
      return allocateQuote(s.totale, s.quote)
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
    const pnlAlloc: { repartoId: string; importo: number }[] = spese.flatMap((s) => allocateQuote(s.totale, s.quote))
    for (const b of busteAll) {
      const alloc = allocateQuote(b.totale, b.quote)
      pnlAlloc.push(...alloc)
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
    const lpSlices: Slice[] = []
    const mesiTarget = mese
      ? [mese]
      : Array.from({ length: 12 }, (_, i) => `${anno}-${String(i + 1).padStart(2, "0")}`)
    for (const ym of mesiTarget) {
      const stored = collabAll.filter((c) => c.mese === ym)
      if (stored.length) {
        for (const c of stored) {
          const alloc = allocateQuote(c.totale, c.quote)
          pnlAlloc.push(...alloc)
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
      const m = lpAnno.find((x) => x.mese === ym)
      if (!m) continue
      for (const r of m.righe) {
        pnlAlloc.push({ repartoId: r.repartoId, importo: r.importo })
        if (!inFiltro(r.repartoId)) continue
        lpSlices.push({
          repartoId: r.repartoId,
          nome: nomeOf(r.repartoId),
          importo: r.importo,
          fonte: "libro-paga",
        })
      }
    }

    const allSlices = [...spese.flatMap(slicesOf), ...lpSlices, ...bustaSlices]
    const tot = Math.round(allSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100

    let totFisso = bustaSlices.reduce((s, x) => s + x.importo, 0)
    let totVariabile = lpSlices.reduce((s, x) => s + x.importo, 0)
    for (const s of spese) {
      const alloc = allocateQuote(s.totale, s.quote).filter((a) => inFiltro(a.repartoId))
      const sub = alloc.reduce((n, a) => n + a.importo, 0)
      if (s.tipoCosto === "fisso") totFisso += sub
      else totVariabile += sub
    }
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
      const ym = meseOf(s.dataDocumento)
      if (!ym.startsWith(String(anno))) continue
      const alloc = allocateQuote(s.totale, s.quote).filter((a) => inFiltro(a.repartoId))
      const sub = alloc.reduce((n, a) => n + a.importo, 0)
      byMeseMap.set(ym, Math.round(((byMeseMap.get(ym) ?? 0) + sub) * 100) / 100)
    }
    for (const ym of Array.from({ length: 12 }, (_, i) => `${anno}-${String(i + 1).padStart(2, "0")}`)) {
      const stored = collabAll.filter((c) => c.mese === ym)
      let sub = 0
      if (stored.length) {
        sub = stored.reduce((n, c) => n + allocateQuote(c.totale, c.quote).filter((a) => inFiltro(a.repartoId)).reduce((x, a) => x + a.importo, 0), 0)
      } else {
        const m = lpAnno.find((x) => x.mese === ym)
        sub = m ? m.righe.filter((r) => inFiltro(r.repartoId)).reduce((n, r) => n + r.importo, 0) : 0
      }
      byMeseMap.set(ym, Math.round(((byMeseMap.get(ym) ?? 0) + sub) * 100) / 100)
    }
    for (const b of ammCostiStore.listBuste()) {
      if (!b.mese.startsWith(String(anno))) continue
      const sub = allocateQuote(b.totale, b.quote).filter((a) => inFiltro(a.repartoId)).reduce((n, a) => n + a.importo, 0)
      byMeseMap.set(b.mese, Math.round(((byMeseMap.get(b.mese) ?? 0) + sub) * 100) / 100)
    }
    const byMese = [...byMeseMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([meseKey, importo]) => ({
      mese: meseKey,
      label: meseKey.slice(5),
      importo,
    }))

    const totLpaga = Math.round(lpSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100
    const totBuste = Math.round(bustaSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100
    const totSpese = Math.round((tot - totLpaga - totBuste) * 100) / 100

    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
    const diretti: Record<MacroCommerciale, number> = { piscina: 0, fitness: 0, spa: 0 }
    let totStruttura = 0
    const strutturaByMacro = new Map<string, number>()
    for (const x of pnlAlloc) {
      const mid = macroIdOf(reparti, x.repartoId)
      if (isMacroCommerciale(mid)) diretti[mid] = round2(diretti[mid] + x.importo)
      else if (isMacroStruttura(mid)) {
        totStruttura = round2(totStruttura + x.importo)
        strutturaByMacro.set(mid, round2((strutturaByMacro.get(mid) ?? 0) + x.importo))
      }
    }
    const ricavi = await queryRicaviAmm(anno, mese || undefined)
    const ripartoPct = quoteRipartoFissi(ricavi.byMacro)
    const risultato = MACRO_COMMERCIALI.map((id) => {
      const ricavo = round2(ricavi.byMacro[id])
      const costoDiretto = round2(diretti[id])
      const quotaFissi = round2((totStruttura * (ripartoPct[id] || 0)) / 100)
      const costoTotale = round2(costoDiretto + quotaFissi)
      const utile = round2(ricavo - costoTotale)
      const marginePct = ricavo > 0.009 ? Math.round((utile / ricavo) * 1000) / 10 : null
      return {
        id,
        nome: nomeOf(id),
        ricavi: ricavo,
        costiDiretti: costoDiretto,
        quotaFissi,
        costoTotale,
        utile,
        marginePct,
        ripartoFissiPct: ripartoPct[id],
      }
    })
    const totRicavi = round2(risultato.reduce((s, r) => s + r.ricavi, 0))
    const totCostoPnl = round2(risultato.reduce((s, r) => s + r.costoTotale, 0))
    const totUtile = round2(totRicavi - totCostoPnl)
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
      totBuste,
      totPersonale: Math.round((totLpaga + totBuste) * 100) / 100,
      byMacro,
      byReparto,
      byMese,
      byCollaboratori,
      byBuste,
      nSpese: spese.length,
      nBuste: busteAll.length,
      ricaviDisponibili: ricavi.disponibile,
      totRicavi,
      totRicaviAltri: ricavi.totAltri,
      totStruttura,
      totCostoPnl,
      totUtile,
      marginePct: totRicavi > 0.009 ? Math.round((totUtile / totRicavi) * 1000) / 10 : null,
      strutturaByMacro: [...strutturaByMacro.entries()]
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
          quote: [{ repartoId, percentuale: 100 }],
          origine: "fattureincloud",
          ficId: doc.id,
        })
        inserite += 1
      } catch (e) {
        errori.push({ riga: i + 1, message: (e as Error)?.message ?? "Documento non importabile" })
      }
    })
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
