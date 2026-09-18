import type { Request, Response } from "express"
import type { User } from "../store/auth.js"
import {
  formatWaDisplay,
  isWhatsappSendConfigured,
  leadWelcomeTemplateConfig,
  normalizeWaTo,
  sendWhatsappTemplate,
  sendWhatsappText,
} from "../services/whatsapp.js"
import {
  assertSlotLibero,
  corsieMax,
  lpOreSlots,
  newLpId,
  oreCoperteLezioneLp,
  readLezioniPrivateDb,
  writeLezioniPrivateDb,
  type LpLezioneStato,
  type LpPacchetto,
  type LpRichiesta,
  type VascaId,
} from "../store/lezioni-private-db.js"

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function isHm(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}
function asVasca(v: unknown): VascaId | null {
  return v === "v25" || v === "ludica" ? v : null
}

function canDesk(u: User): boolean {
  return u.role === "admin" || u.role === "scuola_nuoto" || u.role === "operatore" || u.role === "firme"
}
function canManageRoster(u: User): boolean {
  return u.role === "admin" || u.role === "scuola_nuoto"
}

function flattenLezioni(db: ReturnType<typeof readLezioniPrivateDb>) {
  const out: Array<{
    lezioneId: string
    pacchettoId: string
    richiestaId: string
    clienteNome: string
    telefono: string
    tipo: LpPacchetto["tipo"]
    istruttoreId: string
    istruttoreNome: string
    giorno: string
    ora: string
    durataMin: number
    vasca: VascaId
    corsia: number
    stato: LpLezioneStato
  }> = []
  for (const p of db.pacchetti) {
    for (const l of p.lezioni) {
      out.push({
        lezioneId: l.id,
        pacchettoId: p.id,
        richiestaId: p.richiestaId,
        clienteNome: p.clienteNome,
        telefono: p.telefono,
        tipo: p.tipo,
        istruttoreId: p.istruttoreId,
        istruttoreNome: p.istruttoreNome,
        giorno: l.giorno,
        ora: l.ora,
        durataMin: l.durataMin,
        vasca: l.vasca,
        corsia: l.corsia,
        stato: l.stato,
      })
    }
  }
  return out
}

function compactWaParam(text: string, fallback: string): string {
  const s = String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {3,}/g, "  ")
    .trim()
  return (s || fallback).slice(0, 500)
}

function isWa24hWindowError(msg: string): boolean {
  const s = msg.toLowerCase()
  return (
    s.includes("131047") ||
    s.includes("131051") ||
    s.includes("24 hour") ||
    s.includes("24-hour") ||
    s.includes("re-engage") ||
    s.includes("outside the allowed") ||
    s.includes("not in allowed")
  )
}

function waLabel(nome: string, telefono: string): string {
  return `${nome} (${formatWaDisplay(normalizeWaTo(telefono) ?? telefono) || telefono})`
}

/** Template Meta (funziona senza chat aperta) + testo libero se la finestra 24h è aperta. */
async function sendLpWaToNumber(telefono: string, text: string, nome: string): Promise<void> {
  if (!normalizeWaTo(telefono)) throw new Error("numero WhatsApp non valido")
  const lpTpl = (process.env.WHATSAPP_LP_TEMPLATE ?? "").trim()
  const cfg = leadWelcomeTemplateConfig({ bambini: false })
  const templateName = lpTpl || cfg.templateName
  const lang = (process.env.WHATSAPP_LP_TEMPLATE_LANG ?? cfg.languageCode ?? "it").trim() || "it"
  const param = compactWaParam(text, nome.trim() || "Ciao")
  const nameParam = nome.trim().split(/\s+/)[0] || "Ciao"

  let delivered = false
  let lastErr: Error | null = null
  for (const bodyParams of [[param], [nameParam]] as string[][]) {
    try {
      await sendWhatsappTemplate({
        toRaw: telefono,
        templateName,
        languageCode: lang,
        bodyParams,
      })
      delivered = true
      break
    } catch (e) {
      lastErr = e as Error
    }
  }
  try {
    await sendWhatsappText(telefono, text)
    delivered = true
  } catch (e) {
    if (!delivered) throw lastErr ?? (e as Error)
  }
}

