import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@workspace/ui/lib/utils"
import type { CalendarioComparto, CalendarioIstruttore, CalendarioMergedEventDto } from "@/api/calendario"
import { calendarioApi } from "@/api/calendario"
import {
  CALENDARIO_SEGMENTI,
  roleCanReadCalendarioComparto,
  roleCanWriteCalendarioComparto,
  segmentoToApi,
} from "@/pages/calendario-routes"

type CalView = "month" | "week" | "day"
type CalEvent = CalendarioMergedEventDto

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
const H2 = { blue: "#46A6D9", orange: "#F2941B" } as const

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
  { to: "/calendario/sala-fitness", label: "Calendario sala fitness" },
  { to: "/calendario", label: "Piano operativo (hub)" },
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
function filteredPlanningEvents(filters: Record<FilterId, boolean>, all: CalEvent[]): CalEvent[] {
  const layerOn = CAL_FILTERS.some((f) => filters[f.id])
  return all.filter((e) => {
    const planning = e.zona === "terra" || e.zona === "acqua"
    if (!planning) return false
    if (!layerOn) return true
    return filters.corsi
  })
}

const COMPARTI_CALENDARIO_GRID: CalendarioComparto[] = ["corsi", "scuola_nuoto", "acquaticita", "spogliatoi", "piscina"]

function hasPlanningGrid(comparto: CalendarioComparto): boolean {
  return COMPARTI_CALENDARIO_GRID.includes(comparto)
}

function filteredCalendarEvents(
  comparto: CalendarioComparto,
  filters: Record<FilterId, boolean>,
  all: CalEvent[]
): CalEvent[] {
  if (comparto === "corsi") return filteredPlanningEvents(filters, all)
  return all
}
function eventsForDay(events: CalEvent[], d: Date): CalEvent[] {
  const dow = d.getDay()
  return events.filter((e) => e.dow === dow).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}
function eventsForDayAndHour(events: CalEvent[], d: Date, hour: number): CalEvent[] {
  const dow = d.getDay()
  return events.filter((e) => e.dow === dow && hourBucket(e.start) === hour)
}
function noteFor(e: CalEvent): string {
  return String(e.note ?? "").trim()
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
          <Link key={l.to} to={l.to} className="block px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 hover:text-[#46A6D9]">
            {l.label}
          </Link>
        ))}
      </div>
    </details>
  )
}

function pillColClass(e: CalEvent): string {
  if (e.zona === "acqua") return "border-sky-500/40 bg-sky-500/15 text-sky-100"
  if (e.zona === "terra") return "border-amber-500/35 bg-amber-500/10 text-amber-100"
  return "border-cyan-500/35 bg-cyan-500/10 text-cyan-100"
}

function EventPill({
  e,
  staffLabel,
  note,
  onOpen,
  canEdit,
}: {
  e: CalEvent
  staffLabel: string
  note: string
  onOpen: () => void
  canEdit: boolean
}) {
  const col = pillColClass(e)
  return (
    <button
      type="button"
      onClick={() => {
        if (canEdit) onOpen()
      }}
      disabled={!canEdit}
      className={cn(
        "w-full rounded border px-1 py-0.5 text-left text-[10px] leading-tight transition-colors",
        col,
        canEdit ? "cursor-pointer hover:brightness-110" : "cursor-default opacity-90"
      )}
      title={canEdit ? "Clic per modificare istruttore e note" : "Sola lettura"}
    >
      <span className="font-semibold text-zinc-200">{e.start}</span> {e.title}
      <span className="block truncate text-zinc-300">· {staffLabel}</span>
      {note ? <span className="mt-0.5 block truncate text-[9px] text-amber-200/90">{note}</span> : null}
    </button>
  )
}

