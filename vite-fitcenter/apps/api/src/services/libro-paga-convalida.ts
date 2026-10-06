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
  if (!staffN || staffN === "-" || staffN === "corso") return false
  const cognome = norm(person.cognome ?? "")
  const nome = norm(person.nome ?? "")
  const tokens = staffN.split(" ").filter(Boolean)
  if (cognome.length >= 3) {
    const cognomeHit = tokens.some((t) => t === cognome || (cognome.length >= 4 && t.startsWith(cognome.slice(0, 4))))
    if (!cognomeHit && !staffN.includes(cognome)) return false
    if (tokens.length === 1) return true
    if (!nome || nome.length < 2) return true
    return staffN.includes(nome) || tokens.some((t) => t[0] === nome[0])
  }
  return Boolean(nome.length >= 4 && (staffN === nome || tokens.includes(nome)))
}

const COMPARTO_LABEL: Record<string, string> = {
  corsi: "Corsi fitness",
  scuola_nuoto: "Scuola nuoto",
  sala_fitness: "Sala pesi",
  piscina: "Bagnini",
  reception: "Desk",
  acquaticita: "Acquaticità",
  campus: "Campus",
  danza: "Danza",
}

/** Mansione Libro paga → calendari FitCenter da usare (mai tutti insieme). */
export function compartiPerMansione(mansione: string, dominio?: string): string[] {
  const t = norm(`${mansione} ${dominio ?? ""}`)
  if (!t) return []
  if (/\bsala pesi\b|\bsala fitness\b|\bpalestr/.test(t) && !/\bcorsi\b|\bscuola nuoto\b/.test(t)) {
    return ["sala_fitness"]
  }
  if (/\bbagnin/.test(t)) return ["piscina"]
  if (/\bdesk\b|\breception\b|\bsegreteri|\baccoglienza/.test(t)) return ["reception"]
  if (/\bscuola nuoto\b|\bs n\b|\bsn bambini\b|\bistruttore nuoto/.test(t)) return ["scuola_nuoto"]
  if (/\bdanza\b/.test(t)) return ["danza"]
  if (/\bcampus\b/.test(t)) return ["campus"]
  if (/\bacquatic/.test(t)) return ["acquaticita"]
  if (
    /\bcorsi\b|\baerob|\bpump\b|\bspinning|\bpilates|\byoga|\bzumba|\bgap\b|\bfunctional|\btrx\b|\btotem|\bstretch|\bstep\b/.test(
      t
    )
  ) {
    return ["corsi"]
  }
  if (/\bfitness\b|\bpalestr/.test(t)) return ["sala_fitness"]
  if (/\bnuoto\b|\bvasca|\bpiscina/.test(t)) return ["scuola_nuoto"]
  return []
}

export function labelCompartoConvalida(comparto: string): string {
  return COMPARTO_LABEL[comparto] ?? comparto
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
  calendariAttesi: string[]
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
  turni: (LpagaTurno & { personaleNome: string; livelloNome: string; dominio?: string })[]
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
    const calendariAttesi = compartiPerMansione(t.livelloNome, t.dominio)
    const allowed = new Set(calendariAttesi)
    const daySlots = (byDay.get(t.giorno) ?? []).filter((s) => !allowed.size || allowed.has(s.comparto))
    const samePerson = pe ? daySlots.filter((s) => namesMatch(pe, s.staff)) : []
    const match = samePerson[0]
    const sostitutiPossibili = daySlots.filter((s) => !pe || !namesMatch(pe, s.staff))
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
      calendariAttesi,
      match,
      sostitutiPossibili,
      salvato,
    }
  })
}

export function labelNominativo(p: LpagaPersonale): string {
  return nominativo(p)
}
