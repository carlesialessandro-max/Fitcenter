import { Router } from "express"
import { requireAdmin, requireAuth, requirePiscina } from "../middleware/auth.js"
import { deletePiscinaBooking, getPiscinaBookings, postPiscinaBooking } from "../handlers/piscina.js"

export const piscinaRouter = Router()

// Per ora: prenotazioni gestite da admin/operatore (come la reception). Se vuoi aprirla a ruoli specifici, aggiungiamo middleware dedicato.
piscinaRouter.get("/bookings", requireAuth, requirePiscina, getPiscinaBookings)
piscinaRouter.post("/bookings", requireAuth, requirePiscina, postPiscinaBooking)
piscinaRouter.delete("/bookings/:id", requireAuth, requirePiscina, deletePiscinaBooking)

// Endpoint “ping” protetto admin, utile per verificare accessi
piscinaRouter.get("/admin/ping", requireAuth, requireAdmin, (_req, res) => res.json({ ok: true }))

