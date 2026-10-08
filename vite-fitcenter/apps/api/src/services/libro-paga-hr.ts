import { readCalendarioDb, writeCalendarioDb } from "../store/calendario-db.js"
import {
  parseQualifichePersonale,
  qualificheIds,
  type LpagaPersonale,
  type LpagaQualifica,
  type LpagaRuolo,
} from "../store/libro-paga-db.js"
import { isGestionaleConfigured, queryAnagraficaStaff } from "./gestionale-sql.js"
import { namesMatchPersonale } from "./libro-paga-convalida.js"

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

export function puoModificarePersonale(
  actorRuolo: LpagaRuolo,
  targetRuolo: LpagaRuolo
): boolean {
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

export async function enrichPersonaleHr(list: LpagaPersonale[]): Promise<LpagaPersonale[]> {
  if (!list.length) return list
  const instructors = readCalendarioDb().instructors
  let anagrafica: Awaited<ReturnType<typeof queryAnagraficaStaff>> = []
  try {
    if (isGestionaleConfigured()) {
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
    const storedTess = (p.tesseramento ?? "").trim()
    const geoTess = (geo?.tesseramento ?? "").trim()
    const calTess = (cal?.tesseramento ?? "").trim()
    const tesseramento = storedTess || geoTess || calTess
    const tesseramentoScadenza =
      p.tesseramentoScadenza || geo?.tesseramentoScadenza || cal?.tesseramentoScadenza || undefined
    const tesseramentoFonte: LpagaPersonale["tesseramentoFonte"] = storedTess
      ? geoTess && storedTess === geoTess
        ? "gestionale"
        : "manuale"
      : geoTess
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
