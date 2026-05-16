/**
 * Import una tantum da planning-weekly.json → calendario-reparti.json.
 * Dopo l'import l'API legge solo il DB; le modifiche si fanno dal calendario FitCenter.
 *
 * Uso (da apps/api):
 *   pnpm run import:corsi
 *   pnpm run import:scuola-nuoto
 *   pnpm run import:corsi -- --from-xlsx
 *   pnpm run import:scuola-nuoto -- --from-xlsx
 *   pnpm run import:corsi -- --replace
 */
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const COMPARTI = {
  corsi: {
    label: "corsi terra/acqua",
    fromXlsxCmd: "node scripts/build-planning-data.mjs",
    loadRows: (j) => (Array.isArray(j?.events) && j.events.length > 0 ? j.events : null),
    defaultZona: (e) => e.zona ?? "terra",
  },
  scuola_nuoto: {
    label: "scuola nuoto (S.N. Bambini)",
    fromXlsxCmd: "node scripts/build-planning-data.mjs && node scripts/build-planning-piscina.mjs",
    loadRows: (j) => {
      const rows = j?.eventsByComparto?.scuola_nuoto
      return Array.isArray(rows) && rows.length > 0 ? rows : null
    },
    defaultZona: () => "scuola_nuoto",
  },
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, "..")

const compartoArg = process.argv[2]?.trim()
const cfg = compartoArg ? COMPARTI[compartoArg] : null
if (!cfg) {
  console.error("Uso: node scripts/import-calendario-comparto.mjs <corsi|scuola_nuoto> [--from-xlsx] [--replace]")
  process.exit(1)
}

function dataDirCandidates() {
  return [
    path.join(apiRoot, "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
  ]
}

function resolveDataDir() {
  const dir = dataDirCandidates().find((d) => fs.existsSync(d)) ?? path.join(apiRoot, "data")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function planningJsonPaths() {
  const web = path.join(apiRoot, "..", "web", "src", "data", "planning-weekly.json")
  return [
    web,
    path.resolve(process.cwd(), "apps/web/src/data/planning-weekly.json"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/web/src/data/planning-weekly.json"),
  ]
}

function stableKeyFromParts(zona, dow, start, title) {
  const t = String(title ?? "").trim().replace(/\s+/g, " ")
  return `${zona}|${dow}|${start}|${t}`
}

function readDb(dataDir) {
  const p = path.join(dataDir, "calendario-reparti.json")
  if (!fs.existsSync(p)) return { instructors: [], revisions: [] }
  return JSON.parse(fs.readFileSync(p, "utf8"))
}

function writeDb(dataDir, db) {
  const p = path.join(dataDir, "calendario-reparti.json")
  fs.writeFileSync(p, JSON.stringify(db, null, 2), "utf8")
  return p
}

function loadPlanningRows() {
  for (const p of planningJsonPaths()) {
    if (!fs.existsSync(p)) continue
    const j = JSON.parse(fs.readFileSync(p, "utf8"))
    const rows = cfg.loadRows(j)
    if (rows) return { rows, source: p }
  }
  return null
}

const args = process.argv.slice(3)
const fromXlsx = args.includes("--from-xlsx")
const replace = args.includes("--replace")

if (fromXlsx) {
  const webDir = path.join(apiRoot, "..", "web")
  console.log(`[import:${compartoArg}] Rigenero planning (${cfg.label})…`)
  execSync(cfg.fromXlsxCmd, { cwd: webDir, stdio: "inherit", shell: true })
}

const planning = loadPlanningRows()
if (!planning) {
  console.error(
    `[import:${compartoArg}] Nessun evento in planning-weekly.json.\n` +
      `  Per import da Excel: pnpm run import:${compartoArg === "scuola_nuoto" ? "scuola-nuoto" : compartoArg} -- --from-xlsx`
  )
  process.exit(1)
}

const dataDir = resolveDataDir()
let db = readDb(dataDir)
const now = new Date().toISOString()
const by = `import-${compartoArg}`

if (replace) {
  db = { ...db, revisions: db.revisions.filter((r) => r.comparto !== compartoArg) }
}

const existingKeys = new Set(
  db.revisions.filter((r) => r.comparto === compartoArg).map((r) => r.stableKey)
)
let added = 0
let skipped = 0

for (const e of planning.rows) {
  const zona = cfg.defaultZona(e)
  const sk = stableKeyFromParts(zona, e.dow, e.start, e.title)
  if (existingKeys.has(sk)) {
    skipped++
    continue
  }
  const staff = String(e.staff ?? "").trim()
  db.revisions.push({
    comparto: compartoArg,
    stableKey: sk,
    dow: e.dow,
    start: e.start,
    title: e.title,
    zona,
    staffOverride: staff && staff !== "—" ? staff : null,
    istruttoreId: null,
    note: null,
    updatedAt: now,
    updatedBy: by,
  })
  existingKeys.add(sk)
  added++
}

const outPath = writeDb(dataDir, db)
const total = db.revisions.filter((r) => r.comparto === compartoArg).length
console.log(`[import:${compartoArg}] Fonte:`, planning.source)
console.log(`[import:${compartoArg}] Aggiunti:`, added, "| già presenti:", skipped, "| totale:", total)
console.log(`[import:${compartoArg}] Salvato:`, outPath)
console.log(`[import:${compartoArg}] Da ora solo calendario-reparti.json (modifiche online).`)
