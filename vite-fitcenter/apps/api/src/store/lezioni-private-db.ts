import { readJson, writeJson } from "./persist.js"
import { inferSessoDaNome, type LpSesso } from "../services/lp-istruttore-sesso.js"
import {
  LP_SLOT_END,
  LP_SLOT_START,
  LP_SLOT_STEP,
  corsieAperteGiorno,
  lpOreSlotsAperti,
  lpOreSlotsSettimanaTipo,
  lpOreSlotsTutti,
  postiGiorno,
  slotAperto,
} from "../services/lp-vasche-orari.js"

const FILE = "lezioni-private.json"

export type VascaId = "v25" | "ludica"

export type LpIstruttore = {
  id: string
  nome: string
  telefono: string
  attivo: boolean
  /** M uomo / F donna. Se manca si deduce dal nome. */
  sesso?: LpSesso
  /** Abilitato per lezioni con ragazzi disabili. */
  special?: boolean
}

export type LpRichiesta = {
  id: string
  createdAt: string
  createdBy: string
  clienteNome: string
  eta?: string
  telefono: string
  tutore?: string
  quando?: string
  prefIstruttore?: string
  note?: string
  status: "aperta" | "assegnata" | "annullata"
  istruttoreId?: string
  istruttoreNome?: string
  waNotifiedAt?: string
  waSkipped?: string
  waDestinations?: string[]
}

export type LpLezioneStato = "prenotata" | "svolta" | "annullata_istruttore" | "annullata_cliente" | "tolta"

export type LpLezione = {
  id: string
  giorno: string
  ora: string
  durataMin: number
  vasca: VascaId
  corsia: number
  stato: LpLezioneStato
  annullataAt?: string
  annullataBy?: string
}

export type LpPacchetto = {
  id: string
  richiestaId: string
  clienteNome: string
  telefono: string
  tipo: "prova" | "5" | "10"
  istruttoreId: string
  istruttoreNome: string
  createdAt: string
  lezioni: LpLezione[]
}

/** Corsie disponibili per vasca (0 = chiusa quel giorno). 0=dom … 6=sab */
export type LpRegoleDow = Record<string, { v25: number; ludica: number }>

export type LezioniPrivateDb = {
  instructors: LpIstruttore[]
  richieste: LpRichiesta[]
  pacchetti: LpPacchetto[]
  regole: LpRegoleDow
}

export function defaultRegole(): LpRegoleDow {
  const r: LpRegoleDow = {}
  for (let d = 0; d <= 6; d++) r[String(d)] = { v25: 1, ludica: 2 }
  return r
}

const DEFAULT: LezioniPrivateDb = { instructors: [], richieste: [], pacchetti: [], regole: defaultRegole() }

function asVasca(v: unknown): VascaId | null {
  return v === "v25" || v === "ludica" ? v : null
}

export function readLezioniPrivateDb(): LezioniPrivateDb {
  const raw = readJson<Partial<LezioniPrivateDb>>(FILE, DEFAULT)
  const instructors = (Array.isArray(raw.instructors) ? raw.instructors : []).map((i) => {
    const sesso = i.sesso === "M" || i.sesso === "F" ? i.sesso : inferSessoDaNome(i.nome) ?? undefined
    return { ...i, sesso }
  })
  return {
    instructors,
    richieste: Array.isArray(raw.richieste) ? raw.richieste : [],
    pacchetti: Array.isArray(raw.pacchetti) ? raw.pacchetti : [],
    regole: raw.regole && typeof raw.regole === "object" ? { ...defaultRegole(), ...raw.regole } : defaultRegole(),
  }
}

export function writeLezioniPrivateDb(db: LezioniPrivateDb): void {
  writeJson(FILE, db)
}

export function newLpId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function hmToMin(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function minToHm(n: number): string {
  const h = Math.floor(n / 60)
  const m = n % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export { LP_SLOT_START, LP_SLOT_END, LP_SLOT_STEP, lpOreSlotsAperti, lpOreSlotsSettimanaTipo, postiGiorno }

export function lpOreSlots(): string[] {
  return lpOreSlotsTutti()
}

export function oreCoperteLezioneLp(ora: string, durataMin: number): string[] {
  const s = hmToMin(ora)
  if (s == null) return []
  const dur = Number.isFinite(durataMin) && durataMin > 0 ? durataMin : 30
  const out: string[] = []
  for (let m = s; m < s + dur; m += LP_SLOT_STEP) {
    if (m >= LP_SLOT_START && m < LP_SLOT_END) out.push(minToHm(m))
  }
  return out
}

export function lezioneAttiva(l: LpLezione): boolean {
  return l.stato === "prenotata" || l.stato === "svolta"
}

export function corsieMax(_regole: LpRegoleDow, giornoIso: string, vasca: VascaId): number {
  return corsieAperteGiorno(giornoIso, vasca)
}

export function slotOccupanti(
  db: LezioniPrivateDb,
  giorno: string,
  ora: string,
  vasca: VascaId,
  corsia: number,
  exceptLezioneIds?: string | string[],
): number {
  const skip = new Set(Array.isArray(exceptLezioneIds) ? exceptLezioneIds : exceptLezioneIds ? [exceptLezioneIds] : [])
  let n = 0
  for (const p of db.pacchetti) {
    for (const l of p.lezioni) {
      if (!lezioneAttiva(l)) continue
      if (skip.has(l.id)) continue
      if (l.giorno !== giorno || l.vasca !== vasca || l.corsia !== corsia) continue
      if (oreCoperteLezioneLp(l.ora, l.durataMin).includes(ora)) n += 1
    }
  }
  return n
}

export function slotOccupato(
  db: LezioniPrivateDb,
  giorno: string,
  ora: string,
  vasca: VascaId,
  corsia: number,
  exceptLezioneIds?: string | string[],
): boolean {
  const f = slotAperto(giorno, ora, vasca, corsia)
  const cap = f?.capCorsia ?? 1
  return slotOccupanti(db, giorno, ora, vasca, corsia, exceptLezioneIds) >= cap
}

export function assertSlotLibero(
  db: LezioniPrivateDb,
  giorno: string,
  ora: string,
  vasca: VascaId,
  corsia: number,
  durataMin: number,
  exceptLezioneIds?: string | string[],
): string | null {
  const v = asVasca(vasca)
  if (!v) return "Vasca non valida"
  const fascia = slotAperto(giorno, ora, vasca, corsia, durataMin)
  if (!fascia) {
    if (corsieAperteGiorno(giorno, vasca) <= 0) return "Quel giorno la vasca non è disponibile per le private"
    return "Orario non disponibile in questa vasca"
  }
  for (const o of oreCoperteLezioneLp(ora, durataMin)) {
    const usati = slotOccupanti(db, giorno, o, vasca, corsia, exceptLezioneIds)
    if (usati >= fascia.capCorsia) {
      return fascia.capCorsia > 1 ? `Corsia piena alle ${o} (${fascia.capCorsia} posti)` : `Corsia occupata alle ${o}`
    }
  }
  return null
}
