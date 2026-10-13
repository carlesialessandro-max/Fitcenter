import { readJson, writeJson } from "./persist.js"

const FILE = "fattureincloud.json"
export const FIC_DEFAULT_REPARTO = "altri-costi"

export type FicConfig = {
  accessToken: string
  companyId: number
  companyName: string
  defaultRepartoId: string
  connectedAt: string
  lastSyncAt?: string
}

function empty(): FicConfig | null {
  return null
}

export function maskToken(token: string): string {
  const t = token.trim()
  if (t.length < 8) return "••••"
  return `••••${t.slice(-4)}`
}

export const ficStore = {
  get(): FicConfig | null {
    const raw = readJson<Partial<FicConfig> | null>(FILE, empty())
    if (!raw || typeof raw !== "object") return null
    const accessToken = String(raw.accessToken ?? "").trim()
    const companyId = Number(raw.companyId)
    if (!accessToken || !Number.isFinite(companyId) || companyId <= 0) return null
    return {
      accessToken,
      companyId,
      companyName: String(raw.companyName ?? "").trim(),
      defaultRepartoId: String(raw.defaultRepartoId ?? "").trim() || FIC_DEFAULT_REPARTO,
      connectedAt: String(raw.connectedAt ?? ""),
      lastSyncAt: raw.lastSyncAt ? String(raw.lastSyncAt) : undefined,
    }
  },
  save(cfg: FicConfig) {
    writeJson(FILE, cfg)
  },
  clear() {
    writeJson(FILE, null)
  },
  markSynced() {
    const cur = this.get()
    if (!cur) return
    this.save({ ...cur, lastSyncAt: new Date().toISOString() })
  },
}
