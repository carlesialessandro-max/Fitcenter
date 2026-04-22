import fs from "fs"
import path from "path"
import crypto from "crypto"
import type { Request, Response } from "express"
import { signatureStore } from "../store/esign.js"
import { sendMail } from "../services/mailer.js"
import type { SignatureField, SignatureRequest, SignatureSlot, SignatureStep } from "../types/esign.js"
import { defaultSignatureSlots, ensureSignatureSlots } from "../signature/defaultSlots.js"
import { ensureSignatureFields } from "../signature/defaultFields.js"
import type { PrivacyPageText } from "../signature/privacy-page-defaults.js"
import { PDFDocument } from "pdf-lib"

const OTP_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 20 * 60 * 1000
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_OTP_ATTEMPTS = 5

function sha(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex")
}

function nowIso(): string {
  return new Date().toISOString()
}

function randomOtp(): string {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, "0")
}

function randomToken(size = 32): string {
  return crypto.randomBytes(size).toString("base64url")
}

function isExpired(iso?: string): boolean {
  if (!iso) return true
  return Date.now() > new Date(iso).getTime()
}

function ensurePending(row: SignatureRequest): string | null {
  const steps = normalizedSteps(row)
  const completed = steps.length > 0 && steps.every((s) => !!s.signedAt)
  if (row.status === "signed" && completed) return "Documento già firmato"
  if (isExpired(row.expiresAt)) return "Richiesta scaduta"
  return null
}

function normalizedSteps(row: SignatureRequest): SignatureStep[] {
  const defaults = defaultSignatureSlots()
  const defaultById = new Map(defaults.map((d) => [d.id, d]))
  const existing = Array.isArray(row.steps) ? row.steps : []
  if (existing.length === 0) return toSteps(defaults)
  // Allineato a ensureSignatureSlots: la richiesta memorizza gli step del template (1..N), non sempre 5.
  return existing
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const base = defaultById.get(s.id)
      return base ? { ...base, ...s } : { ...s }
    })
}

function getBaseUrl(req: Request): string {
  const envBase = process.env.SIGN_BASE_URL?.trim()
  if (envBase) return envBase.replace(/\/$/, "")
  const proto = (req.headers["x-forwarded-proto"]?.toString().split(",")[0] ?? req.protocol ?? "https")
    .toString()
    .replace(/:$/, "")
  const host =
    req.headers["x-forwarded-host"]?.toString().split(",")[0]?.trim() || req.get("host") || ""
  return `${proto}://${host}`
}

function appendAudit(row: SignatureRequest, ev: Omit<SignatureRequest["audit"][number], "at">): SignatureRequest["audit"] {
  const audit = Array.isArray(row.audit) ? row.audit.slice() : []
  audit.push({ at: nowIso(), ...ev })
  return audit
}

function shouldAppendAudit(args: { row: SignatureRequest; type: SignatureRequest["audit"][number]["type"]; minMs: number }): boolean {
  const list = Array.isArray(args.row.audit) ? args.row.audit : []
  const last = list.length > 0 ? list[list.length - 1] : null
  if (!last || last.type !== args.type) return true
  const dt = new Date(last.at).getTime()
  if (!Number.isFinite(dt)) return true
  return Date.now() - dt > args.minMs
}

function toSteps(slots: SignatureSlot[]): SignatureStep[] {
  return slots
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ ...s }))
}

