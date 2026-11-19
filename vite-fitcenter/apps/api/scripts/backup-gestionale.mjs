#!/usr/bin/env node
/**
 * Backup SQL gestionale (.bak) → NAS (cartelle datate) + MEGA, con pulizia automatica.
 *
 * Uso (dalla cartella apps/api):
 *   node scripts/backup-gestionale.mjs
 *   node scripts/backup-gestionale.mjs --list
 *   node scripts/backup-gestionale.mjs --prune
 *
 * Variabili in apps/api/.env:
 *   GESTIONALE_BACKUP_SRC   cartella dove SQL scrive i .bak (es. C:\Backup\SQL)
 *   GESTIONALE_BACKUP_DIR   destinazione NAS (es. \\nas\...\backup gestionale)
 *   GESTIONALE_BACKUP_KEEP  ultimi N file .bak da copiare (default: 2)
 *   GESTIONALE_BACKUP_FOLDERS  cartelle datate da tenere su NAS/MEGA (default: 1)
 *   MEGA_EMAIL / MEGA_PASSWORD  stessi di FitCenter: dopo la copia NAS carica su mega.nz
 *   MEGA_GESTIONALE_FOLDER  cartella su MEGA (default: Gestionale-backup)
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import { megaEnabled, uploadDatedFolderToMega } from "./lib/backup-mega.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, "..")
dotenv.config({ path: path.join(apiRoot, ".env") })

const PREFIX = "gestionale-"

function pad2(n) {
  return String(n).padStart(2, "0")
}

function timestampLabel() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function resolveUncOrPath(raw) {
  const s = String(raw ?? "").trim()
  if (!s) return ""
  if (s.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(s)) return s
  return path.resolve(s)
}

function keepFiles() {
  return Math.max(1, Number(process.env.GESTIONALE_BACKUP_KEEP ?? 2) || 2)
}

function keepFolders() {
  return Math.max(1, Number(process.env.GESTIONALE_BACKUP_FOLDERS ?? 1) || 1)
}

function resolveSrc() {
  const dir = resolveUncOrPath(process.env.GESTIONALE_BACKUP_SRC)
  if (!dir) {
    console.error("Imposta GESTIONALE_BACKUP_SRC in apps/api/.env (cartella dei .bak SQL).")
    process.exit(1)
  }
  return dir
}

function resolveDest() {
  const dir = resolveUncOrPath(process.env.GESTIONALE_BACKUP_DIR)
  if (!dir) {
    console.error("Imposta GESTIONALE_BACKUP_DIR in apps/api/.env (cartella NAS del gestionale).")
    process.exit(1)
  }
  return dir
}

function listBackupDirs(backupRoot) {
  if (!fs.existsSync(backupRoot)) return []
  return fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX))
    .map((e) => path.join(backupRoot, e.name))
    .sort()
}

function pruneOldBackups(backupRoot, folders) {
  const dirs = listBackupDirs(backupRoot)
  const drop = dirs.slice(0, Math.max(0, dirs.length - folders))
  for (const dir of drop) {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log(`Rimosso backup vecchio: ${dir}`)
  }
}

function pruneLooseBak(backupRoot, days) {
  if (!fs.existsSync(backupRoot)) return
  const cutMs = Date.now() - days * 24 * 60 * 60 * 1000
  for (const name of fs.readdirSync(backupRoot)) {
    if (!/\.(bak|trn)$/i.test(name)) continue
    const p = path.join(backupRoot, name)
    let st
    try {
      st = fs.statSync(p)
    } catch {
      continue
    }
    if (!st.isFile() || st.mtimeMs >= cutMs) continue
    fs.rmSync(p, { force: true })
    console.log(`Rimosso .bak vecchio sul NAS: ${p}`)
  }
}

function isBak(name) {
  return /\.(bak|trn)$/i.test(name)
}

function collectBakFiles(srcDir) {
  if (!fs.existsSync(srcDir)) return []
  const files = fs
    .readdirSync(srcDir)
    .filter(isBak)
    .map((name) => {
      const p = path.join(srcDir, name)
      const st = fs.statSync(p)
      return { name, path: p, mtimeMs: st.mtimeMs, size: st.size, isFile: st.isFile() }
    })
    .filter((f) => f.isFile)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const maxFiles = keepFiles()
  return files.slice(0, maxFiles)
}

async function runBackup() {
  const src = resolveSrc()
  const backupRoot = resolveDest()
  const filesToKeep = keepFiles()
  const folders = keepFolders()
  const dest = path.join(backupRoot, `${PREFIX}${timestampLabel()}`)

  if (!fs.existsSync(src)) {
    console.error(`Cartella origine non trovata: ${src}`)
    process.exit(1)
  }

  const files = collectBakFiles(src)
  if (!files.length) {
    console.error(`Nessun file .bak in ${src}`)
    process.exit(1)
  }

  try {
    fs.mkdirSync(dest, { recursive: true })
  } catch (e) {
    console.error(`Impossibile creare/accedere alla cartella backup: ${backupRoot}`)
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  const copied = []
  for (const f of files) {
    fs.copyFileSync(f.path, path.join(dest, f.name))
    copied.push(f.name)
  }
  fs.writeFileSync(
    path.join(dest, "backup-manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        src,
        files: copied,
      },
      null,
      2
    ),
    "utf8"
  )

  pruneOldBackups(backupRoot, folders)
  pruneLooseBak(backupRoot, 2)

  console.log("Backup gestionale completato.")
  console.log(`  Origine:  ${src}`)
  console.log(`  Destino:  ${dest}`)
  console.log(`  File:     ${copied.join(", ")}`)
  console.log(`  Conservati gli ultimi ${filesToKeep} .bak in ${folders} cartella/e (${backupRoot})`)

  if (!megaEnabled()) {
    console.log("  MEGA:     non configurato (imposta MEGA_EMAIL e MEGA_PASSWORD in apps/api/.env)")
    return
  }
  console.log("  MEGA:     caricamento in corso (il backup sul NAS è già salvato)…")
  try {
    await uploadDatedFolderToMega({
      localDest: dest,
      keep: folders,
      keepFolders: folders,
      megaFolder: process.env.MEGA_GESTIONALE_FOLDER?.trim() || "Gestionale-backup",
      namePrefix: PREFIX,
      userAgent: "FitCenterGestionaleBackup/1.0",
    })
  } catch (e) {
    console.error("Backup locale/NAS OK, caricamento MEGA fallito:")
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

function runList() {
  const src = process.env.GESTIONALE_BACKUP_SRC ? resolveSrc() : "(GESTIONALE_BACKUP_SRC non impostato)"
  const backupRoot = process.env.GESTIONALE_BACKUP_DIR ? resolveDest() : "(GESTIONALE_BACKUP_DIR non impostato)"
  console.log(`Origine .bak:     ${src}`)
  console.log(`Cartella backup:  ${backupRoot}`)
  if (typeof backupRoot !== "string" || backupRoot.startsWith("(") || !fs.existsSync(backupRoot)) {
    console.log("Nessun backup trovato.")
    return
  }
  const dirs = listBackupDirs(backupRoot)
  if (!dirs.length) {
    console.log("Nessun backup datato trovato.")
    return
  }
  console.log("Backup disponibili:")
  for (const d of dirs) console.log(`  - ${d}`)
}

function runPruneOnly() {
  const backupRoot = resolveDest()
  const folders = keepFolders()
  pruneOldBackups(backupRoot, folders)
  pruneLooseBak(backupRoot, 2)
  console.log(`Pulizia backup in: ${backupRoot} (ultime ${folders} cartelle)`)
}

const args = process.argv.slice(2)

async function main() {
  if (args.includes("--list")) {
    runList()
    return
  }
  if (args.includes("--prune")) {
    runPruneOnly()
    return
  }
  await runBackup()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