function clienteWaText(r: LpRichiesta): string {
  const nome = r.clienteNome.trim().split(/\s+/)[0] || r.clienteNome
  return (
    `Ciao ${nome},\n\n` +
    `abbiamo ricevuto la tua richiesta di lezione privata in acqua.\n` +
    `Ti contatteremo per fissare la lezione di prova.\n` +
    `Dopo la prova potrai scegliere l'abbonamento da 5 o 10 lezioni.\n\n` +
    `FitCenter`
  )
}

function istruttoriWaText(r: LpRichiesta, by: string): string {
  return (
    `Nuova richiesta lezione privata (acqua)\n` +
    `Cliente: ${r.clienteNome}${r.eta ? ` (${r.eta})` : ""}\n` +
    (r.tutore ? `Tutore: ${r.tutore}\n` : "") +
    `Tel: ${r.telefono}\n` +
    `Quando: ${r.quando || "—"}\n` +
    `Pref. istruttore: ${r.prefIstruttore || "indifferente"}\n` +
    (r.note ? `Note: ${r.note}\n` : "") +
    `Compilata da: ${by}\n\n` +
    `Apri FitCenter → Lezioni private per prendere in carico (prova, poi 5 o 10).`
  )
}

async function notifyRichiestaWa(r: LpRichiesta, by: string) {
  const errors: string[] = []
  const destinations: string[] = []
  let sent = 0
  if (!isWhatsappSendConfigured()) {
    return { sent: 0, errors, destinations, skipped: "WhatsApp non configurato sul server" }
  }

  const push = async (labelNome: string, telefono: string, text: string, templateNome: string) => {
    const label = waLabel(labelNome, telefono)
    try {
      await sendLpWaToNumber(telefono, text, templateNome)
      sent += 1
      destinations.push(label)
    } catch (e) {
      const msg = (e as Error).message || String(e)
      const hint = isWa24hWindowError(msg)
        ? " (WhatsApp ha rifiutato il testo libero: controlla il template Meta o che il numero sia su WhatsApp)"
        : ""
      errors.push(`${label}: ${msg}${hint}`)
    }
  }

  const db = readLezioniPrivateDb()
  const istrText = istruttoriWaText(r, by)
  const istruttori = db.instructors.filter((x) => x.attivo && String(x.telefono ?? "").trim())
  if (!istruttori.length) {
    errors.push("Nessun istruttore attivo con cellulare in elenco")
  }
  for (const i of istruttori) {
    await push(`istruttore ${i.nome}`, i.telefono, istrText, i.nome)
  }

  const clientNorm = normalizeWaTo(r.telefono)
  const sameAsInstructor = istruttori.some((i) => normalizeWaTo(i.telefono) === clientNorm)
  if (String(r.telefono ?? "").trim() && !sameAsInstructor) {
    await push(`richiedente ${r.clienteNome}`, r.telefono, clienteWaText(r), r.clienteNome.trim().split(/\s+/)[0] || r.clienteNome)
  }

  const skipped =
    sent === 0
      ? errors.length
        ? errors.join("; ")
        : "Nessun WhatsApp inviato"
      : errors.length
        ? `Inviati ${sent}, errori: ${errors.join("; ")}`
        : undefined
  return { sent, errors, destinations, skipped }
}

export function getLezioniPrivate(req: Request, res: Response) {
  const db = readLezioniPrivateDb()
  res.json({
    instructors: db.instructors,
    richieste: db.richieste.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    pacchetti: db.pacchetti,
    lezioni: flattenLezioni(db),
    regole: db.regole,
    ore: lpOreSlots(),
  })
}

export function putLezioniPrivateRegole(req: Request, res: Response) {
  const u = req.user!
  if (!canManageRoster(u)) return res.status(403).json({ message: "Solo admin / scuola nuoto" })
  const raw = (req.body as { regole?: unknown })?.regole
  if (!raw || typeof raw !== "object") return res.status(400).json({ message: "regole obbligatorie" })
  const db = readLezioniPrivateDb()
  const next = { ...db.regole }
  for (let d = 0; d <= 6; d++) {
    const row = (raw as Record<string, { v25?: unknown; ludica?: unknown }>)[String(d)]
    if (!row) continue
    next[String(d)] = {
      v25: Math.max(0, Math.min(1, Number(row.v25) || 0)),
      ludica: Math.max(0, Math.min(2, Number(row.ludica) || 0)),
    }
  }
  writeLezioniPrivateDb({ ...db, regole: next })
  res.json({ ok: true, regole: next })
}

