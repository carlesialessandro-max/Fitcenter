import { readJson, writeJson } from "./persist.js"

type OverridesFile = {
  // opzionale: per giorno specifico possiamo partizionare (lun/mar/...) ma per ora è globale
  courseNotes: Record<string, string>
  // key = `${childKey}::${baseKey}`
  childNotes: Record<string, string>
  // key = `${childKey}::${baseKey}` => livello override
  levelOverrides: Record<string, string>
}

const FILE = "scuola-nuoto-overrides.json"

function load(): OverridesFile {
  const v = readJson<OverridesFile>(FILE, { courseNotes: {}, childNotes: {}, levelOverrides: {} })
  return {
    courseNotes: v?.courseNotes && typeof v.courseNotes === "object" ? v.courseNotes : {},
    childNotes: v?.childNotes && typeof v.childNotes === "object" ? v.childNotes : {},
    levelOverrides: v?.levelOverrides && typeof v.levelOverrides === "object" ? v.levelOverrides : {},
  }
}

function save(v: OverridesFile): void {
  writeJson(FILE, v)
}

function k(childKey: string, baseKey: string): string {
  return `${childKey}::${baseKey}`
}

export const scuolaNuotoOverridesStore = {
  getAll() {
    return load()
  },

  setCourseNote(baseKey: string, note: string) {
    const v = load()
    const key = String(baseKey ?? "").trim()
    if (!key) return
    const n = String(note ?? "").trim()
    if (!n) delete v.courseNotes[key]
    else v.courseNotes[key] = n
    save(v)
  },

  setChildNote(childKey: string, baseKey: string, note: string) {
    const v = load()
    const ck = String(childKey ?? "").trim()
    const bk = String(baseKey ?? "").trim()
    if (!ck || !bk) return
    const n = String(note ?? "").trim()
    const key = k(ck, bk)
    if (!n) delete v.childNotes[key]
    else v.childNotes[key] = n
    save(v)
  },

  setLevelOverride(childKey: string, baseKey: string, livello: string) {
    const v = load()
    const ck = String(childKey ?? "").trim()
    const bk = String(baseKey ?? "").trim()
    if (!ck || !bk) return
    const l = String(livello ?? "").trim()
    const key = k(ck, bk)
    if (!l) delete v.levelOverrides[key]
    else v.levelOverrides[key] = l
    save(v)
  },
}

