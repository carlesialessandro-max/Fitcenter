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
  parsePrefIstruttore,
  type LpSesso,
} from "../services/lp-istruttore-sesso.js"
import {
  assertSlotLibero,
  lpOreSlotsAperti,
  lpOreSlotsSettimanaTipo,
  lpOreSlotsTutti,
  newLpId,
  oreCoperteLezioneLp,
  postiGiorno,
  readLezioniPrivateDb,
  writeLezioniPrivateDb,
  type LpLezione,
  type LpLezioneStato,
  type LpPacchetto,
  type LpRichiesta,
  type VascaId,
} from "../store/lezioni-private-db.js"
import { fasciaPerInizio, slotAperto } from "../services/lp-vasche-orari.js"
import { allowClosedSlots } from "../services/lp-camilla.js"
import * as gestionaleSql from "../services/gestionale-sql.js"

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

function lezioniFuoriOrario(
  lezioni: Array<{ giorno: string; ora: string; vasca: VascaId; corsia: number; durataMin: number }>,
): boolean {
  return lezioni.some((l) => !slotAperto(l.giorno, l.ora, l.vasca, l.corsia, l.durataMin))
}

function assertLiberiCamilla(
  db: ReturnType<typeof readLezioniPrivateDb>,
  lezioni: LpLezione[],
  u: User,
  istrNome: string,
  except?: string[],
): string | null {
  const closed = lezioniFuoriOrario(lezioni)
  if (closed && !allowClosedSlots(u, istrNome)) {
    return "Fuori orario: solo Camilla Nardi può prenotare le vasche chiuse"
  }
  return assertAllLiberi(db, lezioni, except, closed && allowClosedSlots(u, istrNome))
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
  exceptLezioneIds?: string[],
  allowClosed?: boolean,
): string | null {
  for (let i = 0; i < lezioni.length; i++) {
    const l = lezioni[i]!
    const busy = assertSlotLibero(db, l.giorno, l.ora, l.vasca, l.corsia, l.durataMin, exceptLezioneIds, allowClosed)
    if (busy) return `${l.giorno} ${l.ora}: ${busy}`
    for (let j = 0; j < i; j++) {
      const p = lezioni[j]!
      if (p.giorno !== l.giorno || p.vasca !== l.vasca || p.corsia !== l.corsia) continue
      const covered = oreCoperteLezioneLp(p.ora, p.durataMin)
      if (oreCoperteLezioneLp(l.ora, l.durataMin).some((o) => covered.includes(o))) {
        return `${l.giorno} ${l.ora}: Corsia occupata`
      }
    }
  }
  return null
}

function daysBetweenIso(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime()
  const b = new Date(`${to}T12:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
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
  const allievo = r.clienteNome.trim().split(/\s+/)[0] || r.clienteNome
  const chi = (r.tutore ?? "").trim() || allievo
  const quando = r.quando?.trim() || "l'orario richiesto"
  return (
    `Ciao ${chi}, abbiamo preso in carico la richiesta per la lezione privata di ${allievo}. ` +
    `Stiamo verificando la disponibilita dell'acqua e dell'istruttore per ${quando}. ` +
    `Ti contatteremo a breve per confermare il giorno e l'orario definitivo. ` +
    `In base alla situazione concorderemo prova o pacchetto 5/10. Per annullare o spostare, accordati con l'istruttore. Lo staff H2SPORT`
  )
}

