import fs from "fs"

export type MysqlRow = Record<string, string | null>

function findAllInsertBlocks(sql: string, table: string): { columns: string[]; valuesSql: string }[] {
  const out: { columns: string[]; valuesSql: string }[] = []
  const needle = `INSERT INTO \`${table}\``
  let from = 0
  while (from < sql.length) {
    const idx = sql.indexOf(needle, from)
    if (idx < 0) break
    const rest = sql.slice(idx + needle.length)
    const paren = rest.indexOf("(")
    const close = rest.indexOf(")")
    if (paren < 0 || close < 0 || close < paren) break
    const columns = rest
      .slice(paren + 1, close)
      .split(",")
      .map((c) => c.replace(/[`\s]/g, ""))
      .filter(Boolean)
    const valuesKw = rest.slice(close + 1).search(/VALUES/i)
    if (valuesKw < 0) break
    let i = close + 1 + valuesKw + 6
    while (i < rest.length && /\s/.test(rest[i]!)) i++
    const start = i
    let inStr = false
    let end = rest.length
    for (; i < rest.length; i++) {
      const ch = rest[i]!
      if (inStr) {
        if (ch === "\\" && rest[i + 1] === "'") {
          i++
          continue
        }
        if (ch === "'" && rest[i + 1] === "'") {
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
    out.push({ columns, valuesSql: rest.slice(start, end) })
    from = idx + needle.length + end + 1
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
  return fs.readFileSync(filePath, "utf8")
}

export function dumpCandidates(): string[] {
  const env = process.env.LIBROPAGA_DUMP?.trim()
  return [
    ...(env ? [env] : []),
    "C:\\Users\\aless\\OneDrive\\Documenti\\libropaga.it\\sql\\89_46_111_76.sql",
    "C:\\Users\\aless\\OneDrive\\Documenti\\FitCenter\\libropaga.it\\sql\\89_46_111_76.sql",
  ]
}

export function findDumpFile(): string | null {
  for (const p of dumpCandidates()) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return null
}
