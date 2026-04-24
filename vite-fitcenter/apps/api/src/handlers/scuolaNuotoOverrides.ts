import type { Request, Response } from "express"
import { scuolaNuotoOverridesStore } from "../store/scuola-nuoto-overrides.js"

export function getScuolaNuotoOverrides(_req: Request, res: Response) {
  const v = scuolaNuotoOverridesStore.getAll()
  return res.json({ day: null, ...v })
}

export function postScuolaNuotoCourseNote(req: Request, res: Response) {
  const baseKey = String((req.body as any)?.baseKey ?? "").trim()
  const note = String((req.body as any)?.note ?? "")
  if (!baseKey) return res.status(400).json({ message: "baseKey mancante" })
  scuolaNuotoOverridesStore.setCourseNote(baseKey, note)
  return res.json({ ok: true })
}

export function postScuolaNuotoChildNote(req: Request, res: Response) {
  const childKey = String((req.body as any)?.childKey ?? "").trim()
  const baseKey = String((req.body as any)?.baseKey ?? "").trim()
  const note = String((req.body as any)?.note ?? "")
  if (!childKey || !baseKey) return res.status(400).json({ message: "childKey/baseKey mancanti" })
  scuolaNuotoOverridesStore.setChildNote(childKey, baseKey, note)
  return res.json({ ok: true })
}

export function postScuolaNuotoLevelOverride(req: Request, res: Response) {
  const childKey = String((req.body as any)?.childKey ?? "").trim()
  const baseKey = String((req.body as any)?.baseKey ?? "").trim()
  const livello = String((req.body as any)?.livello ?? "").trim()
  if (!childKey || !baseKey) return res.status(400).json({ message: "childKey/baseKey mancanti" })
  scuolaNuotoOverridesStore.setLevelOverride(childKey, baseKey, livello)
  return res.json({ ok: true })
}

