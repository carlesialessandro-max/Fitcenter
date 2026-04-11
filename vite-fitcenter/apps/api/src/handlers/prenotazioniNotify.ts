import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { sendMail, isSmtpConfigured } from "../services/mailer.js"
import { corsoGroupKey } from "../utils/corsoPrenotazioniGroup.js"

function normalizeEmail(s: string): string | null {
  const t = s.trim().toLowerCase()
  if (!t || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null
  return t
}

export async function postNotifyPrenotazioniCorsi(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.status(503).json({ message: "Database non configurato" })
    }
    const pool = await gestionaleSql.getPool()
    if (!pool) {
      return res.status(503).json({ message: "Database non connesso" })
    }

    const body = req.body as {
      giorno?: string
      groupKey?: string
      subject?: string
      text?: string
    }
    const giorno = String(body.giorno ?? "").trim()
    const groupKey = String(body.groupKey ?? "").trim()
    const subject = String(body.subject ?? "").trim().slice(0, 300)
    const text = String(body.text ?? "").trim().slice(0, 20_000)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
      return res.status(400).json({ message: "giorno non valido (YYYY-MM-DD)" })
    }
    if (!groupKey) {
      return res.status(400).json({ message: "groupKey obbligatorio" })
    }
    if (!subject) {
      return res.status(400).json({ message: "Oggetto obbligatorio" })
    }
    if (!text) {
      return res.status(400).json({ message: "Testo obbligatorio" })
    }

    if (!isSmtpConfigured()) {
      return res.status(503).json({ message: "SMTP non configurato (SMTP_HOST, …)" })
    }

    const rows = await gestionaleSql.queryPrenotazioniCorsi({ giorno })
    const inGroup = rows.filter((r) => corsoGroupKey(r) === groupKey)
    const emailsRaw = inGroup.map((r) => r.email?.trim()).filter(Boolean) as string[]
    const seen = new Set<string>()
    const emails: string[] = []
    for (const e of emailsRaw) {
      const n = normalizeEmail(e)
      if (!n || seen.has(n)) continue
      seen.add(n)
      emails.push(e.trim())
    }

    if (emails.length === 0) {
      return res.status(400).json({ message: "Nessun indirizzo email per i partecipanti di questo corso" })
    }

    const to = emails[0]
    const bcc = emails.length > 1 ? emails.slice(1).join(", ") : undefined
    const { sent } = await sendMail({ to, subject, text, bcc })
    if (!sent) {
      return res.status(502).json({ message: "Invio email non riuscito (vedi log server)" })
    }

    return res.json({ ok: true, recipients: emails.length })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