export function postLezioniPrivateIstruttore(req: Request, res: Response) {
  const u = req.user!
  if (!canManageRoster(u)) return res.status(403).json({ message: "Solo admin / scuola nuoto" })
  const nome = String((req.body as { nome?: string })?.nome ?? "").trim()
  const telefono = String((req.body as { telefono?: string })?.telefono ?? "").trim()
  if (!nome) return res.status(400).json({ message: "Nome obbligatorio" })
  if (!telefono) return res.status(400).json({ message: "Cellulare obbligatorio per WhatsApp" })
  if (!normalizeWaTo(telefono)) {
    return res.status(400).json({ message: "Cellulare non valido (es. 3331234567)" })
  }
  const db = readLezioniPrivateDb()
  const row = { id: newLpId("ins"), nome, telefono, attivo: true }
  writeLezioniPrivateDb({ ...db, instructors: [...db.instructors, row] })
  res.json({ ok: true, instructor: row })
}

export function patchLezioniPrivateIstruttore(req: Request, res: Response) {
  const u = req.user!
  if (!canManageRoster(u)) return res.status(403).json({ message: "Solo admin / scuola nuoto" })
  const id = String(req.params.id ?? "")
  const db = readLezioniPrivateDb()
  const i = db.instructors.find((x) => x.id === id)
  if (!i) return res.status(404).json({ message: "Istruttore non trovato" })
  const b = req.body as { nome?: string; telefono?: string; attivo?: boolean }
  if (typeof b.nome === "string" && b.nome.trim()) i.nome = b.nome.trim()
  if (typeof b.telefono === "string") i.telefono = b.telefono.trim()
  if (typeof b.attivo === "boolean") i.attivo = b.attivo
  writeLezioniPrivateDb(db)
  res.json({ ok: true, instructor: i })
}

export function deleteLezioniPrivateIstruttore(req: Request, res: Response) {
  const u = req.user!
  if (!canManageRoster(u)) return res.status(403).json({ message: "Solo admin / scuola nuoto" })
  const id = String(req.params.id ?? "")
  const db = readLezioniPrivateDb()
  if (!db.instructors.some((x) => x.id === id)) return res.status(404).json({ message: "Istruttore non trovato" })
  writeLezioniPrivateDb({ ...db, instructors: db.instructors.filter((x) => x.id !== id) })
  res.json({ ok: true })
}

export function deleteLezioniPrivateRichiesta(req: Request, res: Response) {
  const u = req.user!
  if (!canDesk(u) && !canManageRoster(u)) return res.status(403).json({ message: "Permessi insufficienti" })
  const id = String(req.params.id ?? "")
  const db = readLezioniPrivateDb()
  if (!db.richieste.some((x) => x.id === id)) return res.status(404).json({ message: "Richiesta non trovata" })
  writeLezioniPrivateDb({
    ...db,
    richieste: db.richieste.filter((x) => x.id !== id),
    pacchetti: db.pacchetti.filter((p) => p.richiestaId !== id),
  })
  res.json({ ok: true })
}

export async function postLezioniPrivateRichiesta(req: Request, res: Response) {
  const u = req.user!
  if (!canDesk(u)) return res.status(403).json({ message: "Permessi insufficienti per registrare richieste" })
  const b = req.body as {
    clienteNome?: string
    eta?: string
    telefono?: string
    tutore?: string
    quando?: string
    prefIstruttore?: string
    note?: string
    createdBy?: string
  }
  const clienteNome = String(b.clienteNome ?? "").trim()
  const telefono = String(b.telefono ?? "").trim()
  const createdBy = String(b.createdBy ?? "").trim() || u.nome || u.username
  if (!clienteNome) return res.status(400).json({ message: "Cognome e nome obbligatori" })
  if (!telefono) return res.status(400).json({ message: "Telefono obbligatorio" })
  if (!createdBy) return res.status(400).json({ message: "Indica chi compila il modulo" })
  const r: LpRichiesta = {
    id: newLpId("rich"),
    createdAt: new Date().toISOString(),
    createdBy,
    clienteNome,
    eta: String(b.eta ?? "").trim() || undefined,
    telefono,
    tutore: String(b.tutore ?? "").trim() || undefined,
    quando: String(b.quando ?? "").trim() || undefined,
    prefIstruttore: String(b.prefIstruttore ?? "").trim() || undefined,
    note: String(b.note ?? "").trim() || undefined,
    status: "aperta",
  }
  const db = readLezioniPrivateDb()
  db.richieste.push(r)
  const wa = await notifyRichiestaWa(r, r.createdBy)
  r.waNotifiedAt = new Date().toISOString()
  r.waDestinations = wa.destinations
  if (wa.skipped) r.waSkipped = wa.skipped
  writeLezioniPrivateDb(db)
  res.json({ ok: true, richiesta: r, wa })
}

