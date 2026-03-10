import { Router } from "express"
import { listChiamate, getChiamata, createChiamata, getChiamateStats } from "../handlers/chiamate.js"

export const chiamateRouter = Router()

chiamateRouter.get("/chiamate/stats", getChiamateStats)
chiamateRouter.get("/chiamate", listChiamate)
chiamateRouter.get("/chiamate/:id", getChiamata)
chiamateRouter.post("/chiamate", createChiamata)
