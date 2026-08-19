import { Router } from "express"
import { requireAdmin, requireAuth } from "../middleware/auth.js"
import { whatsappSendTest, whatsappStatus } from "../handlers/whatsapp.js"

export const whatsappRouter = Router()

/** Admin: stato config + ultimi eventi + invio test. */
whatsappRouter.get("/whatsapp/status", requireAuth, requireAdmin, whatsappStatus)
whatsappRouter.post("/whatsapp/send-test", requireAuth, requireAdmin, whatsappSendTest)