export async function postLezioniPrivateRiavvisa(req: Request, res: Response) {
  const u = req.user!
  if (!canDesk(u) && !canManageRoster(u)) return res.status(403).json({ message: "Permessi insufficienti" })
  const id = String(req.params.id ?? "")
  const db = readLezioniPrivateDb()
  const r = db.richieste.find((x) => x.id === id)
  if (!r) return res.status(404).json({ message: "Richiesta non trovata" })
  const wa = await notifyRichiestaWa(r, r.createdBy || u.nome || u.username)
  r.waNotifiedAt = new Date().toISOString()
  r.waDestinations = wa.destinations
  r.waSkipped = wa.skipped
  writeLezioniPrivateDb(db)
  res.json({ ok: true, richiesta: r, wa })
}

export function postLezioniPrivatePrendi(req: Request, res: Response) {
  const u = req.user!
  const id = String(req.params.id ?? "")
  const b = req.body as {
    istruttoreId?: string
    giorno?: string
    ora?: string
    durataMin?: number
    vasca?: string
    corsia?: number
  }
  const vasca = asVasca(b.vasca)
  const giorno = String(b.giorno ?? "").trim()
  const ora = String(b.ora ?? "").trim()
  const durataMin = Number(b.durataMin) > 0 ? Math.round(Number(b.durataMin)) : 30
  const corsia = Number(b.corsia)
  if (!vasca) return res.status(400).json({ message: "Vasca obbligatoria (v25 o ludica)" })
  if (!isYmd(giorno) || !isHm(ora)) return res.status(400).json({ message: "Giorno e ora obbligatori" })
  if (!Number.isFinite(corsia)) return res.status(400).json({ message: "Corsia obbligatoria" })

  const db = readLezioniPrivateDb()
  const r = db.richieste.find((x) => x.id === id)
  if (!r) return res.status(404).json({ message: "Richiesta non trovata" })
  if (r.status === "annullata") return res.status(400).json({ message: "Richiesta annullata" })
  if (r.status === "assegnata") return res.status(400).json({ message: "Già assegnata" })

  let istr = db.instructors.find((i) => i.id === String(b.istruttoreId ?? "").trim())
  if (!istr && u.role === "istruttore") {
    const n = (u.nome || "").trim().toLowerCase()
    istr = db.instructors.find((i) => i.attivo && i.nome.trim().toLowerCase() === n)
  }
  if (!istr) return res.status(400).json({ message: "Seleziona l'istruttore (elenco in attesa se vuoto)" })

  const busy = assertSlotLibero(db, giorno, ora, vasca, corsia, durataMin)
  if (busy) return res.status(409).json({ message: busy })

  const pac: LpPacchetto = {
    id: newLpId("pck"),
    richiestaId: r.id,
    clienteNome: r.clienteNome,
    telefono: r.telefono,
    tipo: "prova",
    istruttoreId: istr.id,
    istruttoreNome: istr.nome,
    createdAt: new Date().toISOString(),
    lezioni: [
      {
        id: newLpId("lez"),
        giorno,
        ora,
        durataMin,
        vasca,
        corsia,
        stato: "prenotata",
      },
    ],
  }
  r.status = "assegnata"
  r.istruttoreId = istr.id
  r.istruttoreNome = istr.nome
  db.pacchetti.push(pac)
  writeLezioniPrivateDb(db)
  res.json({ ok: true, richiesta: r, pacchetto: pac })
}

