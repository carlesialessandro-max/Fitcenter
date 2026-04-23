import { api } from "./client"

export type PiscinaBooking = {
  id: string
  date: string
  seatId: string
  createdAt: string
  createdByUsername: string
}

export const piscinaApi = {
  listBookings: (date: string) => api.get<{ date: string; bookings: PiscinaBooking[] }>(`/piscina/bookings?date=${encodeURIComponent(date)}`),
  createBooking: (date: string, seatId: string) => api.post<{ booking: PiscinaBooking }>(`/piscina/bookings`, { date, seatId }),
  deleteBooking: (id: string) => api.delete<{ ok: true }>(`/piscina/bookings/${encodeURIComponent(id)}`),
}

