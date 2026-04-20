import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import crypto from "crypto"
import { readJson, writeJson } from "./persist.js"
import type { SignatureRequest, SignatureTemplate } from "../types/esign.js"
import { PRIVACY_PAGE_TEXT_DEFAULT, type PrivacyPageText } from "../signature/privacy-page-defaults.js"

const FILE_NAME = "signature-requests.json"
const TEMPLATES_FILE = "signature-templates.json"
const PRIVACY_PAGE_TEXT_FILE = "signature-privacy-page-text.json"
const PRIVACY_PROFILES_FILE = "signature-privacy-profiles.json"

export type PrivacyProfile = {
  id: string
  name: string
  createdAt: string
  text: PrivacyPageText
  /** Se presente, questo profilo usa un PDF informativa (prima pagina) invece del testo generato. */
  pdfFileName?: string
  pdfOriginalName?: string
}

function mergePrivacyPageText(partial: Partial<PrivacyPageText> | Record<string, unknown>): PrivacyPageText {
  const p = partial as Record<string, unknown>
  const s = (k: keyof PrivacyPageText) => (typeof p[k] === "string" ? (p[k] as string) : PRIVACY_PAGE_TEXT_DEFAULT[k])
  return {
    title1: s("title1"),
    body1: s("body1"),
    sig1: s("sig1"),
    title2: s("title2"),
    body2: s("body2"),
    sig2: s("sig2"),
  }
}

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

function defaultPrivacyProfile(): PrivacyProfile {
  return {
    id: "default",
    name: "Default",
    createdAt: new Date().toISOString(),
    text: { ...PRIVACY_PAGE_TEXT_DEFAULT },
  }
}

function readPrivacyProfiles(): PrivacyProfile[] {
  const rows = readJson<PrivacyProfile[]>(PRIVACY_PROFILES_FILE, [])
  const list = Array.isArray(rows) ? rows : []
  // Garantiamo sempre un profilo "default".
  const hasDefault = list.some((p) => p && p.id === "default")
  if (!hasDefault) {
    const next = [defaultPrivacyProfile(), ...list.filter(Boolean)]
    writeJson(PRIVACY_PROFILES_FILE, next)
    return next
  }
  return list
}

function writePrivacyProfiles(rows: PrivacyProfile[]): void {
  writeJson(PRIVACY_PROFILES_FILE, rows)
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

  /** Compat: testo privacy "globale" (profilo default). */
  getPrivacyPageText(): PrivacyPageText {
    const raw = readJson<Partial<PrivacyPageText>>(PRIVACY_PAGE_TEXT_FILE, {})
    return mergePrivacyPageText(raw)
  },

  /** Compat: salva testo privacy "globale" (profilo default) + file legacy. */
  savePrivacyPageText(next: PrivacyPageText): void {
    writeJson(PRIVACY_PAGE_TEXT_FILE, next)
    // Mantieni anche il profilo default allineato, se esiste.
    const rows = readPrivacyProfiles()
    const idx = rows.findIndex((p) => p.id === "default")
    if (idx >= 0) {
      rows[idx] = { ...rows[idx]!, text: next }
      writePrivacyProfiles(rows)
    }
  },

  /** Compat: reset testo privacy "globale" (profilo default) + file legacy. */
  resetPrivacyPageText(): void {
    writeJson(PRIVACY_PAGE_TEXT_FILE, { ...PRIVACY_PAGE_TEXT_DEFAULT })
    const rows = readPrivacyProfiles()
    const idx = rows.findIndex((p) => p.id === "default")
    if (idx >= 0) {
      rows[idx] = { ...rows[idx]!, text: { ...PRIVACY_PAGE_TEXT_DEFAULT } }
      writePrivacyProfiles(rows)
    }
  },

  listPrivacyProfiles(): PrivacyProfile[] {
    return readPrivacyProfiles()
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  getPrivacyProfileById(id: string): PrivacyProfile | null {
    const x = String(id ?? "").trim()
    if (!x) return null
    return readPrivacyProfiles().find((p) => p.id === x) ?? null
  },

  /** Ritorna sempre un testo valido: profilo selezionato oppure default. */
  getPrivacyProfileText(id?: string): PrivacyPageText {
    const prof = id ? signatureStore.getPrivacyProfileById(id) : null
    return prof?.text ?? signatureStore.getPrivacyProfileById("default")?.text ?? { ...PRIVACY_PAGE_TEXT_DEFAULT }
  },

  createPrivacyProfile(input: { name: string; text: PrivacyPageText }): PrivacyProfile {
    const rows = readPrivacyProfiles()
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const next: PrivacyProfile = { id, name: input.name.trim() || "Privacy", createdAt: new Date().toISOString(), text: input.text }
    rows.push(next)
    writePrivacyProfiles(rows)
    return next
  },

  attachPrivacyProfilePdf(id: string, input: { pdfFileName: string; pdfOriginalName: string }): PrivacyProfile | null {
    const rows = readPrivacyProfiles()
    const idx = rows.findIndex((p) => p.id === id)
    if (idx < 0) return null
    const prev = rows[idx]!
    const next: PrivacyProfile = { ...prev, pdfFileName: input.pdfFileName, pdfOriginalName: input.pdfOriginalName }
    rows[idx] = next
    writePrivacyProfiles(rows)
    return next
  },

  updatePrivacyProfile(id: string, patch: { name?: string; text?: PrivacyPageText }): PrivacyProfile | null {
    const rows = readPrivacyProfiles()
    const idx = rows.findIndex((p) => p.id === id)
    if (idx < 0) return null
    const prev = rows[idx]!
    // Il profilo default non si cancella, ma si può rinominare/modificare.
    const next: PrivacyProfile = {
      ...prev,
      name: patch.name != null ? String(patch.name).trim() || prev.name : prev.name,
      text: patch.text ?? prev.text,
    }
    rows[idx] = next
    writePrivacyProfiles(rows)
    // Mantieni file legacy allineato se tocchiamo "default".
    if (id === "default" && patch.text) {
      writeJson(PRIVACY_PAGE_TEXT_FILE, patch.text)
    }
    return next
  },

  deletePrivacyProfile(id: string): boolean {
    const x = String(id ?? "").trim()
    if (!x || x === "default") return false
    const rows = readPrivacyProfiles()
    const idx = rows.findIndex((p) => p.id === x)
    if (idx < 0) return false
    rows.splice(idx, 1)
    writePrivacyProfiles(rows)
    return true
  },
}

