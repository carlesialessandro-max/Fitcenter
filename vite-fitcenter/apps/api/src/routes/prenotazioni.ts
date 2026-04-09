import { Router } from "express"
import { requireAuth } from "../middleware/auth.js"
import { getPrenotazioniCorsi } from "../handlers/prenotazioni.js"

export const prenotazioniRouter = Router()

prenotazioniRouter.use(requireAuth)

// GET /api/prenotazioni/prenotazioni?giorno=YYYY-MM-DD
prenotazioniRouter.get("/prenotazioni", getPrenotazioniCorsi)

