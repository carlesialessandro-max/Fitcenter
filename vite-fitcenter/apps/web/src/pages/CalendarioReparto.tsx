import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@workspace/ui/lib/utils"
import type { CalendarioComparto, CalendarioIstruttore, CalendarioMergedEventDto } from "@/api/calendario"
import { calendarioApi } from "@/api/calendario"
import { CalendarioInviaTurniModal } from "@/components/CalendarioInviaTurniModal"
import { CalendarioTurnazioniModal } from "@/components/CalendarioTurnazioniModal"
import { InstructorSearchSelect } from "@/components/InstructorSearchSelect"
import { staffColorKey, staffPillClasses } from "@/lib/staff-colors"
import {
  compartoIsManualServer,
  compartoIsServerSeeded,
  eventMatchesCalendarDay,
  MANUAL_SERVER_COMPARTI,
} from "@/lib/calendario-manual"
import {
  compartoUsesShiftRange,
  defaultActivityForShiftComparto,
  defaultZonaForShiftComparto,
} from "@/lib/calendario-shift"

type ManualSlotComparto = (typeof MANUAL_SERVER_COMPARTI)[number]
type CourseLikeComparto = "corsi" | "scuola_nuoto"
type CreateSlotComparto = CourseLikeComparto | ManualSlotComparto
import {
  addHoursToHm,
  buildShiftTitle,
  eventTimeRange,
  shiftEventInHour,
} from "@/lib/reception-shift"
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
const H2 = { blue: "#46A6D9" } as const

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
  { to: "/calendario/istruttori", label: "Istruttori" },
  { to: "/calendario/reception", label: "Calendario reception" },
  { to: "/calendario", label: "Piano operativo (hub)" },
]

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((x) => Number(x))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}
function hourBucket(hm: string): number {
  return Math.floor(hmToMinutes(hm) / 60)
}

const COMPARTI_CALENDARIO_GRID: CalendarioComparto[] = [
  "corsi",
  "scuola_nuoto",
  "acquaticita",
  "spogliatoi",
  "piscina",
  "reception",
  "sala_fitness",
]

function hasPlanningGrid(comparto: CalendarioComparto): boolean {
  return COMPARTI_CALENDARIO_GRID.includes(comparto)
}
function eventsForDay(events: CalEvent[], d: Date): CalEvent[] {
  return events
    .filter((e) => eventMatchesCalendarDay(e, d))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}
function eventsForDayAndHour(events: CalEvent[], d: Date, hour: number, shiftRangeGrid?: boolean): CalEvent[] {
  return eventsForDay(events, d).filter((e) =>
    shiftRangeGrid ? shiftEventInHour(e, hour) : hourBucket(e.start) === hour
  )
}
function noteFor(e: CalEvent): string {
  return String(e.note ?? "").trim()
}

function shiftPillLine(e: CalEvent): string {
  const { start, end } = eventTimeRange(e)
  return `${start}–${end}`
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

function pillColClass(e: CalEvent, colorByStaff?: boolean): string {
  if (colorByStaff) {
    const key = staffColorKey(e)
    if (key !== "unknown") return staffPillClasses(key)
  }
  if (e.zona === "acqua") return "border-sky-500/40 bg-sky-500/15 text-sky-100"
  if (e.zona === "terra") return "border-amber-500/35 bg-amber-500/10 text-amber-100"
  if (e.zona === "invernale") return "border-violet-500/40 bg-violet-500/15 text-violet-100"
  if (e.zona === "interna") return "border-sky-400/45 bg-slate-900/80 text-sky-50"
  if (e.zona === "esterna") return "border-amber-400/50 bg-amber-950/40 text-amber-50"
  if (e.zona === "reception") return "border-emerald-500/35 bg-emerald-950/30 text-emerald-100"
  if (e.zona === "sala_fitness") return "border-orange-500/35 bg-orange-950/25 text-orange-100"
  return "border-cyan-500/35 bg-cyan-500/10 text-cyan-100"
}

function EventPill({
  e,
  staffLabel,
  note,
  onOpen,
  canEdit,
  receptionContinuation,
  showShiftLine,
  overlapCompact,
  colorByStaff,
}: {
  e: CalEvent
  staffLabel: string
  note: string
  onOpen: () => void
  canEdit: boolean
  receptionContinuation?: boolean
  showShiftLine?: boolean
  /** Turni sovrapposti nella stessa ora: pillola compatta affiancata */
  overlapCompact?: boolean
  colorByStaff?: boolean
}) {
  const col = pillColClass(e, colorByStaff)
  if (overlapCompact) {
    return (
      <button
        type="button"
        onClick={() => {
          if (canEdit) onOpen()
        }}
        disabled={!canEdit}
        className={cn(
          "min-w-0 flex-1 rounded border px-0.5 py-0.5 text-left text-[9px] leading-tight",
          col,
          canEdit ? "cursor-pointer hover:brightness-110" : "cursor-default opacity-90"
        )}
        title={canEdit ? "Clic per modificare" : "Sola lettura"}
      >
        <span className="block truncate font-semibold text-zinc-200">{shiftPillLine(e)}</span>
        <span className="block truncate text-zinc-300">{staffLabel}</span>
      </button>
    )
  }
  if (receptionContinuation) {
    return (
      <button
        type="button"
        onClick={() => {
          if (canEdit) onOpen()
        }}
        disabled={!canEdit}
        className={cn("mt-0.5 block h-2 w-full rounded-sm border opacity-80", col, canEdit && "cursor-pointer hover:brightness-110")}
        title={canEdit ? "Turno in corso — clic per modificare" : "Sola lettura"}
        aria-label="Continuazione turno reception"
      />
    )
  }
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
      {showShiftLine ? (
        <>
          <span className="font-semibold text-zinc-200">{shiftPillLine(e)}</span>
          <span className="block truncate text-zinc-300">· {staffLabel}</span>
        </>
      ) : (
        <>
          <span className="font-semibold text-zinc-200">{e.start}</span> {e.title}
          <span className="block truncate text-zinc-300">· {staffLabel}</span>
        </>
      )}
      {note ? <span className="mt-0.5 block truncate text-[9px] text-amber-200/90">{note}</span> : null}
    </button>
  )
}

