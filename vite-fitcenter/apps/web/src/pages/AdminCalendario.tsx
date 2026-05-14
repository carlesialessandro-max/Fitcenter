import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@workspace/ui/lib/utils"
import planningPayload from "@/data/planning-weekly.json"

type CalView = "month" | "week" | "day"

export type PlanningEvent = {
  id: string
  zona: string
  sheet: string
  dow: number
  start: string
  title: string
  staff: string
}

/** Modifiche fatte in calendario (persistenza browser). */
type PlanningEdit = {
  /** Nome istruttore mostrato (sostituisce quello da Excel). */
  staff?: string
  /** Es. sostituzione, malattia, ferie. */
  note?: string
}

const PLANNING_EDITS_KEY = "fitcenter-planning-calendar-edits:v1"

function stablePlanningKey(e: PlanningEvent): string {
  const title = e.title.trim().replace(/\s+/g, " ")
  return `${e.zona}|${e.dow}|${e.start}|${title}`
}

function loadPlanningEdits(): Record<string, PlanningEdit> {
  try {
    const raw = localStorage.getItem(PLANNING_EDITS_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as unknown
    if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, PlanningEdit>
  } catch {
    /* ignore */
  }
  return {}
}

const IT_MONTHS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
] as const

const IT_DOW_SHORT = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function isoYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Lunedì = 0 … domenica = 6 (stessa convenzione degli header Excel → getDay). */
function mondayIndex(d: Date): number {
  const js = d.getDay()
  return (js + 6) % 7
}

function startOfWeekMonday(d: Date): Date {
  return addDays(startOfDay(d), -mondayIndex(d))
}

function monthMatrix(anchor: Date): { date: Date; inMonth: boolean }[] {
  const y = anchor.getFullYear()
  const m = anchor.getMonth()
  const first = new Date(y, m, 1)
  const start = addDays(first, -mondayIndex(first))
  const cells: { date: Date; inMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i)
    cells.push({ date, inMonth: date.getMonth() === m })
  }
  return cells
}

const H2 = { blue: "#46A6D9", orange: "#F2941B" } as const

const VENDITE_LINKS: { to: string; label: string }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/stampa-report", label: "Stampa report" },
  { to: "/referral", label: "Referral" },
  { to: "/convalide-consulenti", label: "Convalide" },
  { to: "/attivi-analisi", label: "Attivi" },
  { to: "/crm", label: "CRM vendita" },
  { to: "/telefonate", label: "Telefonate" },
  { to: "/abbonamenti", label: "Abbonamenti in scadenza" },
  { to: "/andamento-vendite", label: "Andamento vendite" },
]

const ALTRI_LINKS: { to: string; label: string }[] = [
  { to: "/corsi", label: "Corsi" },
  { to: "/corsi/assenze", label: "Assenze (mese)" },
  { to: "/incassi", label: "Incassi" },
  { to: "/firme", label: "Firme" },
  { to: "/firma-cassa", label: "Firma cassa" },
  { to: "/piscina", label: "Mappa piscina" },
  { to: "/scuola-nuoto", label: "Scuola nuoto" },
  { to: "/campus", label: "Campus" },
  { to: "/danza", label: "Danza" },
]

const CAL_FILTERS = [
  { id: "corsi", label: "Corsi (terra + acqua)" },
  { id: "bagnini", label: "Bagnini" },
  { id: "reception", label: "Reception" },
  { id: "scuola_nuoto", label: "Scuola nuoto" },
  { id: "acquaticita", label: "Acquaticità" },
  { id: "spogliatoi", label: "Spogliatoi" },
  { id: "consulenti", label: "Consulenti" },
] as const

type FilterId = (typeof CAL_FILTERS)[number]["id"]

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((x) => Number(x))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

function hourBucket(hm: string): number {
  return Math.floor(hmToMinutes(hm) / 60)
}

function filteredPlanningEvents(filters: Record<FilterId, boolean>, all: PlanningEvent[]): PlanningEvent[] {
  const layerOn = CAL_FILTERS.some((f) => filters[f.id])
  return all.filter((e) => {
    const planning = e.zona === "terra" || e.zona === "acqua"
    if (!planning) return false
    if (!layerOn) return true
    return filters.corsi
  })
}

function eventsForDay(events: PlanningEvent[], d: Date): PlanningEvent[] {
  const dow = d.getDay()
  return events.filter((e) => e.dow === dow).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}

function eventsForDayAndHour(events: PlanningEvent[], d: Date, hour: number): PlanningEvent[] {
  const dow = d.getDay()
  return events.filter((e) => e.dow === dow && hourBucket(e.start) === hour)
}

