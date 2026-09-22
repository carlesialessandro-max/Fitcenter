import type { Request, Response } from "express"
import type { User } from "../store/auth.js"
import {
  formatWaDisplay,
  isWhatsappSendConfigured,
  normalizeWaTo,
} from "../services/whatsapp.js"
import { sendLezionePrivataWhatsapp } from "../services/whatsapp-lezioni-private.js"
import {
  istruttoriPerPreferenza,
  inferSessoDaNome,
  parsePrefSessoIstruttore,
  type LpSesso,
} from "../services/lp-istruttore-sesso.js"
import {
  assertSlotLibero,
  corsieMax,
  lpOreSlots,
  newLpId,
  oreCoperteLezioneLp,
  readLezioniPrivateDb,
  writeLezioniPrivateDb,
  type LpLezione,
  type LpLezioneStato,
  type LpPacchetto,
  type LpRichiesta,
  type VascaId,
} from "../store/lezioni-private-db.js"

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function isHm(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d/.test(s.trim())
}
function asVasca(v: unknown): VascaId | null {
  return v === "v25" || v === "ludica" ? v : null
}
function asTipo(v: unknown): "prova" | "5" | "10" | null {
  return v === "prova" || v === "5" || v === "10" ? v : null
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${mo}-${dd}`
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

function weeklyDateCount(tipo: "prova" | "5" | "10"): number {
  if (tipo === "10") return 10
  if (tipo === "5") return 5
  return 1
}

function newLezioneRow(params: {
  giorno: string
  ora: string
  vasca: VascaId
  corsia: number
  durataMin: number
}): LpLezione {
  return {
    id: newLpId("lez"),
    giorno: params.giorno,
    ora: params.ora.trim().slice(0, 5),
    durataMin: params.durataMin,
    vasca: params.vasca,
    corsia: params.corsia,
    stato: "prenotata",
  }
}

function buildLezioniSlots(params: {
  giorno: string
  ora: string
  vasca: VascaId
  corsia: number
  durataMin: number
  tipo: "prova" | "5" | "10"
  ripetiSettimanale?: boolean
}): LpLezione[] {
  const n = params.ripetiSettimanale === false ? 1 : weeklyDateCount(params.tipo)
  const out: LpLezione[] = []
  for (let i = 0; i < n; i++) {
    out.push(
      newLezioneRow({
        giorno: addDaysIso(params.giorno, i * 7),
        ora: params.ora,
        vasca: params.vasca,
        corsia: params.corsia,
        durataMin: params.durataMin,
      }),
    )
  }
  return out
}

function assertAllLiberi(
  db: ReturnType<typeof readLezioniPrivateDb>,
  lezioni: LpLezione[],
  exceptLezioneId?: string,
): string | null {
  for (let i = 0; i < lezioni.length; i++) {
    const l = lezioni[i]!
    const busy = assertSlotLibero(db, l.giorno, l.ora, l.vasca, l.corsia, l.durataMin, exceptLezioneId)
    if (busy) return `${l.giorno} ${l.ora}: ${busy}`
    for (let j = 0; j < i; j++) {
      const prev = lezioni[j]!
      if (prev.giorno !== l.giorno || prev.vasca !== l.vasca || prev.corsia !== l.corsia) continue
      const ore = oreCoperteLezioneLp(prev.ora, prev.durataMin)
      if (oreCoperteLezioneLp(l.ora, l.durataMin).some((o) => ore.includes(o))) {
        return `${l.giorno} ${l.ora}: Corsia occupata`
      }
    }
  }
  return null
}

function attachLezioniToRichiesta(params: {
  db: ReturnType<typeof readLezioniPrivateDb>
  r: LpRichiesta
  istr: { id: string; nome: string }
  tipo: "prova" | "5" | "10"
  lezioni: LpLezione[]
}): LpPacchetto {
  const { db, r, istr, tipo, lezioni } = params
  r.status = "assegnata"
  r.istruttoreId = istr.id
  r.istruttoreNome = istr.nome
  const existing = db.pacchetti.find((p) => p.richiestaId === r.id && p.tipo === tipo)
  if (existing) {
    existing.lezioni.push(...lezioni)
    existing.istruttoreId = istr.id
    existing.istruttoreNome = istr.nome
    return existing
  }
  const pac: LpPacchetto = {
    id: newLpId("pck"),
    richiestaId: r.id,
    clienteNome: r.clienteNome,
    telefono: r.telefono,
    tipo,
    istruttoreId: istr.id,
    istruttoreNome: istr.nome,
    createdAt: new Date().toISOString(),
    lezioni,
  }
  db.pacchetti.push(pac)
  return pac
}

function waLabel(nome: string, telefono: string): string {
  return `${nome} (${formatWaDisplay(normalizeWaTo(telefono) ?? telefono) || telefono})`
}

function clienteWaText(r: LpRichiesta): string {
  const nome = r.clienteNome.trim().split(/\s+/)[0] || r.clienteNome
  return (
    `Ciao ${nome}, richiesta prova ricevuta. Ti contattiamo per fissarla; poi puoi fare 5 o 10 lezioni. ` +
    `Per annullare o spostare contatta l'istruttore. FitCenter`
  )
}

