import { readJson, writeJson } from "../store/persist.js"
import { listCalendarioPerConvalida } from "../handlers/calendario.js"
import type { LpagaLivello, LpagaPersonale, LpagaTurno } from "../store/libro-paga-db.js"
import { nominativo } from "../store/libro-paga-db.js"
import { livelloSottoAlbero } from "./libro-paga-scope.js"

const FILE = "libro-paga-convalida.json"

export type TurnoConvalidaStato = "ok" | "sostituzione" | "non_svolta" | "da_verificare"

export type TurnoConvalida = {
  turnoId: string
  stato: TurnoConvalidaStato
  nota?: string
  sostitutoNome?: string
  da: string
  at: string
}

type ConvalidaDb = {
  deleghe: Record<string, string[]>
  turni: Record<string, TurnoConvalida>
}

const EMPTY: ConvalidaDb = { deleghe: {}, turni: {} }

function readDb(): ConvalidaDb {
  const raw = readJson<ConvalidaDb>(FILE, EMPTY)
  return {
    deleghe: raw.deleghe && typeof raw.deleghe === "object" ? raw.deleghe : {},
    turni: raw.turni && typeof raw.turni === "object" ? raw.turni : {},
  }
}

function writeDb(db: ConvalidaDb) {
  writeJson(FILE, db)
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function namesMatch(person: Pick<LpagaPersonale, "nome" | "cognome">, staff: string): boolean {
  const staffN = norm(staff)
  if (!staffN || staffN === "-") return false
  const cognome = norm(person.cognome ?? "")
  const nome = norm(person.nome ?? "")
  if (cognome && staffN.includes(cognome)) {
    if (!nome || nome.length < 2) return true
    if (staffN.includes(nome) || staffN.includes(nome.slice(0, 3))) return true
  }
  const full = `${cognome} ${nome}`.trim()
  return Boolean(full && (staffN.includes(full) || full.includes(staffN)))
}

function titleMatchesMansione(title: string, mansione: string): boolean {
  const t = norm(title)
  const m = norm(mansione)
  if (!t || !m) return false
  if (t.includes(m) || m.includes(t)) return true
  const words = m.split(" ").filter((w) => w.length > 3)
  const hit = words.filter((w) => t.includes(w)).length
  return words.length > 0 && hit >= Math.min(2, words.length)
}

function daysInMonth(mese: string): string[] {
  const [ys, ms] = mese.split("-")
  const y = Number(ys)
  const mo = Number(ms)
  if (!y || !mo) return []
  const last = new Date(y, mo, 0).getDate()
  const out: string[] = []
  for (let d = 1; d <= last; d++) {
    out.push(`${ys}-${ms}-${String(d).padStart(2, "0")}`)
  }
  return out
}

export type MatchCalendario = {
  comparto: string
  date: string
  start: string
  title: string
  staff: string
  note?: string
}

export type TurnoConvalidaProposta = {
  turnoId: string
  giorno: string
  livelloNome: string
  personaleNome: string
  quantita: number
  importo: number
  note?: string
  proposto: TurnoConvalidaStato
  match?: MatchCalendario
  sostitutiPossibili: MatchCalendario[]
  salvato?: TurnoConvalida
}

export function getDeleghe(managerId: string): string[] {
  return readDb().deleghe[managerId] ?? []
}

export function setDeleghe(managerId: string, ids: string[]): string[] {
  const db = readDb()
  db.deleghe[managerId] = [...new Set(ids.map((x) => x.trim()).filter(Boolean))]
  writeDb(db)
  return db.deleghe[managerId]!
}

export function viewerPuoConvalidare(
  me: Pick<LpagaPersonale, "id" | "ruolo">,
  personale: LpagaPersonale[]
): boolean {
  if (me.ruolo === "admin" || me.ruolo === "manager") return true
  const db = readDb()
  return personale.some((p) => p.ruolo === "manager" && (db.deleghe[p.id] ?? []).includes(me.id))
}

export function managerIdsCheDelegatoA(meId: string, personale: LpagaPersonale[]): string[] {
  const db = readDb()
  return personale.filter((p) => p.ruolo === "manager" && (db.deleghe[p.id] ?? []).includes(meId)).map((p) => p.id)
}

/** Mansioni del sottoalbero dei responsabili che hanno delegato `meId`. */
export function alberoDaDeleghe(meId: string, personale: LpagaPersonale[], livelli: LpagaLivello[]): Set<string> {
  const tree = new Set<string>()
  for (const id of managerIdsCheDelegatoA(meId, personale)) {
    const mgr = personale.find((p) => p.id === id)
    if (!mgr?.livelloId) continue
    for (const x of livelloSottoAlbero(livelli, mgr.livelloId)) tree.add(x)
  }
  return tree
}

export function getTurnoConvalida(turnoId: string): TurnoConvalida | undefined {
  return readDb().turni[turnoId]
}

export function upsertTurnoConvalida(input: {
  turnoId: string
  stato: TurnoConvalidaStato
  nota?: string
  sostitutoNome?: string
  da: string
}): TurnoConvalida {
  const row: TurnoConvalida = {
    turnoId: input.turnoId,
    stato: input.stato,
    ...(input.nota?.trim() ? { nota: input.nota.trim() } : {}),
    ...(input.sostitutoNome?.trim() ? { sostitutoNome: input.sostitutoNome.trim() } : {}),
    da: input.da,
    at: new Date().toISOString(),
  }
  const db = readDb()
  db.turni[row.turnoId] = row
  writeDb(db)
  return row
}

export function conteggioConvalide(turnoIds: string[]): { n: number; ok: number } {
  const db = readDb()
  let n = 0
  let ok = 0
  for (const id of turnoIds) {
    const s = db.turni[id]?.stato
    if (!s || s === "da_verificare") continue
    n += 1
    if (s === "ok" || s === "sostituzione") ok += 1
  }
  return { n, ok }
}

export function proponeConvalidaMese(opts: {
  mese: string
  turni: (LpagaTurno & { personaleNome: string; livelloNome: string })[]
  personaleById: Map<string, LpagaPersonale>
}): TurnoConvalidaProposta[] {
  const cal = listCalendarioPerConvalida()
  const days = daysInMonth(opts.mese)
  const occ: MatchCalendario[] = []
  for (const date of days) {
    const dow = new Date(`${date}T12:00:00`).getDay()
    for (const e of cal.events) {
      const dateIso = String(e.dateIso ?? "").trim()
      if (dateIso) {
        if (dateIso !== date) continue
      } else if (e.dow !== dow) continue
      occ.push({
        comparto: e.comparto,
        date,
        start: e.start,
        title: e.title,
        staff: e.staffDisplay,
        ...(e.note ? { note: e.note } : {}),
      })
    }
  }
  const byDay = new Map<string, MatchCalendario[]>()
  for (const o of occ) {
    const arr = byDay.get(o.date) ?? []
    arr.push(o)
    byDay.set(o.date, arr)
  }
  const db = readDb()
  return opts.turni.map((t) => {
    const pe = opts.personaleById.get(t.personaleId)
    const daySlots = byDay.get(t.giorno) ?? []
    const samePerson = pe ? daySlots.filter((s) => namesMatch(pe, s.staff)) : []
    const sameMansione = daySlots.filter((s) => titleMatchesMansione(s.title, t.livelloNome))
    const matchPersonaMansione = samePerson.find((s) => titleMatchesMansione(s.title, t.livelloNome))
    const match = matchPersonaMansione ?? samePerson[0]
    const sostitutiPossibili = sameMansione.filter((s) => !pe || !namesMatch(pe, s.staff))
    let proposto: TurnoConvalidaStato = "da_verificare"
    if (match) proposto = "ok"
    else if (sostitutiPossibili.length) proposto = "sostituzione"
    const salvato = db.turni[t.id]
    return {
      turnoId: t.id,
      giorno: t.giorno,
      livelloNome: t.livelloNome,
      personaleNome: t.personaleNome,
      quantita: t.quantita,
      importo: t.importo,
      ...(t.note ? { note: t.note } : {}),
      proposto,
      match,
      sostitutiPossibili,
      salvato,
    }
  })
}

export function labelNominativo(p: LpagaPersonale): string {
  return nominativo(p)
}
