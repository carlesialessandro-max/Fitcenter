import { readJson, writeJson } from "../store/persist.js"
import { readCalendarioDb, writeCalendarioDb } from "../store/calendario-db.js"
import {
  parseQualifichePersonale,
  qualificheIds,
  type LpagaPersonale,
  type LpagaQualifica,
  type LpagaRuolo,
} from "../store/libro-paga-db.js"
import {
  isGestionaleConfigured,
  queryAnagraficaStaff,
  type AnagraficaStaffHit,
} from "./gestionale-sql.js"
import { namesMatchPersonale } from "./libro-paga-convalida.js"

const STAFF_CACHE_FILE = "lpaga-staff-anagrafica.json"
const STAFF_TTL_MS = 15 * 60 * 1000

type StaffCacheFile = { at: string; rows: AnagraficaStaffHit[] }

let staffMem: { at: number; rows: AnagraficaStaffHit[] } | null = null
let staffInFlight: Promise<AnagraficaStaffHit[]> | null = null

export function assertPuoModificarePersonale(
  actor: { ruolo: LpagaRuolo },
  target: { ruolo: LpagaRuolo },
  nextRuolo?: LpagaRuolo
): void {
  if (actor.ruolo !== "admin" && actor.ruolo !== "manager") {
    throw Object.assign(new Error("Solo amministratore o responsabile può modificare gli utenti"), { status: 403 })
  }
  if (actor.ruolo === "manager" && target.ruolo === "admin") {
    throw Object.assign(new Error("Il responsabile non può modificare un amministratore"), { status: 403 })
  }
  if (actor.ruolo === "manager" && nextRuolo === "admin") {
    throw Object.assign(new Error("Il responsabile non può assegnare il ruolo amministratore"), { status: 403 })
  }
}

export function puoModificarePersonale(actorRuolo: LpagaRuolo, targetRuolo: LpagaRuolo): boolean {
  if (actorRuolo !== "admin" && actorRuolo !== "manager") return false
  if (actorRuolo === "manager" && targetRuolo === "admin") return false
  return true
}

function mergeQualifiche(...lists: (unknown[] | undefined)[]): LpagaQualifica[] {
  const byId = new Map<string, LpagaQualifica>()
  for (const list of lists) {
    for (const q of parseQualifichePersonale(list ?? [])) {
      const prev = byId.get(q.id)
      if (!prev) byId.set(q.id, q)
      else if (q.data && !prev.data) byId.set(q.id, q)
    }
  }
  return [...byId.values()]
}

function readStaffDisk(): StaffCacheFile {
  return readJson<StaffCacheFile>(STAFF_CACHE_FILE, { at: "", rows: [] })
}

export async function refreshStaffAnagrafica(reason = "manual"): Promise<AnagraficaStaffHit[]> {
  if (staffInFlight) return staffInFlight
  staffInFlight = (async () => {
    try {
      if (!isGestionaleConfigured()) return staffMem?.rows ?? readStaffDisk().rows
      const rows = await queryAnagraficaStaff()
      staffMem = { at: Date.now(), rows }
      writeJson(STAFF_CACHE_FILE, { at: new Date().toISOString(), rows })
      console.log(`[libro-paga] anagrafica STAFF ${reason}: ${rows.length} nominativi`)
      return rows
    } catch (e) {
      console.warn("[libro-paga] refresh anagrafica STAFF:", (e as Error)?.message ?? e)
      return staffMem?.rows ?? readStaffDisk().rows
    } finally {
      staffInFlight = null
    }
  })()
  return staffInFlight
}

export async function getStaffAnagrafica(): Promise<AnagraficaStaffHit[]> {
  if (staffMem && Date.now() - staffMem.at < STAFF_TTL_MS) return staffMem.rows
  const disk = readStaffDisk()
  const diskAt = disk.at ? Date.parse(disk.at) : 0
  if (disk.rows.length && diskAt && Date.now() - diskAt < STAFF_TTL_MS) {
    staffMem = { at: diskAt, rows: disk.rows }
    return disk.rows
  }
  return refreshStaffAnagrafica("get")
}