function staffDisplayFor(e: PlanningEvent, edits: Record<string, PlanningEdit>): string {
  const k = stablePlanningKey(e)
  const o = edits[k]
  if (o && Object.prototype.hasOwnProperty.call(o, "staff")) {
    const s = String(o.staff ?? "").trim()
    return s || "—"
  }
  return e.staff.trim() || "—"
}

function staffInputInitial(e: PlanningEvent, edits: Record<string, PlanningEdit>): string {
  const o = edits[stablePlanningKey(e)]
  if (o && Object.prototype.hasOwnProperty.call(o, "staff")) return String(o.staff ?? "")
  return e.staff
}

function noteFor(e: PlanningEvent, edits: Record<string, PlanningEdit>): string {
  const k = stablePlanningKey(e)
  return String(edits[k]?.note ?? "").trim()
}

function DropdownNav({ label, links }: { label: string; links: { to: string; label: string }[] }) {
  return (
    <details className="group relative">
      <summary
        className="cursor-pointer list-none rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm font-medium text-zinc-200 outline-none ring-[#46A6D9]/40 hover:border-[#46A6D9]/50 hover:bg-zinc-800 [&::-webkit-details-marker]:hidden"
        style={{ borderColor: "rgba(70, 166, 217, 0.25)" }}
      >
        <span className="inline-flex items-center gap-2">
          {label}
          <span className="text-xs text-zinc-500 group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="absolute left-0 z-50 mt-1 min-w-[14rem] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="block px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 hover:text-[#46A6D9]"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </details>
  )
}

function EventPill({
  e,
  staffLabel,
  note,
  onOpen,
}: {
  e: PlanningEvent
  staffLabel: string
  note: string
  onOpen: () => void
}) {
  const col = e.zona === "acqua" ? "border-sky-500/40 bg-sky-500/15 text-sky-100" : "border-amber-500/35 bg-amber-500/10 text-amber-100"
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full cursor-pointer rounded border px-1 py-0.5 text-left text-[10px] leading-tight transition-colors hover:brightness-110",
        col
      )}
      title="Clic per modificare istruttore e note"
    >
      <span className="font-semibold text-zinc-200">{e.start}</span> {e.title}
      <span className="block truncate text-zinc-300">· {staffLabel}</span>
      {note ? <span className="mt-0.5 block truncate text-[9px] text-amber-200/90">{note}</span> : null}
    </button>
  )
}

function EditEventModal({
  event,
  initialStaff,
  initialNote,
  onClose,
  onSave,
  onResetExcel,
}: {
  event: PlanningEvent
  initialStaff: string
  initialNote: string
  onClose: () => void
  onSave: (staff: string, note: string) => void
  onResetExcel: () => void
}) {
  const [staff, setStaff] = useState(initialStaff)
  const [note, setNote] = useState(initialNote)

  useEffect(() => {
    setStaff(initialStaff)
    setNote(initialNote)
  }, [event.id, initialStaff, initialNote])

  const presets = ["Sostituzione", "Malattia", "Ferie", "Assente"]

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="Chiudi" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-zinc-100">{event.title}</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {event.start} · {event.zona === "acqua" ? "Acqua" : "Terra"} · {event.sheet}
        </p>

        <label className="mt-4 block text-xs font-medium text-zinc-400">
          Istruttore (modificabile)
          <input
            value={staff}
            onChange={(ev) => setStaff(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#46A6D9]/60 focus:outline-none focus:ring-1 focus:ring-[#46A6D9]/30"
            placeholder="Nome istruttore"
            autoComplete="off"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-zinc-400">
          Note (sostituzione, malattia, ferie…)
          <textarea
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            rows={3}
            className="mt-1 w-full resize-y rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#46A6D9]/60 focus:outline-none focus:ring-1 focus:ring-[#46A6D9]/30"
            placeholder="es. Sostituzione con Mario Rossi; ferie fino al…"
          />
        </label>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setNote((n) => (n.trim() ? `${n.trim()}; ${p}` : p))}
              className="rounded-md border border-zinc-600 bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
            >
              + {p}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onResetExcel}
            className="mr-auto rounded-lg border border-zinc-600 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Ripristina da Excel
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
            Annulla
          </button>
          <button
            type="button"
            onClick={() => onSave(staff, note)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-900"
            style={{ backgroundColor: H2.blue }}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  )
}