function istruttoriWaText(r: LpRichiesta, by: string): string {
  const bits = [
    r.clienteNome.trim(),
    r.eta ? `${r.eta} anni` : "",
    r.tutore?.trim() ? `tutore ${r.tutore.trim()}` : "",
    r.telefono.trim(),
    r.quando?.trim() || "",
    r.prefIstruttore?.trim() ? `pref. ${r.prefIstruttore.trim()}` : "",
    r.note?.trim() ? r.note.trim().slice(0, 40) : "",
    by.trim() ? `da ${by.trim()}` : "",
  ].filter(Boolean)
  return `Lezione privata: ${bits.join(" · ")}`
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
      await sendLezionePrivataWhatsapp(telefono, text, templateNome)
      sent += 1
      destinations.push(label)
    } catch (e) {
      const msg = (e as Error).message || String(e)
      const hint = /131047|24 hour|re-engage|not in allowed/i.test(msg)
        ? " (chat chiusa: serve il template breve lezione_privata_breve, non il benvenuto H2Sport)"
        : ""
      errors.push(`${label}: ${msg}${hint}`)
    }
  }

  const db = readLezioniPrivateDb()
  const istrText = istruttoriWaText(r, by)
  const want = parsePrefSessoIstruttore(r.prefIstruttore)
  const istruttori = istruttoriPerPreferenza(db.instructors, r.prefIstruttore)
  if (!istruttori.length) {
    errors.push(
      want
        ? `Nessun istruttore ${want === "F" ? "donna" : "uomo"} attivo con cellulare`
        : "Nessun istruttore attivo con cellulare in elenco"
    )
  }
  for (const i of istruttori) {
    await push(`istruttore ${i.nome}`, i.telefono, istrText, i.nome)
  }

  if (String(r.telefono ?? "").trim()) {
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
  writeLezioniPrivateDb(db)
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
  const sesso = inferSessoDaNome(nome) ?? undefined
  const row = { id: newLpId("ins"), nome, telefono, attivo: true, sesso }
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
  const b = req.body as { nome?: string; telefono?: string; attivo?: boolean; sesso?: LpSesso | "" }
  if (typeof b.nome === "string" && b.nome.trim()) i.nome = b.nome.trim()
  if (typeof b.telefono === "string") i.telefono = b.telefono.trim()
  if (typeof b.attivo === "boolean") i.attivo = b.attivo
  if (b.sesso === "M" || b.sesso === "F") i.sesso = b.sesso
  if (b.sesso === "") delete i.sesso
  if (!i.sesso) i.sesso = inferSessoDaNome(i.nome) ?? undefined
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
    tipo?: "prova" | "5" | "10"
    ripetiSettimanale?: boolean
  }
  const vasca = asVasca(b.vasca)
  const giorno = String(b.giorno ?? "").trim()
  const ora = String(b.ora ?? "").trim()
  const durataMin = Number(b.durataMin) > 0 ? Math.round(Number(b.durataMin)) : 30
  const corsia = Number(b.corsia)
  const tipo = asTipo(b.tipo) ?? "prova"
  if (!vasca) return res.status(400).json({ message: "Vasca obbligatoria (v25 o ludica)" })
  if (!isYmd(giorno) || !isHm(ora)) return res.status(400).json({ message: "Giorno e ora obbligatori" })
  if (!Number.isFinite(corsia)) return res.status(400).json({ message: "Corsia obbligatoria" })

  const db = readLezioniPrivateDb()
  const r = db.richieste.find((x) => x.id === id)
  if (!r) return res.status(404).json({ message: "Richiesta non trovata" })
  if (r.status === "annullata") return res.status(400).json({ message: "Richiesta annullata" })

  let istr = db.instructors.find((i) => i.id === String(b.istruttoreId ?? r.istruttoreId ?? "").trim())
  if (!istr && u.role === "istruttore") {
    const n = (u.nome || "").trim().toLowerCase()
    istr = db.instructors.find((i) => i.attivo && i.nome.trim().toLowerCase() === n)
  }
  if (!istr) return res.status(400).json({ message: "Seleziona l'istruttore (elenco in attesa se vuoto)" })

  const lezioni = buildLezioniSlots({
    giorno,
    ora,
    vasca,
    corsia,
    durataMin,
    tipo,
    ripetiSettimanale: b.ripetiSettimanale,
  })
  const busy = assertAllLiberi(db, lezioni)
  if (busy) return res.status(409).json({ message: busy })

  const pac = attachLezioniToRichiesta({ db, r, istr, tipo, lezioni })
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
    tipo?: "prova" | "5" | "10"
    ripetiSettimanale?: boolean
    richiestaId?: string
  }
  const vasca = asVasca(b.vasca)
  const giorno = String(b.giorno ?? "").trim()
  const ora = String(b.ora ?? "").trim()
  const durataMin = Number(b.durataMin) > 0 ? Math.round(Number(b.durataMin)) : 30
  const corsia = Number(b.corsia)
  const tipo = asTipo(b.tipo) ?? "prova"
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

  const lezioni = buildLezioniSlots({
    giorno,
    ora,
    vasca,
    corsia,
    durataMin,
    tipo,
    ripetiSettimanale: b.ripetiSettimanale,
  })
  const busy = assertAllLiberi(db, lezioni)
  if (busy) return res.status(409).json({ message: busy })

  const richiestaId = String(b.richiestaId ?? "").trim()
  if (richiestaId) {
    const r = db.richieste.find((x) => x.id === richiestaId)
    if (!r) return res.status(404).json({ message: "Richiesta non trovata" })
    if (r.status === "annullata") return res.status(400).json({ message: "Richiesta annullata" })
    const pac = attachLezioniToRichiesta({ db, r, istr, tipo, lezioni })
    writeLezioniPrivateDb(db)
    return res.json({ ok: true, richiesta: r, pacchetto: pac })
  }

  const clienteNome = String(b.clienteNome ?? "").trim()
  const telefono = String(b.telefono ?? "").trim()
  if (!clienteNome) return res.status(400).json({ message: "Cognome e nome obbligatori" })
  if (!telefono) return res.status(400).json({ message: "Telefono obbligatorio" })

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
  db.richieste.push(r)
  const pac = attachLezioniToRichiesta({ db, r, istr, tipo, lezioni })
  writeLezioniPrivateDb(db)
  res.json({ ok: true, richiesta: r, pacchetto: pac })
}