function fmtItDateTimeFromIso(iso: string | undefined | null): string | null {
  const s = String(iso ?? "").trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const pad2 = (n: number) => String(n).padStart(2, "0")
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

async function renderPdfWithSteps(
  basePath: string,
  steps: SignatureStep[],
  signerName?: string,
  meta?: { otpVerifiedAt?: string | null }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(fs.readFileSync(basePath))
  const pages = pdfDoc.getPages()
  const font = await pdfDoc.embedFont("Helvetica")

  const otpIt = fmtItDateTimeFromIso(meta?.otpVerifiedAt)
  if (otpIt && pages.length > 0) {
    // Footer minimale nel PDF firmato: timestamp OTP dentro al file generato.
    pages[0]!.drawText(`OTP verificato: ${otpIt}`, { x: 30, y: 14, size: 7, font })
  }

  for (const step of steps) {
    if (!step.signatureDataUrl) continue
    const pageIdx = Math.max(0, Math.min(pages.length - 1, (step.page ?? 1) - 1))
    const page = pages[pageIdx]
    const signatureBase64 = step.signatureDataUrl.split(",")[1] ?? ""
    if (!signatureBase64) continue
    const signatureBytes = Buffer.from(signatureBase64, "base64")
    const png = await pdfDoc.embedPng(signatureBytes)
    // Firma: evitiamo l'effetto "stampino" troppo alto.
    // Manteniamo il rapporto d'aspetto dell'immagine e la facciamo stare nel box,
    // ma usando un'altezza massima più "da firma" (più larga, meno alta).
    const boxW = Number(step.width) || 0
    const boxH = Number(step.height) || 0
    const maxH = boxH > 0 ? boxH * 0.8 : boxH
    const imgW = (png as any).width ?? boxW
    const imgH = (png as any).height ?? boxH
    const scale = imgW > 0 && imgH > 0 ? Math.min(boxW / imgW, maxH / imgH) : 1
    const drawW = imgW * scale
    const drawH = imgH * scale
    const dx = step.x + Math.max(0, (boxW - drawW) / 2)
    const dy = step.y + Math.max(0, (boxH - drawH) / 2) // centrata nel box
    page.drawImage(png, { x: dx, y: dy, width: drawW, height: drawH })
    if (signerName?.trim()) {
      page.drawText(signerName.trim(), { x: step.x, y: step.y + step.height + 8, size: 9, font })
    }
  }
  return await pdfDoc.save()
}

function clampTextToWidth(args: { text: string; maxWidth: number; font: any; size: number }): string {
  const t = (args.text ?? "").trim()
  if (!t) return ""
  try {
    // pdf-lib font: widthOfTextAtSize
    if (args.font.widthOfTextAtSize(t, args.size) <= args.maxWidth) return t
    let out = t
    while (out.length > 1 && args.font.widthOfTextAtSize(out + "…", args.size) > args.maxWidth) {
      out = out.slice(0, -1)
    }
    return out.length < t.length ? out + "…" : out
  } catch {
    return t
  }
}

function wrapTextToLines(args: { text: string; maxWidth: number; font: any; size: number; maxLines?: number }): string[] {
  const raw = (args.text ?? "").trim()
  if (!raw) return []
  const words = raw.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  const pushLine = (s: string) => {
    if (!s.trim()) return
    lines.push(s.trim())
  }
  const fits = (s: string) => {
    try {
      return args.font.widthOfTextAtSize(s, args.size) <= args.maxWidth
    } catch {
      return s.length <= 80
    }
  }

  for (const w of words) {
    const cand = current ? `${current} ${w}` : w
    if (!current) {
      current = w
      continue
    }
    if (fits(cand)) {
      current = cand
    } else {
      pushLine(current)
      current = w
      if (args.maxLines && lines.length >= args.maxLines) break
    }
  }
  if ((!args.maxLines || lines.length < args.maxLines) && current) pushLine(current)
  return args.maxLines ? lines.slice(0, args.maxLines) : lines
}

function wrapMultilineText(args: { text: string; maxWidth: number; font: any; size: number; maxLines?: number }): string[] {
  // Preserva gli a-capo inseriti nel testo (es. righe Totale/Versato).
  const blocks = String(args.text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
  const out: string[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] ?? ""
    const trimmed = b.trim()
    if (!trimmed) {
      // riga vuota = a-capo
      out.push("")
      continue
    }
    const wrapped = wrapTextToLines({ text: trimmed, maxWidth: args.maxWidth, font: args.font, size: args.size })
    out.push(...wrapped)
    // Mantieni l'a-capo originale tra blocchi non vuoti.
    if (i < blocks.length - 1) out.push("")
    if (args.maxLines && out.length >= args.maxLines) return out.slice(0, args.maxLines)
  }
  return args.maxLines ? out.slice(0, args.maxLines) : out
}

async function renderPdfWithPrefill(basePath: string, fields: SignatureField[], prefill: Record<string, string>): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(fs.readFileSync(basePath))
  const pages = pdfDoc.getPages()
  const font = await pdfDoc.embedFont("Helvetica")
  const boldFont = await pdfDoc.embedFont("Helvetica-Bold")
  const pad2 = (n: number) => String(n).padStart(2, "0")
  const nowItDateTime = () => {
    const d = new Date()
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  const normalizeKey = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  const prefillNorm = new Map<string, string>()
  for (const [k, v] of Object.entries(prefill ?? {})) {
    const nk = normalizeKey(String(k))
    if (!nk) continue
    if (!prefillNorm.has(nk)) prefillNorm.set(nk, v == null ? "" : String(v))
  }

  const totalTxt = (prefillNorm.get("totale_generale") ?? "").trim()
  const versatoTxt = (prefillNorm.get("versato_generale") ?? "").trim()
  const parseEuro = (s: string): number | null => {
    const raw = String(s ?? "").trim()
    if (!raw) return null
    // Tieni solo cifre e separatori
    const cleaned = raw.replace(/[^\d.,-]/g, "")
    if (!cleaned) return null
    // Caso IT: 1.234,56 -> 1234.56
    const hasComma = cleaned.includes(",")
    const normalized = hasComma ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned
    const n = Number(normalized)
    return Number.isFinite(n) ? n : null
  }
  const totalNum = parseEuro(totalTxt)
  const versatoNum = parseEuro(versatoTxt)

  // Footer automatico: data+ora generazione in fondo alla prima pagina.
  if (pages[0]) {
    const p0 = pages[0]
    const footer = `Generato il ${nowItDateTime()}`
    p0.drawText(footer, { x: 30, y: 14, size: 8, font })
  }

  // Layout: prendiamo le coordinate dal template (campi totale/versato generale).
  // In questo modo i totali risultano allineati dove li ha messi il PDF.
  const FALLBACK_COL_W = 80
  const fallback = {
    totale: { x: 420, y: 555, w: FALLBACK_COL_W },
    versato: { x: 490, y: 555, w: FALLBACK_COL_W },
    pageIdx: 0,
  }
  let totalsLayout: {
    pageIdx: number
    totale: { x: number; y: number; w: number; size: number }
    versato: { x: number; y: number; w: number; size: number }
  } | null = null

  const rightAlignX = (txt: string, rightX: number, size: number, fnt: any, colW = FALLBACK_COL_W) => {
    const t = (txt ?? "").trim()
    if (!t) return null
    try {
      const w = fnt.widthOfTextAtSize(t, size)
      return Math.max(0, rightX - w)
    } catch {
      return Math.max(0, rightX - Math.min(colW, t.length * (size * 0.55)))
    }
  }

  for (const f of fields) {
    const id = String(f.id ?? "").trim()
    const idNorm = normalizeKey(id)
    const labelNorm = normalizeKey(String(f.label ?? ""))
    const direct = (prefill as any)?.[id]
    const alt =
      direct ??
      prefillNorm.get(normalizeKey(id)) ??
      (f.label ? prefillNorm.get(normalizeKey(String(f.label))) : undefined)
    // Fallback specifico: tessera ASI può essere mappata come Custom2 in vista, ma nel template avere label "ASI Tessera N."
    const alt2 =
      alt ??
      (/asi/i.test(id) || /asi/i.test(String(f.label ?? "")) ? prefillNorm.get("custom2") ?? prefillNorm.get("asi_tessera") : undefined)
    const text = String((alt2 ?? alt) ?? "").trim()
    if (!text) continue
    const pageIdx = Math.max(0, Math.min(pages.length - 1, (f.page ?? 1) - 1))
    const page = pages[pageIdx]
    const size = Math.max(7, Math.min(18, Number(f.size ?? 10)))
    const maxWidth = f.maxWidth != null ? Math.max(30, Number(f.maxWidth)) : null

    // Se in alto ci sono campi che mostrano esattamente il totale/versato generale,
    // non li renderizziamo: i totali devono comparire solo nella riga "Totale Generale".
    if (Number(f.y ?? 0) >= 650) {
      const n = parseEuro(text)
      const sameTotal = n != null && totalNum != null && Math.abs(n - totalNum) < 0.01
      const sameVersato = n != null && versatoNum != null && Math.abs(n - versatoNum) < 0.01
      if (sameTotal || sameVersato) continue
    }

    // Totali generali: non disegniamo qui, prendiamo solo il layout dal template.
    if (idNorm === "totale_generale" || labelNorm === "totale_generale") {
      const y = Number(f.y ?? NaN)
      if (Number.isFinite(y)) {
        const w = maxWidth ?? FALLBACK_COL_W
        totalsLayout = totalsLayout ?? {
          pageIdx,
          totale: { x: Number(f.x ?? fallback.totale.x), y, w, size: 10 },
          versato: { x: fallback.versato.x, y: fallback.versato.y, w: FALLBACK_COL_W, size: 10 },
        }
        totalsLayout.totale = { x: Number(f.x ?? fallback.totale.x), y, w, size: 10 }
        totalsLayout.pageIdx = pageIdx
      }
      continue
    }
    if (idNorm === "versato_generale" || labelNorm === "versato_generale") {
      const y = Number(f.y ?? NaN)
      if (Number.isFinite(y)) {
        const w = maxWidth ?? FALLBACK_COL_W
        totalsLayout = totalsLayout ?? {
          pageIdx,
          totale: { x: fallback.totale.x, y: fallback.totale.y, w: FALLBACK_COL_W, size: 10 },
          versato: { x: Number(f.x ?? fallback.versato.x), y, w, size: 10 },
        }
        totalsLayout.versato = { x: Number(f.x ?? fallback.versato.x), y, w, size: 10 }
        totalsLayout.pageIdx = pageIdx
      }
      continue
    }

    if (f.multiline && maxWidth) {
      const lh = f.lineHeight != null ? Math.max(8, Number(f.lineHeight)) : Math.max(10, Math.round(size * 1.2))
      const maxLines = f.maxLines != null ? Math.max(1, Math.floor(f.maxLines)) : undefined
      // Caso speciale: tabella movimenti (descrizione a sinistra, Totale e Versato allineati a destra).
      if (String(f.id) === "movimenti") {
        const blocks = String(text ?? "").replace(/\r\n/g, "\n").split("\n")
        // Coordinate coerenti col template: 4 colonne (Servizio | Descrizione | Totale | Versato)
        const layout = totalsLayout ?? { ...fallback, totale: { ...fallback.totale, size: 10 }, versato: { ...fallback.versato, size: 10 } }
        const colW = Math.max(60, Math.min(140, Math.floor(layout.totale.w)))
        const xServizioLeft = 30
        const xDescLeft = 140
        const xTotaleLeft = layout.totale.x
        const xVersatoLeft = layout.versato.x
        const rightXTotale = xTotaleLeft + colW
        const rightXVersato = xVersatoLeft + colW
        const toAmount = (s: string) => clampTextToWidth({ text: s.trim(), maxWidth: colW, font, size })
        const toServizio = (s: string) =>
          clampTextToWidth({ text: s.trim(), maxWidth: Math.max(60, xDescLeft - xServizioLeft - 10), font, size })
        const toDescLines = (s: string) =>
          wrapTextToLines({ text: s.trim(), maxWidth: Math.max(120, xTotaleLeft - xDescLeft - 12), font, size })

        let lineNo = 0
        for (const rawLine of blocks) {
          if (maxLines && lineNo >= maxLines) break
          const line = String(rawLine ?? "")
          const t = line.trim()
          const y = f.y - lineNo * lh
          if (!t) {
            lineNo++
            continue
          }
          const parts = t.split("\t")
          const servizioRaw = parts[0] ?? ""
          const descRaw = parts[1] ?? ""
          const totRaw = parts[2] ?? ""
          const verRaw = parts[3] ?? ""

          const servizio = toServizio(servizioRaw)
          if (servizio) page.drawText(servizio, { x: xServizioLeft, y, size, font })

          const tot = toAmount(totRaw)
          const ver = toAmount(verRaw)
          if (tot) {
            const x = rightAlignX(tot, rightXTotale, size, font, colW)
            if (x != null) page.drawText(tot, { x, y, size, font })
          }
          if (ver) {
            const x = rightAlignX(ver, rightXVersato, size, font, colW)
            if (x != null) page.drawText(ver, { x, y, size, font })
          }

          const descLines = toDescLines(descRaw)
          if (descLines.length <= 1) {
            const d0 = (descLines[0] ?? "").trim()
            if (d0) page.drawText(d0, { x: xDescLeft, y, size, font })
            lineNo++
            continue
          }
          // Se la descrizione va su più righe, consumiamo righe extra solo per la colonna descrizione.
          for (let j = 0; j < descLines.length; j++) {
            if (maxLines && lineNo >= maxLines) break
            const y2 = f.y - lineNo * lh
            const dl = (descLines[j] ?? "").trim()
            if (j === 0) {
              if (dl) page.drawText(dl, { x: xDescLeft, y: y2, size, font })
              lineNo++
              continue
            }
            if (dl) page.drawText(dl, { x: xDescLeft, y: y2, size, font })
            lineNo++
          }
        }
      } else {
        const lines = wrapMultilineText({ text, maxWidth, font, size, maxLines })
        for (let i = 0; i < lines.length; i++) {
          // Coordinate PDF: y cresce verso l’alto → per andare “a capo” scendiamo di lh
          page.drawText(lines[i] ?? "", { x: f.x, y: f.y - i * lh, size, font })
        }
      }
    } else {
      const drawText = maxWidth ? clampTextToWidth({ text, maxWidth, font, size }) : text
      page.drawText(drawText, { x: f.x, y: f.y, size, font })
    }
  }

  // Fallback finale: se la tessera ASI non è stata agganciata a nessun campo del template,
  // proviamo comunque a disegnarla nel box ASI (usa Custom2/asi_tessera dal prefill).
  const asiCandidate = (prefillNorm.get("custom2") ?? prefillNorm.get("asi_tessera") ?? "").trim()
  if (asiCandidate) {
    // Disegniamo SEMPRE nel box ASI: così funziona anche se il template ha un campo ASI ma con coordinate errate.
    const page = pages[0]
    const size = 9
    const x = 140
    const y = 285
    page.drawText(clampTextToWidth({ text: asiCandidate, maxWidth: 220, font, size }), { x, y, size, font })
  }

  // Render totali generali in grassetto nelle coordinate del template (2 colonne).
  {
    const layout = totalsLayout ?? { ...fallback, totale: { ...fallback.totale, size: 10 }, versato: { ...fallback.versato, size: 10 } }
    const page = pages[Math.max(0, Math.min(pages.length - 1, layout.pageIdx))] ?? pages[0]
    const { width } = page.getSize()
    const size = 10
    // Alcuni template hanno y leggermente diverse tra i 2 campi: allineiamo sulla stessa riga.
    const yRow = Math.min(layout.totale.y, layout.versato.y)
    if (totalTxt) {
      const w = layout.totale.w || FALLBACK_COL_W
      const draw = clampTextToWidth({ text: totalTxt, maxWidth: w, font: boldFont, size })
      const rightX = Math.min(layout.totale.x + w, Math.max(0, width - 6))
      const x = rightAlignX(draw, rightX, size, boldFont, w)
      if (x != null) page.drawText(draw, { x, y: yRow, size, font: boldFont })
    }
    if (versatoTxt) {
      const w = layout.versato.w || FALLBACK_COL_W
      const draw = clampTextToWidth({ text: versatoTxt, maxWidth: w, font: boldFont, size })
      const rightX = Math.min(layout.versato.x + w, Math.max(0, width - 6))
      const x = rightAlignX(draw, rightX, size, boldFont, w)
      if (x != null) page.drawText(draw, { x, y: yRow, size, font: boldFont })
    }
  }

  return await pdfDoc.save()
}

export async function createSignatureRequest(req: Request, res: Response) {
  try {
    const isAdmin = req.user?.role === "admin"
    const f = req.file
    const templateId = String(req.body.templateId ?? "").trim()
    const customerEmail = String(req.body.customerEmail ?? "").trim().toLowerCase()
    const customerName = String(req.body.customerName ?? "").trim()
    const customerGestionaleId = String(req.body.customerGestionaleId ?? "").trim() || undefined
    const prefillRaw = String(req.body.prefill ?? "").trim()
    let prefill: Record<string, string> | undefined
    if (prefillRaw) {
      try {
        const parsed = JSON.parse(prefillRaw) as unknown
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          prefill = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [String(k), v == null ? "" : String(v)])
          )
        }
      } catch {
        // ignore
      }
    }
    if (!f && !templateId) return res.status(400).json({ message: "PDF o template obbligatorio" })
    if (!isAdmin && !templateId) return res.status(403).json({ message: "Operatore: selezionare un template esistente" })
    if (!isAdmin && f) return res.status(403).json({ message: "Operatore: upload PDF non consentito" })
    if (!customerEmail || !customerEmail.includes("@")) return res.status(400).json({ message: "Email cliente non valida" })
    if (f) {
      const isPdf = f.mimetype === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf")
      if (!isPdf) return res.status(400).json({ message: "Caricare un file PDF" })
    }

    const id = crypto.randomUUID()
    const publicToken = randomToken(24)
    const destDir = signatureStore.resolveSignatureDir()

    let fileName = ""
    let originalName = ""
    let templateName: string | undefined
    let slots: SignatureSlot[] = defaultSignatureSlots()
    let fields: SignatureField[] = ensureSignatureFields(null)
    if (templateId) {
      const tpl = signatureStore.getTemplateById(templateId)
      if (!tpl || !tpl.active) return res.status(400).json({ message: "Template non valido" })
      const templatePath = path.join(destDir, tpl.fileName)
      if (!fs.existsSync(templatePath)) return res.status(400).json({ message: "File template non trovato" })
      const ext = path.extname(tpl.originalName || "").toLowerCase() || ".pdf"
      fileName = `${id}${ext}`
      originalName = tpl.originalName
      templateName = tpl.name
      slots = ensureSignatureSlots(tpl.slots as SignatureSlot[] | undefined)
      fields = ensureSignatureFields((tpl as any).fields as SignatureField[] | undefined)
      fs.copyFileSync(templatePath, path.join(destDir, fileName))
      // Precompila PDF (se prefill presente)
      if (prefill && Object.keys(prefill).length > 0 && fields.length > 0) {
        const target = path.join(destDir, fileName)
        const bytes = await renderPdfWithPrefill(target, fields, prefill)
        fs.writeFileSync(target, bytes)
      }
    } else if (f) {
      const ext = path.extname(f.originalname || "").toLowerCase() || ".pdf"
      fileName = `${id}${ext}`
      originalName = f.originalname || "document.pdf"
      fs.writeFileSync(path.join(destDir, fileName), f.buffer)
    }

    const row: SignatureRequest = {
      id,
      publicToken,
      status: "pending",
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS).toISOString(),
      createdByUsername: req.user?.username ?? "admin",
      customerEmail,
      customerName: customerName || undefined,
      templateId: templateId || undefined,
      templateName,
      documentFileName: fileName,
      documentOriginalName: originalName || "document.pdf",
      documentMimeType: "application/pdf",
      otpAttempts: 0,
      audit: [{ at: nowIso(), type: "created" }],
      steps: toSteps(slots),
      prefill,
      customerGestionaleId,
    }
    signatureStore.create(row)

    const link = `${getBaseUrl(req)}/firma/${encodeURIComponent(publicToken)}`
    await sendMail({
      to: customerEmail,
      subject: "Documento da firmare - FitCenter",
      text:
        `Ciao${customerName ? ` ${customerName}` : ""},\n\n` +
        `ti invitiamo a firmare il documento al seguente link:\n${link}\n\n` +
        `Il link scade il ${new Date(row.expiresAt).toLocaleString("it-IT")}.\n`,
    })

    res.json({
      id: row.id,
      token: row.publicToken,
      status: row.status,
      customerEmail: row.customerEmail,
      customerName: row.customerName,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      signingUrl: link,
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function listSignatureRequests(_req: Request, res: Response) {
  const isAdmin = _req.user?.role === "admin"
  const username = (_req.user?.username ?? "").trim().toLowerCase()
  const qFrom = String(_req.query?.from ?? "").trim()
  const qTo = String(_req.query?.to ?? "").trim()
  const qConsultant = String(_req.query?.consultant ?? "").trim().toLowerCase()
  const page = Math.max(1, Number(_req.query?.page ?? 1) || 1)
  const limit = Math.min(200, Math.max(10, Number(_req.query?.limit ?? 50) || 50))

  const fromMs = qFrom ? new Date(qFrom).getTime() : NaN
  const toMs = qTo ? new Date(qTo).getTime() : NaN
  const matchFrom = (iso: string) => (Number.isFinite(fromMs) ? new Date(iso).getTime() >= fromMs : true)
  const matchTo = (iso: string) => (Number.isFinite(toMs) ? new Date(iso).getTime() <= toMs : true)

  const base = signatureStore.list().filter((r) => {
    const createdBy = String(r.createdByUsername ?? "").trim().toLowerCase()
    if (!isAdmin && createdBy !== username) return false
    if (isAdmin && qConsultant && createdBy !== qConsultant) return false
    if (!matchFrom(r.createdAt)) return false
    if (!matchTo(r.createdAt)) return false
    return true
  })

  const total = base.length
  const start = (page - 1) * limit
  const slice = base.slice(start, start + limit)
  const rows = slice.map((r) => ({
    ...(function () {
      const steps = normalizedSteps(r)
      const completed = steps.length > 0 && steps.every((s) => !!s.signedAt)
      const status = completed ? "signed" : isExpired(r.expiresAt) ? "expired" : "pending"
      return { status }
    })(),
    id: r.id,
    token: r.publicToken,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    createdByUsername: r.createdByUsername,
    customerEmail: r.customerEmail,
    customerName: r.customerName,
    signedAt: r.signedAt,
    documentOriginalName: r.documentOriginalName,
    signedDocumentFileName: r.signedDocumentFileName,
  }))
  res.json({ rows, page, limit, total })
}

export async function deleteSignatureRequest(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim()
  if (!id) return res.status(400).json({ message: "Id richiesta mancante" })
  const row = signatureStore.getById(id)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
  const isAdmin = req.user?.role === "admin"
  const username = (req.user?.username ?? "").trim().toLowerCase()
  const createdBy = String(row.createdByUsername ?? "").trim().toLowerCase()
  if (!isAdmin && createdBy !== username) return res.status(403).json({ message: "Permessi insufficienti" })
  const deleted = signatureStore.deleteById(id)
  if (!deleted) return res.status(404).json({ message: "Richiesta non trovata" })
  const deleteFiles = String((req.query as any)?.deleteFiles ?? "").trim() === "1"
  if (deleteFiles) {
    const dir = signatureStore.resolveSignatureDir()
    for (const file of [deleted.documentFileName, deleted.signedDocumentFileName]) {
      if (!file) continue
      const p = path.join(dir, file)
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p)
        } catch {
          // best effort
        }
      }
    }
  }
  res.json({ ok: true })
}

