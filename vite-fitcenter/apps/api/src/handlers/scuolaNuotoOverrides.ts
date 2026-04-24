import type { Request, Response } from "express"
import { scuolaNuotoOverridesStore } from "../store/scuola-nuoto-overrides.js"

export function getScuolaNuotoOverrides(_req: Request, res: Response) {
  const day = String((_req.query as any)?.day ?? "").trim() || null
  const v = scuolaNuotoOverridesStore.getAll(day)
  return res.json({ day, ...v })
}

export function postScuolaNuotoCourseNote(req: Request, res: Response) {
  const day = String((req.body as any)?.day ?? "").trim() || null
  const baseKey = String((req.body as any)?.baseKey ?? "").trim()
  const note = String((req.body as any)?.note ?? "")
  if (!baseKey) return res.status(400).json({ message: "baseKey mancante" })
  scuolaNuotoOverridesStore.setCourseNote(baseKey, note, day)
  return res.json({ ok: true })
}

export function postScuolaNuotoChildNote(req: Request, res: Response) {
  const day = String((req.body as any)?.day ?? "").trim() || null
  const childKey = String((req.body as any)?.childKey ?? "").trim()
  const baseKey = String((req.body as any)?.baseKey ?? "").trim()
  const note = String((req.body as any)?.note ?? "")
  if (!childKey || !baseKey) return res.status(400).json({ message: "childKey/baseKey mancanti" })
  scuolaNuotoOverridesStore.setChildNote(childKey, baseKey, note, day)
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

