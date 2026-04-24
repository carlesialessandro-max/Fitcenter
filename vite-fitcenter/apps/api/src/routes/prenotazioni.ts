import { Router } from "express"
import { requireAdminOrCorsi, requireAdminOrCorsiOrIstruttore, requireAdminOrScuolaNuoto, requireAuth } from "../middleware/auth.js"
import { getPrenotazioniCorsi } from "../handlers/prenotazioni.js"
import { postNotifyPrenotazioniCorsi } from "../handlers/prenotazioniNotify.js"
import { getPrenotazioniCorsiRange } from "../handlers/prenotazioniRange.js"
import { getAccessiUtentiRange } from "../handlers/accessiRange.js"
import {
  deleteCorsiNoShowBlock,
  listCorsiNoShowBlocks,
  postCorsiNoShowBlock,
  postCorsiNoShowNotify,
  postCorsiNoShowNotifyAndBlock,
} from "../handlers/corsiNoShow.js"

export const prenotazioniRouter = Router()

prenotazioniRouter.use(requireAuth)

// GET /api/prenotazioni/prenotazioni?giorno=YYYY-MM-DD
prenotazioniRouter.get("/prenotazioni", requireAdminOrCorsiOrIstruttore, getPrenotazioniCorsi)

// GET /api/prenotazioni/prenotazioni-range?from=YYYY-MM-DD&to=YYYY-MM-DD
prenotazioniRouter.get("/prenotazioni-range", requireAdminOrCorsiOrIstruttore, getPrenotazioniCorsiRange)

// GET /api/prenotazioni/accessi-range?from=YYYY-MM-DD&to=YYYY-MM-DD
prenotazioniRouter.get("/accessi-range", requireAdminOrScuolaNuoto, getAccessiUtentiRange)

// POST /api/prenotazioni/notify-email  { giorno, groupKey, subject, text }
prenotazioniRouter.post("/notify-email", requireAdminOrCorsi, postNotifyPrenotazioniCorsi)

// No-show / blocchi (solo admin/corsi)
prenotazioniRouter.get("/no-show/blocks", requireAdminOrCorsi, listCorsiNoShowBlocks)
prenotazioniRouter.post("/no-show/blocks", requireAdminOrCorsi, postCorsiNoShowBlock)
prenotazioniRouter.delete("/no-show/blocks/:email", requireAdminOrCorsi, deleteCorsiNoShowBlock)
prenotazioniRouter.post("/no-show/notify", requireAdminOrCorsi, postCorsiNoShowNotify)
prenotazioniRouter.post("/no-show/notify-and-block", requireAdminOrCorsi, postCorsiNoShowNotifyAndBlock)

