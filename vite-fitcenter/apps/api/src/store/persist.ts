import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const MARKER_FILES = ["amministrazione-costi.json", "auth-users.json", "libro-paga.json"]

function dataDirCandidates(): string[] {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const raw = [
    path.resolve(__dirname, "../../data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/vite-fitcenter/apps/api/data"),
  ]
  return [...new Set(raw)]
}

function mtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function dirFreshness(dir: string): number {
  return Math.max(0, ...MARKER_FILES.map((name) => mtimeMs(path.join(dir, name))))
}

let cachedDir: string | undefined

function resolveDataDir(): string {
  if (cachedDir) return cachedDir
  const candidates = dataDirCandidates()
  const existing = candidates.filter((d) => {
    try {
      return fs.existsSync(d)
    } catch {
      return false
    }
  })
  let dir = existing[0] ?? candidates[0] ?? path.resolve(process.cwd(), "data")
  if (existing.length > 1) {
    let best = existing[0]!
    let bestScore = dirFreshness(best)
    for (const d of existing) {
      const score = dirFreshness(d)
      if (score > bestScore) {
        best = d
        bestScore = score
      }
    }
    dir = best
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  cachedDir = dir
  return dir
}

/** Stessa cartella di auth-users.json / libro-paga.json. Una sola per processo, la più recente. */
export function getDataDir(): string {
  return resolveDataDir()
}

export function readJson<T>(filename: string, fallback: T): T {
  try {
    const primaryDir = resolveDataDir()
    const primaryPath = path.join(primaryDir, filename)
    if (!fs.existsSync(primaryPath)) {
      let bestAlt: { path: string; score: number } | undefined
      for (const dir of dataDirCandidates()) {
        if (dir === primaryDir) continue
        const altPath = path.join(dir, filename)
        const score = mtimeMs(altPath)
        if (!score) continue
        if (!bestAlt || score > bestAlt.score) bestAlt = { path: altPath, score }
      }
      if (bestAlt) {
        const rawAlt = fs.readFileSync(bestAlt.path, "utf8")
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

