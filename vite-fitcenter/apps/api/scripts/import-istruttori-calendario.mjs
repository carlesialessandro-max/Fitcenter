/**
 * Importa anagrafica istruttori da Excel in calendario-reparti.json (merge, no duplicati).
 *
 * Uso (dalla cartella apps/api o root monorepo):
 *   pnpm run import:istruttori
 *   pnpm run import:istruttori -- C:\percorso\istruttori.xlsx
 *   ISTRUTTORI_XLSX=C:\percorso\istruttori.xlsx pnpm run import:istruttori
 *
 * File di default: <data>/planning-import/istruttori.xlsx (stessa cartella data dell'API).
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, "..")
const req = createRequire(import.meta.url)
const XLSX = req("xlsx")

/** Stessi candidati di apps/api/src/store/persist.ts (+ cwd in apps/api). */
function dataDirCandidates() {
  return [
    path.join(apiRoot, "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/vite-fitcenter/apps/api/data"),
    path.resolve(process.cwd(), "../data"),
    path.resolve(process.cwd(), "../../apps/api/data"),
  ]
}

function resolveDataDir() {
  const candidates = dataDirCandidates()
  const existing = candidates.find((d) => fs.existsSync(d))
  const dir = existing ?? candidates[0]
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, "planning-import"), { recursive: true })
  return dir
}

function resolveIstruttoriXlsx(dataDir) {
  const fromEnv = process.env.ISTRUTTORI_XLSX?.trim()
  if (fromEnv) return path.resolve(fromEnv)

  const fromArg = process.argv.slice(2).find((a) => a && !a.startsWith("-"))
  if (fromArg) return path.resolve(fromArg)

  const staticCandidates = [
    path.join(dataDir, "planning-import", "istruttori.xlsx"),
    path.join(apiRoot, "data", "planning-import", "istruttori.xlsx"),
    path.join(apiRoot, "..", "web", "data", "planning-import", "istruttori.xlsx"),
    path.join(apiRoot, "..", "..", "web", "data", "planning-import", "istruttori.xlsx"),
  ]

  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    staticCandidates.push(path.join(dir, "istruttori.xlsx"))
    staticCandidates.push(path.join(dir, "apps", "api", "data", "planning-import", "istruttori.xlsx"))
    staticCandidates.push(path.join(dir, "vite-fitcenter", "apps", "api", "data", "planning-import", "istruttori.xlsx"))
    staticCandidates.push(
      path.join(dir, "vite-fitcenter", "vite-fitcenter", "apps", "api", "data", "planning-import", "istruttori.xlsx")
    )
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const tried = []
  for (const p of staticCandidates) {
    const resolved = path.resolve(p)
    if (tried.includes(resolved)) continue
    tried.push(resolved)
    if (fs.existsSync(resolved)) return resolved
  }

  return { missing: true, defaultPath: path.join(dataDir, "planning-import", "istruttori.xlsx"), tried }
}

function normName(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
}

function parsePersonCell(raw) {
  let s = String(raw ?? "").trim()
  if (!s) return null
  if (/^x\s+/i.test(s)) return null
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  const nome = parts[parts.length - 1]
  const cognome = parts.slice(0, -1).join(" ")
  const title = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  return {
    cognome: cognome
      .split(/\s+/)
      .map(title)
      .join(" "),
    nome: title(nome),
  }
}

function main() {
  const dataDir = resolveDataDir()
  const resolved = resolveIstruttoriXlsx(dataDir)

  if (resolved && typeof resolved === "object" && resolved.missing) {
    console.error("[istruttori] File non trovato.")
    console.error("[istruttori] Percorso atteso (crea la cartella e copia il file):")
    console.error("  ", resolved.defaultPath)
    console.error("[istruttori] Percorsi controllati:")
    for (const p of resolved.tried.slice(0, 12)) console.error("  -", p)
    if (resolved.tried.length > 12) console.error("  ... e altri", resolved.tried.length - 12)
    console.error("")
    console.error("Esempi:")
    console.error('  copy C:\\Users\\...\\Downloads\\istruttori.xlsx "' + resolved.defaultPath + '"')
    console.error('  $env:ISTRUTTORI_XLSX="C:\\percorso\\istruttori.xlsx"; pnpm run import:istruttori')
    console.error('  pnpm run import:istruttori -- "C:\\percorso\\istruttori.xlsx"')
    process.exit(1)
  }

  const xlsxPath = resolved
  const dbPath = path.join(dataDir, "calendario-reparti.json")
  const db = fs.existsSync(dbPath)
    ? JSON.parse(fs.readFileSync(dbPath, "utf8"))
    : { instructors: [], revisions: [] }
  if (!Array.isArray(db.instructors)) db.instructors = []

  const wb = XLSX.readFile(xlsxPath, { cellDates: false, raw: false })
  const sh = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" })

  const seen = new Set(db.instructors.map((i) => `${normName(i.cognome)}|${normName(i.nome)}`))
  const now = new Date().toISOString()
  let added = 0
  let skipped = 0

  for (const row of rows) {
    const cell = row[0] ?? row
    const p = parsePersonCell(typeof cell === "string" ? cell : row.join?.(" ") ?? "")
    if (!p) {
      skipped++
      continue
    }
    const key = `${normName(p.cognome)}|${normName(p.nome)}`
    if (seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    db.instructors.push({
      id: crypto.randomUUID(),
      nome: p.nome,
      cognome: p.cognome,
      telefono: "",
      email: "",
      createdAt: now,
      updatedAt: now,
    })
    added++
  }

  db.instructors.sort((a, b) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome))
  const tmp = dbPath + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8")
  fs.renameSync(tmp, dbPath)
  console.log("[istruttori] Data API:", dataDir)
  console.log("[istruttori] File Excel:", xlsxPath)
  console.log("[istruttori] DB:", dbPath)
  console.log("[istruttori] Aggiunti:", added, "| saltati/vuoti:", skipped, "| totale anagrafica:", db.instructors.length)
}

main()
