#!/usr/bin/env node
/**
 * Backup / restore dati FitCenter (cartella apps/api/data).
 *
 * Uso (dalla cartella apps/api):
 *   node scripts/backup-fitcenter-data.mjs
 *   node scripts/backup-fitcenter-data.mjs --list
 *   node scripts/backup-fitcenter-data.mjs --restore "C:\\backups\\fitcenter-data-2026-05-26_230000" --yes
 *
 * Variabili ambiente (o riga in apps/api/.env):
 *   FITCENTER_BACKUP_DIR   cartella destinazione backup (default: ../backups accanto a data/)
 *   FITCENTER_BACKUP_KEEP  giorni da tenere (default: 3). I più vecchi si cancellano dopo ogni backup.
 *   FITCENTER_BACKUP_INCLUDE_ENV=1  copia anche apps/api/.env nel backup (consigliato, fuori da git)
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, "..")

// Legge FITCENTER_BACKUP_DIR anche da apps/api/.env (così list e backup usano lo stesso percorso).
dotenv.config({ path: path.join(apiRoot, ".env") })

function pad2(n) {
  return String(n).padStart(2, "0")
}

function dataDirCandidates() {
  return [
    path.resolve(apiRoot, "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
  ]
}

function resolveDataDir() {
  const candidates = dataDirCandidates()
  const existing = candidates.find((d) => fs.existsSync(d))
  return existing ?? candidates[0]
}

function resolveBackupRoot(dataDir) {
  const raw = process.env.FITCENTER_BACKUP_DIR?.trim()
  if (raw) {
    // Percorsi UNC (\\server\share) o drive (C:\): non passare da path.resolve.
    if (raw.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(raw)) {
      return raw
    }
    return path.resolve(raw)
  }
  return path.resolve(dataDir, "..", "backups")
}

function timestampLabel() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function listBackupDirs(backupRoot) {
  if (!fs.existsSync(backupRoot)) return []
  return fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("fitcenter-data-"))
    .map((e) => path.join(backupRoot, e.name))
    .sort()
}

function keepDays() {
  return Math.max(1, Number(process.env.FITCENTER_BACKUP_KEEP ?? 3) || 3)
}

function backupDayLabel(dirPath) {
  const m = /^fitcenter-data-(\d{4}-\d{2}-\d{2})_/.exec(path.basename(dirPath))
  return m?.[1] ?? null
}

function pruneOldBackups(backupRoot, days) {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  const cutoffStr = ymdOf(cutoff)
  for (const dir of listBackupDirs(backupRoot)) {
    const day = backupDayLabel(dir)
    if (day && day >= cutoffStr) continue
    fs.rmSync(dir, { recursive: true, force: true })
    console.log(`Rimosso backup vecchio: ${dir}`)
  }
}

function copyTree(srcDir, destDir, skipNames = new Set()) {
  fs.mkdirSync(destDir, { recursive: true })
  if (!fs.existsSync(srcDir)) return []
  const copied = []
  for (const name of fs.readdirSync(srcDir)) {
    if (skipNames.has(name)) continue
    const src = path.join(srcDir, name)
    const dest = path.join(destDir, name)
    const st = fs.statSync(src)
    if (st.isDirectory()) {
      copied.push(...copyTree(src, dest).map((rel) => path.join(name, rel)))
      continue
    }
    if (!st.isFile()) continue
    fs.copyFileSync(src, dest)
    copied.push(name)
  }
  return copied
}

function runBackup() {
  const dataDir = resolveDataDir()
  const backupRoot = resolveBackupRoot(dataDir)
  const keep = keepDays()
  const dest = path.join(backupRoot, `fitcenter-data-${timestampLabel()}`)

  if (!fs.existsSync(dataDir)) {
    console.error(`Cartella dati non trovata: ${dataDir}`)
    process.exit(1)
  }

  try {
    fs.mkdirSync(backupRoot, { recursive: true })
  } catch (e) {
    console.error(`Impossibile creare/accedere alla cartella backup: ${backupRoot}`)
    console.error(e instanceof Error ? e.message : String(e))
    console.error("Verifica percorso UNC (\\\\server\\condivisione) e permessi di scrittura.")
    process.exit(1)
  }

  let files
  try {
    files = copyTree(dataDir, dest)
  } catch (e) {
    console.error(`Errore copia verso: ${dest}`)
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    dataDir,
    files,
  }

  if (process.env.FITCENTER_BACKUP_INCLUDE_ENV === "1") {
    const envPath = path.join(apiRoot, ".env")
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, path.join(dest, "env.backup"))
      manifest.envBackup = "env.backup"
    }
  }

  fs.writeFileSync(path.join(dest, "backup-manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
  pruneOldBackups(backupRoot, keep)

  console.log("Backup completato.")
  console.log(`  Origine:  ${dataDir}`)
  console.log(`  Destino:  ${dest}`)
  console.log(`  File:     ${files.length}`)
  console.log(`  Conservati gli ultimi ${keep} giorni in ${backupRoot}`)
}

function runRestore(restorePath, yes) {
  const dataDir = resolveDataDir()
  const src = path.resolve(restorePath)

  if (!fs.existsSync(src)) {
    console.error(`Backup non trovato: ${src}`)
    process.exit(1)
  }

  const manifestPath = path.join(src, "backup-manifest.json")
  if (!fs.existsSync(manifestPath)) {
    console.error("Cartella backup non valida (manca backup-manifest.json).")
    process.exit(1)
  }

  if (!yes) {
    console.error("Ripristino annullato: aggiungi --yes per confermare.")
    console.error(`  Ripristinerebbe in: ${dataDir}`)
    console.error(`  Da backup:        ${src}`)
    process.exit(1)
  }

  fs.mkdirSync(dataDir, { recursive: true })
  const copied = copyTree(src, dataDir, new Set(["backup-manifest.json", "env.backup"]))
  const envBackup = path.join(src, "env.backup")
  const withEnv = process.argv.includes("--with-env")
  if (withEnv && fs.existsSync(envBackup)) {
    fs.copyFileSync(envBackup, path.join(apiRoot, ".env"))
    console.log("Ripristinato anche apps/api/.env da env.backup")
  }

  console.log("Ripristino completato.")
  console.log(`  Destinazione: ${dataDir}`)
  console.log(`  File:         ${copied.filter((f) => f !== "backup-manifest.json" && f !== "env.backup").length}`)
  console.log("Riavvia il servizio API dopo il ripristino.")
}

function ymdOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function findYesterdayBackup(backupRoot) {
  const dirs = listBackupDirs(backupRoot)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const y = ymdOf(yesterday)
  const hits = dirs.filter((d) => path.basename(d).includes(`fitcenter-data-${y}`))
  if (hits.length) return hits[hits.length - 1]
  const today = ymdOf(now)
  const beforeToday = dirs.filter((d) => path.basename(d) < `fitcenter-data-${today}`)
  return beforeToday.length ? beforeToday[beforeToday.length - 1] : null
}

function runRestoreYesterday(yes) {
  const dataDir = resolveDataDir()
  const backupRoot = resolveBackupRoot(dataDir)
  const src = findYesterdayBackup(backupRoot)
  if (!src) {
    console.error(`Nessun backup di ieri (o precedente) in ${backupRoot}`)
    console.error("Esegui: node scripts/backup-fitcenter-data.mjs --list")
    process.exit(1)
  }
  console.log(`Ripristino da: ${src}`)
  runRestore(src, yes)
}

function runList() {
  const dataDir = resolveDataDir()
  const backupRoot = resolveBackupRoot(dataDir)
  const dirs = listBackupDirs(backupRoot)
  console.log(`Cartella dati:    ${dataDir}`)
  console.log(`Cartella backup:  ${backupRoot}`)
  if (!dirs.length) {
    console.log("Nessun backup trovato.")
    return
  }
  console.log("Backup disponibili:")
  for (const d of dirs) {
    const manifestPath = path.join(d, "backup-manifest.json")
    let extra = ""
    if (fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
        extra = ` (${m.files?.length ?? "?"} file, ${m.createdAt ?? "?"})`
      } catch {
        extra = ""
      }
    }
    console.log(`  - ${d}${extra}`)
  }
}

function runPruneOnly() {
  const dataDir = resolveDataDir()
  const backupRoot = resolveBackupRoot(dataDir)
  const keep = keepDays()
  const before = listBackupDirs(backupRoot).length
  pruneOldBackups(backupRoot, keep)
  const after = listBackupDirs(backupRoot).length
  console.log(`Pulizia backup in: ${backupRoot}`)
  console.log(`  Conservati: ${after} (ultimi ${keep} giorni)`)
  if (before > after) console.log(`  Rimossi:     ${before - after}`)
  else console.log("  Nessun backup da rimuovere.")
}

const args = process.argv.slice(2)
if (args.includes("--list")) {
  runList()
  process.exit(0)
}

if (args.includes("--restore-yesterday")) {
  runRestoreYesterday(args.includes("--yes"))
  process.exit(0)
}

if (args.includes("--prune")) {
  runPruneOnly()
  process.exit(0)
}

const restoreIdx = args.indexOf("--restore")
if (restoreIdx >= 0) {
  const restorePath = args[restoreIdx + 1]
  if (!restorePath) {
    console.error("Uso: node scripts/backup-fitcenter-data.mjs --restore PERCORSO_BACKUP --yes")
    process.exit(1)
  }
  runRestore(restorePath, args.includes("--yes"))
  process.exit(0)
}

runBackup()
