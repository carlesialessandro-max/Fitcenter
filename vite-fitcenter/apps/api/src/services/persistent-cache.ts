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
  const vendSig = "v20-cross-da-rvw-log-utenti"
  return `${b}.${vendSig}`
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

  // Se si tratta di dati storici (asOf != oggi) e sono "totali" di vendita,
  // non devono mai scadere: anche se un TTL precedente li ha fatti scadere,
  // continuiamo a usarli perché sono definitivi una volta calcolati.
  const isHistoricalTotalsName =
    args.name === "data.dashboard" || args.name === "data.dettaglio-mese" || args.name === "data.dettaglio-anno"
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  const d = new Date()
  const year = useLocal ? d.getFullYear() : d.getUTCFullYear()
  const month = (useLocal ? d.getMonth() : d.getUTCMonth()) + 1
  const day = useLocal ? d.getDate() : d.getUTCDate()
  const todayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const treatAsNoExpiry = isHistoricalTotalsName && args.asOf !== todayKey

  const rows = db.exec(
    treatAsNoExpiry
      ? `SELECT value_json, expires_at_ms FROM cache_results
         WHERE name = ? AND scope = ? AND params_hash = ? AND asof = ? AND dep_sig = ?
         ORDER BY created_at_ms DESC
         LIMIT 1;`
      : `SELECT value_json, expires_at_ms FROM cache_results
         WHERE name = ? AND scope = ? AND params_hash = ? AND asof = ? AND dep_sig = ?
         LIMIT 1;`,
    treatAsNoExpiry
      ? [args.name, args.scope, paramsHash, args.asOf, args.depSig]
      : [args.name, args.scope, paramsHash, args.asOf, args.depSig]
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
      args.depSig,
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

