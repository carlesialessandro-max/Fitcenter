import type { Request, Response } from "express"
import { getScopedUser } from "../middleware/auth.js"
import { piscinaBookingsStore } from "../store/piscina-bookings.js"

export function getPiscinaBookings(req: Request, res: Response) {
  const date = String(req.query.date ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "date richiesta (YYYY-MM-DD)" })
  return res.json({ date, bookings: piscinaBookingsStore.listByDate(date) })
}

export function postPiscinaBooking(req: Request, res: Response) {
  const u = getScopedUser(req)
  const date = String((req.body as any)?.date ?? "").trim()
  const seatId = String((req.body as any)?.seatId ?? "").trim()
  const r = piscinaBookingsStore.create({ date, seatId, createdByUsername: u.username })
  if (!r.ok) return res.status(400).json({ message: r.message })
  return res.json({ booking: r.booking })
}

export function deletePiscinaBooking(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim()
  if (!id) return res.status(400).json({ message: "id mancante" })
  const ok = piscinaBookingsStore.remove(id)
  if (!ok) return res.status(404).json({ message: "Prenotazione non trovata" })
  return res.json({ ok: true })
}

