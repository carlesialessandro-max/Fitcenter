import { readJson, writeJson } from "./persist.js"
import {
  dateRangeForNotesPeriod,
  eachIsoDateInRange,
  weekdayKeyFromIso,
  type ScuolaNuotoNotesPeriod,
} from "./scuola-nuoto-notes-period.js"

export type ScuolaNuotoCourseNoteMeta = {
  corsoLabel: string
  corso?: string | null
  oraInizio?: string | null
  oraFine?: string | null
  livello?: string | null
  istruttore?: string | null
}

export type ScuolaNuotoChildNoteMeta = {
  childName: string
  corsoLabel: string
  livello?: string | null
}

type NotesNode = {
  courseNotes: Record<string, string>
  childNotes: Record<string, string>
  levelOverrides: Record<string, string>
  courseMeta?: Record<string, ScuolaNuotoCourseNoteMeta>
  childMeta?: Record<string, ScuolaNuotoChildNoteMeta>
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
  corsoLabel?: string
  childName?: string
  oraInizio?: string | null
  livello?: string | null
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

function applyCourseMeta(row: ScuolaNuotoArchivedNote, meta?: ScuolaNuotoCourseNoteMeta): void {
  if (!meta) return
  if (meta.corsoLabel) row.corsoLabel = meta.corsoLabel
  if (meta.oraInizio != null) row.oraInizio = meta.oraInizio
  if (meta.livello != null) row.livello = meta.livello
}

function applyChildMeta(row: ScuolaNuotoArchivedNote, meta?: ScuolaNuotoChildNoteMeta): void {
  if (!meta) return
  if (meta.childName) row.childName = meta.childName
  if (meta.corsoLabel) row.corsoLabel = meta.corsoLabel
  if (meta.livello != null) row.livello = meta.livello
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
    const row: ScuolaNuotoArchivedNote = { date: iso, weekday, kind: "course", baseKey, note: n, updatedAt }
    applyCourseMeta(row, node.courseMeta?.[baseKey])
    out.push(row)
  }
  for (const [compound, note] of Object.entries(node.childNotes ?? {})) {
    const n = String(note ?? "").trim()
    if (!n) continue
    const sep = compound.indexOf("::")
    const childKey = sep >= 0 ? compound.slice(0, sep) : compound
    const baseKey = sep >= 0 ? compound.slice(sep + 2) : ""
    if (!baseKey) continue
    const row: ScuolaNuotoArchivedNote = { date: iso, weekday, kind: "child", baseKey, childKey, note: n, updatedAt }
    applyChildMeta(row, node.childMeta?.[compound])
    out.push(row)
  }
}

function writeCourseMeta(node: NotesNode, baseKey: string, meta?: ScuolaNuotoCourseNoteMeta | null): void {
  if (!node.courseMeta) node.courseMeta = {}
  if (!meta?.corsoLabel?.trim()) {
    delete node.courseMeta[baseKey]
    return
  }
  node.courseMeta[baseKey] = {
    corsoLabel: meta.corsoLabel.trim(),
    corso: meta.corso ?? null,
    oraInizio: meta.oraInizio ?? null,
    oraFine: meta.oraFine ?? null,
    livello: meta.livello ?? null,
    istruttore: meta.istruttore ?? null,
  }
}

function writeChildMeta(node: NotesNode, compoundKey: string, meta?: ScuolaNuotoChildNoteMeta | null): void {
  if (!node.childMeta) node.childMeta = {}
  if (!meta?.childName?.trim() || !meta?.corsoLabel?.trim()) {
    delete node.childMeta[compoundKey]
    return
  }
  node.childMeta[compoundKey] = {
    childName: meta.childName.trim(),
    corsoLabel: meta.corsoLabel.trim(),
    livello: meta.livello ?? null,
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

  setCourseNote(
    baseKey: string,
    note: string,
    day?: string | null,
    isoDate?: string | null,
    meta?: ScuolaNuotoCourseNoteMeta | null
  ) {
    const v = load()
    const { node } = ensureDay(v, day ?? null)
    const key = String(baseKey ?? "").trim()
    if (!key) return
    const n = String(note ?? "").trim()
    if (!n) {
      delete node.courseNotes[key]
      delete node.courseMeta?.[key]
    } else {
      node.courseNotes[key] = n
      writeCourseMeta(node, key, meta)
    }
    touchNode(node)
    const dated = ensureDate(v, isoDate ?? null)
    if (dated) {
      if (!n) {
        delete dated.node.courseNotes[key]
        delete dated.node.courseMeta?.[key]
      } else {
        dated.node.courseNotes[key] = n
        writeCourseMeta(dated.node, key, meta)
      }
      touchNode(dated.node)
    }
    save(v)
  },

  setChildNote(
    childKey: string,
    baseKey: string,
    note: string,
    day?: string | null,
    isoDate?: string | null,
    meta?: ScuolaNuotoChildNoteMeta | null
  ) {
    const v = load()
    const { node } = ensureDay(v, day ?? null)
    const ck = String(childKey ?? "").trim()
    const bk = String(baseKey ?? "").trim()
    if (!ck || !bk) return
    const n = String(note ?? "").trim()
    const key = k(ck, bk)
    if (!n) {
      delete node.childNotes[key]
      delete node.childMeta?.[key]
    } else {
      node.childNotes[key] = n
      writeChildMeta(node, key, meta)
    }
    touchNode(node)
    const dated = ensureDate(v, isoDate ?? null)
    if (dated) {
      if (!n) {
        delete dated.node.childNotes[key]
        delete dated.node.childMeta?.[key]
      } else {
        dated.node.childNotes[key] = n
        writeChildMeta(dated.node, key, meta)
      }
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