export function startStaffAnagraficaSync(): void {
  void refreshStaffAnagrafica("startup")
  const t = setInterval(() => void refreshStaffAnagrafica("interval"), STAFF_TTL_MS)
  if (typeof t.unref === "function") t.unref()
}

function hitToGestionale(geo: AnagraficaStaffHit): NonNullable<LpagaPersonale["gestionale"]> {
  return {
    idUtente: geo.idUtente || undefined,
    codiceFiscale: geo.codiceFiscale,
    email: geo.email,
    cellulare: geo.cellulare,
    telefono: geo.telefono,
    indirizzo: geo.indirizzo,
    cap: geo.cap,
    citta: geo.citta,
    provincia: geo.provincia,
    dataNascita: geo.dataNascita,
    sesso: geo.sesso,
    tesseramento: geo.tesseramento,
    tesseramentoScadenza: geo.tesseramentoScadenza,
    certificatoMedico: geo.certificatoMedico,
    certificatoMedicoScadenza: geo.certificatoMedicoScadenza,
    categoria: geo.categoria || "STAFF",
  }
}

export async function enrichPersonaleHr(list: LpagaPersonale[]): Promise<LpagaPersonale[]> {
  if (!list.length) return list
  const instructors = readCalendarioDb().instructors
  let anagrafica: AnagraficaStaffHit[] = []
  try {
    anagrafica = await getStaffAnagrafica()
    if (!anagrafica.length && isGestionaleConfigured()) {
      anagrafica = await queryAnagraficaStaff(list)
    }
  } catch (e) {
    console.warn("[libro-paga] enrich anagrafica:", (e as Error)?.message ?? e)
  }

  return list.map((p) => {
    const label = `${p.cognome ?? ""} ${p.nome}`.trim()
    const cal = instructors.find(
      (i) => namesMatchPersonale(p, `${i.cognome} ${i.nome}`) || namesMatchPersonale(p, `${i.nome} ${i.cognome}`)
    )
    const geo =
      anagrafica.find((h) => namesMatchPersonale(p, `${h.cognome} ${h.nome}`)) ??
      anagrafica.find((h) => namesMatchPersonale(p, label))
    const geoTess = (geo?.tesseramento ?? "").trim()
    const calTess = (cal?.tesseramento ?? "").trim()
    const tesseramento = geoTess || calTess
    const tesseramentoScadenza = geo?.tesseramentoScadenza || cal?.tesseramentoScadenza || undefined
    const tesseramentoFonte: LpagaPersonale["tesseramentoFonte"] = geoTess
      ? "gestionale"
      : calTess
        ? "calendario"
        : undefined
    const qualifiche =
      p.qualifiche != null ? parseQualifichePersonale(p.qualifiche) : mergeQualifiche(cal?.qualifiche, geo?.qualifiche)
    return {
      ...p,
      ...(tesseramento ? { tesseramento } : {}),
      ...(tesseramentoScadenza ? { tesseramentoScadenza } : {}),
      ...(tesseramentoFonte ? { tesseramentoFonte } : {}),
      qualifiche,
      ...(geo ? { gestionale: hitToGestionale(geo) } : {}),
    }
  })
}

export function syncIstruttoreCalendarioHr(p: LpagaPersonale): void {
  try {
    const db = readCalendarioDb()
    const hit = db.instructors.find(
      (i) => namesMatchPersonale(p, `${i.cognome} ${i.nome}`) || namesMatchPersonale(p, `${i.nome} ${i.cognome}`)
    )
    if (!hit) return
    const now = new Date().toISOString()
    hit.tesseramento = (p.tesseramento ?? "").trim()
    hit.tesseramentoScadenza = p.tesseramentoScadenza?.trim() || null
    hit.qualifiche = qualificheIds(p.qualifiche ?? [])
    hit.updatedAt = now
    writeCalendarioDb(db)
  } catch (e) {
    console.warn("[libro-paga] sync istruttore calendario:", (e as Error)?.message ?? e)
  }
}
