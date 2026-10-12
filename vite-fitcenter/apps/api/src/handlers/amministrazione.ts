import fs from "fs"
import path from "path"
import type { Request, Response } from "express"
import {
  allocateQuote,
  ammCostiStore,
  macroIdOf,
  pdfDir,
  type AmmQuota,
  type AmmSpesa,
  type AmmTipoCosto,
} from "../store/amministrazione-costi.js"
import { parseFatturaText } from "../services/amministrazione-ocr.js"
import { costiCollaboratoriAnno } from "../services/amministrazione-lpaga.js"

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
    origine: b.origine === "ocr" ? "ocr" : b.origine === "excel" ? "excel" : "manuale",
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

type Slice = { repartoId: string; nome: string; importo: number; fonte: "spesa" | "libro-paga" }

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

    const lpAnno = await costiCollaboratoriAnno(anno)
    const lpMesi = mese ? lpAnno.filter((m) => m.mese === mese) : lpAnno
    const lpSlices: Slice[] = []
    for (const m of lpMesi) {
      for (const r of m.righe) {
        if (!inFiltro(r.repartoId)) continue
        lpSlices.push({
          repartoId: r.repartoId,
          nome: nomeOf(r.repartoId),
          importo: r.importo,
          fonte: "libro-paga",
        })
      }
    }

    const allSlices = [...spese.flatMap(slicesOf), ...lpSlices]
    const tot = Math.round(allSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100

    let totFisso = 0
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
    for (const m of lpAnno) {
      const sub = m.righe.filter((r) => inFiltro(r.repartoId)).reduce((n, r) => n + r.importo, 0)
      byMeseMap.set(m.mese, Math.round(((byMeseMap.get(m.mese) ?? 0) + sub) * 100) / 100)
    }
    const byMese = [...byMeseMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([meseKey, importo]) => ({
      mese: meseKey,
      label: meseKey.slice(5),
      importo,
    }))

    const totLpaga = Math.round(lpSlices.reduce((s, x) => s + x.importo, 0) * 100) / 100
    const totSpese = Math.round((tot - totLpaga) * 100) / 100

    res.json({
      anno,
      mese: mese || null,
      repartoId: repartoId || null,
      tot,
      totFisso,
      totVariabile,
      totSpese: Math.round(totSpese * 100) / 100,
      totCollaboratori: totLpaga,
      byMacro,
      byReparto,
      byMese,
      nSpese: spese.length,
    })
  } catch (e) {
    fail(res, e)
  }
}
