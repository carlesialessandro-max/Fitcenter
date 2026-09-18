import { readJson, writeJson } from "./persist.js"

const FILE = "lezioni-private.json"

export type VascaId = "v25" | "ludica"

export type LpIstruttore = {
  id: string
  nome: string
  telefono: string
  attivo: boolean
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

export type LpLezioneStato = "prenotata" | "svolta" | "annullata_istruttore" | "annullata_cliente"

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
  return {
    instructors: Array.isArray(raw.instructors) ? raw.instructors : [],
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

export const LP_SLOT_START = 8 * 60
export const LP_SLOT_END = 21 * 60
export const LP_SLOT_STEP = 30

export function lpOreSlots(): string[] {
  const out: string[] = []
  for (let m = LP_SLOT_START; m < LP_SLOT_END; m += LP_SLOT_STEP) out.push(minToHm(m))
  return out
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

export function corsieMax(regole: LpRegoleDow, giornoIso: string, vasca: VascaId): number {
  const dt = new Date(`${giornoIso}T12:00:00`)
  const dow = Number.isNaN(dt.getTime()) ? 1 : dt.getDay()
  const row = regole[String(dow)] ?? { v25: 1, ludica: 2 }
  return vasca === "v25" ? Math.max(0, Math.min(1, Number(row.v25) || 0)) : Math.max(0, Math.min(2, Number(row.ludica) || 0))
}

export function slotOccupato(
  db: LezioniPrivateDb,
  giorno: string,
  ora: string,
  vasca: VascaId,
  corsia: number,
  exceptLezioneId?: string,
): boolean {
  for (const p of db.pacchetti) {
    for (const l of p.lezioni) {
      if (!lezioneAttiva(l)) continue
      if (exceptLezioneId && l.id === exceptLezioneId) continue
      if (l.giorno !== giorno || l.vasca !== vasca || l.corsia !== corsia) continue
      if (oreCoperteLezioneLp(l.ora, l.durataMin).includes(ora)) return true
    }
  }
  return false
}

export function assertSlotLibero(
  db: LezioniPrivateDb,
  giorno: string,
  ora: string,
  vasca: VascaId,
  corsia: number,
  durataMin: number,
  exceptLezioneId?: string,
): string | null {
  const max = corsieMax(db.regole, giorno, vasca)
  if (max <= 0) return "Quel giorno la vasca non è disponibile per le private"
  if (corsia < 1 || corsia > max) return "Corsia non valida per quella vasca"
  const v = asVasca(vasca)
  if (!v) return "Vasca non valida"
  for (const o of oreCoperteLezioneLp(ora, durataMin)) {
    if (slotOccupato(db, giorno, o, vasca, corsia, exceptLezioneId)) {
      return `Corsia occupata alle ${o}`
    }
  }
  return null
}
