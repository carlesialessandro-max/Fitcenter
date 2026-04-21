import { Request, Response } from "express"
import { corsiNoShowStore } from "../store/corsi-no-show.js"
import { sendMail, isSmtpConfigured } from "../services/mailer.js"
import {
  clearBloccaPrenotazioniFinoAlByEmail,
  clearBloccaPrenotazioniFinoAlByIdUtente,
  setBloccaPrenotazioniFinoAlByEmail,
  setBloccaPrenotazioniFinoAlByIdUtente,
} from "../services/gestionale-sql.js"

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function toIsoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export async function listCorsiNoShowBlocks(_req: Request, res: Response) {
  res.json({ rows: corsiNoShowStore.list() })
}

export async function postCorsiNoShowBlock(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? "").trim()
    const reason = String(req.body?.reason ?? "").trim()
    const monthKey = String(req.body?.monthKey ?? "").trim()
    const count = Number(req.body?.count ?? 0)
    const until = String(req.body?.until ?? "").trim()
    const row = corsiNoShowStore.block({ email, reason, monthKey, count, until })
    res.status(201).json(row)
  } catch (e) {
    res.status(400).json({ message: (e as Error).message })
  }
}

export async function deleteCorsiNoShowBlock(req: Request, res: Response) {
  try {
    const email = String(req.params.email ?? "").trim()
    const idUtente = String(req.query.idUtente ?? "").trim()
    const norm = corsiNoShowStore.normalizeEmail(email)
    if (!norm) return res.status(400).json({ message: "Email non valida" })

    const gestionale = idUtente ? await clearBloccaPrenotazioniFinoAlByIdUtente({ idUtente }) : await clearBloccaPrenotazioniFinoAlByEmail({ email: norm })
    if (!gestionale.ok) {
      // eslint-disable-next-line no-console
      console.warn("[no-show] sblocco gestionale fallito:", gestionale.message)
    }

    const ok = corsiNoShowStore.unblock({ email: norm, idUtente: idUtente || undefined })
    if (!ok) return res.status(404).json({ message: "Non presente in blocchi" })
    res.json({ ok: true, gestionale })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function postCorsiNoShowNotify(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? "").trim()
    const subject = String(req.body?.subject ?? "").trim().slice(0, 300)
    const textBase = String(req.body?.text ?? "").trim().slice(0, 20_000)
    const absencesRaw = Array.isArray(req.body?.absences) ? (req.body.absences as any[]) : []
    const absences = absencesRaw
      .map((a) => ({
        day: String(a?.day ?? "").trim(),
        servizio: String(a?.servizio ?? "").trim(),
        oraInizio: a?.oraInizio != null ? String(a.oraInizio).trim() : "",
        oraFine: a?.oraFine != null ? String(a.oraFine).trim() : "",
      }))
      .filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.day) && !!a.servizio)
      .slice(0, 200)

    const norm = corsiNoShowStore.normalizeEmail(email)
    if (!norm) return res.status(400).json({ message: "Email non valida" })
    if (!subject) return res.status(400).json({ message: "Oggetto obbligatorio" })
    if (!textBase) return res.status(400).json({ message: "Testo obbligatorio" })
    if (!isSmtpConfigured()) return res.status(503).json({ message: "SMTP non configurato (SMTP_HOST, …)" })

    const details =
      absences.length > 0
        ? `\nAssenze rilevate:\n` +
          absences
            .map((a) => {
              const hh = [a.oraInizio, a.oraFine].filter(Boolean).join("–")
              return `- ${a.day}${hh ? ` ${hh}` : ""} · ${a.servizio}`
            })
            .join("\n")
        : ""

    const text = (textBase + details).slice(0, 20_000)
    const { sent } = await sendMail({ to: norm, subject, text })
    if (!sent) return res.status(502).json({ message: "Invio email non riuscito (vedi log server)" })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function postCorsiNoShowNotifyAndBlock(req: Request, res: Response) {
  try {
    const email = String(req.body?.email ?? "").trim()
    const idUtente = String(req.body?.idUtente ?? "").trim()
    const subject = String(req.body?.subject ?? "").trim().slice(0, 300)
    const textBase = String(req.body?.text ?? "").trim().slice(0, 20_000)
    const monthKey = String(req.body?.monthKey ?? "").trim()
    const count = Number(req.body?.count ?? 0)
    const blockDays = Math.min(30, Math.max(1, Math.floor(Number(req.body?.blockDays ?? 3) || 3)))
    const absencesRaw = Array.isArray(req.body?.absences) ? (req.body.absences as any[]) : []
    const absences = absencesRaw
      .map((a) => ({
        day: String(a?.day ?? "").trim(),
        servizio: String(a?.servizio ?? "").trim(),
        oraInizio: a?.oraInizio != null ? String(a.oraInizio).trim() : "",
        oraFine: a?.oraFine != null ? String(a.oraFine).trim() : "",
      }))
      .filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.day) && !!a.servizio)
      .slice(0, 200)

    const norm = corsiNoShowStore.normalizeEmail(email)
    if (!norm) return res.status(400).json({ message: "Email non valida" })
    if (!subject) return res.status(400).json({ message: "Oggetto obbligatorio" })
    if (!textBase) return res.status(400).json({ message: "Testo obbligatorio" })
    if (!isSmtpConfigured()) return res.status(503).json({ message: "SMTP non configurato (SMTP_HOST, …)" })

    const details =
      absences.length > 0
        ? `\nAssenze rilevate:\n` +
          absences
            .map((a) => {
              const hh = [a.oraInizio, a.oraFine].filter(Boolean).join("–")
              return `- ${a.day}${hh ? ` ${hh}` : ""} · ${a.servizio}`
            })
            .join("\n")
        : ""

    const text = (textBase + details).slice(0, 20_000)

    const { sent } = await sendMail({ to: norm, subject, text })
    if (!sent) return res.status(502).json({ message: "Invio email non riuscito (vedi log server)" })

    // Imposta blocco prenotazioni sul gestionale: fino a oggi + blockDays (inclusivo).
    const until = new Date()
    until.setDate(until.getDate() + blockDays)
    const untilIso = toIsoDateLocal(until)
    const gestionale = idUtente
      ? await setBloccaPrenotazioniFinoAlByIdUtente({ idUtente, untilIso })
      : await setBloccaPrenotazioniFinoAlByEmail({ email: norm, untilIso })
    if (!gestionale.ok) {
      // Non blocchiamo l'email, ma avvisiamo il client: configurazione mancante o errore SQL.
      // Il blocco locale serve solo come storico UI.
      // eslint-disable-next-line no-console
      console.warn("[no-show] blocco gestionale fallito:", gestionale.message)
    }

    const blocked = corsiNoShowStore.block({
      email: norm,
      idUtente: idUtente || undefined,
      reason: "No-show ripetuti (auto)",
      monthKey,
      count,
      until: untilIso,
    })
    res.json({ ok: true, blocked, gestionale })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

