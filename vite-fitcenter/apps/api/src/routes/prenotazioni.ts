import { Router } from "express"
import { requireAdminOrCorsi, requireAdminOrCorsiOrIstruttore, requireAuth } from "../middleware/auth.js"
import { getPrenotazioniCorsi } from "../handlers/prenotazioni.js"
import { postNotifyPrenotazioniCorsi } from "../handlers/prenotazioniNotify.js"

export const prenotazioniRouter = Router()

prenotazioniRouter.use(requireAuth)

// GET /api/prenotazioni/prenotazioni?giorno=YYYY-MM-DD
prenotazioniRouter.get("/prenotazioni", requireAdminOrCorsiOrIstruttore, getPrenotazioniCorsi)

// POST /api/prenotazioni/notify-email  { giorno, groupKey, subject, text }
prenotazioniRouter.post("/notify-email", requireAdminOrCorsi, postNotifyPrenotazioniCorsi)

