import { findDumpFile, parseMysqlTable, readDumpSql, readDumpSqlFromBuffer } from "./libro-paga-dump.js"
import type {
  FileDb,
  LpagaLivello,
  LpagaMacroQuota,
  LpagaMensilita,
  LpagaPersonale,
  LpagaPresenza,
  LpagaRuolo,
  LpagaTotaleReparto,
  LpagaTurno,
  LpagaValidazione,
} from "../store/libro-paga-db.js"
import { exportFullFileDb, mergeTurniKeepOthers, nominativo, replaceTurniOnly } from "../store/libro-paga-db.js"
import { saveLibroPagaSnapshot } from "./libro-paga-backup.js"

function n(v: string | null | undefined): number {
  const x = Number(String(v ?? "").replace(",", "."))
  return Number.isFinite(x) ? x : 0
}

function ymd(v: string | null | undefined): string {
  const s = String(v ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const it = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/)
  if (it) {
    const d = it[1]!.padStart(2, "0")
    const m = it[2]!.padStart(2, "0")
    return `${it[3]}-${m}-${d}`
  }
  return s
}

function ymFromDate(v: string | null | undefined): string {
  const d = ymd(v)
  return d.length >= 7 ? d.slice(0, 7) : d
}

function dumpVal(r: Record<string, string | null>, ...keys: string[]): string {
  const lower = new Map(Object.keys(r).map((k) => [k.toLowerCase(), r[k]]))
  for (const key of keys) {
    const raw = lower.get(key.toLowerCase())
    const s = String(raw ?? "").trim()
    if (s && s.toUpperCase() !== "NULL") return s
  }
  return ""
}

function normPersonKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function nameTokens(p: { nome?: string; cognome?: string }): string {
  return [p.cognome, p.nome]
    .map((x) => normPersonKey(x ?? ""))
    .filter(Boolean)
    .sort()
    .join(" ")
}

/** Aggancia gli id Payroll del dump alle persone già in anagrafica (id, username, nome+cognome). */
export function mapDumpPersonaleIds(dump: LpagaPersonale[], current: LpagaPersonale[]): Map<string, string> {
  const map = new Map<string, string>()
  const byId = new Set(current.map((p) => p.id))
  const byUser = new Map<string, LpagaPersonale[]>()
  const byTokens = new Map<string, LpagaPersonale[]>()
  for (const p of current) {
    const u = (p.username ?? "").trim().toLowerCase()
    if (u) {
      const arr = byUser.get(u) ?? []
      arr.push(p)
      byUser.set(u, arr)
    }
    const t = nameTokens(p)
    if (t) {
      const arr = byTokens.get(t) ?? []
      arr.push(p)
      byTokens.set(t, arr)
    }
  }
  for (const d of dump) {
    if (!d.id) continue
    if (byId.has(d.id)) {
      map.set(d.id, d.id)
      continue
    }
    const u = (d.username ?? "").trim().toLowerCase()
    const um = u ? byUser.get(u) : undefined
    if (um?.length === 1) {
      map.set(d.id, um[0]!.id)
      continue
    }
    const t = nameTokens(d)
    const tm = t ? byTokens.get(t) : undefined
    if (tm?.length === 1) {
      map.set(d.id, tm[0]!.id)
      continue
    }
    map.set(d.id, d.id)
  }
  return map
}

function mapDumpLivelloIds(dump: LpagaLivello[], current: LpagaLivello[]): Map<string, string> {
  const map = new Map<string, string>()
  const byId = new Set(current.map((l) => l.id))
  const byNome = new Map<string, LpagaLivello[]>()
  for (const l of current) {
    const k = normPersonKey(l.nome)
    if (!k) continue
    const arr = byNome.get(k) ?? []
    arr.push(l)
    byNome.set(k, arr)
  }
  for (const d of dump) {
    if (!d.id) continue
    if (byId.has(d.id)) {
      map.set(d.id, d.id)
      continue
    }
    const hits = byNome.get(normPersonKey(d.nome)) ?? []
    map.set(d.id, hits.length === 1 ? hits[0]!.id : d.id)
  }
  return map
}

function personMatchesQ(p: { nome?: string; cognome?: string; username?: string }, q: string): boolean {
  const n = normPersonKey(q)
  if (n.length < 3) return false
  return normPersonKey([p.cognome, p.nome, p.username].join(" ")).includes(n)
}

function turnoDupKey(t: { giorno: string; personaleId: string; livelloId: string; quantita: number; note?: string }): string {
  return [
    t.giorno.slice(0, 10),
    t.personaleId,
    t.livelloId,
    Number(t.quantita).toFixed(2),
    normPersonKey(t.note ?? ""),
  ].join("|")
}

