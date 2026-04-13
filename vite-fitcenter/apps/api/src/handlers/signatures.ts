import fs from "fs"
import path from "path"
import crypto from "crypto"
import type { Request, Response } from "express"
import { signatureStore } from "../store/esign.js"
import { sendMail } from "../services/mailer.js"
import type { SignatureRequest, SignatureSlot, SignatureStep } from "../types/esign.js"
import { defaultSignatureSlots, ensureSignatureSlots } from "../signature/defaultSlots.js"
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

function toSteps(slots: SignatureSlot[]): SignatureStep[] {
  return slots
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ ...s }))
}

async function renderPdfWithSteps(basePath: string, steps: SignatureStep[], signerName?: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(fs.readFileSync(basePath))
  const pages = pdfDoc.getPages()
  for (const step of steps) {
    if (!step.signatureDataUrl) continue
    const pageIdx = Math.max(0, Math.min(pages.length - 1, (step.page ?? 1) - 1))
    const page = pages[pageIdx]
    const signatureBase64 = step.signatureDataUrl.split(",")[1] ?? ""
    if (!signatureBase64) continue
    const signatureBytes = Buffer.from(signatureBase64, "base64")
    const png = await pdfDoc.embedPng(signatureBytes)
    page.drawImage(png, {
      x: step.x,
      y: step.y,
      width: step.width,
      height: step.height,
    })
    if (signerName?.trim()) {
      const font = await pdfDoc.embedFont("Helvetica")
      page.drawText(signerName.trim(), { x: step.x, y: step.y + step.height + 8, size: 9, font })
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
      fs.copyFileSync(templatePath, path.join(destDir, fileName))
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
  const rows = signatureStore
    .list()
    .filter((r) => isAdmin || String(r.createdByUsername ?? "").trim().toLowerCase() === username)
    .map((r) => ({
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
    customerEmail: r.customerEmail,
    customerName: r.customerName,
    signedAt: r.signedAt,
    documentOriginalName: r.documentOriginalName,
    signedDocumentFileName: r.signedDocumentFileName,
    }))
  res.json(rows)
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
  res.json({ ok: true })
}

export async function getPublicSignatureInfo(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
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
  const rows = signatureStore.list()
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
    audit: appendAudit(r, { type: "otp_requested", ip: req.ip, userAgent: req.headers["user-agent"]?.toString(), message: `OTP inviata a ${r.customerEmail}` }),
  }))
  if (!updated) return res.status(500).json({ message: "Errore interno" })

  await sendMail({
    to: row.customerEmail,
    subject: "Codice OTP firma documento - FitCenter",
    text: `Il tuo codice OTP è: ${otp}\nScade tra 10 minuti.`,
  })
  res.json({
    ok: true,
    // Utile in sviluppo locale quando SMTP non è configurato.
    debugOtp: process.env.NODE_ENV === "production" ? undefined : otp,
  })
}

export async function verifySignatureOtp(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const otp = String(req.body?.otp ?? "").trim()
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
  const err = ensurePending(row)
  if (err) return res.status(400).json({ message: err })
  if (!row.otpCodeHash || !row.otpExpiresAt) return res.status(400).json({ message: "OTP non richiesto" })
  if (isExpired(row.otpExpiresAt)) return res.status(400).json({ message: "OTP scaduto" })
  if ((row.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) return res.status(429).json({ message: "Troppi tentativi OTP" })

  const otpHash = sha(otp)
  if (otpHash !== row.otpCodeHash) {
    signatureStore.updateById(row.id, (r) => ({
      ...r,
      otpAttempts: (r.otpAttempts ?? 0) + 1,
      audit: appendAudit(r, {
        type: "otp_invalid",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
        message: "OTP non valido",
      }),
    }))
    return res.status(400).json({ message: "OTP non valido" })
  }

  const signerToken = randomToken(24)
  const updated = signatureStore.updateById(row.id, (r) => ({
    ...r,
    otpVerifiedAt: nowIso(),
    signerSessionTokenHash: sha(signerToken),
    signerSessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    otpCodeHash: undefined,
    otpExpiresAt: undefined,
    otpAttempts: 0,
    audit: appendAudit(r, { type: "otp_verified", ip: req.ip, userAgent: req.headers["user-agent"]?.toString(), message: "OTP verificato" }),
  }))
  if (!updated) return res.status(500).json({ message: "Errore interno" })
  res.json({ ok: true, signerToken })
}

export async function listSignatureTemplates(_req: Request, res: Response) {
  const rows = signatureStore.listTemplates().map((t) => ({
    ...t,
    // Template senza slots nel JSON: ensureSignatureSlots applica i default (5) o l’elenco salvato.
    slots: ensureSignatureSlots(t.slots as SignatureSlot[] | undefined),
  }))
  res.json(rows)
}

export async function createSignatureTemplate(req: Request, res: Response) {
  try {
    const f = req.file
    const name = String(req.body.name ?? "").trim()
    if (!f) return res.status(400).json({ message: "PDF template obbligatorio" })
    if (!name) return res.status(400).json({ message: "Nome template obbligatorio" })
    const isPdf = f.mimetype === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf")
    if (!isPdf) return res.status(400).json({ message: "Caricare un PDF" })

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
      slots: defaultSignatureSlots(),
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
  const next = signatureStore.updateTemplateById(id, (r) => ({ ...r, slots }))
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

export async function confirmSignature(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim()
  const signerToken = String(req.body?.signerToken ?? "").trim()
  const signatureDataUrl = String(req.body?.signatureDataUrl ?? "").trim()
  const requestedStepId = String(req.body?.stepId ?? "").trim()
  const fullName = String(req.body?.fullName ?? "").trim()
  const row = signatureStore.getByToken(token)
  if (!row) return res.status(404).json({ message: "Richiesta non trovata" })
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
  const signedPdfBytes = await renderPdfWithSteps(origPdfPath, signedSteps, fullName || row.customerName)

  const signedFileName = `signed-${row.id}.pdf`
  const signedPdfPath = path.join(signatureStore.resolveSignatureDir(), signedFileName)
  fs.writeFileSync(signedPdfPath, signedPdfBytes)

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

  if (completed) {
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