const DOW_OPTIONS: { v: number; label: string }[] = [
  { v: 1, label: "Lunedì" },
  { v: 2, label: "Martedì" },
  { v: 3, label: "Mercoledì" },
  { v: 4, label: "Giovedì" },
  { v: 5, label: "Venerdì" },
  { v: 6, label: "Sabato" },
  { v: 0, label: "Domenica" },
]

const PISCINA_ZONE_PRESETS = ["invernale", "interna", "esterna", "piscina"] as const

function PiscinaZonaEditor({ value, onChange }: { value: string; onChange: (z: string) => void }) {
  const presets = PISCINA_ZONE_PRESETS as readonly string[]
  const sel = presets.includes(value) ? value : "other"
  return (
    <div className="space-y-2 sm:col-span-2">
      <label className="block text-xs font-medium text-zinc-400">
        Piscina / periodo
        <select
          className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          value={sel}
          onChange={(e) => {
            const v = e.target.value
            if (v === "other") {
              onChange(presets.includes(value) ? "" : value)
            } else {
              onChange(v)
            }
          }}
        >
          <option value="invernale">Invernale (un planning)</option>
          <option value="interna">Estivo · piscina interna</option>
          <option value="esterna">Estivo · piscina esterna</option>
          <option value="piscina">Altro · zona «piscina»</option>
          <option value="other">Altra zona (slug)</option>
        </select>
      </label>
      {sel === "other" ? (
        <label className="block text-xs font-medium text-zinc-400">
          Slug zona (come nel planning Excel)
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            placeholder="es. acquaticita"
            autoComplete="off"
          />
        </label>
      ) : null}
    </div>
  )
}

type ScheduleEditMode = "none" | "corsi" | ManualSlotComparto

