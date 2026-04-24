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

  const SCALE_ALL = 0.85
  const S = (n: number) => n * SCALE_ALL

  const addLet = (num: number, x: number, y: number) => {
    const bookId = `bp-${pad2(num)}`
    out.push({
      id: `lettino-${bookId}`,
      label: String(num),
      bookId,
      shapes: [{ kind: "rect", x: S(x), y: S(y), w: S(18), h: S(10), r: 2 }],
    })
  }

  const addPostazione = (zone: "sx" | "cx" | "dx", idx: number, x: number, y: number) => {
    const bookId = `pr-${zone}-${pad2(idx)}`
    // Postazione prato: 1 ombrellone + 2 lettini (più piccola per leggibilità)
    out.push({
      id: `post-${bookId}`,
      label: `${zone.toUpperCase()}${idx}`,
      bookId,
      shapes: [
        { kind: "circle", cx: S(x + 8), cy: S(y + 8), r: S(8) },
        { kind: "rect", x: S(x + 20), y: S(y + 2), w: S(14), h: S(8), r: 2 },
        { kind: "rect", x: S(x + 20), y: S(y + 14), w: S(14), h: S(8), r: 2 },
      ],
    })
  }

  // --- Bordo piscina (deck alto) ---
  // Blocco Sinistro (13): sopra 7 (1-7), sotto 6 (8-13)
  // Spostati più in alto per stare fuori dall'acqua.
  for (let i = 0; i < 7; i++) addLet(1 + i, 300 + i * 30, 55)
  for (let i = 0; i < 6; i++) addLet(8 + i, 315 + i * 30, 85)

  // Blocco Destro (15): sopra 8 (14-21), sotto 7 (22-28)
  // Spostati a destra di +500px (richiesta).
  for (let i = 0; i < 8; i++) addLet(14 + i, 540 + i * 30 + 500, 55)
  for (let i = 0; i < 7; i++) addLet(22 + i, 555 + i * 30 + 500, 85)

  // --- Prato: 25 lettini singoli (29..53) ---
  // Ai margini in fondo al prato (in basso), allineati come i lettini della piscina.
  // 2 colonne laterali + 1 colonna centrale (9 + 9 + 7 = 25).
  let p = 29
  const pgYTop = 620
  const pgDy = 18
  // sinistra (9)
  for (let i = 0; i < 9; i++) addLet(p++, 35, pgYTop + i * pgDy)
  // destra (9)
  for (let i = 0; i < 9; i++) addLet(p++, 1445, pgYTop + i * pgDy)
  // centro (7)
  for (let i = 0; i < 7; i++) addLet(p++, 740, pgYTop + i * pgDy)

  // --- Prato sinistra (3 file): 10, 10, 8 postazioni ---
  // Le righe sono vicino alla siepe (foto 2)
  let sx = 1
  // Allinea alla siepe (x vicino al bordo sinistro del prato) e sposta tutto nel verde (y >= 210)
  const sxStartX = 30
  const sxStartY = 290
  const sxDx = 75
  for (let i = 0; i < 10; i++) addPostazione("sx", sx++, sxStartX, sxStartY + i * 36)
  for (let i = 0; i < 10; i++) addPostazione("sx", sx++, sxStartX + sxDx, sxStartY + i * 36)
  for (let i = 0; i < 8; i++) addPostazione("sx", sx++, sxStartX + sxDx * 2, sxStartY + i * 40)

  // --- Prato centrale (3 file): 2 + 4 + 3 postazioni, posizionate dove sono le "X" (screenshot) ---
  // (cioè nella fascia centrale alta, sopra le postazioni basse e sotto il bordo vasca)
  let cx = 1
  // Spostate leggermente in basso per rimanere nel prato (dopo scala)
  // Abbassate: così pr-cx-04/05 finiscono sicuramente su verde (dopo scala).
  const cxRowYs = [420, 475, 530]
  const cxLeftXs = [300, 380] // 2 a sinistra
  const cxMidXs = [455, 535, 615, 695] // 4 al centro
  const cxRightXs = [760, 830, 900] // 3 a destra (più a sinistra per non confondersi con DX)
  for (const y of cxRowYs) {
    for (const x of cxLeftXs) addPostazione("cx", cx++, x, y)
    for (const x of cxMidXs) addPostazione("cx", cx++, x, y)
    for (const x of cxRightXs) addPostazione("cx", cx++, x, y)
  }

  // --- Prato destra (2 file): 5 e 6 postazioni ---
  let dx = 1
  // Allinea al margine destro del prato e sposta tutto nel verde (y >= 210)
  // Sposta ancora a destra (~100px) per evitare overlap con il blocco centrale
  const dxBaseX = 1020
  const dxBaseY = 340
  for (let i = 0; i < 5; i++) addPostazione("dx", dx++, dxBaseX, dxBaseY + i * 55)
  // Seconda colonna più vicina per rientrare nel viewBox
  for (let i = 0; i < 6; i++) addPostazione("dx", dx++, dxBaseX + 60, dxBaseY + i * 50)

  return out
}

export function PiscinaMappa() {
  const { role } = useAuth()
  if (role === "firme") return <Navigate to="/firma-cassa" replace />
  if (role !== "admin" && role !== "operatore") return <Navigate to="/" replace />

  const [date, setDate] = useState<string>(isoTodayLocal())
  const [zoom, setZoom] = useState<number>(0.8)
  const [showLabels, setShowLabels] = useState<boolean>(false)
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
            <label className="text-xs text-zinc-500">
              Zoom
              <select
                value={String(zoom)}
                onChange={(e) => setZoom(Number(e.target.value) || 1)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="0.8">80%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
                <option value="2">200%</option>
              </select>
            </label>
            <label className="mt-1 inline-flex items-center gap-2 text-xs text-zinc-400 sm:mt-6">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
              Mostra etichette
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
          <svg
            viewBox="0 0 1600 700"
            className="min-w-[900px]"
            style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {/* sfondo */}
            <rect x="0" y="0" width="1600" height="700" fill="#0a0a0a" />
            <rect x="0" y="210" width="1600" height="490" fill="#164e2b" opacity="0.9" />
            <rect x="250" y="20" width="1100" height="260" fill="#c9b48a" opacity="0.95" />

            {/* edificio top */}
            <rect x="520" y="0" width="1080" height="50" fill="#2a2a2a" />

            {/* vasca */}
            <path
              d="M410,105
                 C360,105 330,135 330,175
                 C330,235 410,265 500,265
                 C590,265 670,235 670,175
                 C670,135 640,105 590,105
                 C560,105 540,120 520,145
                 C500,120 470,105 410,105 Z"
              fill="#43c6e6"
              stroke="#0e7490"
              strokeWidth="4"
            />
            <path d="M360,155 C330,170 330,195 360,210 C390,195 390,170 360,155 Z" fill="#7dd3fc" opacity="0.75" />

            {/* passerella basso vasca */}
            <rect x="430" y="285" width="140" height="30" fill="#c9b48a" />

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
                  {showLabels
                    ? (() => {
                        const first = s.shapes[0]
                        const tx = first.kind === "circle" ? first.cx : first.x + 4
                        const ty = first.kind === "circle" ? first.cy + 4 : first.y + 9
                        return (
                          <text x={tx} y={ty} fontSize="10" fill={isBooked ? "#fff" : "#111"} fontWeight="700">
                            {s.label}
                          </text>
                        )
                      })()
                    : null}
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

