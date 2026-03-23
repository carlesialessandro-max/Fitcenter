import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { readJson, writeJson } from "./persist.js"
import type { SignatureRequest, SignatureTemplate } from "../types/esign.js"

const FILE_NAME = "signature-requests.json"
const TEMPLATES_FILE = "signature-templates.json"

function resolveSignatureDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(process.cwd(), "apps/api/data/signatures"),
    path.resolve(process.cwd(), "vite-fitcenter/apps/api/data/signatures"),
    path.resolve(__dirname, "../../data/signatures"),
  ]
  const dir = candidates[0] ?? path.resolve(process.cwd(), "data/signatures")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readAll(): SignatureRequest[] {
  const rows = readJson<SignatureRequest[]>(FILE_NAME, [])
  return Array.isArray(rows) ? rows : []
}

function writeAll(rows: SignatureRequest[]): void {
  writeJson(FILE_NAME, rows)
}

function readTemplates(): SignatureTemplate[] {
  const rows = readJson<SignatureTemplate[]>(TEMPLATES_FILE, [])
  return Array.isArray(rows) ? rows : []
}

function writeTemplates(rows: SignatureTemplate[]): void {
  writeJson(TEMPLATES_FILE, rows)
}

function updateTemplateById(id: string, updater: (row: SignatureTemplate) => SignatureTemplate): SignatureTemplate | null {
  const rows = readTemplates()
  const idx = rows.findIndex((r) => r.id === id)
  if (idx < 0) return null
  const next = updater(rows[idx] as SignatureTemplate)
  rows[idx] = next
  writeTemplates(rows)
  return next
}

function updateById(id: string, updater: (row: SignatureRequest) => SignatureRequest): SignatureRequest | null {
  const rows = readAll()
  const idx = rows.findIndex((r) => r.id === id)
  if (idx < 0) return null
  const next = updater(rows[idx] as SignatureRequest)
  rows[idx] = next
  writeAll(rows)
  return next
}

export const signatureStore = {
  resolveSignatureDir,

  list(): SignatureRequest[] {
    return readAll()
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  create(row: SignatureRequest): SignatureRequest {
    const rows = readAll()
    rows.push(row)
    writeAll(rows)
    return row
  },

  getById(id: string): SignatureRequest | null {
    return readAll().find((r) => r.id === id) ?? null
  },

  getByToken(token: string): SignatureRequest | null {
    return readAll().find((r) => r.publicToken === token) ?? null
  },

  updateById,

  deleteById(id: string): SignatureRequest | null {
    const rows = readAll()
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) return null
    const [deleted] = rows.splice(idx, 1)
    writeAll(rows)
    return deleted ?? null
  },

  listTemplates(): SignatureTemplate[] {
    return readTemplates()
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  createTemplate(row: SignatureTemplate): SignatureTemplate {
    const rows = readTemplates()
    rows.push(row)
    writeTemplates(rows)
    return row
  },

  getTemplateById(id: string): SignatureTemplate | null {
    return readTemplates().find((r) => r.id === id) ?? null
  },

  updateTemplateById,

  deleteTemplateById(id: string): SignatureTemplate | null {
    const rows = readTemplates()
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) return null
    const [deleted] = rows.splice(idx, 1)
    writeTemplates(rows)
    return deleted ?? null
  },
}

