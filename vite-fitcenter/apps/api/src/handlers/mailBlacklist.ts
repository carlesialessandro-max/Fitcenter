import type { Request, Response } from "express"
import { getScopedUser } from "../middleware/auth.js"
import { mailBlacklistStore, isMailAddrOk, normalizeMailAddr } from "../store/mail-blacklist.js"

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
