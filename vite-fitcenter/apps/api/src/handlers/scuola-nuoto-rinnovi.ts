import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { rowToAbbonamento } from "../data/map-sql-to-types.js"
import { markRinnovato } from "../lib/mark-rinnovato.js"
import { getScopedUser } from "../middleware/auth.js"
import {
  SCUOLA_NUOTO_CORSI_SCADENZA,
  isDataFineCorsoRinnovo,
  tipologiaCorsoRinnovo,
  ymdDataFine,
  type TipologiaCorsoRinnovo,
} from "../services/scuola-nuoto-rinnovi.js"
import { sendMail, isSmtpConfigured } from "../services/mailer.js"
import { sendSms, isSmsConfigured, isSmsSandboxMode } from "../services/sms.js"
import { attiviInviiStore, type AttiviInvioRecipient } from "../store/attivi-invii.js"
export type RinnovoCorsoRow = {
  clienteId: string
  abbonamentoId: string
  nome: string
  email: string | null
  telefono: string | null
  piano: string
  tipologia: TipologiaCorsoRinnovo
  dataFine: string
  consulenteNome: string | null
}

function pickEmailTelFromAbbRow(row: Record<string, unknown>): { email: string | null; telefono: string | null } {
  const emailRaw = String(
    row.ClienteEmail ?? row.Email ?? row.E_mail ?? row.Mail ?? row.email ?? row.PEC ?? row.Pec ?? ""
  ).trim()
  const firstEmail = emailRaw.split(/[;,/\s]+/).map((x) => x.trim()).find((x) => x.includes("@")) ?? ""
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(firstEmail) ? firstEmail : null
  const telRaw = String(
    row.ClienteSms ?? row.SMS ?? row.Cellulare ?? row.Telefono ?? row.Telefono_1 ?? row.telefono ?? ""
  ).trim()
  return { email, telefono: telRaw || null }
}

function sleepMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function loadRinnoviRows(dataFine: string): Promise<RinnovoCorsoRow[]> {
  if (!gestionaleSql.isGestionaleConfigured()) return []
  const rawAll = await gestionaleSql.queryAbbonamenti(undefined, { leftJoinVenditore: true })
  const pairs = rawAll.map((row) => ({ row, a: rowToAbbonamento(row) }))
  const all = pairs.map((p) => p.a)
  markRinnovato(all)
  const byId = new Map(pairs.map((p) => [String(p.a.id), p]))

  const out: RinnovoCorsoRow[] = []
  for (const a of all) {
    if (ymdDataFine(a.dataFine ?? "") !== dataFine) continue
    if (a.rinnovato === true) continue
    if (a.isTesseramento) continue
    const tipologia = tipologiaCorsoRinnovo(a)
    if (!tipologia) continue
    const p = byId.get(String(a.id))
    if (!p) continue
    const { email, telefono } = pickEmailTelFromAbbRow(p.row)
    const piano = (a.abbonamentoDescrizione ?? a.pianoNome ?? "").trim() || "—"
    const clienteId = String(a.clienteId ?? "").trim() || `abb:${a.id}`
    out.push({
      clienteId,
      abbonamentoId: String(a.id),
      nome: a.clienteNome || "—",
      email,
      telefono,
      piano,
      tipologia,
      dataFine,
      consulenteNome: (a.consulenteNome ?? "").trim() || null,
    })
  }
  out.sort((x, y) => x.nome.localeCompare(y.nome, "it") || x.piano.localeCompare(y.piano, "it"))
  return out
}

export async function getScuolaNuotoRinnoviMeta(_req: Request, res: Response) {
  res.json({ corsi: SCUOLA_NUOTO_CORSI_SCADENZA })
}

