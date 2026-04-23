import { Router } from "express"
import { requireAuth, requireAdminOrScuolaNuoto } from "../middleware/auth.js"
import { getScuolaNuotoToday } from "../handlers/scuolaNuoto.js"

export const scuolaNuotoRouter = Router()

// Corsi del giorno della settimana (non per data specifica), filtrati per periodo.
scuolaNuotoRouter.get("/today", requireAuth, requireAdminOrScuolaNuoto, getScuolaNuotoToday)

