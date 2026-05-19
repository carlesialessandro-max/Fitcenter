import type { Request, Response } from "express"
import {
  scuolaNuotoOverridesStore,
  type ScuolaNuotoChildNoteMeta,
  type ScuolaNuotoCourseNoteMeta,
} from "../store/scuola-nuoto-overrides.js"
import type { ScuolaNuotoNotesPeriod } from "../store/scuola-nuoto-notes-period.js"

const NOTE_PERIODS = new Set<ScuolaNuotoNotesPeriod>(["current_week", "previous_week", "month"])

export function getScuolaNuotoOverrides(_req: Request, res: Response) {
  const day = String((_req.query as any)?.day ?? "").trim() || null
  const v = scuolaNuotoOverridesStore.getAll(day)
  return res.json({ day, ...v })
}

export function getScuolaNuotoNotesArchive(req: Request, res: Response) {
  const raw = String((req.query as any)?.period ?? "current_week").trim() as ScuolaNuotoNotesPeriod
  const period = NOTE_PERIODS.has(raw) ? raw : "current_week"
  const payload = scuolaNuotoOverridesStore.listArchivedNotes(period)
  return res.json(payload)
}

function parseCourseMeta(body: unknown): ScuolaNuotoCourseNoteMeta | null {
  const b = body as Record<string, unknown>
  const corsoLabel = String(b?.corsoLabel ?? b?.corso ?? "").trim()
  if (!corsoLabel) return null
  return {
    corsoLabel,
    corso: String(b?.corso ?? "").trim() || null,
    oraInizio: String(b?.oraInizio ?? "").trim() || null,
    oraFine: String(b?.oraFine ?? "").trim() || null,
    livello: String(b?.livello ?? "").trim() || null,
    istruttore: String(b?.istruttore ?? "").trim() || null,
  }
}

function parseChildMeta(body: unknown): ScuolaNuotoChildNoteMeta | null {
  const b = body as Record<string, unknown>
  const childName = String(b?.childName ?? "").trim()
  const corsoLabel = String(b?.corsoLabel ?? "").trim()
  if (!childName || !corsoLabel) return null
  return {
    childName,
    corsoLabel,
    livello: String(b?.livello ?? "").trim() || null,
  }
}

export function postScuolaNuotoCourseNote(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>
  const day = String(body?.day ?? "").trim() || null
  const date = String(body?.date ?? "").trim() || null
  const baseKey = String(body?.baseKey ?? "").trim()
  const note = String(body?.note ?? "")
  if (!baseKey) return res.status(400).json({ message: "baseKey mancante" })
  scuolaNuotoOverridesStore.setCourseNote(baseKey, note, day, date, parseCourseMeta(body))
  return res.json({ ok: true })
}

export function postScuolaNuotoChildNote(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>
  const day = String(body?.day ?? "").trim() || null
  const date = String(body?.date ?? "").trim() || null
  const childKey = String(body?.childKey ?? "").trim()
  const baseKey = String(body?.baseKey ?? "").trim()
  const note = String(body?.note ?? "")
  if (!childKey || !baseKey) return res.status(400).json({ message: "childKey/baseKey mancanti" })
  scuolaNuotoOverridesStore.setChildNote(childKey, baseKey, note, day, date, parseChildMeta(body))
  return res.json({ ok: true })
}

export function postScuolaNuotoLevelOverride(req: Request, res: Response) {
  const day = String((req.body as any)?.day ?? "").trim() || null
  const childKey = String((req.body as any)?.childKey ?? "").trim()
  const baseKey = String((req.body as any)?.baseKey ?? "").trim()
  const livello = String((req.body as any)?.livello ?? "").trim()
  if (!childKey || !baseKey) return res.status(400).json({ message: "childKey/baseKey mancanti" })
  scuolaNuotoOverridesStore.setLevelOverride(childKey, baseKey, livello, day)
  return res.json({ ok: true })
}