export async function getScuolaNuotoRinnovi(req: Request, res: Response) {
  try {
    const dataFine = ymdDataFine(String(req.query.dataFine ?? ""))
    if (!isDataFineCorsoRinnovo(dataFine)) {
      return res.status(400).json({ message: "Seleziona una data fine corso valida" })
    }
    const rows = await loadRinnoviRows(dataFine)
    const acquaticita = rows.filter((r) => r.tipologia === "acquaticita")
    const scuolaNuoto = rows.filter((r) => r.tipologia === "scuola_nuoto")
    res.json({
      dataFine,
      totale: rows.length,
      conEmail: rows.filter((r) => r.email).length,
      conTelefono: rows.filter((r) => r.telefono).length,
      acquaticita,
      scuolaNuoto,
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

type ContattoInvio = {
  clienteId: string
  nome: string
  email: string | null
  telefono: string | null
}

export async function postScuolaNuotoRinnoviInvia(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      dataFine?: string
      clienteIds?: string[]
      channel?: string
      subject?: string
      text?: string
      confirm?: boolean
    }
    if (!body.confirm) return res.status(400).json({ message: "Conferma obbligatoria (confirm: true)" })
    const dataFine = ymdDataFine(String(body.dataFine ?? ""))
    if (!isDataFineCorsoRinnovo(dataFine)) {
      return res.status(400).json({ message: "Data fine corso non valida" })
    }
    const channel = String(body.channel ?? "").trim().toLowerCase()
    if (channel !== "email" && channel !== "sms") {
      return res.status(400).json({ message: "channel deve essere email oppure sms" })
    }
    const text = String(body.text ?? "").trim()
    if (!text) return res.status(400).json({ message: "Testo messaggio obbligatorio" })
    const subject = String(body.subject ?? "").trim().slice(0, 300)
    if (channel === "email" && !subject) {
      return res.status(400).json({ message: "Oggetto email obbligatorio" })
    }
    if (channel === "email" && !isSmtpConfigured()) {
      return res.status(503).json({ message: "SMTP non configurato" })
    }
    if (channel === "sms") {
      if (!isSmsConfigured()) return res.status(503).json({ message: "SMS non configurato" })
      if (isSmsSandboxMode()) return res.status(503).json({ message: "SMS in sandbox" })
    }

    const ids = Array.isArray(body.clienteIds) ? body.clienteIds.map((x) => String(x).trim()).filter(Boolean) : []
    if (!ids.length) return res.status(400).json({ message: "Seleziona almeno un destinatario" })

    const loaded = await loadRinnoviRows(dataFine)
    const allow = new Set(ids)
    const picked = loaded.filter((r) => allow.has(r.clienteId))
    if (!picked.length) return res.status(400).json({ message: "Nessun destinatario valido per questo corso" })
    if (picked.length > 800) {
      return res.status(400).json({ message: `Troppi destinatari (${picked.length}). Max 800.` })
    }

    const rows: ContattoInvio[] = picked.map((r) => ({
      clienteId: r.clienteId,
      nome: r.nome,
      email: r.email,
      telefono: r.telefono,
    }))

    let sent = 0
    let failed = 0
    let skipped = 0
    const errors: string[] = []
    const recipients: AttiviInvioRecipient[] = []
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const normAddr = (s: string) => {
      const t = s.trim().toLowerCase()
      const m = t.match(/<([^>]+)>/)
      return (m?.[1] ?? t).trim()
    }
    const mark = (r: ContattoInvio, esito: AttiviInvioRecipient["esito"], dest: string | null, nota?: string) => {
      recipients.push({ clienteId: r.clienteId, nome: r.nome, dest, esito, nota })
      if (esito === "sent") sent++
      else if (esito === "failed") failed++
      else skipped++
    }

    if (channel === "email") {
      const byEmail = new Map<string, ContattoInvio[]>()
      for (const r of rows) {
        const e = (r.email ?? "").trim()
        if (!e || !emailOk.test(e)) {
          mark(r, "skipped", e || null, "Email mancante o non valida")
          continue
        }
        const k = e.toLowerCase()
        const list = byEmail.get(k) ?? []
        list.push(r)
        byEmail.set(k, list)
      }
      const emails = Array.from(byEmail.keys())
      if (!emails.length) return res.status(400).json({ message: "Nessuna email valida" })
      const chunkSize = 40
      for (let i = 0; i < emails.length; i += chunkSize) {
        const chunk = emails.slice(i, i + chunkSize)
        const to = chunk[0]!
        const bcc = chunk.length > 1 ? chunk.slice(1).join(", ") : undefined
        const out = await sendMail({ to, bcc, subject, text })
        const rejected = new Set((out.rejected ?? []).map(normAddr))
        for (const em of chunk) {
          const refused = rejected.has(normAddr(em))
          for (const r of byEmail.get(em) ?? []) {
            mark(r, refused || !out.sent ? "failed" : "sent", r.email, out.detail)
          }
        }
        if (i + chunkSize < emails.length) await sleepMs(120)
      }
    } else {
      const byPhone = new Map<string, { raw: string; rows: ContattoInvio[] }>()
      for (const r of rows) {
        const t = (r.telefono ?? "").trim()
        const k = t.replace(/\D/g, "")
        if (k.length < 9) {
          mark(r, "skipped", t || null, "Cellulare mancante")
          continue
        }
        const prev = byPhone.get(k)
        if (prev) prev.rows.push(r)
        else byPhone.set(k, { raw: t, rows: [r] })
      }
      const phones = Array.from(byPhone.values())
      if (!phones.length) return res.status(400).json({ message: "Nessun cellulare valido" })
      for (const pack of phones) {
        const o = await sendSms({ to: pack.raw, text })
        for (const r of pack.rows) {
          mark(r, o.sent ? "sent" : "failed", r.telefono, o.detail)
        }
        await sleepMs(80)
      }
    }

    const actor = getScopedUser(req)
    const userLabel = String(actor.username ?? actor.nome ?? "").trim() || "user"
    try {
      attiviInviiStore.append({
        user: userLabel,
        channel,
        subject: channel === "email" ? subject : "",
        text,
        segmento: `rinnovi-sn:${dataFine}`,
        destinatari: rows.length,
        sent,
        failed,
        skipped,
        errors,
        recipients,
      })
    } catch {
      /* log opzionale */
    }

    res.json({ sent, failed, skipped, errors: errors.slice(0, 8) })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