export function postLezioniPrivatePacchetto(req: Request, res: Response) {
  void req.user
  const b = req.body as {
    richiestaId?: string
    tipo?: "prova" | "5" | "10"
    lezioni?: Array<{ giorno?: string; ora?: string; durataMin?: number; vasca?: string; corsia?: number }>
  }
  const tipo = b.tipo === "10" ? "10" : b.tipo === "5" ? "5" : b.tipo === "prova" ? "prova" : null
  if (!tipo) return res.status(400).json({ message: "Tipo: prova, 5 o 10" })
  const db = readLezioniPrivateDb()
  const r = db.richieste.find((x) => x.id === String(b.richiestaId ?? ""))
  if (!r || r.status === "annullata") {
    return res.status(400).json({ message: "Richiesta non valida" })
  }
  const istr = db.instructors.find((i) => i.id === (r.istruttoreId ?? ""))
  if (!r.istruttoreId && !istr) {
    return res.status(400).json({ message: "Assegna prima un istruttore (prendi in carico)" })
  }
  const rows = Array.isArray(b.lezioni) ? b.lezioni : []
  if (rows.length < 1 || rows.length > 10) return res.status(400).json({ message: "Indica da 1 a 10 date" })
  const lezioni: LpLezione[] = []
  for (const row of rows) {
    const vasca = asVasca(row.vasca)
    const giorno = String(row.giorno ?? "").trim()
    const ora = String(row.ora ?? "").trim()
    const corsia = Number(row.corsia)
    const durataMin = Number(row.durataMin) > 0 ? Math.round(Number(row.durataMin)) : 30
    if (!vasca || !isYmd(giorno) || !isHm(ora)) return res.status(400).json({ message: "Ogni lezione serve giorno, ora, vasca" })
    lezioni.push(newLezioneRow({ giorno, ora, vasca, corsia, durataMin }))
  }
  const busy = assertAllLiberi(db, lezioni)
  if (busy) return res.status(409).json({ message: busy })
  const pac = attachLezioniToRichiesta({
    db,
    r,
    istr: istr ?? { id: r.istruttoreId!, nome: r.istruttoreNome || "" },
    tipo,
    lezioni,
  })
  writeLezioniPrivateDb(db)
  res.json({ ok: true, pacchetto: pac })
}

