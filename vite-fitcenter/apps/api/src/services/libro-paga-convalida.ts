import { readJson, writeJson } from "../store/persist.js"
import { listCalendarioPerConvalida } from "../handlers/calendario.js"
import type { LpagaLivello, LpagaPersonale, LpagaTurno } from "../store/libro-paga-db.js"
import { dominioLivello, nominativo } from "../store/libro-paga-db.js"
import { livelloSottoAlbero } from "./libro-paga-scope.js"
import { isGestionaleConfigured, queryAccessiUtenti } from "./gestionale-sql.js"

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

export function namesMatchPersonale(person: Pick<LpagaPersonale, "nome" | "cognome">, staff: string): boolean {
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
  pulizie: "Pulizie",
  campus: "Campus",
  danza: "Danza",
}

function isMansioneCorsoFit(t: string): boolean {
  if (/\bscuola nuoto\b|\bsn bambini\b|\bbimbo\b|\bbimbi\b|\bistruttore nuoto/.test(t)) return false
  if (/\bnuoto\b/.test(t) && !/\bfit\b|\bterra\b|\bh ?2 ?0\b/.test(t)) return false
  return (
    /\bcorso\b|\bcorsi\b/.test(t) ||
    (/\bfit\b/.test(t) && /\bh ?2 ?0\b|\bterra\b|\baerob|\bpump\b|\bspinning|\bpilates|\byoga|\bzumba/.test(t)) ||
    /\baerob|\bpump\b|\bspinning|\bpilates|\byoga|\bzumba|\bgap\b|\bfunctional|\btrx\b|\btotem|\bstretch|\bstep\b/.test(t)
  )
}