export function postLezioniPrivatePrenota(req: Request, res: Response) {
  const u = req.user!
  const b = req.body as {
    clienteNome?: string
    telefono?: string
    istruttoreId?: string
    giorno?: string
    ora?: string
    vasca?: string
    corsia?: number
    durataMin?: number
    eta?: string
    createdBy?: string
  }
  const clienteNome = String(b.clienteNome ?? "").trim()
  const telefono = String(b.telefono ?? "").trim()
  const vasca = asVasca(b.vasca)
  const giorno = String(b.giorno ?? "").trim()
  const ora = String(b.ora ?? "").trim()
  const durataMin = Number(b.durataMin) > 0 ? Math.round(Number(b.durataMin)) : 30
  const corsia = Number(b.corsia)
  if (!clienteNome) return res.status(400).json({ message: "Cognome e nome obbligatori" })
  if (!telefono) return res.status(400).json({ message: "Telefono obbligatorio" })
  if (!vasca) return res.status(400).json({ message: "Vasca obbligatoria (v25 o ludica)" })
  if (!isYmd(giorno) || !isHm(ora)) return res.status(400).json({ message: "Giorno e ora obbligatori" })
  if (!Number.isFinite(corsia)) return res.status(400).json({ message: "Corsia obbligatoria" })

  const db = readLezioniPrivateDb()
  let istr = db.instructors.find((i) => i.id === String(b.istruttoreId ?? "").trim())
  if (!istr && u.role === "istruttore") {
    const n = (u.nome || "").trim().toLowerCase()
    istr = db.instructors.find((i) => i.attivo && i.nome.trim().toLowerCase() === n)
  }
  if (!istr) return res.status(400).json({ message: "Seleziona l'istruttore" })
  const busy = assertSlotLibero(db, giorno, ora, vasca, corsia, durataMin)
  if (busy) return res.status(409).json({ message: busy })

  const createdBy = String(b.createdBy ?? "").trim() || u.nome || u.username
  const r: LpRichiesta = {
    id: newLpId("rich"),
    createdAt: new Date().toISOString(),
    createdBy,
    clienteNome,
    eta: String(b.eta ?? "").trim() || undefined,
    telefono,
    status: "assegnata",
    istruttoreId: istr.id,
    istruttoreNome: istr.nome,
  }
  const pac: LpPacchetto = {
    id: newLpId("pck"),
    richiestaId: r.id,
    clienteNome,
    telefono,
    tipo: "prova",
    istruttoreId: istr.id,
    istruttoreNome: istr.nome,
    createdAt: new Date().toISOString(),
    lezioni: [
      {
        id: newLpId("lez"),
        giorno,
        ora,
        durataMin,
        vasca,
        corsia,
        stato: "prenotata",
      },
    ],
  }
  db.richieste.push(r)
  db.pacchetti.push(pac)
  writeLezioniPrivateDb(db)
  res.json({ ok: true, richiesta: r, pacchetto: pac })
}