const MACRO_NOMI: Record<string, string> = {
  "48": "Spa",
  "152": "Desk",
  "153": "Commerciale",
  "51": "Amministrazione",
  "49": "Manutenzione",
  "50": "Pulizie",
  "52": "Direzione",
  "53": "Varie",
}

export function dumpSqlToDb(sql: string): FileDb {
  const nodes = parseMysqlTable(sql, "unit_node")
  let users = parseMysqlTable(sql, "users")
  if (!users.length) users = parseMysqlTable(sql, "user")
  const shifts = parseMysqlTable(sql, "workshifts")
  const atts = parseMysqlTable(sql, "attendances")
  const vals = parseMysqlTable(sql, "validations")
  const totals = parseMysqlTable(sql, "totals")
  const deps = parseMysqlTable(sql, "totals_dep")
  const comps = parseMysqlTable(sql, "compartments")

  const livelli: LpagaLivello[] = nodes.map((r) => {
    const parent = dumpVal(r, "parent", "parentId", "parent_id")
    const specialeId = dumpVal(r, "specialId", "special_id")
    return {
      id: dumpVal(r, "id"),
      nome: dumpVal(r, "name", "nome"),
      ...(parent && parent !== "0" ? { parentId: parent } : {}),
      retribuzione: n(dumpVal(r, "pay", "retribuzione")),
      fissa: dumpVal(r, "isFixed", "is_fixed") === "1",
      retribuibile: dumpVal(r, "isFinal", "is_final") === "1",
      statistica: dumpVal(r, "isStat", "is_stat") === "1",
      speciale: dumpVal(r, "isSpecial", "is_special") === "1",
      ...(specialeId ? { specialeId } : {}),
      attivo: true,
    }
  })

  const personale: LpagaPersonale[] = users
    .filter((r) => dumpVal(r, "id"))
    .map((r) => {
      const ruoloRaw = dumpVal(r, "role", "ruolo").toLowerCase() || "user"
      const ruolo: LpagaRuolo = ruoloRaw === "admin" || ruoloRaw === "manager" ? ruoloRaw : "user"
      const iban = dumpVal(r, "iban")
      const livelloId = dumpVal(r, "chargeLevel", "charge_level", "livelloId", "livello_id")
      const contratto = ymd(dumpVal(r, "contract", "contratto"))
      const username = dumpVal(r, "username").toLowerCase()
      return {
        id: dumpVal(r, "id"),
        nome: dumpVal(r, "name", "nome"),
        cognome: dumpVal(r, "surname", "cognome"),
        username,
        ruolo,
        ...(livelloId && livelloId !== "0" ? { livelloId } : {}),
        ...(contratto && /^\d{4}-\d{2}-\d{2}$/.test(contratto) ? { contratto } : {}),
        ...(iban ? { iban } : {}),
        attivo: true,
      }
    })

  const turni: LpagaTurno[] = shifts.map((r) => {
    const userId = dumpVal(r, "userId", "user_id", "userid")
    const giorno = ymd(dumpVal(r, "date", "giorno", "day"))
    const note = dumpVal(r, "note", "notes")
    return {
      id: dumpVal(r, "id"),
      personaleId: userId,
      livelloId: dumpVal(r, "levelId", "level_id", "livelloId", "livello_id"),
      giorno,
      quantita: n(dumpVal(r, "value", "quantita", "qty")),
      importo: n(dumpVal(r, "amount", "importo")),
      ...(note ? { note } : {}),
      creatoDa: dumpVal(r, "creatorId", "creator_id") || userId,
      createdAt: `${ymd(dumpVal(r, "creationDate", "creation_date") || giorno)}T12:00:00.000Z`,
    }
  })

  const presenze: LpagaPresenza[] = atts.map((r) => ({
    id: dumpVal(r, "id"),
    turnoId: dumpVal(r, "workshiftId", "workshift_id", "turnoId", "turno_id"),
    valore: n(dumpVal(r, "value", "valore")),
    controllatoDa: dumpVal(r, "userId", "user_id", "userid"),
    controllatoAt: `${ymd(dumpVal(r, "date", "giorno"))}T12:00:00.000Z`,
  }))

  const validazioni: LpagaValidazione[] = vals.map((r) => ({
    id: dumpVal(r, "id"),
    personaleId: dumpVal(r, "userId", "user_id", "userid"),
    giorno: ymd(dumpVal(r, "date", "giorno")),
    stamp: dumpVal(r, "validationStamp", "validation_stamp") || `${ymd(dumpVal(r, "date", "giorno"))}T12:00:00.000Z`,
  }))

  const mensilita: LpagaMensilita[] = totals.map((r) => ({
    id: dumpVal(r, "id"),
    personaleId: dumpVal(r, "userId", "user_id", "userid"),
    mese: ymFromDate(r.date),
    bonifico: n(r.payTotal) || n(r.total),
    ...(String(r.payNote ?? "").trim() ? { nota: String(r.payNote).trim() } : {}),
    chiuso: false,
  }))

  const totaliReparto: LpagaTotaleReparto[] = deps.map((r) => ({
    mese: ymFromDate(r.date),
    piscina: n(r.piscina),
    palestra: n(r.palestra),
    ristorante: n(r.ristorante),
    miscellanea: n(r.miscellanea),
    totale: n(r.total),
  }))

  const macroQuote: LpagaMacroQuota[] = comps.map((r) => {
    const livelloId = String(r.levelId ?? "")
    return {
      livelloId,
      nome: MACRO_NOMI[livelloId] ?? livelloId,
      piscina: n(r.piscina),
      palestra: n(r.palestra),
      ristorante: n(r.ristorante),
    }
  })

  return { livelli, personale, turni, presenze, mensilita, validazioni, totaliReparto, macroQuote }
}

