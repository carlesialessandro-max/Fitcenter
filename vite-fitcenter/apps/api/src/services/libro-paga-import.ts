import { findDumpFile, parseMysqlTable, readDumpSql } from "./libro-paga-dump.js"
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
import { replaceImportedDb } from "../store/libro-paga-db.js"

function n(v: string | null | undefined): number {
  const x = Number(String(v ?? "").replace(",", "."))
  return Number.isFinite(x) ? x : 0
}

function ymd(v: string | null | undefined): string {
  const s = String(v ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

function ymFromDate(v: string | null | undefined): string {
  const d = ymd(v)
  return d.length >= 7 ? d.slice(0, 7) : d
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
  const users = parseMysqlTable(sql, "users")
  const shifts = parseMysqlTable(sql, "workshifts")
  const atts = parseMysqlTable(sql, "attendances")
  const vals = parseMysqlTable(sql, "validations")
  const totals = parseMysqlTable(sql, "totals")
  const deps = parseMysqlTable(sql, "totals_dep")
  const comps = parseMysqlTable(sql, "compartments")

  const livelli: LpagaLivello[] = nodes.map((r) => {
    const parent = String(r.parent ?? "").trim()
    return {
      id: String(r.id ?? ""),
      nome: String(r.name ?? "").trim(),
      ...(parent && parent !== "0" ? { parentId: parent } : {}),
      retribuzione: n(r.pay),
      fissa: String(r.isFixed ?? "") === "1",
      retribuibile: String(r.isFinal ?? "") === "1",
      statistica: String(r.isStat ?? "") === "1",
      speciale: String(r.isSpecial ?? "") === "1",
      ...(r.specialId ? { specialeId: String(r.specialId) } : {}),
      attivo: true,
    }
  })

  const personale: LpagaPersonale[] = users
    .filter((r) => String(r.id ?? ""))
    .map((r) => {
      const ruoloRaw = String(r.role ?? "user").toLowerCase()
      const ruolo: LpagaRuolo = ruoloRaw === "admin" || ruoloRaw === "manager" ? ruoloRaw : "user"
      const iban = String(r.iban ?? "").trim()
      const livelloId = String(r.chargeLevel ?? "").trim()
      const contratto = ymd(r.contract)
      return {
        id: String(r.id ?? ""),
        nome: String(r.name ?? "").trim(),
        cognome: String(r.surname ?? "").trim(),
        username: String(r.username ?? "").trim().toLowerCase(),
        ruolo,
        ...(livelloId && livelloId !== "0" ? { livelloId } : {}),
        ...(contratto && /^\d{4}-\d{2}-\d{2}$/.test(contratto) ? { contratto } : {}),
        ...(iban && iban.toUpperCase() !== "NULL" ? { iban } : {}),
        attivo: true,
      }
    })

  const turni: LpagaTurno[] = shifts.map((r) => ({
    id: String(r.id ?? ""),
    personaleId: String(r.userId ?? ""),
    livelloId: String(r.levelId ?? ""),
    giorno: ymd(r.date),
    quantita: n(r.value),
    importo: n(r.amount),
    ...(String(r.note ?? "").trim() ? { note: String(r.note).trim() } : {}),
    creatoDa: String(r.creatorId ?? r.userId ?? ""),
    createdAt: `${ymd(r.creationDate || r.date)}T12:00:00.000Z`,
  }))

  const presenze: LpagaPresenza[] = atts.map((r) => ({
    id: String(r.id ?? ""),
    turnoId: String(r.workshiftId ?? ""),
    valore: n(r.value),
    controllatoDa: String(r.userId ?? ""),
    controllatoAt: `${ymd(r.date)}T12:00:00.000Z`,
  }))

  const validazioni: LpagaValidazione[] = vals.map((r) => ({
    id: String(r.id ?? ""),
    personaleId: String(r.userId ?? ""),
    giorno: ymd(r.date),
    stamp: String(r.validationStamp ?? "").trim() || `${ymd(r.date)}T12:00:00.000Z`,
  }))

  const mensilita: LpagaMensilita[] = totals.map((r) => ({
    id: String(r.id ?? ""),
    personaleId: String(r.userId ?? ""),
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

export async function importLibroPagaDump(): Promise<{
  dump: string
  storage: "sql" | "json"
  livelli: number
  personale: number
  turni: number
  presenze: number
  mensilita: number
  validazioni: number
}> {
  const dump = findDumpFile()
  if (!dump) {
    throw Object.assign(
      new Error(
        "Dump Payroll non trovato. Esporta Sql1272546_1 da phpMyAdmin (SQL) e copia il file come apps/api/data/libropaga-dump.sql sul server FitCenter."
      ),
      { status: 404 }
    )
  }
  const sql = readDumpSql(dump)
  const db = dumpSqlToDb(sql)
  if (!db.livelli.length) throw Object.assign(new Error("Dump senza livelli"), { status: 400 })
  const storage = await replaceImportedDb(db)
  return {
    dump,
    storage,
    livelli: db.livelli.length,
    personale: db.personale.length,
    turni: db.turni.length,
    presenze: db.presenze.length,
    mensilita: db.mensilita.length,
    validazioni: db.validazioni.length,
  }
}