/** Mansione Libro paga → calendari FitCenter da usare (mai tutti insieme). */
export function compartiPerMansione(mansione: string, dominio?: string): string[] {
  const t = norm(`${mansione} ${dominio ?? ""}`)
  if (!t) return []
  if (/\bsala pesi\b|\bsala fitness\b|\bpalestr/.test(t) && !/\bcorso\b|\bcorsi\b|\bscuola nuoto\b/.test(t)) {
    return ["sala_fitness"]
  }
  if (/\bbagnin/.test(t)) return ["piscina"]
  if (/\bdesk\b|\breception\b|\bsegreteri|\baccoglienza/.test(t)) return ["reception"]
  if (isMansioneCorsoFit(t)) return ["corsi"]
  if (/\bscuola nuoto\b|\bs n\b|\bsn bambini\b|\bistruttore nuoto|\bbimbo\b|\bbimbi\b/.test(t)) {
    return ["scuola_nuoto"]
  }
  if (/\bdanza\b/.test(t)) return ["danza"]
  if (/\bcampus\b/.test(t)) return ["campus"]
  if (/\bacquatic/.test(t)) return ["acquaticita"]
  if (/\bpuliz/.test(t)) return ["pulizie"]
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

export type TornelloConvalida = {
  disponibile: boolean
  ok: boolean
  orario?: string
}

export type TurnoConvalidaProposta = {
  turnoId: string
  personaleId: string
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
  tornello?: TornelloConvalida
}

export const FOGLI_ORARI_CONVALIDA = {
  bagnini: "https://docs.google.com/spreadsheets/d/1v6UXzuiJAjcdG1kcp9Yr9Y4ZHuZa721i/edit?gid=298645103#gid=298645103",
  desk: "https://docs.google.com/spreadsheets/d/1-2ar1zRVlxJRjLL97SFMt5WJgLAS96iIv4g0lGf3LgU/edit?gid=0#gid=0",
} as const

/** Mansioni visibili in convalida: admin = tutte; responsabile = sottoalbero; delegato = albero dei manager. */
export function alberoConvalidaViewer(
  me: Pick<LpagaPersonale, "id" | "ruolo" | "livelloId">,
  personale: LpagaPersonale[],
  livelli: LpagaLivello[]
): Set<string> | undefined {
  if (me.ruolo === "admin") return undefined
  if (me.ruolo === "manager") {
    return me.livelloId ? livelloSottoAlbero(livelli, me.livelloId) : undefined
  }
  const de = alberoDaDeleghe(me.id, personale, livelli)
  return de.size ? de : undefined
}

export function turniNelMesePerConvalida(opts: {
  mese: string
  turni: LpagaTurno[]
  personale: LpagaPersonale[]
  livelli: LpagaLivello[]
  tree?: Set<string>
  personaleId?: string
  personaleIds?: Set<string>
}): (LpagaTurno & { personaleNome: string; livelloNome: string; dominio?: string })[] {
  const livBy = new Map(opts.livelli.map((l) => [l.id, l]))
  const perBy = new Map(opts.personale.map((p) => [p.id, p]))
  return opts.turni
    .filter((t) => {
      if (t.giorno.slice(0, 7) !== opts.mese) return false
      if (opts.personaleId && t.personaleId !== opts.personaleId) return false
      if (opts.personaleIds && !opts.personaleIds.has(t.personaleId)) return false
      if (opts.tree && !opts.tree.has(t.livelloId)) return false
      return true
    })
    .map((t) => {
      const pe = perBy.get(t.personaleId)
      return {
        ...t,
        personaleNome: pe ? nominativo(pe) : "—",
        livelloNome: livBy.get(t.livelloId)?.nome ?? "—",
        dominio: t.livelloId ? dominioLivello(opts.livelli, t.livelloId) : "",
      }
    })
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
    // Senza calendario atteso non si pesca da tutta la giornata (es. Corso Fit → S.N. Bambini).
    const daySlots = allowed.size
      ? (byDay.get(t.giorno) ?? []).filter((s) => allowed.has(s.comparto))
      : []
    const samePerson = pe ? daySlots.filter((s) => namesMatchPersonale(pe, s.staff)) : []
    const match = samePerson[0]
    const sostitutiPossibili = daySlots.filter((s) => !pe || !namesMatchPersonale(pe, s.staff))
    let proposto: TurnoConvalidaStato = "da_verificare"
    if (match) proposto = "ok"
    else if (sostitutiPossibili.length) proposto = "sostituzione"
    const salvato = db.turni[t.id]
    return {
      turnoId: t.id,
      personaleId: t.personaleId,
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

export function isAnomaliaConvalida(row: TurnoConvalidaProposta): boolean {
  const stato = row.salvato?.stato ?? row.proposto
  return stato !== "ok"
}

export function applicaAutoOkConvalida(rows: TurnoConvalidaProposta[], da: string): number {
  let n = 0
  for (const r of rows) {
    if (r.salvato && r.salvato.stato !== "da_verificare") continue
    if (r.proposto !== "ok") continue
    upsertTurnoConvalida({ turnoId: r.turnoId, stato: "ok", da })
    n += 1
  }
  return n
}

export function payloadConvalidaMese(
  mese: string,
  rows: TurnoConvalidaProposta[],
  extra?: { confermatiOra?: number }
) {
  const anomalie = rows
    .filter(isAnomaliaConvalida)
    .sort((a, b) => a.personaleNome.localeCompare(b.personaleNome, "it") || a.giorno.localeCompare(b.giorno))
  const confermabili = rows.filter((r) => r.proposto === "ok" && (!r.salvato || r.salvato.stato === "da_verificare"))
  const confermati = rows.filter((r) => r.salvato?.stato === "ok" || r.salvato?.stato === "sostituzione")
  return {
    mese,
    nTurni: rows.length,
    nConfermabili: confermabili.length,
    nAnomalie: anomalie.length,
    nConfermati: confermati.length,
    anomalie,
    fogli: FOGLI_ORARI_CONVALIDA,
    ...(extra?.confermatiOra != null ? { confermatiOra: extra.confermatiOra } : {}),
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * DATETIME del gestionale è naive (ora di centrale). Il driver mssql lo marca spesso come UTC:
 * non convertire Europe/Rome, usa le cifre così come sono (come in pagina Corsi).
 */
function parseAccessoWallClock(val: unknown): { ymd: string; hm: string; minutes: number } | null {
  if (val == null || val === "") return null
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const ymd = `${val.getUTCFullYear()}-${pad2(val.getUTCMonth() + 1)}-${pad2(val.getUTCDate())}`
    const hh = val.getUTCHours()
    const mi = val.getUTCMinutes()
    return { ymd, hm: `${pad2(hh)}:${pad2(mi)}`, minutes: hh * 60 + mi }
  }
  const s = String(val).trim()
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(s)
  if (iso) {
    const hh = Number(iso[4])
    const mi = Number(iso[5])
    return { ymd: `${iso[1]}-${iso[2]}-${iso[3]}`, hm: `${pad2(hh)}:${pad2(mi)}`, minutes: hh * 60 + mi }
  }
  const it = /^(\d{2})\/(\d{2})\/(\d{4})(?:[^\d]+(\d{1,2}):(\d{2}))?/.exec(s)
  if (it) {
    const hh = Number(it[4] ?? 0)
    const mi = Number(it[5] ?? 0)
    return { ymd: `${it[3]}-${it[2]}-${it[1]}`, hm: `${pad2(hh)}:${pad2(mi)}`, minutes: hh * 60 + mi }
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const ymd = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  const hh = d.getUTCHours()
  const mi = d.getUTCMinutes()
  return { ymd, hm: `${pad2(hh)}:${pad2(mi)}`, minutes: hh * 60 + mi }
}

function rawIgnoreCase(raw: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] != null) return raw[key]
  const lk = key.toLowerCase()
  for (const rk of Object.keys(raw)) {
    if (rk.toLowerCase() === lk && raw[rk] != null) return raw[rk]
  }
  return undefined
}

function clockFromAccesso(acc: {
  dataEntrata?: string
  raw?: Record<string, unknown>
}): { ymd: string; hm: string; minutes: number } | null {
  const raw = acc.raw ?? {}
  const primary =
    rawIgnoreCase(raw, "AccessiDataOra") ??
    rawIgnoreCase(raw, "DataEntrata") ??
    rawIgnoreCase(raw, "DataIngresso") ??
    rawIgnoreCase(raw, "DataOraEntrata") ??
    acc.dataEntrata
  const parsed = parseAccessoWallClock(primary)
  if (parsed && parsed.hm !== "00:00") return parsed
  const d = parseAccessoWallClock(rawIgnoreCase(raw, "AccessiData"))
  const t = parseAccessoWallClock(rawIgnoreCase(raw, "AccessiOra"))
  if (d && t) return { ymd: d.ymd, hm: t.hm, minutes: t.minutes }
  return parsed
}

/** Solo transiti di entrata (Terminale «Ingresso dx piscina», ecc.). Le uscite non contano. */
function isIngressoTornello(raw: Record<string, unknown> | undefined): boolean {
  const r = raw ?? {}
  const parts = [
    rawIgnoreCase(r, "TerminaleDescrizione"),
    rawIgnoreCase(r, "TerminaleDesc"),
    rawIgnoreCase(r, "DescrizioneTerminale"),
    rawIgnoreCase(r, "Terminale"),
    rawIgnoreCase(r, "AccessiTerminale"),
    rawIgnoreCase(r, "TerminaleAccesso"),
    rawIgnoreCase(r, "TerminaleNome"),
    rawIgnoreCase(r, "NomeTerminale"),
    rawIgnoreCase(r, "Varco"),
    rawIgnoreCase(r, "VarcoNome"),
    rawIgnoreCase(r, "Verso"),
    rawIgnoreCase(r, "Direzione"),
    rawIgnoreCase(r, "Tipo"),
    rawIgnoreCase(r, "TipoEvento"),
    rawIgnoreCase(r, "Evento"),
    rawIgnoreCase(r, "Descrizione"),
  ]
  let blob = parts
    .map((x) => String(x ?? ""))
    .join(" ")
    .toLowerCase()
  if (!blob.trim()) {
    blob = Object.entries(r)
      .filter(([k]) => /terminal|varco|verso|direzion|tipo|event|descriz/i.test(k))
      .map(([, v]) => String(v ?? ""))
      .join(" ")
      .toLowerCase()
  }
  if (!blob.trim()) return true
  if (/\buscit[aeio]?\b|\bexit\b|\bout\b/.test(blob)) return false
  if (/\bentrata\s+subordinat/.test(blob)) return false
  return true
}

function labelAccesso(acc: { cognome?: string; nome?: string; raw?: Record<string, unknown> }): string {
  const raw = acc.raw ?? {}
  const nomeUtente = String(
    rawIgnoreCase(raw, "Nome utente") ?? rawIgnoreCase(raw, "NomeUtente") ?? ""
  ).trim()
  if (nomeUtente) return nomeUtente
  return [acc.cognome, acc.nome].filter(Boolean).join(" ").trim()
}

export async function arricchisciTornelloConvalida(
  mese: string,
  rows: TurnoConvalidaProposta[],
  personaleById: Map<string, LpagaPersonale>
): Promise<TurnoConvalidaProposta[]> {
  const vuoto = (): TornelloConvalida => ({ disponibile: false, ok: false })
  if (!rows.length) return rows
  if (!isGestionaleConfigured()) {
    return rows.map((r) => ({ ...r, tornello: vuoto() }))
  }
  const days = daysInMonth(mese)
  const from = days[0]
  const to = days[days.length - 1]
  if (!from || !to) return rows.map((r) => ({ ...r, tornello: vuoto() }))
  try {
    const accessi = await queryAccessiUtenti({ from, to })
    if (!accessi.length) return rows.map((r) => ({ ...r, tornello: { disponibile: true, ok: false } }))
    const byPersonDay = new Map<string, { hm: string; minutes: number }>()
    const people = [...new Map(rows.map((r) => [r.personaleId, personaleById.get(r.personaleId)]))]
    for (const acc of accessi) {
      if (!isIngressoTornello(acc.raw)) continue
      const clock = clockFromAccesso(acc)
      if (!clock || !clock.ymd.startsWith(mese)) continue
      const label = labelAccesso(acc)
      if (!label) continue
      for (const [id, pe] of people) {
        if (!pe) continue
        if (!namesMatchPersonale(pe, label)) continue
        const key = `${id}|${clock.ymd}`
        const prev = byPersonDay.get(key)
        if (!prev || clock.minutes < prev.minutes) byPersonDay.set(key, { hm: clock.hm, minutes: clock.minutes })
      }
    }
    return rows.map((r) => {
      const hit = byPersonDay.get(`${r.personaleId}|${r.giorno}`)
      if (!hit) return { ...r, tornello: { disponibile: true, ok: false } }
      return {
        ...r,
        tornello: { disponibile: true, ok: true, orario: hit.hm },
      }
    })
  } catch (e) {
    console.warn("[libro-paga] tornello convalida:", (e as Error)?.message ?? e)
    return rows.map((r) => ({ ...r, tornello: vuoto() }))
  }
}
