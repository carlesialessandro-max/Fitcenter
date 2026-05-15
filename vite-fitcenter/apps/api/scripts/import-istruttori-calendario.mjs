/**
 * Importa anagrafica istruttori da Excel in calendario-reparti.json (merge, no duplicati).
 *
 * Uso:
 *   pnpm --filter api run import:istruttori
 *   ISTRUTTORI_XLSX=C:\path\istruttori.xlsx pnpm --filter api run import:istruttori
 *
 * File di default: apps/api/data/planning-import/istruttori.xlsx
 * Colonna A: "Cognome Nome" (ultima parola = nome). Righe che iniziano con "X " sono escluse.
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

function dataDir() {
  const candidates = [
    path.join(apiRoot, "data"),
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
  ]
  const existing = candidates.find((d) => fs.existsSync(d))
  const dir = existing ?? candidates[0]
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
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
  const defaultXlsx = path.join(dataDir(), "planning-import", "istruttori.xlsx")
  const xlsxPath = process.env.ISTRUTTORI_XLSX?.trim() || process.argv[2]?.trim() || defaultXlsx
  if (!fs.existsSync(xlsxPath)) {
    console.error("[istruttori] File non trovato:", xlsxPath)
    console.error("Copia istruttori.xlsx in apps/api/data/planning-import/ oppure imposta ISTRUTTORI_XLSX.")
    process.exit(1)
  }

  const dbPath = path.join(dataDir(), "calendario-reparti.json")
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
  console.log("[istruttori] File:", xlsxPath)
  console.log("[istruttori] Aggiunti:", added, "| saltati/vuoti:", skipped, "| totale anagrafica:", db.instructors.length)
}

main()
