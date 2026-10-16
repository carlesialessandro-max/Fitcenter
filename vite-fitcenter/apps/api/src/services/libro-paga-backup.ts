import fs from "fs"
import path from "path"
import { getDataDir } from "../store/persist.js"
import type { FileDb } from "../store/libro-paga-db.js"

const DIR = "libro-paga-snapshots"

export type LibroPagaSnapshotMeta = {
  id: string
  createdAt: string
  label: string
  livelli: number
  personale: number
  turni: number
}

function snapshotsDir(): string {
  const d = path.join(getDataDir(), DIR)
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  return d
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "")
}

export function saveLibroPagaSnapshot(db: FileDb, label: string): LibroPagaSnapshotMeta {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}`
  const meta: LibroPagaSnapshotMeta = {
    id,
    createdAt: new Date().toISOString(),
    label: label.trim() || "snapshot",
    livelli: db.livelli.length,
    personale: db.personale.length,
    turni: db.turni.length,
  }
  const abs = path.join(snapshotsDir(), `${id}.json`)
  fs.writeFileSync(abs, JSON.stringify({ meta, db }, null, 2), "utf8")
  return meta
}

export function listLibroPagaSnapshots(): LibroPagaSnapshotMeta[] {
  const dir = snapshotsDir()
  const out: LibroPagaSnapshotMeta[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { meta?: LibroPagaSnapshotMeta }
      if (raw.meta?.id) out.push(raw.meta)
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function loadLibroPagaSnapshot(id: string): FileDb | null {
  const sid = safeId(id)
  if (!sid) return null
  const file = path.join(snapshotsDir(), `${sid}.json`)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { db?: FileDb }
  if (!raw.db?.livelli || !raw.db.personale) return null
  return raw.db
}