export async function importLibroPagaDumpFromSql(
  sql: string,
  dumpName: string
): Promise<{
  dump: string
  storage: "sql" | "json"
  mode: "turni-only"
  snapshotId: string
  livelli: number
  personale: number
  turni: number
  turniRiassegnati: number
  presenze: number
  mensilita: number
  validazioni: number
}> {
  const current = await exportFullFileDb()
  if (!current.personale.length) {
    throw Object.assign(
      new Error("Anagrafica vuota: non si importa il dump Payroll. Ripristina prima il backup dati (ruoli e date)."),
      { status: 409 }
    )
  }
  const snapshot = saveLibroPagaSnapshot(current, `prima import turni ${dumpName}`)
  const imported = dumpSqlToDb(sql)
  if (!imported.turni.length) throw Object.assign(new Error("Dump senza turni (tabella workshifts)"), { status: 400 })

  const idMap = mapDumpPersonaleIds(imported.personale, current.personale)
  const remap = (id: string) => idMap.get(id) ?? id
  const turni = imported.turni.map((t) => ({
    ...t,
    personaleId: remap(t.personaleId),
    creatoDa: remap(t.creatoDa),
  }))
  const turniRiassegnati = turni.filter((t, i) => t.personaleId !== imported.turni[i]?.personaleId).length
  const presenze = imported.presenze.map((p) => ({
    ...p,
    controllatoDa: remap(p.controllatoDa),
  }))

  const storage = await replaceTurniOnly(turni, presenze)
  return {
    dump: dumpName,
    storage,
    mode: "turni-only",
    snapshotId: snapshot.id,
    livelli: current.livelli.length,
    personale: current.personale.length,
    turni: turni.length,
    turniRiassegnati,
    presenze: presenze.length,
    mensilita: current.mensilita.length,
    validazioni: current.validazioni.length,
  }
}

export async function importLibroPagaDumpFromBuffer(buf: Buffer, filename: string) {
  const sql = readDumpSqlFromBuffer(buf, filename)
  return importLibroPagaDumpFromSql(sql, filename || "upload")
}

