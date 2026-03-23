import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

function dataDirCandidates(): string[] {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return [
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(__dirname, "../../data"),
  ]
}

function resolveDataDir(): string {
  const candidates = dataDirCandidates()
  const existing = candidates.find((d) => fs.existsSync(d))
  const dir = existing ?? candidates[0] ?? path.resolve(process.cwd(), "data")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function readJson<T>(filename: string, fallback: T): T {
  try {
    const primaryDir = resolveDataDir()
    const primaryPath = path.join(primaryDir, filename)
    if (!fs.existsSync(primaryPath)) {
      // Migrazione soft: se il file esiste in un altro candidato, copialo e usalo.
      for (const dir of dataDirCandidates()) {
        if (dir === primaryDir) continue
        const altPath = path.join(dir, filename)
        if (!fs.existsSync(altPath)) continue
        const rawAlt = fs.readFileSync(altPath, "utf8")
        fs.writeFileSync(primaryPath, rawAlt, "utf8")
        return JSON.parse(rawAlt) as T
      }
      return fallback
    }
    const raw = fs.readFileSync(primaryPath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(filename: string, value: unknown): void {
  const dir = resolveDataDir()
  const filePath = path.join(dir, filename)
  const tmpPath = filePath + ".tmp"
  const raw = JSON.stringify(value, null, 2)
  fs.writeFileSync(tmpPath, raw, "utf8")
  fs.renameSync(tmpPath, filePath)
}

