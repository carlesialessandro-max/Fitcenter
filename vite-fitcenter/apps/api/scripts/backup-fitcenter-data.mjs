#!/usr/bin/env node
/**
 * Backup / restore dati FitCenter (cartella apps/api/data).
 *
 * Uso (dalla cartella apps/api):
 *   node scripts/backup-fitcenter-data.mjs
 *   node scripts/backup-fitcenter-data.mjs --list
 *   node scripts/backup-fitcenter-data.mjs --restore "C:\\backups\\fitcenter-data-2026-05-26_230000" --yes
 *
 * Variabili ambiente:
 *   FITCENTER_BACKUP_DIR   cartella destinazione backup (default: ../backups accanto a data/)
 *   FITCENTER_BACKUP_KEEP  quanti backup tenere (default: 14)
 *   FITCENTER_BACKUP_INCLUDE_ENV=1  copia anche apps/api/.env nel backup (consigliato, fuori da git)
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, "..")

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
  if (process.env.FITCENTER_BACKUP_DIR?.trim()) {
    return path.resolve(process.env.FITCENTER_BACKUP_DIR.trim())
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

function pruneOldBackups(backupRoot, keep) {
  const dirs = listBackupDirs(backupRoot)
  const excess = dirs.length - keep
  if (excess <= 0) return
  for (let i = 0; i < excess; i++) {
    fs.rmSync(dirs[i], { recursive: true, force: true })
    console.log(`Rimosso backup vecchio: ${dirs[i]}`)
  }
}

function copyDirFiles(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  if (!fs.existsSync(srcDir)) return []
  const copied = []
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name)
    const st = fs.statSync(src)
    if (!st.isFile()) continue
    fs.copyFileSync(src, path.join(destDir, name))
    copied.push(name)
  }
  return copied
}

function runBackup() {
  const dataDir = resolveDataDir()
  const backupRoot = resolveBackupRoot(dataDir)
  const keep = Math.max(1, Number(process.env.FITCENTER_BACKUP_KEEP ?? 14) || 14)
  const dest = path.join(backupRoot, `fitcenter-data-${timestampLabel()}`)

  if (!fs.existsSync(dataDir)) {
    console.error(`Cartella dati non trovata: ${dataDir}`)
    process.exit(1)
  }

  const files = copyDirFiles(dataDir, dest)
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
  console.log(`  Conservati ultimi ${keep} backup in ${backupRoot}`)
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
  const copied = copyDirFiles(src, dataDir)
  const envBackup = path.join(src, "env.backup")
  if (fs.existsSync(envBackup)) {
    fs.copyFileSync(envBackup, path.join(apiRoot, ".env"))
    console.log("Ripristinato anche apps/api/.env da env.backup")
  }

  console.log("Ripristino completato.")
  console.log(`  Destinazione: ${dataDir}`)
  console.log(`  File:         ${copied.filter((f) => f !== "backup-manifest.json" && f !== "env.backup").length}`)
  console.log("Riavvia il servizio API dopo il ripristino.")
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

const args = process.argv.slice(2)
if (args.includes("--list")) {
  runList()
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
