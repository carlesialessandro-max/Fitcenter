import { Router } from "express"
import { requireAdmin, requireAdminOrOperatoreOrCrm, requireAuth } from "../middleware/auth.js"
import { whatsappSendLead, whatsappSendTest, whatsappStatus } from "../handlers/whatsapp.js"

export const whatsappRouter = Router()

/** Admin: stato config + ultimi eventi + invio test. */
whatsappRouter.get("/whatsapp/status", requireAuth, requireAdmin, whatsappStatus)
whatsappRouter.post("/whatsapp/send-test", requireAuth, requireAdmin, whatsappSendTest)
/** Admin / consulente / CRM: template benvenuto al lead. */
whatsappRouter.post("/whatsapp/send-lead", requireAuth, requireAdminOrOperatoreOrCrm, whatsappSendLead)
