import { Router } from "express"
import { listChiamate, getChiamata, createChiamata, getChiamateStats } from "../handlers/chiamate.js"
import { requireAuth } from "../middleware/auth.js"

export const chiamateRouter = Router()

chiamateRouter.get("/chiamate/stats", requireAuth, getChiamateStats)
chiamateRouter.get("/chiamate", requireAuth, listChiamate)
chiamateRouter.get("/chiamate/:id", requireAuth, getChiamata)
chiamateRouter.post("/chiamate", requireAuth, createChiamata)
