import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import crypto from "crypto"
import initSqlJs from "sql.js"

let dbPromise: Promise<any> | null = null
let dbFilePath: string | null = null
let lastDbInstance: any | null = null
const PERSIST_CACHE_AT_END = process.env.PERSIST_CACHE_AT_END === "true"

function resolveDataDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
    path.resolve(__dirname, "../../data"),
  ]
  return candidates[0] ?? path.resolve(process.cwd(), "data")
}

async function openDb(): Promise<any> {
  const dataDir = resolveDataDir()
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  const filePath = path.join(dataDir, "app.sqlite")
  dbFilePath = filePath

  const SQL = await initSqlJs()
  const fileExists = fs.existsSync(filePath)
  const bytes = fileExists ? fs.readFileSync(filePath) : null
  const db: any = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database()

  db.run(
    `CREATE TABLE IF NOT EXISTS cache_results (
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      params_hash TEXT NOT NULL,
      asof TEXT NOT NULL,
      dep_sig TEXT NOT NULL,
      value_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      PRIMARY KEY (name, scope, params_hash, asof, dep_sig)
    );`
  )
  db.run(
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`
  )
  if (!PERSIST_CACHE_AT_END) persistDb(db)
  lastDbInstance = db
  return db
}

function persistDb(db: any) {
  if (!dbFilePath) return
  const out = db.export()
  fs.writeFileSync(dbFilePath, Buffer.from(out))
}

async function getDb(): Promise<any> {
  if (!dbPromise) dbPromise = openDb()
  return dbPromise
}

function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex")
}

function stableJson(x: unknown): string {
  if (x == null) return "null"
  if (typeof x !== "object") return JSON.stringify(x)
  const keys = Object.keys(x as Record<string, unknown>).sort()
  return JSON.stringify(x, keys)
}

async function getMeta(key: string): Promise<string> {
  const db = await getDb()
  const rows = db.exec(`SELECT value FROM meta WHERE key = ? LIMIT 1;`, [key])
  const v = rows?.[0]?.values?.[0]?.[0]
  return typeof v === "string" ? v : "0"
}

async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb()
  db.run(`INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`, [
    key,
    value,
  ])
  persistDb(db)
}

export async function bumpMetaVersion(key: "budget" | "convalidazioni" | "chiamate"): Promise<void> {
  const curr = Number(await getMeta(`v:${key}`)) || 0
  await setMeta(`v:${key}`, String(curr + 1))
}

export async function getDepSig(): Promise<string> {
  const [b, c, ch] = await Promise.all([
    getMeta("v:budget"),
    getMeta("v:convalidazioni"),
    getMeta("v:chiamate"),
  ])
  return `${b}.${c}.${ch}`
}

/**
 * Firma dipendenze "leggera" per dati che dipendono solo dal budget.
 * Riduce invalidazioni inutili (es. chiamate/convalidazioni) sui totali dashboard storici.
 */
export async function getBudgetDepSig(): Promise<string> {
  const b = await getMeta("v:budget")
  // Bump quando cambia la logica SQL vendite (invalida cache dashboard/dettaglio su SQLite).
  // La cache resta persistente su app.sqlite; solo la chiave dep_sig cambia così i totali si ricalcolano.
  const vendSig = "v25-zero-cache-guard"
  return `${b}.${vendSig}`
}

/** Data calendario da chiave cache (accetta anche `YYYY-MM-DDTHH` per «oggi»). */
export function baseAsOfDateKey(asOf: string): string {
  return asOf.length >= 10 ? asOf.slice(0, 10) : asOf
}

function parseYmdKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

export function isTodayCacheAsOf(asOf: string, todayKey?: string): boolean {
  const t = todayKey ?? getTodayCacheKey()
  return baseAsOfDateKey(asOf) === t
}

/** Cache storica recente con vendite 0: di solito errore/timeout, non un mese davvero vuoto. */
export function isLikelyPoisonedZeroCache(name: string, asOf: string, value: unknown): boolean {
  if (!isHistoricalTotalsCacheName(name)) return false
  const todayKey = getTodayCacheKey()
  if (isTodayCacheAsOf(asOf, todayKey)) return false
  const p = parseYmdKey(asOf)
  const t = parseYmdKey(todayKey)
  if (!p || !t) return false
  const diffDays =
    (Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(p.year, p.month - 1, p.day)) / 86_400_000
  if (diffDays < 1 || diffDays > 120) return false

  if (name === "data.dashboard") {
    const d = value as { entrateMese?: number }
    return (d.entrateMese ?? 0) === 0
  }
  if (name === "data.dettaglio-mese") {
    const d = value as {
      dettaglioMese?: { consuntivo?: number }
      dettaglioGiorno?: { consuntivo?: number }
    }
    return (d.dettaglioMese?.consuntivo ?? 0) === 0 && (d.dettaglioGiorno?.consuntivo ?? 0) === 0
  }
  return false
}

/** Elimina righe cache (es. rigenerazione precompute --force). */
export async function purgeCacheEntries(opts: {
  names?: string[]
  scope?: string
  asOfFrom?: string
  asOfTo?: string
}): Promise<number> {
  const db = await getDb()
  const clauses: string[] = []
  const params: unknown[] = []
  if (opts.names?.length) {
    clauses.push(`name IN (${opts.names.map(() => "?").join(",")})`)
    params.push(...opts.names)
  }
  if (opts.scope) {
    clauses.push("scope = ?")
    params.push(opts.scope)
  }
  if (opts.asOfFrom) {
    clauses.push("asof >= ?")
    params.push(opts.asOfFrom)
  }
  if (opts.asOfTo) {
    clauses.push("asof <= ?")
    params.push(opts.asOfTo)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const before = db.exec(`SELECT COUNT(*) AS c FROM cache_results ${where};`, params)
  const countBefore = Number(before?.[0]?.values?.[0]?.[0] ?? 0)
  db.run(`DELETE FROM cache_results ${where};`, params)
  if (!PERSIST_CACHE_AT_END) persistDb(db)
  return countBefore
}

export function getTodayCacheKey(): string {
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  const d = new Date()
  const year = useLocal ? d.getFullYear() : d.getUTCFullYear()
  const month = (useLocal ? d.getMonth() : d.getUTCMonth()) + 1
  const day = useLocal ? d.getDate() : d.getUTCDate()
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** dep_sig stabile per totali storici: non invalidare al cambio budget/chiamate. */
export function frozenDepSigForAsOf(asOf: string): string {
  return `frozen:${asOf}`
}

function isHistoricalTotalsCacheName(name: string): boolean {
  return name === "data.dashboard" || name === "data.dettaglio-mese" || name === "data.dettaglio-anno"
}

function isHistoricalCacheEntry(name: string, asOf: string, todayKey: string): boolean {
  const isHistoricalTotalsName = isHistoricalTotalsCacheName(name)
  const dateKey = baseAsOfDateKey(asOf)
  const isHistoricalReportConsulenti =
    name === "data.report-consulenti" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey < todayKey
  return (isHistoricalTotalsName && !isTodayCacheAsOf(asOf, todayKey)) || isHistoricalReportConsulenti
}

function readCacheRow<T>(
  db: any,
  name: string,
  scope: string,
  paramsHash: string,
  asOf: string,
  depSig: string | null,
  treatAsNoExpiry: boolean,
  now: number
): T | null {
  const rows = db.exec(
    depSig
      ? `SELECT value_json, expires_at_ms FROM cache_results
         WHERE name = ? AND scope = ? AND params_hash = ? AND asof = ? AND dep_sig = ?
         ORDER BY created_at_ms DESC
         LIMIT 1;`
      : `SELECT value_json, expires_at_ms FROM cache_results
         WHERE name = ? AND scope = ? AND params_hash = ? AND asof = ?
         ORDER BY created_at_ms DESC
         LIMIT 1;`,
    depSig
      ? [name, scope, paramsHash, asOf, depSig]
      : [name, scope, paramsHash, asOf]
  )
  const row = rows?.[0]?.values?.[0]
  if (!row) return null
  const valueJson = row[0]
  const expiresAt = Number(row[1] ?? 0)
  if (!valueJson) return null
  if (!treatAsNoExpiry) {
    if (Number.isNaN(expiresAt) || expiresAt < now) return null
  }
  try {
    return JSON.parse(String(valueJson)) as T
  } catch {
    return null
  }
}

export async function cacheGet<T>(args: {
  name: string
  scope: string
  params: unknown
  asOf: string
  depSig: string
}): Promise<T | null> {
  const db = await getDb()
  const paramsHash = sha1(stableJson(args.params))
  const now = Date.now()
  const todayKey = getTodayCacheKey()
  const treatAsNoExpiry = isHistoricalCacheEntry(args.name, args.asOf, todayKey)

  const tryRead = (asOf: string, depSig: string | null): T | null =>
    readCacheRow<T>(db, args.name, args.scope, paramsHash, asOf, depSig, treatAsNoExpiry, now)

  const accept = (hit: T | null): T | null => {
    if (hit == null) return null
    if (isLikelyPoisonedZeroCache(args.name, args.asOf, hit)) return null
    return hit
  }

  let hit = accept(tryRead(args.asOf, args.depSig))
  if (hit) return hit

  if (treatAsNoExpiry) {
    hit = accept(tryRead(args.asOf, frozenDepSigForAsOf(args.asOf)))
    if (hit) return hit
    // Precompute / versioni precedenti: ignora dep_sig (totali vendita immutabili).
    hit = accept(tryRead(args.asOf, null))
    if (hit) return hit
  }

  return null
}

export async function cacheSet(args: {
  name: string
  scope: string
  params: unknown
  asOf: string
  depSig: string
  ttlMs: number
  value: unknown
}): Promise<void> {
  const db = await getDb()
  const paramsHash = sha1(stableJson(args.params))
  const now = Date.now()
  const createdAt = now
  const expiresAt = now + Math.max(0, args.ttlMs)
  const todayKey = getTodayCacheKey()
  const treatAsNoExpiry = isHistoricalCacheEntry(args.name, args.asOf, todayKey)
  if (treatAsNoExpiry && isLikelyPoisonedZeroCache(args.name, args.asOf, args.value)) {
    return
  }
  const depSig = treatAsNoExpiry ? frozenDepSigForAsOf(args.asOf) : args.depSig
  db.run(
    `INSERT INTO cache_results(name, scope, params_hash, asof, dep_sig, value_json, created_at_ms, expires_at_ms)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name, scope, params_hash, asof, dep_sig)
     DO UPDATE SET value_json=excluded.value_json, created_at_ms=excluded.created_at_ms, expires_at_ms=excluded.expires_at_ms;`,
    [
      args.name,
      args.scope,
      paramsHash,
      args.asOf,
      depSig,
      JSON.stringify(args.value),
      createdAt,
      expiresAt,
    ]
  )
  if (!PERSIST_CACHE_AT_END) persistDb(db)
}

// Se richiesto, esporta/salva una sola volta alla fine del processo.
if (PERSIST_CACHE_AT_END) {
  process.once("exit", () => {
    if (lastDbInstance) {
      try {
        persistDb(lastDbInstance)
      } catch {
        // best-effort
      }
    }
  })
}