function istruttoriWaText(r: LpRichiesta, by: string): string {
  const tel = r.telefono.trim()
  const allievo = r.eta?.trim() ? `${r.clienteNome.trim()} (${r.eta.trim()} anni)` : r.clienteNome.trim()
  const orario = [
    r.quando?.trim(),
    r.prefIstruttore?.trim() ? `(${r.prefIstruttore.trim()})` : "",
  ]
    .filter(Boolean)
    .join(" ")
  const chi = by.trim() || "reception"
  return (
    `Nuova richiesta lezione privata inserita da ${chi}. Chi e disponibile? ` +
    `Allievo ${allievo}. ` +
    (r.tutore?.trim() ? `Tutore ${r.tutore.trim()}. ` : "") +
    (orario ? `Orario ${orario}. ` : "") +
    (r.note?.trim() ? `Note: ${r.note.trim().slice(0, 80)}. ` : "") +
    `Chi prende la lezione: 1) segnati sulla richiesta in FitCenter. 2) Prenota in Calendario vasche. ` +
    `3) SOLO DOPO contatta il genitore` +
    (tel ? ` al ${tel}` : "") +
    `. 4) Se l'orario e occupato, chiama o scrivi per un'alternativa.`
  )
}

function istruttoreWaFields(r: LpRichiesta, by: string): string[] {
  const allievo = r.eta?.trim() ? `${r.clienteNome.trim()} (${r.eta.trim()} anni)` : r.clienteNome.trim() || "-"
  const pref = r.prefIstruttore?.trim()
  const orario = [r.quando?.trim(), pref ? `(${pref})` : ""].filter(Boolean).join(" ")
  return [
    by.trim() || "reception",
    allievo,
    r.tutore?.trim() || "-",
    orario || "-",
    r.note?.trim().slice(0, 80) || "-",
    r.telefono.trim() || "-",
  ]
}

function clienteWaFields(r: LpRichiesta): string[] {
  const allievo = r.clienteNome.trim().split(/\s+/)[0] || r.clienteNome.trim() || "-"
  const chi = (r.tutore ?? "").trim() || allievo
  return [chi, allievo, r.quando?.trim() || "l'orario richiesto"]
}

