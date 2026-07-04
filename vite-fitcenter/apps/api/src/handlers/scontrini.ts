import type { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { formatScontrinoEmail, formatScontrinoSms } from "../services/scontrino-format.js"
import { sendMail, isSmtpConfigured } from "../services/mailer.js"
import { sendSms, normalizeItPhone, isSmsConfigured, maskPhone } from "../services/sms.js"

function parseIntParam(v: unknown, min: number, max: number): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  if (i < min || i > max) return null
  return i
}

function canUseScontrini(req: Request): boolean {
  const role = req.user?.role
  return role === "admin" || role === "operatore" || role === "firme"
}

/** Elenco scontrini da RVW_RicevuteUtenti (raggruppati per IDRicevuta). */
export async function getRicevuteUtenti(req: Request, res: Response) {
  try {
    if (!canUseScontrini(req)) {
      return res.status(403).json({ message: "Permessi insufficienti" })
    }
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.status(503).json({ message: "Gestionale SQL non configurato" })
    }
    const rawAsOf = String(req.query.asOf ?? "").trim()
    const asOfIso = rawAsOf && /^\d{4}-\d{2}-\d{2}$/.test(rawAsOf) ? rawAsOf : undefined
    const windowMinutes = parseIntParam(req.query.windowMinutes, 1, 24 * 60)
    const limit = parseIntParam(req.query.limit, 50, 3000) ?? undefined
    const out = await gestionaleSql.queryRicevuteUtenti({
      asOfIso,
      windowMinutes: windowMinutes ?? undefined,
      limit,
    })
    res.json(out)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Invia scontrino via email o SMS. */
export async function postInviaScontrino(req: Request, res: Response) {
  try {
    if (!canUseScontrini(req)) {
      return res.status(403).json({ message: "Permessi insufficienti" })
    }
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.status(503).json({ message: "Gestionale SQL non configurato" })
    }
    const ricevutaId = String(req.body?.ricevutaId ?? "").trim()
    const channel = String(req.body?.channel ?? "").trim().toLowerCase()
    if (!ricevutaId) return res.status(400).json({ message: "ricevutaId obbligatorio" })
    if (channel !== "email" && channel !== "sms") {
      return res.status(400).json({ message: "channel deve essere email o sms" })
    }

    const ricevuta = await gestionaleSql.queryRicevutaUtenteById(ricevutaId)
    if (!ricevuta) return res.status(404).json({ message: "Scontrino non trovato" })

    if (channel === "email") {
      const email = String(req.body?.email ?? ricevuta.email ?? "")
        .trim()
        .toLowerCase()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Email cliente non valida" })
      }
      const { subject, text } = formatScontrinoEmail(ricevuta)
      const out = await sendMail({ to: email, subject, text })
      if (!out.sent && !isSmtpConfigured()) {
        return res.status(503).json({
          message: "SMTP non configurato — impossibile inviare email",
          dryRun: true,
          preview: text.slice(0, 500),
        })
      }
      return res.json({ ok: true, channel: "email", sent: out.sent, to: email })
    }

    const phoneRaw = String(req.body?.phone ?? ricevuta.sms ?? "").trim()
    const phone = normalizeItPhone(phoneRaw)
    if (!phone) {
      return res.status(400).json({ message: "Cellulare cliente non valido" })
    }
    const text = formatScontrinoSms(ricevuta)
    const out = await sendSms({ to: phone, text })
    if (!out.sent && !isSmsConfigured()) {
      return res.status(503).json({
        message: "SMS non configurato — impossibile inviare al cellulare",
        dryRun: true,
        preview: text,
      })
    }
    return res.json({
      ok: true,
      channel: "sms",
      sent: out.sent,
      to: phone,
      toMasked: maskPhone(phone),
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
