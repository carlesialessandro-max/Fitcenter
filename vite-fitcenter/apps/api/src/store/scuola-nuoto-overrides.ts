import { readJson, writeJson } from "./persist.js"

type OverridesFile = {
  // v2: partizionamento per giorno (lun..dom). "any" = fallback.
  byDay?: Record<string, { courseNotes: Record<string, string>; childNotes: Record<string, string>; levelOverrides: Record<string, string> }>
  // legacy (v1): globale
  courseNotes?: Record<string, string>
  childNotes?: Record<string, string>
  levelOverrides?: Record<string, string>
}

const FILE = "scuola-nuoto-overrides.json"

function load(): OverridesFile {
  const v = readJson<OverridesFile>(FILE, {})
  return v && typeof v === "object" ? v : {}
}

function save(v: OverridesFile): void {
  writeJson(FILE, v)
}

function k(childKey: string, baseKey: string): string {
  return `${childKey}::${baseKey}`
}

function ensureDay(v: OverridesFile, day: string | null): { dayKey: string; node: { courseNotes: Record<string, string>; childNotes: Record<string, string>; levelOverrides: Record<string, string> } } {
  const dayKey = (day ?? "").trim().toLowerCase() || "any"
  if (!v.byDay || typeof v.byDay !== "object") v.byDay = {}
  const existing = v.byDay[dayKey]
  if (existing) return { dayKey, node: existing }
  const node = { courseNotes: {}, childNotes: {}, levelOverrides: {} }
  v.byDay[dayKey] = node
  return { dayKey, node }
}

export const scuolaNuotoOverridesStore = {
  getAll(day?: string | null) {
    const v = load()
    // merge: day-specific overrides + legacy global as fallback
    const dayKey = (day ?? "").trim().toLowerCase() || "any"
    const byDay = v.byDay && typeof v.byDay === "object" ? v.byDay : {}
    const node = byDay[dayKey] ?? byDay["any"] ?? { courseNotes: {}, childNotes: {}, levelOverrides: {} }
    const legacyCourse = (v.courseNotes && typeof v.courseNotes === "object" ? v.courseNotes : {}) as Record<string, string>
    const legacyChild = (v.childNotes && typeof v.childNotes === "object" ? v.childNotes : {}) as Record<string, string>
    const legacyLevel = (v.levelOverrides && typeof v.levelOverrides === "object" ? v.levelOverrides : {}) as Record<string, string>
    return {
      courseNotes: { ...legacyCourse, ...(node.courseNotes ?? {}) },
      childNotes: { ...legacyChild, ...(node.childNotes ?? {}) },
      levelOverrides: { ...legacyLevel, ...(node.levelOverrides ?? {}) },
    }
  },

  setCourseNote(baseKey: string, note: string, day?: string | null) {
    const v = load()
    const { node } = ensureDay(v, day ?? null)
    const key = String(baseKey ?? "").trim()
    if (!key) return
    const n = String(note ?? "").trim()
    if (!n) delete node.courseNotes[key]
    else node.courseNotes[key] = n
    save(v)
  },

  setChildNote(childKey: string, baseKey: string, note: string, day?: string | null) {
    const v = load()
    const { node } = ensureDay(v, day ?? null)
    const ck = String(childKey ?? "").trim()
    const bk = String(baseKey ?? "").trim()
    if (!ck || !bk) return
    const n = String(note ?? "").trim()
    const key = k(ck, bk)
    if (!n) delete node.childNotes[key]
    else node.childNotes[key] = n
    save(v)
  },

  setLevelOverride(childKey: string, baseKey: string, livello: string, day?: string | null) {
    const v = load()
    const { node } = ensureDay(v, day ?? null)
    const ck = String(childKey ?? "").trim()
    const bk = String(baseKey ?? "").trim()
    if (!ck || !bk) return
    const l = String(livello ?? "").trim()
    const key = k(ck, bk)
    if (!l) delete node.levelOverrides[key]
    else node.levelOverrides[key] = l
    save(v)
  },
}