export async function getPublicSignatureInfo(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
  if (shouldAppendAudit({ row, type: "document_opened", minMs: 60_000 })) {
    signatureStore.updateById(row.id, (r) => ({
      ...r,
      audit: appendAudit(r, {
        type: "document_opened",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
        ok: true,
        link: { requestId: r.id, token: r.publicToken, documentFileName: r.documentFileName, customerEmail: r.customerEmail },
        message: "Apertura link firma",
      }),
    }))
  }
  const steps = normalizedSteps(row)
  const completed = steps.length > 0 && steps.every((s) => !!s.signedAt)
  const status = completed ? "signed" : isExpired(row.expiresAt) ? "expired" : "pending"
  const next = steps.find((s) => !s.signedAt)
  res.json({
    token: row.publicToken,
    status,
    customerEmailMasked: row.customerEmail.replace(/(^.).+(@.+$)/, "$1***$2"),
    customerEmail: row.customerEmail,
    customerName: row.customerName,
    documentOriginalName: row.documentOriginalName,
    expiresAt: row.expiresAt,
    signedAt: row.signedAt,
    totalSteps: steps.length,
    signedSteps: steps.filter((s) => !!s.signedAt).length,
    nextStepId: next?.id ?? null,
    nextStepLabel: next?.label ?? null,
  })
}