/** Aggiunge i turni di UNA persona dal dump. Non cancella gli altri. */
export async function importLibroPagaDumpPersonaFromSql(
  sql: string,
  dumpName: string,
  opts: { q: string; mese?: string }
): Promise<{
  dump: string
  storage: "sql" | "json"
  mode: "persona"
  snapshotId: string
  persona: string
  personaleId: string
  mese: string | null
  dumpTurni: number
  inseriti: number
  aggiornati: number
  saltati: number
  senzaMansione: number
}> {
  const q = String(opts.q ?? "").trim()
  if (normPersonKey(q).length < 3) {
    throw Object.assign(new Error("Scrivi almeno 3 lettere del nominativo (es. Petruzzi)"), { status: 400 })
  }
  const mese = opts.mese && /^\d{4}-\d{2}$/.test(opts.mese) ? opts.mese : ""
  const current = await exportFullFileDb()
  if (!current.personale.length) {
    throw Object.assign(new Error("Anagrafica vuota: crea prima la persona in Personale."), { status: 409 })
  }
  const imported = dumpSqlToDb(sql)
  if (!imported.turni.length) throw Object.assign(new Error("Dump senza turni (tabella workshifts)"), { status: 400 })

  const dumpHits = imported.personale.filter((p) => personMatchesQ(p, q))
  const currentHits = current.personale.filter((p) => personMatchesQ(p, q))
  if (!dumpHits.length) {
    throw Object.assign(new Error(`Nel dump Payroll non c’è nessuno per «${q}».`), { status: 404 })
  }
  if (!currentHits.length) {
    throw Object.assign(
      new Error(`In anagrafica non c’è nessuno per «${q}». Creala prima in Personale, poi ritenta.`),
      { status: 404 }
    )
  }
  if (currentHits.length > 1) {
    throw Object.assign(
      new Error(
        `Più persone in anagrafica per «${q}»: ${currentHits.map((p) => nominativo(p)).join(", ")}. Scrivi nome e cognome.`
      ),
      { status: 409 }
    )
  }
  if (dumpHits.length > 1) {
    throw Object.assign(
      new Error(
        `Nel dump ci sono ${dumpHits.length} persone per «${q}»: ${dumpHits.map((p) => nominativo(p)).join(", ")}. Scrivi nome e cognome.`
      ),
      { status: 409 }
    )
  }

  const target = currentHits[0]!
  const dumpPerson = dumpHits[0]!
  let dumpTurni = imported.turni.filter((t) => t.personaleId === dumpPerson.id)
  if (mese) dumpTurni = dumpTurni.filter((t) => t.giorno.slice(0, 7) === mese)
  if (!dumpTurni.length) {
    throw Object.assign(
      new Error(
        mese
          ? `Nessun turno nel dump per ${nominativo(dumpPerson)} a ${mese}.`
          : `Nessun turno nel dump per ${nominativo(dumpPerson)}.`
      ),
      { status: 404 }
    )
  }

  const livMap = mapDumpLivelloIds(imported.livelli, current.livelli)
  const livOk = new Set(current.livelli.map((l) => l.id))
  const existingById = new Map(current.turni.map((t) => [t.id, t]))
  const seen = new Set(current.turni.map((t) => turnoDupKey(t)))
  const toMerge: LpagaTurno[] = []
  let aggiornati = 0
  let saltati = 0
  let senzaMansione = 0
  for (const t of dumpTurni) {
    const livelloId = livMap.get(t.livelloId) && livOk.has(livMap.get(t.livelloId)!) ? livMap.get(t.livelloId)! : livOk.has(t.livelloId) ? t.livelloId : ""
    if (!livelloId) {
      senzaMansione += 1
      continue
    }
    const row: LpagaTurno = {
      ...t,
      personaleId: target.id,
      livelloId,
      giorno: t.giorno.slice(0, 10),
    }
    const prev = existingById.get(t.id)
    if (prev) {
      toMerge.push({
        ...row,
        id: t.id,
        creatoDa: prev.creatoDa,
        createdAt: prev.createdAt,
      })
      aggiornati += 1
      continue
    }
    if (seen.has(turnoDupKey(row))) {
      saltati += 1
      continue
    }
    seen.add(turnoDupKey(row))
    toMerge.push(row)
  }
  if (!toMerge.length) {
    throw Object.assign(
      new Error(
        `Nessun turno nuovo da aggiungere per ${nominativo(target)}` +
          (saltati ? ` (${saltati} già presenti)` : "") +
          (senzaMansione ? `, ${senzaMansione} senza mansione in anagrafica` : "") +
          "."
      ),
      { status: 409 }
    )
  }

  const snapshot = saveLibroPagaSnapshot(current, `prima turni ${nominativo(target)} ${dumpName}`)
  const storage = await mergeTurniKeepOthers(toMerge)
  return {
    dump: dumpName,
    storage,
    mode: "persona",
    snapshotId: snapshot.id,
    persona: nominativo(target),
    personaleId: target.id,
    mese: mese || null,
    dumpTurni: dumpTurni.length,
    inseriti: toMerge.length - aggiornati,
    aggiornati,
    saltati,
    senzaMansione,
  }
}

export async function importLibroPagaDumpPersonaFromBuffer(
  buf: Buffer,
  filename: string,
  opts: { q: string; mese?: string }
) {
  return importLibroPagaDumpPersonaFromSql(readDumpSqlFromBuffer(buf, filename), filename || "upload", opts)
}

export async function importLibroPagaDump(): Promise<
  Awaited<ReturnType<typeof importLibroPagaDumpFromSql>>
> {
  const dump = findDumpFile()
  if (!dump) {
    throw Object.assign(
      new Error("Seleziona un file dump Payroll (.sql o .gz)."),
      { status: 400 }
    )
  }
  return importLibroPagaDumpFromSql(readDumpSql(dump), dump)
}
