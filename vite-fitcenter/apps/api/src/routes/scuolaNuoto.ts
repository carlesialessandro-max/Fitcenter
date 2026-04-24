import { Router } from "express"
import { requireAuth, requireAdminOrScuolaNuoto } from "../middleware/auth.js"
import { getScuolaNuotoToday } from "../handlers/scuolaNuoto.js"
import {
  getScuolaNuotoOverrides,
  postScuolaNuotoChildNote,
  postScuolaNuotoCourseNote,
  postScuolaNuotoLevelOverride,
} from "../handlers/scuolaNuotoOverrides.js"

export const scuolaNuotoRouter = Router()

// Corsi del giorno della settimana (non per data specifica), filtrati per periodo.
scuolaNuotoRouter.get("/today", requireAuth, requireAdminOrScuolaNuoto, getScuolaNuotoToday)

// Note / override locali (persistenza su server).
scuolaNuotoRouter.get("/overrides", requireAuth, requireAdminOrScuolaNuoto, getScuolaNuotoOverrides)
scuolaNuotoRouter.post("/course-note", requireAuth, requireAdminOrScuolaNuoto, postScuolaNuotoCourseNote)
scuolaNuotoRouter.post("/child-note", requireAuth, requireAdminOrScuolaNuoto, postScuolaNuotoChildNote)
scuolaNuotoRouter.post("/level-override", requireAuth, requireAdminOrScuolaNuoto, postScuolaNuotoLevelOverride)

