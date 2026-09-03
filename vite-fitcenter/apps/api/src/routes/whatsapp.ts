import { Router } from "express"
import { requireAdmin, requireAdminOrOperatoreOrCrm, requireAuth } from "../middleware/auth.js"
import {
  whatsappEventsDeleteByPhone,
  whatsappEventsList,
  whatsappEventsPurgeTests,
  whatsappSendLead,
  whatsappSendLeadInfo,
  whatsappSendTest,
  whatsappStatus,
} from "../handlers/whatsapp.js"

export const whatsappRouter = Router()

/** Admin: stato config + ultimi eventi + invio test. */
whatsappRouter.get("/whatsapp/status", requireAuth, requireAdmin, whatsappStatus)
whatsappRouter.post("/whatsapp/send-test", requireAuth, requireAdmin, whatsappSendTest)
/** Log conversazioni WA (admin / consulente / CRM). */
whatsappRouter.get("/whatsapp/events", requireAuth, requireAdminOrOperatoreOrCrm, whatsappEventsList)
whatsappRouter.delete("/whatsapp/events", requireAuth, requireAdmin, whatsappEventsDeleteByPhone)
whatsappRouter.post("/whatsapp/events/purge-tests", requireAuth, requireAdmin, whatsappEventsPurgeTests)
/** Admin / consulente / CRM: template benvenuto al lead. */
whatsappRouter.post("/whatsapp/send-lead", requireAuth, requireAdminOrOperatoreOrCrm, whatsappSendLead)
whatsappRouter.post("/whatsapp/send-lead-info", requireAuth, requireAdminOrOperatoreOrCrm, whatsappSendLeadInfo)