export function postLezioniPrivatePacchetto(req: Request, res: Response) {
  const u = req.user!
  const b = req.body as {
    richiestaId?: string
    tipo?: "5" | "10"
    lezioni?: Array<{ giorno?: string; ora?: string; durataMin?: number; vasca?: string; corsia?: number }>
  }
  const tipo = b.tipo === "10" ? "10" : b.tipo === "5" ? "5" : null
  if (!tipo) return res.status(400).json({ message: "Tipo pacchetto 5 o 10" })
  const db = readLezioniPrivateDb()
  const r = db.richieste.find((x) => x.id === String(b.richiestaId ?? ""))
  if (!r || r.status !== "assegnata" || !r.istruttoreId) {
    return res.status(400).json({ message: "Prima assegna la prova a un istruttore" })
  }
  const rows = Array.isArray(b.lezioni) ? b.lezioni : []
  if (rows.length < 1 || rows.length > 10) return res.status(400).json({ message: "Indica da 1 a 10 date" })
  const lezioni = []
  for (const row of rows) {
    const vasca = asVasca(row.vasca)
    const giorno = String(row.giorno ?? "").trim()
    const ora = String(row.ora ?? "").trim()
    const corsia = Number(row.corsia)
    const durataMin = Number(row.durataMin) > 0 ? Math.round(Number(row.durataMin)) : 30
    if (!vasca || !isYmd(giorno) || !isHm(ora)) return res.status(400).json({ message: "Ogni lezione serve giorno, ora, vasca" })
    const busy = assertSlotLibero(db, giorno, ora, vasca, corsia, durataMin)
    if (busy) return res.status(409).json({ message: `${giorno} ${ora}: ${busy}` })
    const l = {
      id: newLpId("lez"),
      giorno,
      ora,
      durataMin,
      vasca,
      corsia,
      stato: "prenotata" as const,
    }
    lezioni.push(l)
    db.pacchetti.push({
      id: "__tmp__",
      richiestaId: r.id,
      clienteNome: r.clienteNome,
      telefono: r.telefono,
      tipo,
      istruttoreId: r.istruttoreId,
      istruttoreNome: r.istruttoreNome || "",
      createdAt: "",
      lezioni: [l],
    })
  }
  db.pacchetti = db.pacchetti.filter((p) => p.id !== "__tmp__")
  const pac: LpPacchetto = {
    id: newLpId("pck"),
    richiestaId: r.id,
    clienteNome: r.clienteNome,
    telefono: r.telefono,
    tipo,
    istruttoreId: r.istruttoreId,
    istruttoreNome: r.istruttoreNome || "",
    createdAt: new Date().toISOString(),
    lezioni,
  }
  db.pacchetti.push(pac)
  writeLezioniPrivateDb(db)
  res.json({ ok: true, pacchetto: pac })
}

export function patchLezioniPrivateLezione(req: Request, res: Response) {
  const u = req.user!
  const id = String(req.params.id ?? "")
  const b = req.body as { stato?: LpLezioneStato }
  const stato = b.stato
  if (stato !== "svolta" && stato !== "annullata_istruttore" && stato !== "annullata_cliente" && stato !== "prenotata") {
    return res.status(400).json({ message: "Stato non valido" })
  }
  const db = readLezioniPrivateDb()
  for (const p of db.pacchetti) {
    const l = p.lezioni.find((x) => x.id === id)
    if (!l) continue
    l.stato = stato
    if (stato.startsWith("annullata")) {
      l.annullataAt = new Date().toISOString()
      l.annullataBy = u.nome || u.username
    } else {
      l.annullataAt = undefined
      l.annullataBy = undefined
    }
    writeLezioniPrivateDb(db)
    return res.json({ ok: true, lezione: l })
  }
  return res.status(404).json({ message: "Lezione non trovata" })
}

export function getLezioniPrivateOccupazione(req: Request, res: Response) {
  const from = String(req.query.from ?? "").trim()
  const to = String(req.query.to ?? "").trim()
  if (!isYmd(from) || !isYmd(to) || from > to) return res.status(400).json({ message: "from/to YYYY-MM-DD" })
  const db = readLezioniPrivateDb()
  const days: string[] = []
  const cur = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getFullYear()
    const mo = String(cur.getMonth() + 1).padStart(2, "0")
    const dd = String(cur.getDate()).padStart(2, "0")
    days.push(`${y}-${mo}-${dd}`)
    cur.setDate(cur.getDate() + 1)
  }
  const ore = lpOreSlots()
  const booked = flattenLezioni(db).filter((l) => l.stato === "prenotata" || l.stato === "svolta")
  const byDay: Record<string, { totali: number; occupati: number; v25: number; ludica: number }> = {}
  for (const giorno of days) {
    const cap25 = corsieMax(db.regole, giorno, "v25")
    const capL = corsieMax(db.regole, giorno, "ludica")
    const totali = ore.length * (cap25 + capL)
    const occ = new Set<string>()
    for (const l of booked) {
      if (l.giorno !== giorno) continue
      for (const o of oreCoperteLezioneLp(l.ora, l.durataMin)) occ.add(`${l.vasca}|${l.corsia}|${o}`)
    }
    byDay[giorno] = { totali, occupati: occ.size, v25: cap25, ludica: capL }
  }
  res.json({ from, to, ore, regole: db.regole, byDay, booked: booked.filter((l) => l.giorno >= from && l.giorno <= to) })
}
