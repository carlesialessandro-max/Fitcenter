import fs from "fs"
import path from "path"
import zlib from "zlib"
import { fileURLToPath } from "url"
import { getDataDir } from "../store/persist.js"

export type MysqlRow = Record<string, string | null>

function parseCreateColumns(sql: string, table: string): string[] {
  const needle = `CREATE TABLE \`${table}\``
  const idx = sql.indexOf(needle)
  if (idx < 0) return []
  const chunk = sql.slice(idx, idx + 12000)
  const end = chunk.search(/\)\s*ENGINE=/i)
  const body = end > 0 ? chunk.slice(0, end) : chunk
  const cols: string[] = []
  const re = /^\s*`([^`]+)`\s+/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) cols.push(m[1]!)
  return cols
}

function skipWs(sql: string, i: number): number {
  while (i < sql.length && /\s/.test(sql[i]!)) i++
  return i
}

function findAllInsertBlocks(sql: string, table: string): { columns: string[]; valuesSql: string }[] {
  const out: { columns: string[]; valuesSql: string }[] = []
  const createCols = parseCreateColumns(sql, table)
  const needle = `INSERT INTO \`${table}\``
  let from = 0
  while (from < sql.length) {
    const idx = sql.indexOf(needle, from)
    if (idx < 0) break
    let i = skipWs(sql, idx + needle.length)
    let columns = createCols
    if (sql[i] === "(") {
      const close = sql.indexOf(")", i)
      if (close < 0) break
      const listed = sql
        .slice(i + 1, close)
        .split(",")
        .map((c) => c.replace(/[`\s]/g, ""))
        .filter(Boolean)
      if (listed.length) columns = listed
      i = skipWs(sql, close + 1)
    }
    if (sql.slice(i, i + 6).toUpperCase() !== "VALUES") {
      from = idx + needle.length
      continue
    }
    i = skipWs(sql, i + 6)
    const start = i
    let inStr = false
    let end = sql.length
    for (; i < sql.length; i++) {
      const ch = sql[i]!
      if (inStr) {
        if (ch === "\\" && sql[i + 1] === "'") {
          i++
          continue
        }
        if (ch === "'" && sql[i + 1] === "'") {
          i++
          continue
        }
        if (ch === "'") inStr = false
        continue
      }
      if (ch === "'") inStr = true
      else if (ch === ";") {
        end = i
        break
      }
    }
    if (columns.length) out.push({ columns, valuesSql: sql.slice(start, end) })
    from = end + 1
  }
  return out
}

function parseValueTuples(valuesSql: string): string[][] {
  const rows: string[][] = []
  let i = 0
  const s = valuesSql
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++
    if (i >= s.length) break
    if (s[i] !== "(") {
      i++
      continue
    }
    i++
    const vals: string[] = []
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i]!)) i++
      if (s[i] === ")") {
        i++
        break
      }
      if (s.slice(i, i + 4).toUpperCase() === "NULL" && (i + 4 >= s.length || /[\s,)]/.test(s[i + 4]!))) {
        vals.push("NULL")
        i += 4
      } else if (s[i] === "'") {
        i++
        let out = ""
        while (i < s.length) {
          if (s[i] === "\\" && s[i + 1] === "'") {
            out += "'"
            i += 2
            continue
          }
          if (s[i] === "'" && s[i + 1] === "'") {
            out += "'"
            i += 2
            continue
          }
          if (s[i] === "'") {
            i++
            break
          }
          out += s[i]
          i++
        }
        vals.push(out)
      } else {
        let out = ""
        while (i < s.length && s[i] !== "," && s[i] !== ")") {
          out += s[i]
          i++
        }
        vals.push(out.trim())
      }
      while (i < s.length && /\s/.test(s[i]!)) i++
      if (s[i] === ",") i++
    }
    rows.push(vals)
  }
  return rows
}

export function parseMysqlTable(sql: string, table: string): MysqlRow[] {
  const blocks = findAllInsertBlocks(sql, table)
  const rows: MysqlRow[] = []
  for (const block of blocks) {
    const tuples = parseValueTuples(block.valuesSql)
    for (const vals of tuples) {
      const row: MysqlRow = {}
      for (let i = 0; i < block.columns.length; i++) {
        const col = block.columns[i]!
        const v = vals[i]
        row[col] = v == null || v === "NULL" ? null : v
      }
      rows.push(row)
    }
  }
  return rows
}

export function readDumpSql(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  const gz = filePath.toLowerCase().endsWith(".gz") || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)
  return (gz ? zlib.gunzipSync(buf) : buf).toString("utf8")
}

function isDumpFilename(name: string): boolean {
  const n = name.toLowerCase()
  const okExt = n.endsWith(".sql") || n.endsWith(".gz") || !path.extname(name)
  if (!okExt) return false
  return n.startsWith("libropaga-dump") || n.startsWith("sql1272546") || n.startsWith("89_46_111_76")
}

function dumpDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return [
    getDataDir(),
    path.resolve(here, "../../data"),
    path.resolve(here, "../data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/vite-fitcenter/apps/api/data"),
    "C:\\FitCenter\\vite-fitcenter\\vite-fitcenter\\apps\\api\\data",
    "C:\\fitcenter\\vite-fitcenter\\vite-fitcenter\\apps\\api\\data",
    "C:\\FitCenter\\vite-fitcenter\\apps\\api\\data",
    "C:\\fitcenter\\vite-fitcenter\\apps\\api\\data",
    "C:\\Users\\aless\\OneDrive\\Documenti\\libropaga.it\\sql",
    "C:\\Users\\aless\\OneDrive\\Documenti\\FitCenter\\libropaga.it\\sql",
  ]
}

export function dumpCandidates(): string[] {
  const env = process.env.LIBROPAGA_DUMP?.trim()
  const names = ["libropaga-dump.sql", "libropaga-dump.sql.gz", "89_46_111_76.sql", "Sql1272546_1_Mon.gz"]
  const out: string[] = []
  if (env) out.push(env)
  for (const dir of dumpDirs()) {
    for (const name of names) out.push(path.join(dir, name))
  }
  return out
}

export function findDumpFile(): string | null {
  const env = process.env.LIBROPAGA_DUMP?.trim()
  if (env && fs.existsSync(env)) return env
  const seen = new Set<string>()
  for (const dir of dumpDirs()) {
    const key = dir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (!fs.existsSync(dir)) continue
      for (const name of fs.readdirSync(dir)) {
        if (!isDumpFilename(name)) continue
        const p = path.join(dir, name)
        if (fs.statSync(p).isFile()) return p
      }
    } catch {
      // ignore
    }
  }
  for (const p of dumpCandidates()) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return null
}