async function notifyRichiestaWa(r: LpRichiesta, by: string) {
  const errors: string[] = []
  const destinations: string[] = []
  let sent = 0
  if (!isWhatsappSendConfigured()) {
    return { sent: 0, errors, destinations, skipped: "WhatsApp non configurato sul server" }
  }

  const push = async (
    labelNome: string,
    telefono: string,
    text: string,
    templateNome: string,
    kind: "istruttore" | "cliente",
    fields: string[],
  ) => {
    const label = waLabel(labelNome, telefono)
    try {
      await sendLezionePrivataWhatsapp(telefono, text, templateNome, { kind, fields })
      sent += 1
      destinations.push(label)
    } catch (e) {
      const msg = (e as Error).message || String(e)
      const hint = /131047|24 ore|24 hour|fuori finestra|re-engage|not in allowed/i.test(msg)
        ? " (chat chiusa: serve il template approvato)"
        : ""
      errors.push(`${label}: ${msg}${hint}`)
    }
  }

  const db = readLezioniPrivateDb()
  const istrText = istruttoriWaText(r, by)
  const istrFields = istruttoreWaFields(r, by)
  const want = parsePrefIstruttore(r.prefIstruttore)
  const istruttori = istruttoriPerPreferenza(db.instructors, r.prefIstruttore)
  if (!istruttori.length) {
    errors.push(
      want.special
        ? "Nessun istruttore Special attivo con cellulare"
        : want.sesso
          ? `Nessun istruttore ${want.sesso === "F" ? "donna" : "uomo"} attivo con cellulare`
          : "Nessun istruttore attivo con cellulare in elenco"
    )
  }
  for (const i of istruttori) {
    await push(`istruttore ${i.nome}`, i.telefono, istrText, i.nome, "istruttore", istrFields)
  }

  if (String(r.telefono ?? "").trim()) {
    await push(
      `richiedente ${r.clienteNome}`,
      r.telefono,
      clienteWaText(r),
      r.clienteNome.trim().split(/\s+/)[0] || r.clienteNome,
      "cliente",
      clienteWaFields(r),
    )
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
    ore: lpOreSlotsSettimanaTipo(),
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
  const b = req.body as { nome?: string; telefono?: string; attivo?: boolean; sesso?: LpSesso | ""; special?: boolean }
  if (typeof b.nome === "string" && b.nome.trim()) i.nome = b.nome.trim()
  if (typeof b.telefono === "string") i.telefono = b.telefono.trim()
  if (typeof b.attivo === "boolean") i.attivo = b.attivo
  if (typeof b.special === "boolean") i.special = b.special
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
  const busy = assertLiberiCamilla(db, lezioni, u, istr.nome)
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
  const busy = assertLiberiCamilla(db, lezioni, u, istr.nome)
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
  const u = req.user!
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
  const busy = assertLiberiCamilla(db, lezioni, u, istr?.nome || r.istruttoreNome || "")
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
      const busy = assertLiberiCamilla(
        db,
        [newLezioneRow({ giorno: nextGiorno, ora: nextOra, vasca: nextVasca, corsia: nextCorsia, durataMin: nextDurata })],
        u,
        p.istruttoreNome,
        [l.id],
      )
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

export function postLezioniPrivateSpostaPacchetto(req: Request, res: Response) {
  const id = String(req.params.id ?? "")
  const b = req.body as {
    lezioneIds?: string[]
    lezioneAncoraId?: string
    giornoAncora?: string
    deltaGiorni?: number
    ora?: string
    vasca?: string
    corsia?: number
  }
  const db = readLezioniPrivateDb()
  const pac = db.pacchetti.find((p) => p.id === id)
  if (!pac) return res.status(404).json({ message: "Pacchetto non trovato" })
  const wantIds = Array.isArray(b.lezioneIds) ? b.lezioneIds.filter(Boolean) : []
  const selected = pac.lezioni
    .filter((l) => l.stato === "prenotata" && (wantIds.length === 0 || wantIds.includes(l.id)))
    .slice()
    .sort((a, b2) => a.giorno.localeCompare(b2.giorno) || a.ora.localeCompare(b2.ora))
  if (!selected.length) return res.status(400).json({ message: "Nessuna data da spostare (solo lezioni prenotate)" })

  let delta = Number.isFinite(Number(b.deltaGiorni)) ? Math.round(Number(b.deltaGiorni)) : 0
  const ancora = String(b.giornoAncora ?? "").trim()
  if (ancora) {
    if (!isYmd(ancora)) return res.status(400).json({ message: "Nuova data non valida" })
    const ancoraId = String(b.lezioneAncoraId ?? "").trim()
    const ancoraFrom =
      (ancoraId ? pac.lezioni.find((l) => l.id === ancoraId) : undefined) ?? selected[0]!
    delta = daysBetweenIso(ancoraFrom.giorno, ancora)
  }
  const nextOra = b.ora != null ? String(b.ora).trim().slice(0, 5) : undefined
  const nextVasca = b.vasca != null ? asVasca(b.vasca) : undefined
  if (b.vasca != null && !nextVasca) return res.status(400).json({ message: "Vasca non valida" })
  const nextCorsia = b.corsia != null ? Number(b.corsia) : undefined
  if (b.corsia != null && !Number.isFinite(nextCorsia)) return res.status(400).json({ message: "Corsia non valida" })
  if (nextOra && !isHm(nextOra)) return res.status(400).json({ message: "Ora non valida" })
  if (delta === 0 && nextOra == null && nextVasca == null && nextCorsia == null) {
    return res.status(400).json({ message: "Indica di quanti giorni spostare o una nuova data/ora" })
  }

  const except = selected.map((l) => l.id)
  const planned = selected.map((l) =>
    newLezioneRow({
      giorno: addDaysIso(l.giorno, delta),
      ora: nextOra ?? l.ora,
      vasca: nextVasca ?? l.vasca,
      corsia: nextCorsia ?? l.corsia,
      durataMin: l.durataMin,
    }),
  )
  const busy = assertLiberiCamilla(db, planned, req.user!, pac.istruttoreNome, except)
  if (busy) return res.status(409).json({ message: busy })
  selected.forEach((l, i) => {
    const n = planned[i]!
    l.giorno = n.giorno
    l.ora = n.ora
    l.vasca = n.vasca
    l.corsia = n.corsia
  })
  writeLezioniPrivateDb(db)
  res.json({ ok: true, spostate: selected.length, pacchetto: pac })
}

export function getLezioniPrivateOccupazione(req: Request, res: Response) {
  const u = req.user!
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
  const prenotaFuoriOrario = allowClosedSlots(u) || canDesk(u)
  const ore = prenotaFuoriOrario ? lpOreSlotsTutti() : lpOreSlotsAperti(days)
  const booked = flattenLezioni(db).filter((l) => l.stato === "prenotata" || l.stato === "svolta")
  const byDay: Record<string, { totali: number; occupati: number; v25: number; ludica: number }> = {}
  for (const giorno of days) {
    const cap = postiGiorno(giorno)
    let occupati = 0
    for (const ora of ore) {
      for (const vasca of ["v25", "ludica"] as const) {
        const f = fasciaPerInizio(giorno, ora, vasca)
        if (!f) continue
        for (let c = 1; c <= f.corsie; c++) {
          const usati = booked.filter(
            (l) =>
              l.giorno === giorno &&
              l.vasca === vasca &&
              l.corsia === c &&
              oreCoperteLezioneLp(l.ora, l.durataMin).includes(ora),
          ).length
          occupati += Math.min(usati, f.capCorsia)
        }
      }
    }
    byDay[giorno] = { totali: cap.totali, occupati: Math.min(occupati, cap.totali), v25: cap.v25, ludica: cap.ludica }
  }
  res.json({
    from,
    to,
    ore,
    prenotaFuoriOrario,
    regole: db.regole,
    byDay,
    booked: booked.filter((l) => l.giorno >= from && l.giorno <= to),
  })
}

function blobAbbLp(a: gestionaleSql.LpAbbonamentoHit): string {
  return `${a.descrizione} ${a.categoria} ${a.macro} ${a.durata ?? ""}`
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

function isPrivateAbbLp(a: gestionaleSql.LpAbbonamentoHit): boolean {
  const b = blobAbbLp(a)
  if (/TESSERAMENT|QUOTA ASSOCIATIVA|\bASI\b|BADGE|MERCHAND/.test(b)) return false
  return /PRIVATE|LEZIONI PRIV/.test(b)
}

function tipoDaAbbLp(a: gestionaleSql.LpAbbonamentoHit): "prova" | "5" | "10" | "altro" {
  const b = blobAbbLp(a)
  if (/PROVA/.test(b)) return "prova"
  if (/\b10\b|PACCHETTO\s*10|DIECI/.test(b)) return "10"
  if (/\b5\b|PACCHETTO\s*5|CINQUE/.test(b)) return "5"
  return "altro"
}

function abbCopreGiorno(a: gestionaleSql.LpAbbonamentoHit, giorno: string): boolean {
  const from = (a.dataInizio || "").slice(0, 10)
  const to = (a.dataFine || "").slice(0, 10)
  if (from && from > giorno) return false
  if (to && to < giorno) return false
  return !!(from || to)
}

function monthBoundsIso(d = new Date()): { from: string; to: string } {
  const y = d.getFullYear()
  const m = d.getMonth()
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`
  const last = new Date(y, m + 1, 0).getDate()
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`
  return { from, to }
}

export async function getLezioniPrivateAbbonamentiCheck(req: Request, res: Response) {
  try {
    const bounds = monthBoundsIso()
    const from = isYmd(String(req.query.from ?? "").trim()) ? String(req.query.from).trim() : bounds.from
    const to = isYmd(String(req.query.to ?? "").trim()) ? String(req.query.to).trim() : bounds.to
    if (from > to) return res.status(400).json({ message: "from/to non validi" })
    const db = readLezioniPrivateDb()
    const lezioni = flattenLezioni(db).filter(
      (l) =>
        l.giorno >= from &&
        l.giorno <= to &&
        (l.stato === "prenotata" || l.stato === "svolta"),
    )
    const cache = new Map<string, gestionaleSql.LpAbbonamentoHit[]>()
    const rows = []
    let ok = 0
    let incongruente = 0
    let mancante = 0
    let nonAnagrafato = 0
    let provaSenzaAbb = 0
    for (const l of lezioni) {
      const key = `${l.telefono}|${l.clienteNome}`.toLowerCase()
      if (!cache.has(key)) {
        cache.set(
          key,
          await gestionaleSql.queryAbbonamentiPerClienteLp({
            telefono: l.telefono,
            nome: l.clienteNome,
          }),
        )
      }
      const hits = cache.get(key) ?? []
      const privates = hits.filter(isPrivateAbbLp)
      const covering = privates.filter((a) => abbCopreGiorno(a, l.giorno))
      const cliente =
        hits[0] != null
          ? `${hits[0].cognome} ${hits[0].nome}`.trim()
          : privates[0]
            ? `${privates[0].cognome} ${privates[0].nome}`.trim()
            : ""
      let esito: "ok" | "incongruente" | "mancante" | "non_anagrafato" | "prova_senza_abb"
      let nota = ""
      const best =
        covering.find((a) => tipoDaAbbLp(a) === l.tipo) ??
        covering.find((a) => tipoDaAbbLp(a) === "altro") ??
        covering[0]
      if (!hits.length) {
        if (l.tipo === "prova") {
          esito = "prova_senza_abb"
          nota = "Prova: cliente non trovato in anagrafica"
        } else {
          esito = "non_anagrafato"
          nota = "Cliente non trovato in anagrafica (telefono o nominativo)"
        }
      } else if (!covering.length) {
        if (l.tipo === "prova") {
          esito = "prova_senza_abb"
          nota = privates.length
            ? "Prova senza abbonamento private valido in quella data"
            : "Prova: nessun abbonamento private in gestionale"
        } else {
          esito = "mancante"
          nota = privates.length
            ? "Abbonamento private presente ma non copre la data della lezione"
            : "Nessun abbonamento lezioni private in gestionale"
        }
      } else {
        esito = "ok"
        const tipoAbb = tipoDaAbbLp(best!)
        nota =
          tipoAbb === "altro"
            ? "Abbonamento private valido"
            : `Abbonamento private valido (${tipoAbb === "prova" ? "prova" : `pacchetto ${tipoAbb}`})`
      }
      if (esito === "ok") ok += 1
      else if (esito === "incongruente") incongruente += 1
      else if (esito === "mancante") mancante += 1
      else if (esito === "non_anagrafato") nonAnagrafato += 1
      else provaSenzaAbb += 1
      rows.push({
        lezioneId: l.lezioneId,
        giorno: l.giorno,
        ora: l.ora,
        clienteNome: l.clienteNome,
        telefono: l.telefono,
        istruttoreNome: l.istruttoreNome,
        tipo: l.tipo,
        stato: l.stato,
        esito,
        nota,
        clienteGestionale: cliente || undefined,
        abbonamento: best
          ? {
              descrizione: best.descrizione,
              categoria: best.categoria,
              dataInizio: best.dataInizio,
              dataFine: best.dataFine,
              tipoRiconosciuto: tipoDaAbbLp(best),
            }
          : privates[0]
            ? {
                descrizione: privates[0].descrizione,
                categoria: privates[0].categoria,
                dataInizio: privates[0].dataInizio,
                dataFine: privates[0].dataFine,
                tipoRiconosciuto: tipoDaAbbLp(privates[0]),
              }
            : undefined,
      })
    }
    rows.sort((a, b) => `${a.giorno}${a.ora}`.localeCompare(`${b.giorno}${b.ora}`))
    res.json({
      from,
      to,
      totale: rows.length,
      ok,
      incongruente,
      mancante,
      nonAnagrafato,
      provaSenzaAbb,
      rows,
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
