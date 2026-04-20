import { Request, Response } from "express"
import { corsiNoShowStore } from "../store/corsi-no-show.js"
import { sendMail, isSmtpConfigured } from "../services/mailer.js"

export async function listCorsiNoShowBlocks(_req: Request, res: Response) {
  res.json({ rows: corsiNoShowStore.list() })
}

export async function postCorsiNoShowBlock(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? "").trim()
    const reason = String(req.body?.reason ?? "").trim()
    const monthKey = String(req.body?.monthKey ?? "").trim()
    const count = Number(req.body?.count ?? 0)
    const row = corsiNoShowStore.block({ email, reason, monthKey, count })
    res.status(201).json(row)
  } catch (e) {
    res.status(400).json({ message: (e as Error).message })
  }
}

export async function deleteCorsiNoShowBlock(req: Request, res: Response) {
  try {
    const email = String(req.params.email ?? "").trim()
    const ok = corsiNoShowStore.unblock(email)
    if (!ok) return res.status(404).json({ message: "Non presente in blocchi" })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function postCorsiNoShowNotifyAndBlock(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? "").trim()
    const subject = String(req.body?.subject ?? "").trim().slice(0, 300)
    const text = String(req.body?.text ?? "").trim().slice(0, 20_000)
    const monthKey = String(req.body?.monthKey ?? "").trim()
    const count = Number(req.body?.count ?? 0)

    const norm = corsiNoShowStore.normalizeEmail(email)
    if (!norm) return res.status(400).json({ message: "Email non valida" })
    if (!subject) return res.status(400).json({ message: "Oggetto obbligatorio" })
    if (!text) return res.status(400).json({ message: "Testo obbligatorio" })
    if (!isSmtpConfigured()) return res.status(503).json({ message: "SMTP non configurato (SMTP_HOST, …)" })

    const { sent } = await sendMail({ to: norm, subject, text })
    if (!sent) return res.status(502).json({ message: "Invio email non riuscito (vedi log server)" })

    const blocked = corsiNoShowStore.block({
      email: norm,
      reason: "No-show ripetuti (auto)",
      monthKey,
      count,
    })
    res.json({ ok: true, blocked })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