export async function patchLezioniPrivateLezione(req: Request, res: Response) {
  const u = req.user!
  const id = String(req.params.id ?? "")
  const b = req.body as {
    stato?: LpLezioneStato
    giorno?: string
    ora?: string
    vasca?: string
    corsia?: number
    durataMin?: number
  }
  const db = readLezioniPrivateDb()
  for (const p of db.pacchetti) {
    const l = p.lezioni.find((x) => x.id === id)
    if (!l) continue

    const nextGiorno = b.giorno != null ? String(b.giorno).trim() : l.giorno
    const nextOra = (b.ora != null ? String(b.ora).trim() : l.ora).slice(0, 5)
    const nextVasca = b.vasca != null ? asVasca(b.vasca) : l.vasca
    const nextCorsia = b.corsia != null ? Number(b.corsia) : l.corsia
    const nextDurata = b.durataMin != null && Number(b.durataMin) > 0 ? Math.round(Number(b.durataMin)) : l.durataMin
    if (!nextVasca) return res.status(400).json({ message: "Vasca non valida" })
    if (!isYmd(nextGiorno) || !isHm(nextOra)) return res.status(400).json({ message: "Giorno e ora non validi" })
    if (!Number.isFinite(nextCorsia)) return res.status(400).json({ message: "Corsia non valida" })

    const moving =
      nextGiorno !== l.giorno || nextOra !== l.ora || nextVasca !== l.vasca || nextCorsia !== l.corsia || nextDurata !== l.durataMin
    if (moving) {
      const busy = assertSlotLibero(db, nextGiorno, nextOra, nextVasca, nextCorsia, nextDurata, l.id)
      if (busy) return res.status(409).json({ message: busy })
      l.giorno = nextGiorno
      l.ora = nextOra
      l.vasca = nextVasca
      l.corsia = nextCorsia
      l.durataMin = nextDurata
      if (l.stato === "tolta" || l.stato.startsWith("annullata")) l.stato = "prenotata"
    }

    if (b.stato) {
      const stato = b.stato
      if (
        stato !== "svolta" &&
        stato !== "annullata_istruttore" &&
        stato !== "annullata_cliente" &&
        stato !== "prenotata" &&
        stato !== "tolta"
      ) {
        return res.status(400).json({ message: "Stato non valido" })
      }
      l.stato = stato
      if (stato.startsWith("annullata") || stato === "tolta") {
        l.annullataAt = new Date().toISOString()
        l.annullataBy = u.nome || u.username
      } else {
        l.annullataAt = undefined
        l.annullataBy = undefined
      }
    }

    writeLezioniPrivateDb(db)
    if (b.stato?.startsWith("annullata")) {
      const chi = b.stato === "annullata_cliente" ? "cliente" : "istruttore"
      const msg = `Lezione privata annullata (${chi}): ${p.clienteNome} · ${l.giorno} ${l.ora}.`
      const istr = db.instructors.find((i) => i.id === p.istruttoreId && String(i.telefono ?? "").trim())
      if (istr) void sendLezionePrivataWhatsapp(istr.telefono, msg, istr.nome).catch((e) => console.error("[lp-wa]", (e as Error).message))
      if (b.stato === "annullata_istruttore" && p.telefono) {
        void sendLezionePrivataWhatsapp(
          p.telefono,
          `La lezione privata del ${l.giorno} alle ${l.ora} è stata annullata. Per riprenotare contatta l'istruttore.`,
          p.clienteNome,
        ).catch((e) => console.error("[lp-wa]", (e as Error).message))
      }
    }
    return res.json({ ok: true, lezione: l, richiestaId: p.richiestaId })
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
