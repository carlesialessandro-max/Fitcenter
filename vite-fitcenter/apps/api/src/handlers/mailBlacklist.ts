import type { Request, Response } from "express"
import { getScopedUser } from "../middleware/auth.js"
import { mailBlacklistStore, isMailAddrOk, normalizeMailAddr } from "../store/mail-blacklist.js"
import { extractBounceEmails, isInvalidMailboxFromLogNote } from "../lib/mail-bounce.js"
import { fetchMailboxBounceEmails, isImapConfigured } from "../services/mail-imap-bounces.js"
import { attiviInviiStore } from "../store/attivi-invii.js"

export async function postMailUnsubscribePublic(req: Request, res: Response) {
  try {
    const email = normalizeMailAddr(String((req.body as { email?: string })?.email ?? ""))
    if (!isMailAddrOk(email)) {
      return res.status(400).json({ message: "Inserisci un indirizzo email valido" })
    }
    const row = mailBlacklistStore.add({
      email,
      source: "link",
      note: "Annulla iscrizione dal link in calce",
    })
    return res.json({ ok: true, email: row.email })
  } catch (e) {
    const status = Number((e as { status?: number })?.status) || 500
    return res.status(status).json({ message: (e as Error).message })
  }
}

export async function getMailBlacklist(_req: Request, res: Response) {
  try {
    return res.json({ rows: mailBlacklistStore.list() })
  } catch (e) {
    return res.status(500).json({ message: (e as Error).message })
  }
}

export async function postMailBlacklist(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { email?: string; note?: string; source?: string }
    const actor = getScopedUser(req)
    const source = body.source === "reply" ? "reply" : "admin"
    const row = mailBlacklistStore.add({
      email: String(body.email ?? ""),
      source,
      note: body.note,
      user: String(actor.username ?? actor.nome ?? "").trim() || "admin",
    })
    return res.json({ ok: true, row })
  } catch (e) {
    const status = Number((e as { status?: number })?.status) || 500
    return res.status(status).json({ message: (e as Error).message })
  }
}

export async function postMailBlacklistImport(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { text?: string; fromMailbox?: boolean; fromLog?: boolean }
    const actor = getScopedUser(req)
    const user = String(actor.username ?? actor.nome ?? "").trim() || "admin"
    const collected = new Set<string>()
    let messages = 0

    if (body.fromMailbox) {
      if (!isImapConfigured()) {
        return res.status(503).json({ message: "Casella IMAP non configurata" })
      }
      const fetched = await fetchMailboxBounceEmails(21)
      messages = fetched.messages
      for (const e of fetched.emails) collected.add(e)
    }

    if (body.fromLog) {
      for (const invio of attiviInviiStore.list(80)) {
        if (invio.channel !== "email") continue
        for (const r of invio.recipients ?? []) {
          if (r.esito !== "failed" || !r.dest) continue
          if (!isInvalidMailboxFromLogNote(r.nota)) continue
          collected.add(normalizeMailAddr(r.dest))
        }
      }
    }

    if (String(body.text ?? "").trim()) {
      for (const e of extractBounceEmails(body.text ?? "")) collected.add(e)
    }

    if (!collected.size) {
      return res.status(400).json({
        message: body.fromMailbox
          ? "Nessuna bounce trovata in casella (ultimi 21 giorni)."
          : body.fromLog
            ? "Nessuna casella inesistente nel log. I NON inviati per errore del server restano fuori dalla blacklist."
            : "Nessun indirizzo da mettere in blacklist.",
        added: 0,
        skipped: 0,
        emails: [],
        messages,
      })
    }

    const out = mailBlacklistStore.addMany([...collected], {
      source: "bounce",
      note: body.fromLog && !body.fromMailbox && !String(body.text ?? "").trim()
        ? "Casella inesistente dal log invii"
        : "Bounce: casella inesistente",
      user,
    })
    return res.json({ ok: true, ...out, found: collected.size, messages })
  } catch (e) {
    const status = Number((e as { status?: number })?.status) || 500
    return res.status(status).json({ message: (e as Error).message })
  }
}

export async function deleteMailBlacklist(req: Request, res: Response) {
  try {
    const email = normalizeMailAddr(String((req.query as { email?: string }).email ?? (req.body as { email?: string })?.email ?? ""))
    if (!email) return res.status(400).json({ message: "Email mancante" })
    const ok = mailBlacklistStore.remove(email)
    if (!ok) return res.status(404).json({ message: "Indirizzo non in blacklist" })
    return res.json({ ok: true, email })
  } catch (e) {
    return res.status(500).json({ message: (e as Error).message })
  }
}