export async function downloadPublicSignatureDocument(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
  const fileName = row.status === "signed" && row.signedDocumentFileName ? row.signedDocumentFileName : row.documentFileName
  const docPath = path.join(signatureStore.resolveSignatureDir(), fileName)
  if (!fs.existsSync(docPath)) return res.status(404).json({ message: "Documento non trovato" })
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(row.status === "signed" ? row.documentOriginalName : row.documentOriginalName)}"`
  )
  fs.createReadStream(docPath).pipe(res)
}

export async function exportSignatureAudit(_req: Request, res: Response) {
  const qId = String((_req.query as any)?.id ?? "").trim()
  const qToken = String((_req.query as any)?.token ?? "").trim()
  const rows = signatureStore
    .list()
    .filter((r) => (!qId || r.id === qId) && (!qToken || r.publicToken === qToken))
  const safe = rows.map((r) => ({
    id: r.id,
    token: r.publicToken,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    signedAt: r.signedAt,
    customerEmail: r.customerEmail,
    customerName: r.customerName,
    documentOriginalName: r.documentOriginalName,
    signedDocumentFileName: r.signedDocumentFileName,
    otpAttempts: r.otpAttempts,
    otpVerifiedAt: r.otpVerifiedAt,
    audit: r.audit ?? [],
  }))
  res.json({ rows: safe, exportedAt: nowIso() })
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function fmtRome(iso: unknown): string {
  const s = iso == null ? "" : String(iso).trim()
  if (!s) return ""
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d)
}

