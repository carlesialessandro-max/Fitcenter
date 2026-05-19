import { readJson, writeJson } from "./persist.js"
import {
  dateRangeForNotesPeriod,
  eachIsoDateInRange,
  weekdayKeyFromIso,
  type ScuolaNuotoNotesPeriod,
} from "./scuola-nuoto-notes-period.js"

type NotesNode = {
  courseNotes: Record<string, string>
  childNotes: Record<string, string>
  levelOverrides: Record<string, string>
  updatedAt?: string
}

type OverridesFile = {
  // v2: partizionamento per giorno (lun..dom). "any" = fallback.
  byDay?: Record<string, NotesNode>
  // v3: note per data calendario (archivio settimana / mese).
  byDate?: Record<string, NotesNode>
  // legacy (v1): globale
  courseNotes?: Record<string, string>
  childNotes?: Record<string, string>
  levelOverrides?: Record<string, string>
}

export type ScuolaNuotoArchivedNote = {
  date: string
  weekday: string
  kind: "course" | "child"
  baseKey: string
  childKey?: string
  note: string
  updatedAt?: string
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

function emptyNode(): NotesNode {
  return { courseNotes: {}, childNotes: {}, levelOverrides: {} }
}

function touchNode(node: NotesNode): void {
  node.updatedAt = new Date().toISOString()
}

function ensureDay(v: OverridesFile, day: string | null): { dayKey: string; node: NotesNode } {
  const dayKey = (day ?? "").trim().toLowerCase() || "any"
  if (!v.byDay || typeof v.byDay !== "object") v.byDay = {}
  const existing = v.byDay[dayKey]
  if (existing) return { dayKey, node: existing }
  const node = emptyNode()
  v.byDay[dayKey] = node
  return { dayKey, node }
}

function ensureDate(v: OverridesFile, isoDate: string | null): { dateKey: string; node: NotesNode } | null {
  const dateKey = String(isoDate ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  if (!v.byDate || typeof v.byDate !== "object") v.byDate = {}
  const existing = v.byDate[dateKey]
  if (existing) return { dateKey, node: existing }
  const node = emptyNode()
  v.byDate[dateKey] = node
  return { dateKey, node }
}

function collectNotesFromNode(
  iso: string,
  node: NotesNode,
  out: ScuolaNuotoArchivedNote[]
): void {
  const weekday = weekdayKeyFromIso(iso)
  const updatedAt = node.updatedAt
  for (const [baseKey, note] of Object.entries(node.courseNotes ?? {})) {
    const n = String(note ?? "").trim()
    if (!n) continue
    out.push({ date: iso, weekday, kind: "course", baseKey, note: n, updatedAt })
  }
  for (const [compound, note] of Object.entries(node.childNotes ?? {})) {
    const n = String(note ?? "").trim()
    if (!n) continue
    const sep = compound.indexOf("::")
    const childKey = sep >= 0 ? compound.slice(0, sep) : compound
    const baseKey = sep >= 0 ? compound.slice(sep + 2) : ""
    if (!baseKey) continue
    out.push({ date: iso, weekday, kind: "child", baseKey, childKey, note: n, updatedAt })
  }
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

  setCourseNote(baseKey: string, note: string, day?: string | null, isoDate?: string | null) {
    const v = load()
    const { node } = ensureDay(v, day ?? null)
    const key = String(baseKey ?? "").trim()
    if (!key) return
    const n = String(note ?? "").trim()
    if (!n) delete node.courseNotes[key]
    else node.courseNotes[key] = n
    touchNode(node)
    const dated = ensureDate(v, isoDate ?? null)
    if (dated) {
      if (!n) delete dated.node.courseNotes[key]
      else dated.node.courseNotes[key] = n
      touchNode(dated.node)
    }
    save(v)
  },

  setChildNote(childKey: string, baseKey: string, note: string, day?: string | null, isoDate?: string | null) {
    const v = load()
    const { node } = ensureDay(v, day ?? null)
    const ck = String(childKey ?? "").trim()
    const bk = String(baseKey ?? "").trim()
    if (!ck || !bk) return
    const n = String(note ?? "").trim()
    const key = k(ck, bk)
    if (!n) delete node.childNotes[key]
    else node.childNotes[key] = n
    touchNode(node)
    const dated = ensureDate(v, isoDate ?? null)
    if (dated) {
      if (!n) delete dated.node.childNotes[key]
      else dated.node.childNotes[key] = n
      touchNode(dated.node)
    }
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
    touchNode(node)
    save(v)
  },

  listArchivedNotes(period: ScuolaNuotoNotesPeriod, refDate?: Date) {
    const { from, to, label } = dateRangeForNotesPeriod(period, refDate)
    const v = load()
    const byDate = v.byDate && typeof v.byDate === "object" ? v.byDate : {}
    const rows: ScuolaNuotoArchivedNote[] = []
    for (const iso of eachIsoDateInRange(from, to)) {
      const node = byDate[iso]
      if (!node) continue
      collectNotesFromNode(iso, node, rows)
    }
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      return a.baseKey.localeCompare(b.baseKey)
    })
    return { period, from, to, label, rows }
  },
}

