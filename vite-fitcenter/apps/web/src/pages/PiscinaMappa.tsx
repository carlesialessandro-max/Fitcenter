import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { piscinaApi } from "@/api/piscina"
import { useAuth } from "@/contexts/AuthContext"
import { Navigate } from "react-router-dom"

type ShapeRect = { kind: "rect"; x: number; y: number; w: number; h: number; r?: number }
type ShapeCircle = { kind: "circle"; cx: number; cy: number; r: number }
type Seat = { id: string; label: string; bookId: string; shapes: Array<ShapeRect | ShapeCircle> }

function isoTodayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function buildSeats(): Seat[] {
  // Coordinate in viewBox 0..1000 (x) e 0..700 (y).
  // Bordo piscina: lettino singolo numerato 1..28.
  // Prato: postazione = 2 lettini + 1 ombrellone (prenotazione unica per postazione).
  const out: Seat[] = []

  const addLet = (num: number, x: number, y: number) => {
    const bookId = `bp-${pad2(num)}`
    out.push({
      id: `lettino-${bookId}`,
      label: String(num),
      bookId,
      shapes: [{ kind: "rect", x, y, w: 18, h: 10, r: 2 }],
    })
  }

  const addPostazione = (zone: "sx" | "cx" | "dx", idx: number, x: number, y: number) => {
    const bookId = `pr-${zone}-${pad2(idx)}`
    out.push({
      id: `post-${bookId}`,
      label: `${zone.toUpperCase()}${idx}`,
      bookId,
      shapes: [
        { kind: "circle", cx: x + 10, cy: y + 10, r: 10 },
        { kind: "rect", x: x + 26, y: y + 2, w: 18, h: 10, r: 2 },
        { kind: "rect", x: x + 26, y: y + 18, w: 18, h: 10, r: 2 },
      ],
    })
  }

  // --- Bordo piscina (deck alto) ---
  // Blocco Sinistro (13): sopra 7 (1-7), sotto 6 (8-13)
  for (let i = 0; i < 7; i++) addLet(1 + i, 300 + i * 30, 80)
  for (let i = 0; i < 6; i++) addLet(8 + i, 315 + i * 30, 110)

  // Blocco Destro (15): sopra 8 (14-21), sotto 7 (22-28)
  for (let i = 0; i < 8; i++) addLet(14 + i, 540 + i * 30, 80)
  for (let i = 0; i < 7; i++) addLet(22 + i, 555 + i * 30, 110)

  // --- Prato sinistra (3 file): 10, 10, 8 postazioni ---
  // Le righe sono vicino alla siepe (foto 2)
  let sx = 1
  const sxStartX = 70
  const sxStartY = 260
  const sxDx = 70
  for (let i = 0; i < 10; i++) addPostazione("sx", sx++, sxStartX, sxStartY + i * 36)
  for (let i = 0; i < 10; i++) addPostazione("sx", sx++, sxStartX + sxDx, sxStartY + i * 36)
  for (let i = 0; i < 8; i++) addPostazione("sx", sx++, sxStartX + sxDx * 2, sxStartY + i * 40)

  // --- Prato centrale (3 file): 2, 4, 3 postazioni (ingresso piscina) ---
  // Richiesta: 3 file ripetute, ognuna con 2 (sx) + 4 (centro) + 3 (dx) postazioni.
  let cx = 1
  const cxRowYs = [470, 540, 610]
  const cxLeftXs = [360, 440] // 2 a sinistra
  const cxMidXs = [520, 600, 680, 760] // 4 al centro
  const cxRightXs = [840, 920, 980] // 3 a destra (resta entro viewBox)
  for (const y of cxRowYs) {
    for (const x of cxLeftXs) addPostazione("cx", cx++, x, y)
    for (const x of cxMidXs) addPostazione("cx", cx++, x, y)
    for (const x of cxRightXs) addPostazione("cx", cx++, x, y)
  }

  // --- Prato destra (2 file): 5 e 6 postazioni ---
  let dx = 1
  const dxBaseX = 740
  const dxBaseY = 260
  for (let i = 0; i < 5; i++) addPostazione("dx", dx++, dxBaseX, dxBaseY + i * 55)
  for (let i = 0; i < 6; i++) addPostazione("dx", dx++, dxBaseX + 80, dxBaseY + i * 50)

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

  function onSeatClick(bookId: string) {
    const b = bookedBySeat.get(bookId)
    if (b) deleteM.mutate(b.id)
    else createM.mutate(bookId)
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
              const b = bookedBySeat.get(s.bookId)
              const isBooked = Boolean(b)
              const fillLettino = isBooked ? "#ef4444" : "#f4f4f5"
              const fillUmb = isBooked ? "#ef4444" : "#fb923c"
              const stroke = isBooked ? "#7f1d1d" : "#3f3f46"
              return (
                <g key={s.id} onClick={() => onSeatClick(s.bookId)} style={{ cursor: "pointer" }}>
                  {s.shapes.map((sh, idx) =>
                    sh.kind === "circle" ? (
                      <circle key={idx} cx={sh.cx} cy={sh.cy} r={sh.r} fill={fillUmb} stroke={stroke} strokeWidth="2" opacity={0.95} />
                    ) : (
                      <rect
                        key={idx}
                        x={sh.x}
                        y={sh.y}
                        width={sh.w}
                        height={sh.h}
                        rx={sh.r ?? 2}
                        fill={fillLettino}
                        stroke={stroke}
                        strokeWidth="1.5"
                        opacity={0.92}
                      />
                    )
                  )}
                  {/* Etichetta */}
                  {(() => {
                    const first = s.shapes[0]
                    const tx = first.kind === "circle" ? first.cx : first.x + 4
                    const ty = first.kind === "circle" ? first.cy + 4 : first.y + 9
                    return (
                      <text x={tx} y={ty} fontSize="10" fill={isBooked ? "#fff" : "#111"} fontWeight="700">
                        {s.label}
                      </text>
                    )
                  })()}
                  <title>{b ? `${s.bookId} — prenotato da ${b.by}` : `${s.bookId} — libero`}</title>
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