function EditEventModal({
  event,
  instructors,
  initialInstructorId,
  initialStaffText,
  initialNote,
  scheduleMode,
  onClose,
  onSave,
  onClearRevision,
  onHideFromCalendar,
}: {
  event: CalEvent
  instructors: CalendarioIstruttore[]
  initialInstructorId: string
  initialStaffText: string
  initialNote: string
  scheduleMode: ScheduleEditMode
  onClose: () => void
  onSave: (p: {
    istruttoreId: string | null
    staffText: string
    note: string
    dow: number
    start: string
    title: string
    zona: string
  }) => void
  onClearRevision: () => void
  onHideFromCalendar?: () => void
}) {
  const [istruttoreId, setIstruttoreId] = useState(initialInstructorId)
  const [staffText, setStaffText] = useState(initialStaffText)
  const [note, setNote] = useState(initialNote)
  const [dow, setDow] = useState(event.dow)
  const [start, setStart] = useState(event.start)
  const isShiftRangeMode = scheduleMode !== "corsi" && scheduleMode !== "none"
  const shiftComparto = scheduleMode !== "none" && scheduleMode !== "corsi" ? scheduleMode : null
  const initialShift =
    isShiftRangeMode && shiftComparto
      ? (() => {
          const r = eventTimeRange(event)
          const act = event.title.includes("·") ? event.title.split("·")[0].trim() : defaultActivityForShiftComparto(shiftComparto)
          return { activity: act || defaultActivityForShiftComparto(shiftComparto), end: r.end }
        })()
      : null
  const [end, setEnd] = useState(initialShift?.end ?? "14:00")
  const [activity, setActivity] = useState(initialShift?.activity ?? "Sportello")
  const [title, setTitle] = useState(event.title)
  const [zona, setZona] = useState<string>(() =>
    scheduleMode === "corsi"
      ? event.zona === "acqua" || event.zona === "terra"
        ? event.zona
        : "terra"
      : shiftComparto
        ? event.zona || defaultZonaForShiftComparto(shiftComparto)
        : event.zona
  )

  useEffect(() => {
    setIstruttoreId(initialInstructorId)
    setStaffText(initialStaffText)
    setNote(initialNote)
    setDow(event.dow)
    setStart(event.start)
    setTitle(event.title)
    if (isShiftRangeMode && shiftComparto) {
      const r = eventTimeRange(event)
      setEnd(r.end)
      setActivity(
        event.title.includes("·")
          ? event.title.split("·")[0].trim() || defaultActivityForShiftComparto(shiftComparto)
          : defaultActivityForShiftComparto(shiftComparto)
      )
    }
    if (scheduleMode === "corsi") {
      setZona(event.zona === "acqua" || event.zona === "terra" ? event.zona : "terra")
    } else if (shiftComparto) {
      setZona(event.zona || defaultZonaForShiftComparto(shiftComparto))
    } else {
      setZona(event.zona)
    }
  }, [event.stableKey, event.dow, event.start, event.title, event.zona, initialInstructorId, initialStaffText, initialNote, scheduleMode, shiftComparto])

  const presets = ["Sostituzione", "Malattia", "Ferie", "Assente"]
  const isManual = event.stableKey.startsWith("manual-")
  const zonaLabel = event.zona === "acqua" ? "Acqua" : event.zona === "terra" ? "Terra" : event.zona
  const scheduleFields = scheduleMode !== "none"

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="Chiudi" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-zinc-100">{scheduleFields ? title : event.title}</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {scheduleMode === "corsi"
            ? `${start} · ${zona === "acqua" ? "Acqua" : "Terra"} · ${event.sheet}`
            : isShiftRangeMode
              ? `${start} · ${zona} · ${event.sheet}`
              : `${event.start} · ${zonaLabel} · ${event.sheet}`}
        </p>
        {scheduleFields ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-400 sm:col-span-2">
              Giorno
              <select
                value={dow}
                onChange={(ev) => setDow(Number(ev.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-[#46A6D9]/60 focus:outline-none focus:ring-1 focus:ring-[#46A6D9]/30"
              >
                {DOW_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {isShiftRangeMode ? (
              <>
                <label className="block text-xs font-medium text-zinc-400">
                  Dalle (HH:mm)
                  <input
                    value={start}
                    onChange={(ev) => setStart(ev.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    placeholder="08:00"
                    autoComplete="off"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-400">
                  Alle (HH:mm)
                  <input
                    value={end}
                    onChange={(ev) => setEnd(ev.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    placeholder="14:00"
                    autoComplete="off"
                  />
                </label>
              </>
            ) : (
              <label className="block text-xs font-medium text-zinc-400 sm:col-span-2">
                Inizio (HH:mm)
                <input
                  value={start}
                  onChange={(ev) => setStart(ev.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  placeholder="09:00"
                  autoComplete="off"
                />
              </label>
            )}
            {scheduleMode === "corsi" ? (
              <label className="block text-xs font-medium text-zinc-400">
                Zona
                <select
                  value={zona}
                  onChange={(ev) => setZona(ev.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="terra">Terra</option>
                  <option value="acqua">Acqua</option>
                </select>
              </label>
            ) : scheduleMode === "piscina" ? (
              <PiscinaZonaEditor value={zona} onChange={setZona} />
            ) : (
              <label className="block text-xs font-medium text-zinc-400 sm:col-span-2">
                Zona (slug)
                <input
                  value={zona}
                  onChange={(ev) => setZona(ev.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  placeholder={scheduleMode === "sala_fitness" ? "sala_fitness" : "reception"}
                  autoComplete="off"
                />
              </label>
            )}
            <label className="block text-xs font-medium text-zinc-400 sm:col-span-2">
              {scheduleMode === "corsi" ? "Titolo corso" : "Attività (es. Sportello, Copertura, Turno sala)"}
              <input
                value={isShiftRangeMode ? activity : title}
                onChange={(ev) => (isShiftRangeMode ? setActivity(ev.target.value) : setTitle(ev.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                autoComplete="off"
              />
            </label>
            {scheduleMode === "piscina" ? (
              <p className="text-[10px] text-zinc-500 sm:col-span-2">
                In <strong className="font-medium text-zinc-400">estate</strong> con due vasche usa le zone{" "}
                <code className="text-zinc-400">interna</code> e <code className="text-zinc-400">esterna</code>; in inverno resta{" "}
                <code className="text-zinc-400">invernale</code> (import Excel).
              </p>
            ) : isShiftRangeMode ? (
              <p className="text-[10px] text-zinc-500 sm:col-span-2">
                Fascia oraria (es. 08:00–14:00). Salvataggio sul server; il build non usa più Excel per questo reparto.
              </p>
            ) : null}
          </div>
        ) : null}
        <label className="mt-4 block text-xs font-medium text-zinc-400">
          Istruttore (anagrafica)
          <InstructorSearchSelect
            className="mt-1"
            instructors={instructors}
            value={istruttoreId}
            onChange={setIstruttoreId}
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-zinc-400">
          Staff / nome in calendario (testo libero)
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
          <div className="mr-auto flex flex-wrap gap-2">
            {scheduleFields && !isManual && onHideFromCalendar ? (
              <button
                type="button"
                onClick={onHideFromCalendar}
                className="rounded-lg border border-amber-600/50 px-3 py-2 text-xs text-amber-200 hover:bg-amber-950/40"
              >
                Nascondi dal calendario
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClearRevision}
              className="rounded-lg border border-zinc-600 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {isManual
                ? scheduleMode === "corsi"
                  ? "Elimina corso"
                  : isShiftRangeMode
                    ? "Elimina slot"
                    : "Elimina"
                : "Ripristina da Excel"}
            </button>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
            Annulla
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                istruttoreId: istruttoreId || null,
                staffText,
                note,
                dow: scheduleFields ? dow : event.dow,
                start: scheduleFields ? start.trim() : event.start,
                title: scheduleFields
                  ? isShiftRangeMode && shiftComparto
                    ? buildShiftTitle(activity, start.trim(), end.trim())
                    : title.trim()
                  : event.title,
                zona:
                  scheduleMode === "corsi"
                    ? zona === "acqua" || zona === "terra"
                      ? zona
                      : "terra"
                    : scheduleMode === "piscina"
                      ? zona.trim() || "invernale"
                      : scheduleMode === "reception"
                        ? zona.trim() || "reception"
                        : scheduleMode === "sala_fitness"
                          ? zona.trim() || "sala_fitness"
                          : event.zona,
              })
            }
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

function CreateSlotModal({
  comparto,
  instructors,
  calendarDate,
  onClose,
  onCreated,
}: {
  comparto: CreateSlotComparto
  instructors: CalendarioIstruttore[]
  /** Giorno di calendario per cui creare lo slot (solo quel giorno/settimana). */
  calendarDate: Date
  onClose: () => void
  onCreated: () => void
}) {
  const isCorsiLike = comparto === "corsi" || comparto === "scuola_nuoto"
  const isShiftRange = !isCorsiLike
  const shiftComparto = isShiftRange ? comparto : "piscina"
  const dateIso = isoYmd(calendarDate)
  const [dow, setDow] = useState(() => calendarDate.getDay())
  const [start, setStart] = useState(isShiftRange ? "08:00" : "09:00")
  const [end, setEnd] = useState(isShiftRange ? "14:00" : "10:00")
  const [activity, setActivity] = useState(isCorsiLike ? "" : defaultActivityForShiftComparto(shiftComparto))
  const [title, setTitle] = useState(isCorsiLike ? "" : defaultActivityForShiftComparto(shiftComparto))
  const [zona, setZona] = useState<string>(
    comparto === "scuola_nuoto" ? "scuola_nuoto" : isCorsiLike ? "terra" : defaultZonaForShiftComparto(shiftComparto)
  )
  const [istruttoreId, setIstruttoreId] = useState("")
  const [staffText, setStaffText] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const tit = isShiftRange
      ? buildShiftTitle(activity, start.trim(), end.trim())
      : (title.trim() || (isCorsiLike ? "" : "Copertura")).trim()
    if (!tit) {
      alert(isShiftRange ? "Controlla orari e attività" : "Titolo obbligatorio")
      return
    }
    if (!istruttoreId.trim() && !staffText.trim()) {
      alert("Scegli un istruttore dall'anagrafica oppure inserisci il nome in calendario")
      return
    }
    setBusy(true)
    try {
      const zonaOut = isCorsiLike
        ? comparto === "scuola_nuoto"
          ? "scuola_nuoto"
          : zona === "terra" || zona === "acqua"
            ? zona
            : "terra"
        : isShiftRange
          ? zona.trim() || defaultZonaForShiftComparto(shiftComparto)
          : zona.trim() || "invernale"
      await calendarioApi.patchSlot(comparto, {
        create: true,
        dow,
        dateIso: isCorsiLike ? null : dateIso,
        start: start.trim(),
        title: tit,
        zona: zonaOut,
        istruttoreId: istruttoreId || null,
        staffOverride: istruttoreId ? null : staffText.trim() || null,
        note: note.trim() || null,
      })
      onCreated()
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Errore")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="Chiudi" />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold text-zinc-100">
          {comparto === "scuola_nuoto"
            ? "Nuova lezione"
            : isCorsiLike
            ? "Nuovo corso"
            : comparto === "sala_fitness"
              ? "Nuovo turno sala fitness"
              : comparto === "reception"
                ? "Nuovo slot reception"
                : "Nuovo turno (bagnini)"}
        </h2>
        <p className="text-xs text-zinc-500">
          {comparto === "scuola_nuoto"
            ? "Lezione settimanale salvata sul server (stesso giorno ogni settimana)."
            : isCorsiLike
            ? "Slot manuale sul planning corsi (terra/acqua)."
            : `Turno per il giorno ${dateIso} (salvato sul server; non si ripete sulle altre settimane).`}
        </p>
        {isCorsiLike ? (
          <label className="block text-xs font-medium text-zinc-400">
            Giorno
            <select
              value={dow}
              onChange={(ev) => setDow(Number(ev.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              {DOW_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-zinc-300">
            Data: <span className="font-medium text-zinc-100">{dateIso}</span>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {isShiftRange ? (
            <>
              <label className="block text-xs font-medium text-zinc-400">
                Dalle (HH:mm)
                <input
                  value={start}
                  onChange={(ev) => {
                    const v = ev.target.value
                    setStart(v)
                    if (!end || end <= v) setEnd(addHoursToHm(v, 6))
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  placeholder="08:00"
                />
              </label>
              <label className="block text-xs font-medium text-zinc-400">
                Alle (HH:mm)
                <input
                  value={end}
                  onChange={(ev) => setEnd(ev.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  placeholder="14:00"
                />
              </label>
            </>
          ) : (
            <label className="block text-xs font-medium text-zinc-400 sm:col-span-2">
              Inizio (HH:mm)
              <input
                value={start}
                onChange={(ev) => setStart(ev.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
            </label>
          )}
          {comparto === "corsi" ? (
            <label className="block text-xs font-medium text-zinc-400 sm:col-span-2">
              Zona
              <select
                value={zona}
                onChange={(ev) => setZona(ev.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="terra">Terra</option>
                <option value="acqua">Acqua</option>
              </select>
            </label>
          ) : null}
        </div>
        {!isCorsiLike ? (
          comparto === "piscina" ? (
            <PiscinaZonaEditor value={zona} onChange={setZona} />
          ) : (
            <label className="block text-xs font-medium text-zinc-400">
              Zona (slug)
              <input
                value={zona}
                onChange={(ev) => setZona(ev.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                placeholder={defaultZonaForShiftComparto(shiftComparto)}
              />
            </label>
          )
        ) : null}
        {!isShiftRange ? (
          <label className="block text-xs font-medium text-zinc-400">
            {comparto === "scuola_nuoto" ? "Titolo lezione" : comparto === "corsi" ? "Titolo" : "Titolo / attività"}
            <input value={title} onChange={(ev) => setTitle(ev.target.value)} className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </label>
        ) : (
          <label className="block text-xs font-medium text-zinc-400">
            Attività (es. Sportello, Copertura, Turno sala)
            <input value={activity} onChange={(ev) => setActivity(ev.target.value)} className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </label>
        )}
        <label className="block text-xs font-medium text-zinc-400">
          Istruttore (anagrafica)
          <InstructorSearchSelect className="mt-1" instructors={instructors} value={istruttoreId} onChange={setIstruttoreId} />
        </label>
        <label className="block text-xs font-medium text-zinc-400">
          Nome in calendario (se senza anagrafica)
          <input value={staffText} onChange={(ev) => setStaffText(ev.target.value)} className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
        </label>
        <label className="block text-xs font-medium text-zinc-400">
          Note
          <input value={note} onChange={(ev) => setNote(ev.target.value)} className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
            Annulla
          </button>
          <button type="submit" disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50" style={{ backgroundColor: H2.blue }}>
            Aggiungi
          </button>
        </div>
      </form>
    </div>
  )
}

export function CalendarioRepartoPage() {
  const { segmento } = useParams<{ segmento: string }>()
  const { role } = useAuth()
  const apiComparto = segmento ? segmentoToApi(segmento) : null

  const [view, setView] = useState<CalView>("month")
  const [cursor, setCursor] = useState(() => new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [instructors, setInstructors] = useState<CalendarioIstruttore[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [editEvent, setEditEvent] = useState<CalEvent | null>(null)
  const [editCalendarDate, setEditCalendarDate] = useState<string | null>(null)
  const [createSlotComparto, setCreateSlotComparto] = useState<null | CreateSlotComparto>(null)
  const [turnazioniOpen, setTurnazioniOpen] = useState(false)
  const [inviaTurniOpen, setInviaTurniOpen] = useState(false)

  const compartoLabel = useMemo(() => CALENDARIO_SEGMENTI.find((x) => x.api === apiComparto)?.label ?? "Calendario", [apiComparto])

  const canRead = apiComparto != null && roleCanReadCalendarioComparto(role, apiComparto)
  const canWrite = apiComparto != null && roleCanWriteCalendarioComparto(role, apiComparto)
  const scheduleMode: ScheduleEditMode =
    apiComparto === "corsi" || apiComparto === "scuola_nuoto"
      ? "corsi"
      : apiComparto && compartoIsManualServer(apiComparto)
        ? apiComparto
        : "none"
  const canOpenInstructors =
    role === "admin" ||
    role === "corsi" ||
    role === "operatore" ||
    role === "firme" ||
    role === "istruttore" ||
    role === "scuola_nuoto" ||
    role === "bagnini" ||
    role === "danza" ||
    role === "campus"
  const shiftRangeGrid = compartoUsesShiftRange(apiComparto)

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
    async (
      e: CalEvent,
      p: { istruttoreId: string | null; staffText: string; note: string; dow: number; start: string; title: string; zona: string }
    ) => {
      if (!apiComparto || !canWrite) return
      const staffTrim = p.staffText.trim()
      const noteTrim = p.note.trim()
      try {
        const dateIso =
          compartoIsManualServer(apiComparto) && editCalendarDate
            ? editCalendarDate
            : compartoIsManualServer(apiComparto)
              ? e.dateIso ?? editCalendarDate
              : undefined
        await calendarioApi.patchSlot(apiComparto, {
          stableKey: e.stableKey,
          dow: p.dow,
          dateIso: dateIso ?? null,
          start: p.start,
          title: p.title,
          zona: p.zona,
          istruttoreId: p.istruttoreId || null,
          staffOverride: p.istruttoreId ? null : staffTrim || null,
          note: noteTrim || null,
        })
        await reload()
        setEditEvent(null)
        setEditCalendarDate(null)
      } catch (err) {
        alert(err instanceof Error ? err.message : "Salvataggio fallito")
      }
    },
    [apiComparto, canWrite, reload, editCalendarDate]
  )

  const resetEdit = useCallback(
    async (e: CalEvent) => {
      if (!apiComparto || !canWrite) return
      try {
        await calendarioApi.patchSlot(apiComparto, { stableKey: e.stableKey, clear: true })
        await reload()
        setEditEvent(null)
        setEditCalendarDate(null)
      } catch (err) {
        alert(err instanceof Error ? err.message : "Ripristino fallito")
      }
    },
    [apiComparto, canWrite, reload]
  )

  const hideSlot = useCallback(
    async (e: CalEvent) => {
      if (!apiComparto || !canWrite) return
      if (compartoIsManualServer(apiComparto) && e.stableKey.startsWith("manual-")) {
        try {
          await calendarioApi.patchSlot(apiComparto, { stableKey: e.stableKey, clear: true })
          await reload()
          setEditEvent(null)
        } catch (err) {
          alert(err instanceof Error ? err.message : "Operazione fallita")
        }
        return
      }
      if (apiComparto !== "corsi" && !compartoIsServerSeeded(apiComparto)) return
      try {
        await calendarioApi.patchSlot(apiComparto, { stableKey: e.stableKey, removed: true })
        await reload()
        setEditEvent(null)
      } catch (err) {
        alert(err instanceof Error ? err.message : "Operazione fallita")
      }
    },
    [apiComparto, canWrite, reload]
  )

  const monthLabel = useMemo(() => `${IT_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`, [cursor])
  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(cursor)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [cursor])
  const dayOnly = useMemo(() => startOfDay(cursor), [cursor])
  const slotAnchorDate = useMemo(() => (view === "day" ? dayOnly : startOfDay(cursor)), [view, dayOnly, cursor])
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
                  Base orari da planning; puoi <strong className="font-medium text-zinc-400">spostare</strong>,{" "}
                  <strong className="font-medium text-zinc-400">rinominare</strong>, <strong className="font-medium text-zinc-400">nascondere</strong> o{" "}
                  <strong className="font-medium text-zinc-400">aggiungere</strong> corsi. Istruttori e note sul{" "}
                  <strong className="font-medium text-zinc-400">server</strong>.
                </>
              ) : apiComparto === "scuola_nuoto" ? (
                <>
                  Calendario sul <strong className="font-medium text-zinc-400">server</strong> (import iniziale da{" "}
                  <strong className="font-medium text-zinc-400">PISCINAORARIO</strong>, foglio S.N. Bambini): modifica, aggiungi o
                  nascondi lezioni online.
                </>
              ) : compartoIsManualServer(apiComparto) ? (
                <>
                  Calendario <strong className="font-medium text-zinc-400">{compartoLabel}</strong>:{" "}
                  <strong className="font-medium text-zinc-400">Aggiungi slot</strong> nel giorno o nella settimana che stai guardando (fascia oraria + istruttore). Le modifiche valgono{" "}
                  <strong className="font-medium text-zinc-400">solo per quel giorno</strong>, non per tutte le settimane. Tutto salvato sul server.
                  {apiComparto === "piscina" ? (
                    <>
                      {" "}
                      Zone: <code className="text-xs text-zinc-400">invernale</code>, <code className="text-xs text-zinc-400">interna</code>,{" "}
                      <code className="text-xs text-zinc-400">esterna</code>.
                    </>
                  ) : null}
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
            {canOpenInstructors ? (
              <Link to="/calendario/istruttori" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Istruttori
              </Link>
            ) : null}
          </div>
        </header>

        {hasPlanningGrid(apiComparto) && events.length === 0 && !loading && !loadErr ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {apiComparto === "corsi" ? (
              <>
                Nessun corso: verifica <code className="text-xs">planning-weekly.json</code> sul server.
              </>
            ) : apiComparto === "scuola_nuoto" ? (
              <>
                Nessuna lezione. Import PISCINAORARIO (una tantum):{" "}
                <code className="text-xs">cd apps/api && pnpm run import:scuola-nuoto</code>
                {" "}(opz. <code className="text-xs">--from-xlsx</code>).
              </>
            ) : compartoIsManualServer(apiComparto) ? (
              <>
                Nessuno slot in questo periodo: vai alla settimana/giorno desiderato e usa{" "}
                <strong className="font-medium text-amber-200/90">Aggiungi slot</strong>. I turni restano salvati sul server.
              </>
            ) : null}
          </p>
        ) : null}

        {!hasPlanningGrid(apiComparto) && !loading ? (
          <p className="rounded-xl border border-zinc-700 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
            Nessun dato planning per questo reparto al momento. Struttura pronta per import futuro.
          </p>
        ) : null}

        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={prev} className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800" aria-label="Periodo precedente">
              ←
            </button>
            <button type="button" onClick={next} className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800" aria-label="Periodo successivo">
              →
            </button>
            <span className="min-w-0 flex-1 text-center text-sm font-medium capitalize text-zinc-200 sm:min-w-[10rem] sm:flex-none sm:text-left">
              {view === "month" && monthLabel}
              {view === "week" &&
                `Settimana ${pad2(weekDays[0]!.getDate())}/${pad2(weekDays[0]!.getMonth() + 1)} – ${pad2(weekDays[6]!.getDate())}/${pad2(weekDays[6]!.getMonth() + 1)} ${weekDays[6]!.getFullYear()}`}
              {view === "day" && `${pad2(dayOnly.getDate())} ${IT_MONTHS[dayOnly.getMonth()]} ${dayOnly.getFullYear()}`}
            </span>
            <button type="button" onClick={goToday} className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-900" style={{ backgroundColor: H2.blue }}>
              Oggi
            </button>
          </div>
          <div className="grid w-full grid-cols-3 gap-1">
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
                  "rounded-md px-2 py-2 text-center text-sm font-medium transition-colors",
                  view === k ? "text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:text-zinc-200"
                )}
                style={view === k ? { backgroundColor: H2.blue } : undefined}
              >
                {lab}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasPlanningGrid(apiComparto) && events.length > 0 ? (
              <button
                type="button"
                onClick={() => setTurnazioniOpen(true)}
                className="rounded-lg border border-[#46A6D9]/40 bg-[#46A6D9]/10 px-3 py-1.5 text-sm font-medium text-[#46A6D9] hover:bg-[#46A6D9]/20"
              >
                Turnazioni
              </button>
            ) : null}
            {apiComparto === "piscina" && canWrite ? (
              <button
                type="button"
                onClick={() => setInviaTurniOpen(true)}
                className="rounded-lg border border-emerald-600/40 bg-emerald-950/30 px-3 py-1.5 text-sm font-medium text-emerald-200 hover:bg-emerald-950/50"
              >
                Invia turni email
              </button>
            ) : null}
            {scheduleMode !== "none" && canWrite ? (
              <button
                type="button"
                onClick={() =>
                  setCreateSlotComparto(
                    apiComparto === "corsi" || apiComparto === "scuola_nuoto" ? apiComparto : scheduleMode
                  )
                }
                className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                {scheduleMode === "corsi"
                  ? apiComparto === "scuola_nuoto"
                    ? "Aggiungi lezione"
                    : "Aggiungi corso"
                  : scheduleMode === "sala_fitness"
                    ? "Aggiungi turno sala"
                    : scheduleMode === "piscina"
                      ? "Aggiungi turno"
                      : "Aggiungi slot"}
              </button>
            ) : null}
          </div>
        </div>

        {createSlotComparto && canWrite ? (
          <CreateSlotModal
            comparto={createSlotComparto}
            instructors={instructors}
            calendarDate={slotAnchorDate}
            onClose={() => setCreateSlotComparto(null)}
            onCreated={() => void reload()}
          />
        ) : null}

        {editEvent && canWrite ? (
          <EditEventModal
            key={editEvent.stableKey}
            event={editEvent}
            instructors={instructors}
            initialInstructorId={editEvent.istruttoreId ?? ""}
            initialStaffText={editEvent.staffOverride ?? ""}
            initialNote={editEvent.note ?? ""}
            scheduleMode={scheduleMode}
            onClose={() => {
              setEditEvent(null)
              setEditCalendarDate(null)
            }}
            onSave={(p) => void saveEdit(editEvent, p)}
            onClearRevision={() => void resetEdit(editEvent)}
            onHideFromCalendar={scheduleMode !== "none" ? () => void hideSlot(editEvent) : undefined}
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
                const dayEv = eventsForDay(events, date)
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
                          onOpen={() => {
                            setEditCalendarDate(isoYmd(date))
                            setEditEvent(e)
                          }}
                          canEdit={canWrite}
                          showShiftLine={shiftRangeGrid}
                          colorByStaff={shiftRangeGrid}
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
                    const evs = eventsForDayAndHour(events, d, h, shiftRangeGrid)
                    const overlapHour = shiftRangeGrid && evs.length > 1
                    return (
                      <div
                        key={`${isoYmd(d)}-${h}`}
                        className={cn(
                          "min-h-[3.25rem] border-b border-l border-zinc-800/60 bg-zinc-950/30 p-0.5 align-top",
                          overlapHour ? "flex gap-0.5" : "space-y-0.5"
                        )}
                      >
                        {evs.map((e) => {
                          const shiftStart = shiftRangeGrid ? hourBucket(eventTimeRange(e).start) === h : true
                          return (
                            <EventPill
                              key={e.id}
                              e={e}
                              staffLabel={e.staffDisplay}
                              note={noteFor(e)}
                              onOpen={() => {
                                setEditCalendarDate(isoYmd(d))
                                setEditEvent(e)
                              }}
                              canEdit={canWrite}
                              showShiftLine={shiftRangeGrid}
                              colorByStaff={shiftRangeGrid}
                              overlapCompact={overlapHour}
                              receptionContinuation={shiftRangeGrid && !overlapHour && !shiftStart}
                            />
                          )
                        })}
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
                const evs = eventsForDayAndHour(events, dayOnly, h, shiftRangeGrid)
                const overlapHour = shiftRangeGrid && evs.length > 1
                return (
                  <div key={h} className="flex border-b border-zinc-800/70">
                    <div className="w-14 shrink-0 py-2 pr-2 text-right text-xs text-zinc-500">{pad2(h)}:00</div>
                    <div
                      className={cn(
                        "min-h-[3.25rem] flex-1 border-l border-zinc-800/60 bg-zinc-900/20 p-1",
                        overlapHour ? "flex gap-0.5" : "space-y-0.5"
                      )}
                    >
                      {evs.map((e) => {
                        const shiftStart = shiftRangeGrid ? hourBucket(eventTimeRange(e).start) === h : true
                        return (
                          <EventPill
                            key={e.id}
                            e={e}
                            staffLabel={e.staffDisplay}
                            note={noteFor(e)}
                            onOpen={() => {
                              setEditCalendarDate(isoYmd(dayOnly))
                              setEditEvent(e)
                            }}
                            canEdit={canWrite}
                            showShiftLine={shiftRangeGrid}
                            colorByStaff={shiftRangeGrid}
                            overlapCompact={overlapHour}
                            receptionContinuation={shiftRangeGrid && !overlapHour && !shiftStart}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {apiComparto === "piscina" && canWrite ? (
          <CalendarioInviaTurniModal
            open={inviaTurniOpen}
            onClose={() => setInviaTurniOpen(false)}
            instructors={instructors}
            events={events}
            weekStart={weekDays[0]!}
            weekEnd={weekDays[6]!}
          />
        ) : null}

        {apiComparto && hasPlanningGrid(apiComparto) ? (
          <CalendarioTurnazioniModal
            open={turnazioniOpen}
            onClose={() => setTurnazioniOpen(false)}
            compartoLabel={compartoLabel}
            cursor={cursor}
            events={events}
            instructors={instructors}
            comparto={apiComparto}
          />
        ) : null}
      </div>
    </div>
  )
}
