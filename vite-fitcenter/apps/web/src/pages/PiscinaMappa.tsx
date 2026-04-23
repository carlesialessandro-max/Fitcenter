import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { piscinaApi } from "@/api/piscina"
import { useAuth } from "@/contexts/AuthContext"
import { Navigate } from "react-router-dom"

type Seat = { id: string; x: number; y: number; w: number; h: number; kind: "lettino" | "ombrellone" }

function isoTodayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function buildSeats(): Seat[] {
  // Coordinate in viewBox 0..1000 (x) e 0..700 (y). Disposizione “simile” alla foto.
  const out: Seat[] = []
  let n = 1
  const add = (x: number, y: number, w: number, h: number, kind: Seat["kind"]) => out.push({ id: `${kind}-${n++}`, x, y, w, h, kind })

  // Lettini bordo vasca in alto (deck)
  for (let i = 0; i < 18; i++) add(360 + i * 30, 80, 18, 10, "lettino")
  for (let i = 0; i < 14; i++) add(400 + i * 30, 110, 18, 10, "lettino")

  // Blocco sinistra prato con ombrelloni
  for (let r = 0; r < 4; r++) {
    add(90, 300 + r * 85, 18, 18, "ombrellone")
    for (let i = 0; i < 6; i++) add(140 + i * 30, 290 + r * 85, 18, 10, "lettino")
    for (let i = 0; i < 6; i++) add(140 + i * 30, 310 + r * 85, 18, 10, "lettino")
  }

  // Prato basso centro: cluster con 2 ombrelloni
  add(470, 520, 18, 18, "ombrellone")
  add(540, 560, 18, 18, "ombrellone")
  for (let r = 0; r < 4; r++) for (let i = 0; i < 8; i++) add(410 + i * 28, 480 + r * 22, 18, 10, "lettino")

  // Destra prato: due colonne di lettini
  for (let c = 0; c < 2; c++) for (let r = 0; r < 8; r++) add(820 + c * 40, 260 + r * 35, 18, 10, "lettino")
  for (let c = 0; c < 2; c++) for (let r = 0; r < 8; r++) add(760 + c * 40, 280 + r * 35, 18, 10, "lettino")

  return out
}

export function PiscinaMappa() {
  const { role } = useAuth()
  if (role === "firme") return <Navigate to="/firma-cassa" replace />
  if (role !== "admin" && role !== "operatore") return <Navigate to="/" replace />

  const [date, setDate] = useState<string>(isoTodayLocal())
  const seats = useMemo(() => buildSeats(), [])

  const q = useQuery({
    queryKey: ["piscina", "bookings", date],
    queryFn: () => piscinaApi.listBookings(date),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })

  const bookedBySeat = useMemo(() => {
    const m = new Map<string, { id: string; by: string }>()
    for (const b of q.data?.bookings ?? []) m.set(b.seatId, { id: b.id, by: b.createdByUsername })
    return m
  }, [q.data])

  const createM = useMutation({
    mutationFn: async (seatId: string) => piscinaApi.createBooking(date, seatId),
    onSuccess: () => q.refetch(),
  })
  const deleteM = useMutation({
    mutationFn: async (bookingId: string) => piscinaApi.deleteBooking(bookingId),
    onSuccess: () => q.refetch(),
  })

  function onSeatClick(seatId: string) {
    const b = bookedBySeat.get(seatId)
    if (b) deleteM.mutate(b.id)
    else createM.mutate(seatId)
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Mappa Piscina</h2>
            <p className="text-sm text-zinc-500">Clicca un posto per prenotare / annullare (per data).</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs text-zinc-500">
              Data
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              />
            </label>
            <button
              type="button"
              onClick={() => q.refetch()}
              className="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Aggiorna
            </button>
          </div>
        </div>
        {q.isError ? (
          <div className="mt-3 rounded-lg border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-200">
            Errore nel caricamento prenotazioni.
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
        <div className="overflow-auto">
          <svg viewBox="0 0 1000 700" className="min-w-[900px]">
            {/* sfondo */}
            <rect x="0" y="0" width="1000" height="700" fill="#0a0a0a" />
            <rect x="0" y="210" width="1000" height="490" fill="#164e2b" opacity="0.9" />
            <rect x="250" y="20" width="700" height="230" fill="#c9b48a" opacity="0.95" />

            {/* edificio top */}
            <rect x="520" y="0" width="480" height="50" fill="#2a2a2a" />

            {/* vasca */}
            <path
              d="M410,70
                 C360,70 330,100 330,140
                 C330,200 410,230 500,230
                 C590,230 670,200 670,140
                 C670,100 640,70 590,70
                 C560,70 540,85 520,110
                 C500,85 470,70 410,70 Z"
              fill="#43c6e6"
              stroke="#0e7490"
              strokeWidth="4"
            />
            <path d="M360,120 C330,135 330,160 360,175 C390,160 390,135 360,120 Z" fill="#7dd3fc" opacity="0.75" />

            {/* passerella basso vasca */}
            <rect x="430" y="250" width="140" height="30" fill="#c9b48a" />

            {/* siepi sinistra */}
            <rect x="20" y="20" width="210" height="190" fill="#0f3d22" opacity="0.9" />
            <rect x="40" y="40" width="170" height="150" fill="#0a0a0a" opacity="0.35" />

            {/* posti */}
            {seats.map((s) => {
              const b = bookedBySeat.get(s.id)
              const isUmb = s.kind === "ombrellone"
              const fill = b ? "#ef4444" : isUmb ? "#fb923c" : "#f4f4f5"
              const stroke = b ? "#7f1d1d" : "#3f3f46"
              const opacity = isUmb ? 0.95 : 0.9
              return (
                <g key={s.id} onClick={() => onSeatClick(s.id)} style={{ cursor: "pointer" }}>
                  {isUmb ? (
                    <circle cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={s.w / 2} fill={fill} stroke={stroke} strokeWidth="2" opacity={opacity} />
                  ) : (
                    <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" opacity={opacity} />
                  )}
                  <title>{b ? `${s.id} — prenotato da ${b.by}` : `${s.id} — libero`}</title>
                </g>
              )
            })}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm border border-zinc-700 bg-zinc-100" /> libero (lettino)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border border-zinc-700 bg-orange-400" /> ombrellone
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm border border-red-900 bg-red-500" /> prenotato
          </span>
          {createM.isPending || deleteM.isPending ? <span className="text-zinc-500">Salvataggio...</span> : null}
        </div>
      </div>
    </div>
  )
}

