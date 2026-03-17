import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

function resolveDataDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(process.cwd(), "apps/api/data"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data"),
    path.resolve(__dirname, "../../data"),
  ]
  const dir = candidates[0] ?? path.resolve(process.cwd(), "data")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function readJson<T>(filename: string, fallback: T): T {
  try {
    const filePath = path.join(resolveDataDir(), filename)
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, "utf8")
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

