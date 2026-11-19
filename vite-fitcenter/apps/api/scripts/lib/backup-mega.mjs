import fs from "fs"
import path from "path"

export function megaEnabled() {
  return Boolean(process.env.MEGA_EMAIL?.trim() && process.env.MEGA_PASSWORD?.trim())
}

function pad2(n) {
  return String(n).padStart(2, "0")
}

function ymdOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dayFromDatedName(name, prefix) {
  const m = new RegExp(`^${prefix}(\\d{4}-\\d{2}-\\d{2})_`).exec(String(name ?? ""))
  return m?.[1] ?? null
}

async function megaEnsureDir(parent, name) {
  const hit = (parent.children ?? []).find((c) => c.directory && c.name === name)
  if (hit) return hit
  return parent.mkdir(name)
}

async function megaUploadDir(megaFolder, localDir) {
  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const local = path.join(localDir, entry.name)
    if (entry.isDirectory()) {
      const sub = await megaEnsureDir(megaFolder, entry.name)
      await megaUploadDir(sub, local)
      continue
    }
    if (!entry.isFile()) continue
    const size = fs.statSync(local).size
    await megaFolder.upload({ name: entry.name, size }, fs.createReadStream(local)).complete
  }
}

async function megaPrune(megaRoot, days, prefix) {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  const cutoffStr = ymdOf(cutoff)
  for (const child of megaRoot.children ?? []) {
    if (!child.directory) continue
    if (!String(child.name ?? "").startsWith(prefix)) continue
    const day = dayFromDatedName(child.name, prefix)
    if (day && day >= cutoffStr) continue
    await child.delete(true)
    console.log(`Rimosso da MEGA: ${child.name}`)
  }
}

async function megaPruneKeepNewest(megaRoot, keepFolders, prefix) {
  const dirs = (megaRoot.children ?? [])
    .filter((c) => c.directory && String(c.name ?? "").startsWith(prefix))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
  const drop = dirs.slice(0, Math.max(0, dirs.length - keepFolders))
  for (const child of drop) {
    await child.delete(true)
    console.log(`Rimosso da MEGA: ${child.name}`)
  }
}

export async function uploadDatedFolderToMega({
  localDest,
  keep,
  keepFolders,
  megaFolder,
  namePrefix,
  userAgent = "FitCenterBackup/1.0",
}) {
  let Storage
  try {
    ;({ Storage } = await import("megajs"))
  } catch {
    throw new Error("Manca il pacchetto megajs. Dalla cartella apps/api esegui: pnpm install")
  }
  const email = process.env.MEGA_EMAIL.trim()
  const password = process.env.MEGA_PASSWORD
  const folderName = megaFolder
  const secondFactorCode = process.env.MEGA_SECOND_FACTOR?.trim() || undefined
  const storage = await Promise.race([
    new Storage({
      email,
      password,
      secondFactorCode,
      userAgent,
      keepalive: false,
    }).ready,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timeout login MEGA (60s). Controlla email, password e 2FA.")), 60_000)
    }),
  ])
  try {
    const megaRoot = await megaEnsureDir(storage.root, folderName)
    const remoteName = path.basename(localDest)
    const remoteFolder = await megaEnsureDir(megaRoot, remoteName)
    await megaUploadDir(remoteFolder, localDest)
    if (typeof storage.reload === "function") await storage.reload()
    const megaRootFresh = await megaEnsureDir(storage.root, folderName)
    if (keepFolders != null) {
      await megaPruneKeepNewest(megaRootFresh, keepFolders, namePrefix)
    } else {
      await megaPrune(megaRootFresh, keep, namePrefix)
    }
    const kept = (megaRootFresh.children ?? []).filter(
      (c) => c.directory && String(c.name ?? "").startsWith(namePrefix)
    ).length
    console.log(`  MEGA:     /${folderName}/${remoteName}`)
    if (keepFolders != null) {
      console.log(`  MEGA:     conservate le ultime ${keepFolders} copie (${kept} cartelle)`)
    } else {
      console.log(`  MEGA:     conservati gli ultimi ${keep} giorni (${kept} backup)`)
    }
  } finally {
    storage.close?.()
  }
}