function EditEventModal({
  event,
  instructors,
  initialInstructorId,
  initialStaffText,
  initialNote,
  onClose,
  onSave,
  onResetExcel,
}: {
  event: CalEvent
  instructors: CalendarioIstruttore[]
  initialInstructorId: string
  initialStaffText: string
  initialNote: string
  onClose: () => void
  onSave: (istruttoreId: string | null, staffText: string, note: string) => void
  onResetExcel: () => void
}) {
  const [istruttoreId, setIstruttoreId] = useState(initialInstructorId)
  const [staffText, setStaffText] = useState(initialStaffText)
  const [note, setNote] = useState(initialNote)

  useEffect(() => {
    setIstruttoreId(initialInstructorId)
    setStaffText(initialStaffText)
    setNote(initialNote)
  }, [event.stableKey, initialInstructorId, initialStaffText, initialNote])

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
          Istruttore (anagrafica)
          <select
            value={istruttoreId}
            onChange={(ev) => setIstruttoreId(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-[#46A6D9]/60 focus:outline-none focus:ring-1 focus:ring-[#46A6D9]/30"
          >
            <option value="">— Nessuno (usa testo sotto) —</option>
            {instructors.map((ins) => (
              <option key={ins.id} value={ins.id}>
                {ins.cognome} {ins.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-xs font-medium text-zinc-400">
          Nome istruttore (testo libero, se non usi anagrafica)
          <input
            value={staffText}
            onChange={(ev) => setStaffText(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#46A6D9]/60 focus:outline-none focus:ring-1 focus:ring-[#46A6D9]/30"
            placeholder={event.staff}
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
            onClick={() => onSave(istruttoreId || null, staffText, note)}
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

function InstructorsPanel({
  rows,
  canManage,
  onRefresh,
}: {
  rows: CalendarioIstruttore[]
  canManage: boolean
  onRefresh: () => void
}) {
  const [nome, setNome] = useState("")
  const [cognome, setCognome] = useState("")
  const [telefono, setTelefono] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await calendarioApi.postInstructor({ nome, cognome, telefono, email })
      setNome("")
      setCognome("")
      setTelefono("")
      setEmail("")
      onRefresh()
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Errore")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm("Eliminare questo istruttore?")) return
    setBusy(true)
    try {
      await calendarioApi.deleteInstructor(id)
      onRefresh()
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Errore")
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) return null

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Anagrafica istruttori (server)</h2>
      <p className="mt-1 text-xs text-zinc-600">Nome, cognome, telefono e email salvati sul server. Usabili nel calendario corsi.</p>
      {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
      <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          value={nome}
          onChange={(ev) => setNome(ev.target.value)}
          placeholder="Nome"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={cognome}
          onChange={(ev) => setCognome(ev.target.value)}
          placeholder="Cognome"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={telefono}
          onChange={(ev) => setTelefono(ev.target.value)}
          placeholder="Telefono"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="Email"
          className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
            style={{ backgroundColor: H2.blue }}
          >
            Aggiungi istruttore
          </button>
        </div>
      </form>
      <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800/80 bg-zinc-950/40 px-2 py-1">
            <span className="truncate text-zinc-300">
              {r.cognome} {r.nome}
              <span className="block truncate text-xs text-zinc-500">
                {r.telefono || "—"} · {r.email || "—"}
              </span>
            </span>
            <button type="button" onClick={() => remove(r.id)} className="shrink-0 text-xs text-red-400 hover:underline" disabled={busy}>
              Elimina
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CalendarioRepartoPage() {
  const { segmento } = useParams<{ segmento: string }>()
  const { role } = useAuth()
  const apiComparto = segmento ? segmentoToApi(segmento) : null

  const [view, setView] = useState<CalView>("month")
  const [cursor, setCursor] = useState(() => new Date())
  const [filters, setFilters] = useState<Record<FilterId, boolean>>(
    () => Object.fromEntries(CAL_FILTERS.map((f) => [f.id, true])) as Record<FilterId, boolean>
  )
  const [events, setEvents] = useState<CalEvent[]>([])
  const [instructors, setInstructors] = useState<CalendarioIstruttore[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [editEvent, setEditEvent] = useState<CalEvent | null>(null)

  const compartoLabel = useMemo(() => CALENDARIO_SEGMENTI.find((x) => x.api === apiComparto)?.label ?? "Calendario", [apiComparto])

  const canRead = apiComparto != null && roleCanReadCalendarioComparto(role, apiComparto)
  const canWrite = apiComparto != null && roleCanWriteCalendarioComparto(role, apiComparto)
  const canManageInstructors = role === "admin" || role === "corsi"

  const reload = useCallback(async () => {
    if (!apiComparto) return
    setLoading(true)
    setLoadErr(null)
    try {
      const data = await calendarioApi.getComparto(apiComparto)
      setEvents(data.events)
      setInstructors(data.instructors)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Errore caricamento")
      setEvents([])
      setInstructors([])
    } finally {
      setLoading(false)
    }
  }, [apiComparto])

  useEffect(() => {
    void reload()
  }, [reload])

  const saveEdit = useCallback(
    async (e: CalEvent, istruttoreId: string | null, staffText: string, noteRaw: string) => {
      if (!apiComparto || !canWrite) return
      const note = noteRaw.trim()
      const staffTrim = staffText.trim()
      try {
        await calendarioApi.patchSlot(apiComparto, {
          stableKey: e.stableKey,
          dow: e.dow,
          start: e.start,
          title: e.title,
          zona: e.zona,
          istruttoreId: istruttoreId || null,
          staffOverride: istruttoreId ? null : staffTrim || null,
          note: note || null,
        })
        await reload()
        setEditEvent(null)
      } catch (err) {
        alert(err instanceof Error ? err.message : "Salvataggio fallito")
      }
    },
    [apiComparto, canWrite, reload]
  )

  const resetEdit = useCallback(
    async (e: CalEvent) => {
      if (!apiComparto || !canWrite) return
      try {
        await calendarioApi.patchSlot(apiComparto, { stableKey: e.stableKey, clear: true })
        await reload()
        setEditEvent(null)
      } catch (err) {
        alert(err instanceof Error ? err.message : "Ripristino fallito")
      }
    },
    [apiComparto, canWrite, reload]
  )

  const visible = useMemo(
    () => (apiComparto ? filteredCalendarEvents(apiComparto, filters, events) : []),
    [apiComparto, filters, events]
  )
  const monthLabel = useMemo(() => `${IT_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`, [cursor])
  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(cursor)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [cursor])
  const dayOnly = useMemo(() => startOfDay(cursor), [cursor])
  const hours = useMemo(() => Array.from({ length: 17 }, (_, i) => i + 6), [])
  const cells = view === "month" ? monthMatrix(cursor) : []

  if (!segmento || !apiComparto) return <Navigate to="/calendario" replace />
  const validSegment = CALENDARIO_SEGMENTI.some((x) => x.segmento === segmento)
  if (!validSegment) return <Navigate to="/calendario" replace />
  if (!canRead) return <Navigate to="/" replace />

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
  const isTodayCell = (d: Date) => isoYmd(d) === isoYmd(today)
  const hubBack = role === "admin" ? "/calendario" : "/"

  return (
    <div className="min-h-full bg-zinc-950 p-4 text-zinc-100 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Piano operativo · {compartoLabel}</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-500">
              {apiComparto === "corsi" ? (
                <>
                  Base orari da planning Excel; modifiche a <strong className="font-medium text-zinc-400">istruttore</strong> e{" "}
                  <strong className="font-medium text-zinc-400">note</strong> salvate sul <strong className="font-medium text-zinc-400">server</strong> (sincronizzate tra utenti).
                </>
              ) : hasPlanningGrid(apiComparto) ? (
                <>
                  Orari da Excel piscina (fogli S.N. Bambini, Acquaticità, Spogliatoi, Bambini estate). Modifiche a{" "}
                  <strong className="font-medium text-zinc-400">staff</strong> e <strong className="font-medium text-zinc-400">note</strong> sul server.
                </>
              ) : (
                <>Calendario reparto: quando importeremo il planning per questo settore, gli slot appariranno qui.</>
              )}
            </p>
            {loadErr ? <p className="mt-2 text-xs text-red-400">{loadErr}</p> : null}
            {loading ? <p className="mt-2 text-xs text-zinc-500">Caricamento…</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {role === "admin" ? (
              <>
                <DropdownNav label="Vendite" links={VENDITE_LINKS} />
                <DropdownNav label="Altri" links={ALTRI_LINKS} />
              </>
            ) : null}
            <Link to={hubBack} className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
              {role === "admin" ? "Hub reparti" : "Home"}
            </Link>
            <Link to="/" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
              Dashboard
            </Link>
          </div>
        </header>

        {hasPlanningGrid(apiComparto) && events.length === 0 && !loading && !loadErr ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {apiComparto === "corsi" ? (
              <>
                Nessun evento dal planning corsi: verifica <code className="text-xs">planning-weekly.json</code> e che l&apos;API legga il file sul server.
              </>
            ) : (
              <>
                Nessun evento per questo comparto: copia <code className="text-xs">PISCINAORARIO…xlsx</code> in{" "}
                <code className="text-xs">apps/web/data/planning-import/piscina-orario-2025-2026.xlsx</code> ed esegui{" "}
                <code className="text-xs">pnpm run build:planning</code> (oppure <code className="text-xs">PISCINA_XLSX</code>).
              </>
            )}
          </p>
        ) : null}

        {!hasPlanningGrid(apiComparto) && !loading ? (
          <p className="rounded-xl border border-zinc-700 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
            Nessun dato planning per questo reparto al momento. Struttura pronta per import futuro.
          </p>
        ) : null}

        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={prev} className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800" aria-label="Periodo precedente">
              ←
            </button>
            <button type="button" onClick={next} className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800" aria-label="Periodo successivo">
              →
            </button>
            <span className="min-w-[10rem] text-center text-sm font-medium capitalize text-zinc-200 sm:text-left">
              {view === "month" && monthLabel}
              {view === "week" &&
                `Settimana ${pad2(weekDays[0]!.getDate())}/${pad2(weekDays[0]!.getMonth() + 1)} – ${pad2(weekDays[6]!.getDate())}/${pad2(weekDays[6]!.getMonth() + 1)} ${weekDays[6]!.getFullYear()}`}
              {view === "day" && `${pad2(dayOnly.getDate())} ${IT_MONTHS[dayOnly.getMonth()]} ${dayOnly.getFullYear()}`}
            </span>
            <button type="button" onClick={goToday} className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-900" style={{ backgroundColor: H2.blue }}>
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
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", view === k ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-200")}
                style={view === k ? { backgroundColor: H2.blue } : undefined}
              >
                {lab}
              </button>
            ))}
          </div>
        </div>

        {hasPlanningGrid(apiComparto) && apiComparto === "corsi" ? (
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
          </section>
        ) : null}

        <InstructorsPanel rows={instructors} canManage={canManageInstructors && apiComparto === "corsi"} onRefresh={() => void reload()} />

        {editEvent && canWrite ? (
          <EditEventModal
            key={editEvent.stableKey}
            event={editEvent}
            instructors={instructors}
            initialInstructorId={editEvent.istruttoreId ?? ""}
            initialStaffText={editEvent.staffOverride ?? ""}
            initialNote={editEvent.note ?? ""}
            onClose={() => setEditEvent(null)}
            onSave={(id, staff, note) => void saveEdit(editEvent, id, staff, note)}
            onResetExcel={() => void resetEdit(editEvent)}
          />
        ) : null}

        {view === "month" && hasPlanningGrid(apiComparto) ? (
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
                      isTodayCell(date) && "ring-1 ring-inset",
                      wend && inMonth && "text-red-300/90"
                    )}
                    style={isTodayCell(date) ? { boxShadow: `inset 0 0 0 1px ${H2.blue}` } : undefined}
                  >
                    <div className="text-sm font-medium text-zinc-200">{date.getDate()}</div>
                    <div className="mt-1 flex max-h-[4.5rem] flex-col gap-0.5 overflow-y-auto">
                      {dayEv.slice(0, 8).map((e) => (
                        <EventPill
                          key={e.id}
                          e={e}
                          staffLabel={e.staffDisplay}
                          note={noteFor(e)}
                          onOpen={() => setEditEvent(e)}
                          canEdit={canWrite}
                        />
                      ))}
                      {dayEv.length > 8 ? <div className="text-[10px] text-zinc-500">+{dayEv.length - 8}…</div> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {view === "week" && hasPlanningGrid(apiComparto) ? (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/40">
            <div className="grid min-w-[780px]" style={{ gridTemplateColumns: "52px repeat(7, minmax(0,1fr))" }}>
              <div className="border-b border-zinc-800 bg-zinc-900/80" />
              {weekDays.map((d, i) => (
                <div
                  key={isoYmd(d)}
                  className={cn("border-b border-l border-zinc-800 bg-zinc-900/80 px-2 py-2 text-center text-xs font-medium", isTodayCell(d) && "text-[#46A6D9]")}
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
                      <div key={`${isoYmd(d)}-${h}`} className="min-h-[3.25rem] space-y-0.5 border-b border-l border-zinc-800/60 bg-zinc-950/30 p-0.5 align-top">
                        {evs.map((e) => (
                          <EventPill
                            key={e.id}
                            e={e}
                            staffLabel={e.staffDisplay}
                            note={noteFor(e)}
                            onOpen={() => setEditEvent(e)}
                            canEdit={canWrite}
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

        {view === "day" && hasPlanningGrid(apiComparto) ? (
          <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/40">
            <div className={cn("border-b border-zinc-800 bg-zinc-900/80 px-4 py-3 text-center text-sm font-medium", isTodayCell(dayOnly) && "text-[#46A6D9]")}>
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
                          staffLabel={e.staffDisplay}
                          note={noteFor(e)}
                          onOpen={() => setEditEvent(e)}
                          canEdit={canWrite}
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