export function AdminCalendario() {
  const { role } = useAuth()
  const [view, setView] = useState<CalView>("month")
  const [cursor, setCursor] = useState(() => new Date())
  const [filters, setFilters] = useState<Record<FilterId, boolean>>(() =>
    Object.fromEntries(CAL_FILTERS.map((f) => [f.id, true])) as Record<FilterId, boolean>
  )
  const [edits, setEdits] = useState<Record<string, PlanningEdit>>(loadPlanningEdits)
  const [editEvent, setEditEvent] = useState<PlanningEvent | null>(null)

  const persistEdits = useCallback((next: Record<string, PlanningEdit>) => {
    setEdits(next)
    try {
      localStorage.setItem(PLANNING_EDITS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  const saveEdit = useCallback(
    (e: PlanningEvent, staffRaw: string, noteRaw: string) => {
      const k = stablePlanningKey(e)
      const staffTrim = staffRaw.trim()
      const note = noteRaw.trim()
      const effectiveStaff = staffTrim || e.staff.trim()
      const sameStaff = effectiveStaff === e.staff.trim()
      const next = { ...edits }
      if (sameStaff && !note) {
        delete next[k]
      } else {
        const patch: PlanningEdit = {}
        if (!sameStaff) patch.staff = staffTrim || e.staff
        if (note) patch.note = note
        next[k] = patch
      }
      persistEdits(next)
      setEditEvent(null)
    },
    [edits, persistEdits]
  )

  const resetEdit = useCallback(
    (e: PlanningEvent) => {
      const k = stablePlanningKey(e)
      const next = { ...edits }
      delete next[k]
      persistEdits(next)
      setEditEvent(null)
    },
    [edits, persistEdits]
  )

  const allEvents = (planningPayload as { events: PlanningEvent[] }).events
  const visible = useMemo(() => filteredPlanningEvents(filters, allEvents), [filters, allEvents])

  const monthLabel = useMemo(() => {
    return `${IT_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
  }, [cursor])

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(cursor)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [cursor])

  const dayOnly = useMemo(() => startOfDay(cursor), [cursor])

  const hours = useMemo(() => Array.from({ length: 17 }, (_, i) => i + 6), [])

  if (role !== "admin") {
    return <Navigate to="/" replace />
  }

  function goToday() {
    setCursor(new Date())
  }

  function prev() {
    setCursor((d) => {
      if (view === "month") return new Date(d.getFullYear(), d.getMonth() - 1, 1)
      if (view === "week") return addDays(d, -7)
      return addDays(d, -1)
    })
  }

  function next() {
    setCursor((d) => {
      if (view === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1)
      if (view === "week") return addDays(d, 7)
      return addDays(d, 1)
    })
  }

  const today = new Date()
  const isToday = (d: Date) => isoYmd(d) === isoYmd(today)

  const cells = view === "month" ? monthMatrix(cursor) : []

  const planningNote = String((planningPayload as { planningNote?: string }).planningNote ?? "")

  return (
    <div className="min-h-full bg-zinc-950 p-4 text-zinc-100 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Piano operativo</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-500">
              Base orari da planning Excel (una tantum); poi modifica qui <strong className="font-medium text-zinc-400">istruttore</strong> e{" "}
              <strong className="font-medium text-zinc-400">note</strong> (sostituzione, malattia, ferie…). Le modifiche restano salvate in questo browser.
            </p>
            {planningNote ? <p className="mt-2 text-xs text-zinc-600">{planningNote}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownNav label="Vendite" links={VENDITE_LINKS} />
            <DropdownNav label="Altri" links={ALTRI_LINKS} />
            <Link
              to="/"
              className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={prev}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
              aria-label="Periodo precedente"
            >
              ←
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
              aria-label="Periodo successivo"
            >
              →
            </button>
            <span className="min-w-[10rem] text-center text-sm font-medium capitalize text-zinc-200 sm:text-left">
              {view === "month" && monthLabel}
              {view === "week" &&
                `Settimana ${pad2(weekDays[0]!.getDate())}/${pad2(weekDays[0]!.getMonth() + 1)} – ${pad2(weekDays[6]!.getDate())}/${pad2(weekDays[6]!.getMonth() + 1)} ${weekDays[6]!.getFullYear()}`}
              {view === "day" &&
                `${pad2(dayOnly.getDate())} ${IT_MONTHS[dayOnly.getMonth()]} ${dayOnly.getFullYear()}`}
            </span>
            <button
              type="button"
              onClick={goToday}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-900"
              style={{ backgroundColor: H2.blue }}
            >
              Oggi
            </button>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-700 p-1">
            {(
              [
                ["month", "Mese"],
                ["week", "Settimana"],
                ["day", "Giorno"],
              ] as const
            ).map(([k, lab]) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  view === k ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
                )}
                style={view === k ? { backgroundColor: H2.blue } : undefined}
              >
                {lab}
              </button>
            ))}
          </div>
        </div>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Layer calendario</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {CAL_FILTERS.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={filters[f.id]}
                  onChange={(e) => setFilters((prev) => ({ ...prev, [f.id]: e.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-600"
                  style={{ accentColor: H2.orange }}
                />
                {f.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Corsi terra/acqua dal planning; clic su un corso per aggiornare istruttore e note. Altri layer: integrazioni future.
          </p>
        </section>

        {editEvent ? (
          <EditEventModal
            key={editEvent.id}
            event={editEvent}
            initialStaff={staffInputInitial(editEvent, edits)}
            initialNote={noteFor(editEvent, edits)}
            onClose={() => setEditEvent(null)}
            onSave={(staff, note) => saveEdit(editEvent, staff, note)}
            onResetExcel={() => resetEdit(editEvent)}
          />
        ) : null}

        {view === "month" ? (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="grid grid-cols-7 gap-px rounded-lg bg-zinc-800 text-center text-xs font-medium text-zinc-400">
              {IT_DOW_SHORT.map((d) => (
                <div key={d} className="bg-zinc-900 py-2 capitalize">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-px grid grid-cols-7 gap-px bg-zinc-800">
              {cells.map(({ date, inMonth }) => {
                const wend = date.getDay() === 0 || date.getDay() === 6
                const dayEv = eventsForDay(visible, date)
                return (
                  <div
                    key={isoYmd(date)}
                    className={cn(
                      "min-h-[5.5rem] bg-zinc-900/90 p-1.5 text-left sm:min-h-[6.25rem]",
                      !inMonth && "opacity-40",
                      isToday(date) && "ring-1 ring-inset",
                      wend && inMonth && "text-red-300/90"
                    )}
                    style={isToday(date) ? { boxShadow: `inset 0 0 0 1px ${H2.blue}` } : undefined}
                  >
                    <div className="text-sm font-medium text-zinc-200">{date.getDate()}</div>
                    <div className="mt-1 flex max-h-[4.5rem] flex-col gap-0.5 overflow-y-auto">
                      {dayEv.slice(0, 8).map((e) => (
                        <EventPill
                          key={e.id}
                          e={e}
                          staffLabel={staffDisplayFor(e, edits)}
                          note={noteFor(e, edits)}
                          onOpen={() => setEditEvent(e)}
                        />
                      ))}
                      {dayEv.length > 8 ? (
                        <div className="text-[10px] text-zinc-500">+{dayEv.length - 8}…</div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {view === "week" ? (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/40">
            <div className="grid min-w-[780px]" style={{ gridTemplateColumns: "52px repeat(7, minmax(0,1fr))" }}>
              <div className="border-b border-zinc-800 bg-zinc-900/80" />
              {weekDays.map((d, i) => (
                <div
                  key={isoYmd(d)}
                  className={cn(
                    "border-b border-l border-zinc-800 bg-zinc-900/80 px-2 py-2 text-center text-xs font-medium",
                    isToday(d) && "text-[#46A6D9]"
                  )}
                >
                  <div className="uppercase text-zinc-500">{IT_DOW_SHORT[i]}</div>
                  <div className="text-sm text-zinc-200">{d.getDate()}</div>
                </div>
              ))}
              {hours.map((h) => (
                <Fragment key={h}>
                  <div className="border-b border-zinc-800/80 py-1 pr-1 text-right text-[10px] text-zinc-500">
                    {pad2(h)}:00
                  </div>
                  {weekDays.map((d) => {
                    const evs = eventsForDayAndHour(visible, d, h)
                    return (
                      <div
                        key={`${isoYmd(d)}-${h}`}
                        className="min-h-[3.25rem] space-y-0.5 border-b border-l border-zinc-800/60 bg-zinc-950/30 p-0.5 align-top"
                      >
                        {evs.map((e) => (
                          <EventPill
                            key={e.id}
                            e={e}
                            staffLabel={staffDisplayFor(e, edits)}
                            note={noteFor(e, edits)}
                            onOpen={() => setEditEvent(e)}
                          />
                        ))}
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        ) : null}

        {view === "day" ? (
          <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/40">
            <div
              className={cn(
                "border-b border-zinc-800 bg-zinc-900/80 px-4 py-3 text-center text-sm font-medium",
                isToday(dayOnly) && "text-[#46A6D9]"
              )}
            >
              {IT_DOW_SHORT[mondayIndex(dayOnly)]} {pad2(dayOnly.getDate())} {IT_MONTHS[dayOnly.getMonth()]}
            </div>
            <div className="max-h-[75vh] overflow-y-auto">
              {hours.map((h) => {
                const evs = eventsForDayAndHour(visible, dayOnly, h)
                return (
                  <div key={h} className="flex border-b border-zinc-800/70">
                    <div className="w-14 shrink-0 py-2 pr-2 text-right text-xs text-zinc-500">{pad2(h)}:00</div>
                    <div className="min-h-[3.25rem] flex-1 space-y-0.5 border-l border-zinc-800/60 bg-zinc-900/20 p-1">
                      {evs.map((e) => (
                        <EventPill
                          key={e.id}
                          e={e}
                          staffLabel={staffDisplayFor(e, edits)}
                          note={noteFor(e, edits)}
                          onOpen={() => setEditEvent(e)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