export async function exportSignatureAuditCsv(_req: Request, res: Response) {
  const qId = String((_req.query as any)?.id ?? "").trim()
  const qToken = String((_req.query as any)?.token ?? "").trim()
  const rows = signatureStore
    .list()
    .filter((r) => (!qId || r.id === qId) && (!qToken || r.publicToken === qToken))
  const header = [
    "requestId",
    "token",
    "status",
    "createdAt",
    "createdAt_IT",
    "expiresAt",
    "expiresAt_IT",
    "signedAt",
    "signedAt_IT",
    "customerEmail",
    "customerName",
    "documentOriginalName",
    "documentFileName",
    "signedDocumentFileName",
    "eventAt",
    "eventAt_IT",
    "eventType",
    "eventOk",
    "channel",
    "destination",
    "ip",
    "userAgent",
    "message",
  ]
  const lines: string[] = []
  lines.push(header.join(","))
  for (const r of rows) {
    const audit = Array.isArray(r.audit) ? r.audit : []
    if (audit.length === 0) {
      const base = [
        r.id,
        r.publicToken,
        r.status,
        r.createdAt,
        fmtRome(r.createdAt),
        r.expiresAt,
        fmtRome(r.expiresAt),
        r.signedAt ?? "",
        fmtRome(r.signedAt),
        r.customerEmail,
        r.customerName ?? "",
        r.documentOriginalName,
        r.documentFileName,
        r.signedDocumentFileName ?? "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]
      lines.push(base.map(csvEscape).join(","))
      continue
    }
    for (const ev of audit) {
      const row = [
        r.id,
        r.publicToken,
        r.status,
        r.createdAt,
        fmtRome(r.createdAt),
        r.expiresAt,
        fmtRome(r.expiresAt),
        r.signedAt ?? "",
        fmtRome(r.signedAt),
        r.customerEmail,
        r.customerName ?? "",
        r.documentOriginalName,
        r.documentFileName,
        r.signedDocumentFileName ?? "",
        ev.at,
        fmtRome(ev.at),
        ev.type,
        ev.ok == null ? "" : String(ev.ok),
        (ev as any).channel ?? "",
        (ev as any).destination ?? "",
        ev.ip ?? "",
        ev.userAgent ?? "",
        ev.message ?? "",
      ]
      lines.push(row.map(csvEscape).join(","))
    }
  }
  const out = lines.join("\r\n")
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  const suffix = qId ? `-${qId}` : qToken ? `-${qToken}` : ""
  res.setHeader("Content-Disposition", `attachment; filename="firma-audit${suffix}-${new Date().toISOString().slice(0, 10)}.csv"`)
  // BOM per Excel (UTF-8)
  res.send(`\uFEFF${out}`)
}

export async function requestSignatureOtp(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
  const err = ensurePending(row)
  if (err) return res.status(400).json({ message: err })

  const otp = randomOtp()
  const updated = signatureStore.updateById(row.id, (r) => ({
    ...r,
    otpCodeHash: sha(otp),
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    otpAttempts: 0,
    audit: appendAudit(r, {
      type: "otp_requested",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
      channel: "email",
      destination: r.customerEmail,
      ok: true,
      link: {
        requestId: r.id,
        token: r.publicToken,
        documentFileName: r.documentFileName,
        customerEmail: r.customerEmail,
        otpCodeHash: sha(otp),
      },
      message: "OTP richiesta",
    }),
  }))
  if (!updated) return res.status(500).json({ message: "Errore interno" })

  const mailRes = await sendMail({
    to: row.customerEmail,
    subject: "Codice OTP firma documento - FitCenter",
    text: `Il tuo codice OTP è: ${otp}\nScade tra 10 minuti.`,
  })
  signatureStore.updateById(row.id, (r) => ({
    ...r,
    audit: appendAudit(r, {
      type: "otp_sent",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
      channel: "email",
      destination: r.customerEmail,
      ok: !!mailRes.sent,
      link: { requestId: r.id, token: r.publicToken, documentFileName: r.documentFileName, customerEmail: r.customerEmail, otpCodeHash: r.otpCodeHash },
      message: mailRes.sent ? "OTP inviata" : "Invio OTP fallito",
    }),
  }))
  res.json({
    ok: true,
    // Utile in sviluppo locale quando SMTP non è configurato.
    debugOtp: process.env.NODE_ENV === "production" ? undefined : otp,
  })
}

export async function verifySignatureOtp(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const otp = String(req.body?.otp ?? "").trim()
  const acceptedTerms = !!req.body?.acceptedTerms
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
  const err = ensurePending(row)
  if (err) return res.status(400).json({ message: err })
  if (!row.otpCodeHash || !row.otpExpiresAt) return res.status(400).json({ message: "OTP non richiesto" })
  if (isExpired(row.otpExpiresAt)) return res.status(400).json({ message: "OTP scaduto" })
  if ((row.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) return res.status(429).json({ message: "Troppi tentativi OTP" })
  if (!acceptedTerms) return res.status(400).json({ message: "Consenso obbligatorio (accetta i termini)" })

  const otpHash = sha(otp)
  if (otpHash !== row.otpCodeHash) {
    signatureStore.updateById(row.id, (r) => ({
      ...r,
      otpAttempts: (r.otpAttempts ?? 0) + 1,
      audit: appendAudit(r, {
        type: "otp_invalid",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
        channel: "email",
        destination: r.customerEmail,
        ok: false,
        link: { requestId: r.id, token: r.publicToken, documentFileName: r.documentFileName, customerEmail: r.customerEmail, otpCodeHash: r.otpCodeHash },
        message: "OTP non valido",
      }),
    }))
    return res.status(400).json({ message: "OTP non valido" })
  }

  const signerToken = randomToken(24)
  const updated = signatureStore.updateById(row.id, (r) => ({
    ...r,
    consentAcceptedAt: r.consentAcceptedAt ?? nowIso(),
    otpVerifiedAt: nowIso(),
    signerSessionTokenHash: sha(signerToken),
    signerSessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    otpCodeHash: undefined,
    otpExpiresAt: undefined,
    otpAttempts: 0,
    audit: appendAudit(
      { ...r, audit: appendAudit(r, { type: "consent_accepted", ip: req.ip, userAgent: req.headers["user-agent"]?.toString(), ok: true, message: "Consenso accettato" }) },
      { type: "otp_verified", ip: req.ip, userAgent: req.headers["user-agent"]?.toString(), channel: "email", destination: r.customerEmail, ok: true, message: "OTP verificato" }
    ),
  }))
  if (!updated) return res.status(500).json({ message: "Errore interno" })
  res.json({ ok: true, signerToken })
}

export async function listSignatureTemplates(_req: Request, res: Response) {
  const rows = signatureStore.listTemplates().map((t) => ({
    ...t,
    // Template senza layout nel JSON: applichiamo i default (slots+fields) oppure l’elenco salvato.
    slots: ensureSignatureSlots(t.slots as SignatureSlot[] | undefined),
    fields: ensureSignatureFields((t as any).fields as SignatureField[] | undefined),
  }))
  res.json(rows)
}

export async function createSignatureTemplate(req: Request, res: Response) {
  try {
    const f = req.file
    const name = String(req.body.name ?? "").trim()
    const privacyProfileIdRaw = String(req.body.privacyProfileId ?? "").trim()
    if (!f) return res.status(400).json({ message: "PDF template obbligatorio" })
    if (!name) return res.status(400).json({ message: "Nome template obbligatorio" })
    const isPdf = f.mimetype === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf")
    if (!isPdf) return res.status(400).json({ message: "Caricare un PDF" })
    const privacyProfileId =
      privacyProfileIdRaw && signatureStore.getPrivacyProfileById(privacyProfileIdRaw) ? privacyProfileIdRaw : "default"

    const id = crypto.randomUUID()
    const ext = path.extname(f.originalname || "").toLowerCase() || ".pdf"
    const fileName = `template-${id}${ext}`
    const dir = signatureStore.resolveSignatureDir()
    fs.writeFileSync(path.join(dir, fileName), f.buffer)
    const tpl = signatureStore.createTemplate({
      id,
      name,
      fileName,
      originalName: f.originalname || "template.pdf",
      mimeType: "application/pdf",
      createdAt: nowIso(),
      active: true,
      privacyProfileId,
      // Nuovo template: 1 firma di default (poi l'admin può aggiungere slot se necessario).
      slots: [{ id: "firma-1", label: "Firma", page: 1, x: 330, y: 90, width: 240, height: 80, order: 1 }],
      fields: ensureSignatureFields(null),
    })
    res.json(tpl)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function updateSignatureTemplateSlots(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim()
  if (!id) return res.status(400).json({ message: "Id template mancante" })
  const tpl = signatureStore.getTemplateById(id)
  if (!tpl) return res.status(404).json({ message: "Template non trovato" })
  const slotsRaw = Array.isArray(req.body?.slots) ? req.body.slots : null
  if (!slotsRaw) return res.status(400).json({ message: "slots obbligatorio" })
  const slots: SignatureSlot[] = slotsRaw.map((s: Record<string, unknown>, i: number) => ({
    id: String(s.id ?? `slot-${i + 1}`),
    label: String(s.label ?? `Firma ${i + 1}`),
    page: Math.max(1, Number(s.page ?? 1)),
    x: Number(s.x ?? 50),
    y: Number(s.y ?? 50),
    width: Math.max(40, Number(s.width ?? 220)),
    height: Math.max(20, Number(s.height ?? 80)),
    order: Math.max(1, Number(s.order ?? i + 1)),
  }))
  const fieldsRaw = Array.isArray(req.body?.fields) ? req.body.fields : null
  const fields: SignatureField[] | undefined = fieldsRaw
    ? fieldsRaw.map((f: Record<string, unknown>, i: number) => ({
        id: String(f.id ?? `field-${i + 1}`),
        label: String(f.label ?? `Campo ${i + 1}`),
        page: Math.max(1, Number(f.page ?? 1)),
        x: Number(f.x ?? 50),
        y: Number(f.y ?? 50),
        order: Math.max(1, Number(f.order ?? i + 1)),
        size: f.size != null ? Number(f.size) : undefined,
        maxWidth: f.maxWidth != null ? Number(f.maxWidth) : undefined,
      }))
    : undefined
  const privacyProfileIdRaw = String(req.body?.privacyProfileId ?? "").trim()
  const privacyProfileId =
    privacyProfileIdRaw && signatureStore.getPrivacyProfileById(privacyProfileIdRaw) ? privacyProfileIdRaw : (tpl as any).privacyProfileId ?? "default"
  const next = signatureStore.updateTemplateById(id, (r) => ({
    ...r,
    slots,
    fields: ensureSignatureFields(fields ?? (r as any).fields),
    privacyProfileId,
  }))
  if (!next) return res.status(500).json({ message: "Errore aggiornamento template" })
  res.json(next)
}

export async function downloadSignatureTemplateDocument(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim()
  if (!id) return res.status(400).json({ message: "Id template mancante" })
  const tpl = signatureStore.getTemplateById(id)
  if (!tpl) return res.status(404).json({ message: "Template non trovato" })
  const fp = path.join(signatureStore.resolveSignatureDir(), tpl.fileName)
  if (!fs.existsSync(fp)) return res.status(404).json({ message: "File template non trovato" })
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(tpl.originalName || "template.pdf")}"`)
  fs.createReadStream(fp).pipe(res)
}

export async function deleteSignatureTemplate(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim()
  if (!id) return res.status(400).json({ message: "Id template mancante" })
  const deleted = signatureStore.deleteTemplateById(id)
  if (!deleted) return res.status(404).json({ message: "Template non trovato" })
  const fp = path.join(signatureStore.resolveSignatureDir(), deleted.fileName)
  if (fs.existsSync(fp)) {
    try {
      fs.unlinkSync(fp)
    } catch {
      // ignore
    }
  }
  res.json({ ok: true })
}

export async function deleteSignatureTemplatePage(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id template mancante" })
    const tpl = signatureStore.getTemplateById(id)
    if (!tpl) return res.status(404).json({ message: "Template non trovato" })

    const pageRaw = (req.body as any)?.page
    const which = String((req.body as any)?.which ?? "").trim().toLowerCase()
    const wantLast = which === "last" || pageRaw == null || String(pageRaw).trim() === ""

    const fp = path.join(signatureStore.resolveSignatureDir(), tpl.fileName)
    if (!fs.existsSync(fp)) return res.status(404).json({ message: "File template non trovato" })

    const bytes = fs.readFileSync(fp)
    const doc = await PDFDocument.load(bytes)
    const total = doc.getPageCount()
    if (total <= 1) return res.status(400).json({ message: "Il template ha 1 sola pagina: non cancellabile" })

    const page = wantLast ? total : Math.floor(Number(pageRaw))
    if (!Number.isFinite(page) || page < 1 || page > total) {
      return res.status(400).json({ message: `Pagina non valida (1..${total})` })
    }

    doc.removePage(page - 1)
    const out = await doc.save()
    fs.writeFileSync(fp, Buffer.from(out))

    // Aggiorna layout: pagine dopo quella cancellata scalano di -1.
    signatureStore.updateTemplateById(id, (r) => {
      const dec = (n: unknown) => {
        const x = Math.max(1, Math.floor(Number(n ?? 1) || 1))
        return x > page ? x - 1 : x
      }
      const slots = ensureSignatureSlots((r as any).slots as SignatureSlot[] | undefined).map((s) => ({ ...s, page: dec(s.page) }))
      const fields = ensureSignatureFields((r as any).fields as SignatureField[] | undefined).map((f) => ({ ...f, page: dec(f.page) }))
      return { ...r, slots, fields }
    })

    res.json({ ok: true, pageDeleted: page, pagesBefore: total, pagesAfter: total - 1 })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

function privacyLastPageText(profileId?: string) {
  return signatureStore.getPrivacyProfileText(profileId)
}

const MAX_PRIVACY_FIELD_LEN = 32_000

function parsePrivacyPageBody(req: Request): { ok: true; text: PrivacyPageText } | { ok: false; message: string } {
  const b = req.body as Record<string, unknown> | undefined
  if (!b || typeof b !== "object") return { ok: false, message: "Body JSON non valido" }
  const keys = ["title1", "body1", "sig1", "title2", "body2", "sig2"] as const
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = b[k]
    if (typeof v !== "string") return { ok: false, message: `Campo "${k}" obbligatorio (stringa)` }
    if (v.length > MAX_PRIVACY_FIELD_LEN) return { ok: false, message: `Campo "${k}" troppo lungo (max ${MAX_PRIVACY_FIELD_LEN})` }
    out[k] = v
  }
  return { ok: true, text: out as PrivacyPageText }
}

export async function getSignaturePrivacyPageText(req: Request, res: Response) {
  try {
    void req
    res.json(signatureStore.getPrivacyPageText())
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function putSignaturePrivacyPageText(req: Request, res: Response) {
  try {
    const parsed = parsePrivacyPageBody(req)
    if (!parsed.ok) return res.status(400).json({ message: parsed.message })
    signatureStore.savePrivacyPageText(parsed.text)
    res.json(signatureStore.getPrivacyPageText())
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function resetSignaturePrivacyPageText(req: Request, res: Response) {
  try {
    void req
    signatureStore.resetPrivacyPageText()
    res.json(signatureStore.getPrivacyPageText())
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function listSignaturePrivacyProfiles(_req: Request, res: Response) {
  res.json(signatureStore.listPrivacyProfiles())
}

export async function createSignaturePrivacyProfile(req: Request, res: Response) {
  try {
    const name = String(req.body?.name ?? "").trim()
    const parsed = parsePrivacyPageBody(req)
    if (!name) return res.status(400).json({ message: "Nome profilo obbligatorio" })
    if (!parsed.ok) return res.status(400).json({ message: parsed.message })
    const created = signatureStore.createPrivacyProfile({ name, text: parsed.text })
    res.status(201).json(created)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function updateSignaturePrivacyProfile(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id profilo mancante" })
    const name = String(req.body?.name ?? "").trim()
    const parsed = parsePrivacyPageBody(req)
    if (!name) return res.status(400).json({ message: "Nome profilo obbligatorio" })
    if (!parsed.ok) return res.status(400).json({ message: parsed.message })
    const updated = signatureStore.updatePrivacyProfile(id, { name, text: parsed.text })
    if (!updated) return res.status(404).json({ message: "Profilo non trovato" })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function deleteSignaturePrivacyProfile(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id profilo mancante" })
    const ok = signatureStore.deletePrivacyProfile(id)
    if (!ok) return res.status(400).json({ message: "Impossibile eliminare questo profilo (forse è default o non esiste)" })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

async function replaceLastPageWithPrivacyBytes(pdfBytes: Uint8Array, t: ReturnType<typeof privacyLastPageText>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const pages = doc.getPages()
  if (pages.length === 0) return pdfBytes
  const lastIdx = pages.length - 1
  const last = pages[lastIdx]
  const { width, height } = last.getSize()

  // Rimuovi ultima pagina e reinserisci una pagina “testo” con stessa dimensione.
  doc.removePage(lastIdx)
  const page = doc.addPage([width, height])
  const font = await doc.embedFont("Helvetica")
  const bold = await doc.embedFont("Helvetica-Bold")

  const marginX = 40
  let y = height - 60
  const sizeTitle = 12
  const sizeBody = 10
  const lh = 13
  const maxW = width - marginX * 2

  const drawWrapped = (text: string, isBold = false) => {
    const lines = wrapMultilineText({ text, maxWidth: maxW, font: isBold ? bold : font, size: isBold ? sizeTitle : sizeBody })
    for (const line of lines) {
      if (y < 60) break
      page.drawText(line, { x: marginX, y, size: isBold ? sizeTitle : sizeBody, font: isBold ? bold : font })
      y -= isBold ? lh + 2 : lh
    }
    y -= 6
  }

  drawWrapped(t.title1, true)
  drawWrapped(t.body1, false)
  y -= 10
  page.drawText(t.sig1, { x: marginX, y, size: 10, font })
  y -= 34

  drawWrapped(t.title2, true)
  drawWrapped(t.body2, false)
  y -= 10
  page.drawText(t.sig2, { x: marginX, y, size: 10, font })

  return await doc.save()
}

async function appendPrivacyPageBytes(pdfBytes: Uint8Array, t: ReturnType<typeof privacyLastPageText>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const pages = doc.getPages()
  if (pages.length === 0) return pdfBytes
  const last = pages[pages.length - 1]
  const { width, height } = last.getSize()

  const page = doc.addPage([width, height])
  const font = await doc.embedFont("Helvetica")
  const bold = await doc.embedFont("Helvetica-Bold")

  const marginX = 40
  let y = height - 60
  const sizeTitle = 12
  const sizeBody = 10
  const lh = 13
  const maxW = width - marginX * 2

  const drawWrapped = (text: string, isBold = false) => {
    const lines = wrapMultilineText({ text, maxWidth: maxW, font: isBold ? bold : font, size: isBold ? sizeTitle : sizeBody })
    for (const line of lines) {
      if (y < 60) break
      page.drawText(line, { x: marginX, y, size: isBold ? sizeTitle : sizeBody, font: isBold ? bold : font })
      y -= isBold ? lh + 2 : lh
    }
    y -= 6
  }

  drawWrapped(t.title1, true)
  drawWrapped(t.body1, false)
  y -= 10
  page.drawText(t.sig1, { x: marginX, y, size: 10, font })
  y -= 34

  drawWrapped(t.title2, true)
  drawWrapped(t.body2, false)
  y -= 10
  page.drawText(t.sig2, { x: marginX, y, size: 10, font })

  return await doc.save()
}

async function replaceLastPageWithPrivacyPdfBytes(templateBytes: Uint8Array, privacyPdfBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(templateBytes)
  const pages = doc.getPages()
  if (pages.length === 0) return templateBytes
  const src = await PDFDocument.load(privacyPdfBytes)
  const srcPages = src.getPages()
  if (srcPages.length === 0) return templateBytes
  const lastIdx = pages.length - 1
  doc.removePage(lastIdx)
  const indices = srcPages.map((_, i) => i)
  const copied = await doc.copyPages(src, indices)
  for (const p of copied) doc.addPage(p)
  return await doc.save()
}

async function appendPrivacyPdfPageBytes(templateBytes: Uint8Array, privacyPdfBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(templateBytes)
  const src = await PDFDocument.load(privacyPdfBytes)
  const srcPages = src.getPages()
  if (srcPages.length === 0) return templateBytes
  const indices = srcPages.map((_, i) => i)
  const copied = await doc.copyPages(src, indices)
  for (const p of copied) doc.addPage(p)
  return await doc.save()
}

export async function postSignaturePrivacyProfilePdf(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id profilo mancante" })
    const prof = signatureStore.getPrivacyProfileById(id)
    if (!prof) return res.status(404).json({ message: "Profilo non trovato" })
    const f = (req as any).file as { buffer: Buffer; originalname: string; mimetype: string } | undefined
    if (!f) return res.status(400).json({ message: "PDF informativa obbligatorio" })
    const isPdf = f.mimetype === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf")
    if (!isPdf) return res.status(400).json({ message: "Caricare un PDF" })
    const dir = signatureStore.resolveSignatureDir()
    const fileName = `privacy-${id}-${crypto.randomUUID()}.pdf`
    fs.writeFileSync(path.join(dir, fileName), f.buffer)
    const updated = signatureStore.attachPrivacyProfilePdf(id, { pdfFileName: fileName, pdfOriginalName: f.originalname || "privacy.pdf" })
    if (!updated) return res.status(500).json({ message: "Errore aggiornamento profilo" })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function createSignaturePrivacyProfilePdf(req: Request, res: Response) {
  try {
    const name = String(req.body?.name ?? "").trim()
    const f = (req as any).file as { buffer: Buffer; originalname: string; mimetype: string } | undefined
    if (!name) return res.status(400).json({ message: "Nome profilo obbligatorio" })
    if (!f) return res.status(400).json({ message: "PDF informativa obbligatorio" })
    const isPdf = f.mimetype === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf")
    if (!isPdf) return res.status(400).json({ message: "Caricare un PDF" })
    const created = signatureStore.createPrivacyProfile({ name, text: signatureStore.getPrivacyProfileText("default") })
    const dir = signatureStore.resolveSignatureDir()
    const fileName = `privacy-${created.id}-${crypto.randomUUID()}.pdf`
    fs.writeFileSync(path.join(dir, fileName), f.buffer)
    const updated = signatureStore.attachPrivacyProfilePdf(created.id, { pdfFileName: fileName, pdfOriginalName: f.originalname || "privacy.pdf" })
    res.status(201).json(updated ?? created)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function replaceSignatureTemplateLastPagePrivacy(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id template mancante" })
    const tpl = signatureStore.getTemplateById(id)
    if (!tpl) return res.status(404).json({ message: "Template non trovato" })
    const fp = path.join(signatureStore.resolveSignatureDir(), tpl.fileName)
    if (!fs.existsSync(fp)) return res.status(404).json({ message: "File template non trovato" })
    const base = fs.readFileSync(fp)
    // Permetti override temporaneo (UI) senza salvare layout template.
    const overrideProfileId = String((req.body as any)?.privacyProfileId ?? "").trim()
    const profileId = overrideProfileId || String((tpl as any).privacyProfileId ?? "default").trim() || "default"
    const prof = signatureStore.getPrivacyProfileById(profileId)
    const out =
      prof?.pdfFileName && fs.existsSync(path.join(signatureStore.resolveSignatureDir(), prof.pdfFileName))
        ? await replaceLastPageWithPrivacyPdfBytes(base, fs.readFileSync(path.join(signatureStore.resolveSignatureDir(), prof.pdfFileName)))
        : await replaceLastPageWithPrivacyBytes(base, privacyLastPageText(profileId))
    fs.writeFileSync(fp, Buffer.from(out))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function appendSignatureTemplatePrivacyPage(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "Id template mancante" })
    const tpl = signatureStore.getTemplateById(id)
    if (!tpl) return res.status(404).json({ message: "Template non trovato" })
    const fp = path.join(signatureStore.resolveSignatureDir(), tpl.fileName)
    if (!fs.existsSync(fp)) return res.status(404).json({ message: "File template non trovato" })
    const base = fs.readFileSync(fp)
    const overrideProfileId = String((req.body as any)?.privacyProfileId ?? "").trim()
    const profileId = overrideProfileId || String((tpl as any).privacyProfileId ?? "default").trim() || "default"
    const prof = signatureStore.getPrivacyProfileById(profileId)
    const out =
      prof?.pdfFileName && fs.existsSync(path.join(signatureStore.resolveSignatureDir(), prof.pdfFileName))
        ? await appendPrivacyPdfPageBytes(base, fs.readFileSync(path.join(signatureStore.resolveSignatureDir(), prof.pdfFileName)))
        : await appendPrivacyPageBytes(base, privacyLastPageText(profileId))
    fs.writeFileSync(fp, Buffer.from(out))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function confirmSignature(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const signerToken = String(req.body?.signerToken ?? "").trim()
  const signatureDataUrl = String(req.body?.signatureDataUrl ?? "").trim()
  const requestedStepId = String(req.body?.stepId ?? "").trim()
  const fullName = String(req.body?.fullName ?? "").trim()
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
  const baseRow = row
  const err = ensurePending(row)
  if (err) return res.status(400).json({ message: err })
  if (!signatureDataUrl.startsWith("data:image/png;base64,")) return res.status(400).json({ message: "Firma non valida" })
  if (!row.signerSessionTokenHash || !row.signerSessionExpiresAt) return res.status(401).json({ message: "Sessione firma non valida" })
  if (isExpired(row.signerSessionExpiresAt)) return res.status(401).json({ message: "Sessione firma scaduta" })
  if (sha(signerToken) !== row.signerSessionTokenHash) return res.status(401).json({ message: "Sessione firma non valida" })
  const steps = normalizedSteps(row)
  const nextPending = steps.find((s) => !s.signedAt)
  if (!nextPending) return res.status(400).json({ message: "Tutte le firme sono già completate" })
  // Richiediamo sempre stepId per evitare firme duplicate per doppio click / race.
  if (!requestedStepId) {
    return res.status(400).json({ message: `Step firma mancante. Prossima firma: ${nextPending.label}` })
  }
  if (requestedStepId !== nextPending.id) {
    return res.status(400).json({ message: `Ordine firme non valido. Prossima firma: ${nextPending.label}` })
  }

  const signedSteps = steps.map((s) =>
    s.id === nextPending.id
      ? {
          ...s,
          signedAt: nowIso(),
          signatureDataUrl,
        }
      : s
  )

  const origPdfPath = path.join(signatureStore.resolveSignatureDir(), row.documentFileName)
  const signedPdfBytes = await renderPdfWithSteps(origPdfPath, signedSteps, fullName || row.customerName, {
    otpVerifiedAt: row.otpVerifiedAt,
  })

  const signedFileName = `signed-${row.id}.pdf`
  const signedPdfPath = path.join(signatureStore.resolveSignatureDir(), signedFileName)
  fs.writeFileSync(signedPdfPath, signedPdfBytes)

  const auditSidecarFileName = `signed-${row.id}.audit.json`
  const auditSidecarPath = path.join(signatureStore.resolveSignatureDir(), auditSidecarFileName)
  const writeAuditSidecar = (input: { completed: boolean; signedAt?: string | null; audit: SignatureRequest["audit"] }) => {
    try {
      const payload = {
        version: 1,
        generatedAt: nowIso(),
        request: {
          id: baseRow.id,
          token: baseRow.publicToken,
          status: input.completed ? "signed" : "pending",
          createdAt: baseRow.createdAt,
          expiresAt: baseRow.expiresAt,
          templateId: baseRow.templateId ?? null,
          templateName: baseRow.templateName ?? null,
        },
        document: {
          originalName: baseRow.documentOriginalName,
          sourceFileName: baseRow.documentFileName,
          signedFileName,
        },
        signer: {
          customerEmail: baseRow.customerEmail,
          customerName: baseRow.customerName ?? null,
          fullName: fullName || baseRow.customerName || null,
          ip: req.ip ?? null,
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        },
        otp: {
          verifiedAt: baseRow.otpVerifiedAt ?? null,
          consentAcceptedAt: (baseRow as any).consentAcceptedAt ?? null,
          // Nota legale/tecnica: non salviamo mai l'OTP in chiaro.
          codeHash: baseRow.otpCodeHash ?? null,
        },
        result: {
          completed: input.completed,
          signedAt: input.signedAt ?? null,
        },
        audit: input.audit ?? [],
      }
      fs.writeFileSync(auditSidecarPath, Buffer.from(JSON.stringify(payload, null, 2), "utf8"))
    } catch {
      // best effort: non bloccare la firma
    }
  }

  // Export gestionale allegati (Windows share), se configurato.
  // Esempio env: GESTIONALE_ALLEGATI_DIR=\\\\SERVERNEW\\Manager\\Allegati
  const allegatiBase = String(process.env.GESTIONALE_ALLEGATI_DIR ?? "").trim()
  async function tryExportToGestionaleShare() {
    if (!allegatiBase) return
    const utenteId = String(baseRow.customerGestionaleId ?? "").trim()
    if (!utenteId) return
    // Cartella gestione allegati: ID utente sempre a 8 cifre (es. 218 -> 00000218)
    const digitsOnly = utenteId.replace(/\D/g, "")
    const safeId = digitsOnly.length >= 8 ? digitsOnly : digitsOnly.padStart(8, "0")
    if (!safeId) return
    // UNC path: su alcuni ambienti il runtime può essere non-Windows -> usiamo join win32 per mantenere i backslash.
    const isUnc = /^\\\\\\\\/.test(allegatiBase)
    const joinWin = (...parts: string[]) => path.win32.join(...parts)
    const joinNative = (...parts: string[]) => path.join(...parts)
    const joinFn = isUnc ? joinWin : joinNative

    const base = isUnc ? allegatiBase.replace(/\//g, "\\") : allegatiBase
    const destDirPreferred = joinFn(base, safeId, "Pdf Firmati")
    const destName = `Firmato-${baseRow.documentOriginalName?.replace(/[/\\\\]/g, "_") || "documento"}.pdf`
    const basePath = joinFn(destDirPreferred, destName)
    const makeUniquePath = (p: string): string => {
      // Se esiste (o è bloccato), creiamo un nome univoco con timestamp.
      if (!fs.existsSync(p)) return p
      const dir = path.win32.dirname(p)
      const ext = path.win32.extname(p) || ".pdf"
      const base = path.win32.basename(p, ext)
      const ts = new Date().toISOString().replace(/[:.]/g, "-")
      return path.win32.join(dir, `${base}-${ts}${ext}`)
    }
    const destPath = makeUniquePath(basePath)
    fs.mkdirSync(destDirPreferred, { recursive: true })
    try {
      fs.copyFileSync(signedPdfPath, destPath)
    } catch (e) {
      // Secondo tentativo: se il file è bloccato/permessi su un path specifico, prova un nome diverso.
      const altPath = makeUniquePath(basePath)
      fs.copyFileSync(signedPdfPath, altPath)
    }

    // Copia anche il file "prova" affiancato (audit).
    try {
      const auditDest = `${destPath}.audit.json`
      if (fs.existsSync(auditSidecarPath)) fs.copyFileSync(auditSidecarPath, auditDest)
    } catch {
      // best effort
    }
  }

  const completed = signedSteps.every((s) => !!s.signedAt)
  const signed = signatureStore.updateById(row.id, (r) => ({
    ...r,
    status: completed ? "signed" : "pending",
    signedAt: completed ? nowIso() : r.signedAt,
    signatureDataUrl: signatureDataUrl || r.signatureDataUrl,
    signatureFullName: fullName || undefined,
    signatureIp: req.ip,
    signatureUserAgent: req.headers["user-agent"]?.toString(),
    signerSessionTokenHash: completed ? undefined : r.signerSessionTokenHash,
    signerSessionExpiresAt: completed ? undefined : r.signerSessionExpiresAt,
    signedDocumentFileName: signedFileName,
    steps: signedSteps,
    audit: appendAudit(r, {
      type: completed ? "signed" : "otp_verified",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
      message: completed ? "Firma completata (tutti gli step)" : `Step firmato: ${nextPending.label}`,
    }),
  }))
  if (!signed) return res.status(500).json({ message: "Errore interno" })

  // Scrivi/aggiorna sempre un file prova affiancato al PDF firmato.
  writeAuditSidecar({ completed, signedAt: signed.signedAt ?? null, audit: signed.audit ?? [] })

  if (completed) {
    try {
      await tryExportToGestionaleShare()
    } catch (e) {
      // Best-effort: non blocchiamo la firma se l'export fallisce.
      signatureStore.updateById(row.id, (r) => ({
        ...r,
        audit: appendAudit(r, {
          type: "signature_failed",
          ip: req.ip,
          userAgent: req.headers["user-agent"]?.toString(),
          message: `Export allegati fallito: ${(e as Error).message}`,
        }),
      }))
    }
    await sendMail({
      to: row.customerEmail,
      subject: "Documento firmato - FitCenter",
      text: `La firma del documento "${row.documentOriginalName}" è stata completata il ${new Date(signed.signedAt ?? nowIso()).toLocaleString("it-IT")}.`,
      attachments: [
        {
          filename: `Firmato-${row.documentOriginalName.replace(/\.pdf$/i, "")}.pdf`,
          path: signedPdfPath,
          contentType: "application/pdf",
        },
      ],
    })
  }
  res.json({
    ok: true,
    signedAt: signed.signedAt,
    completed,
    nextStepLabel: completed ? null : signedSteps.find((s) => !s.signedAt)?.label ?? null,
  })
}

