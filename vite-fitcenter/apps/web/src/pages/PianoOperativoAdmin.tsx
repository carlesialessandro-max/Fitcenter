import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { cn } from "@workspace/ui/lib/utils"
import type { CalendarioComparto, CalendarioMergedEventDto } from "@/api/calendario"
import { calendarioApi } from "@/api/calendario"
import { CercaFiltroInput } from "@/components/CercaFiltroInput"
import { useAuth } from "@/contexts/AuthContext"
import { compareByShiftRange, eventTimeRange } from "@/lib/reception-shift"
import { compartoUsesShiftRange } from "@/lib/calendario-shift"
import { dedupeShiftEvents } from "@/lib/shift-dedupe"
import { apiToSegmento, calendarioPath } from "@/pages/calendario-routes"

const IT_DOW_SHORT = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] as const

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function isoYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseIsoLocal(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, day] = iso.split("-").map(Number)
  return new Date(y, m - 1, day)
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

function formatDateIt(iso: string): string {
  const d = parseIsoLocal(iso)
  if (!d) return iso
  return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
}

function foldTxt(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

function slotMatchesName(e: CalendarioMergedEventDto, q: string): boolean {
  const parts = foldTxt(q).split(" ").filter(Boolean)
  if (!parts.length) return true
  const hay = foldTxt(`${e.staffDisplay ?? ""} ${e.staff ?? ""} ${e.title ?? ""}`)
  return parts.every((p) => hay.includes(p))
}

function SlotTimeLabel({ e, comparto }: { e: CalendarioMergedEventDto; comparto: CalendarioComparto }) {
  if (compartoUsesShiftRange(comparto)) {
    const r = eventTimeRange(e)
    return (
      <span className="font-medium text-zinc-200">
        {r.start}–{r.end}
      </span>
    )
  }
  return <span className="font-medium text-zinc-200">{e.start}</span>
}

function WeekDayPicker({ valueIso, onChange }: { valueIso: string; onChange: (iso: string) => void }) {
  const hiddenDateRef = useRef<HTMLInputElement>(null)
  const anchor = parseIsoLocal(valueIso) ?? new Date()
  const weekStart = startOfWeekMonday(anchor)
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart.getTime()])

  function pickDay(iso: string) {
    const d = parseIsoLocal(iso)
    if (!d) return
    onChange(iso)
  }

  function shiftWeek(delta: number) {
    const d = parseIsoLocal(valueIso) ?? new Date()
    onChange(isoYmd(addDays(d, delta * 7)))
  }

  return (
    <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Settimana</span>
        <button
          type="button"
          onClick={() => pickDay(isoYmd(new Date()))}
          className="rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Oggi
        </button>
      </div>
      <div className="flex items-stretch gap-1">
        <button type="button" onClick={() => shiftWeek(-1)} className="rounded-lg border border-zinc-600 px-2 py-2 text-sm text-zinc-400 hover:bg-zinc-800" aria-label="Settimana precedente">
          ←
        </button>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {weekDays.map((d) => {
            const iso = isoYmd(d)
            const selected = iso === valueIso
            const isToday = iso === isoYmd(new Date())
            return (
              <button
                key={iso}
                type="button"
                onClick={() => pickDay(iso)}
                className={cn(
                  "flex flex-col items-center rounded-lg border py-2 text-[10px] leading-tight transition-colors",
                  selected
                    ? "border-[#46A6D9] bg-[#46A6D9]/25 text-zinc-100"
                    : isToday
                      ? "border-zinc-500 bg-zinc-800/80 text-zinc-200"
                      : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-800"
                )}
              >
                <span className="uppercase opacity-80">{IT_DOW_SHORT[mondayIndex(d)]}</span>
                <span className="text-sm font-semibold">{d.getDate()}</span>
              </button>
            )
          })}
        </div>
        <button type="button" onClick={() => shiftWeek(1)} className="rounded-lg border border-zinc-600 px-2 py-2 text-sm text-zinc-400 hover:bg-zinc-800" aria-label="Settimana successiva">
          →
        </button>
      </div>
      <p className="text-sm font-medium capitalize text-zinc-200">{formatDateIt(valueIso)}</p>
      <button
        type="button"
        onClick={() => {
          const el = hiddenDateRef.current
          if (el && typeof el.showPicker === "function") void el.showPicker()
          else el?.focus()
        }}
        className="text-xs font-medium text-[#46A6D9] hover:underline"
      >
        Apri calendario…
      </button>
      <input
        ref={hiddenDateRef}
        type="date"
        value={valueIso}
        onChange={(ev) => pickDay(ev.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  )
}

type HitSlot = {
  dateIso: string
  label: string
  comparto: CalendarioComparto
  event: CalendarioMergedEventDto
}

export function PianoOperativoAdmin() {
  const { role } = useAuth()
  const [dateIso, setDateIso] = useState(() => isoYmd(new Date()))
  const [q, setQ] = useState("")
  const [reparti, setReparti] = useState<{ comparto: CalendarioComparto; label: string; events: CalendarioMergedEventDto[] }[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const qTrim = q.trim()
  const searching = qTrim.length >= 2
  const weekStart = startOfWeekMonday(parseIsoLocal(dateIso) ?? new Date())
  const weekFrom = isoYmd(weekStart)
  const weekTo = isoYmd(addDays(weekStart, 6))

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const data = searching
        ? await calendarioApi.getPianoOperativo(dateIso, { from: weekFrom, to: weekTo })
        : await calendarioApi.getPianoOperativo(dateIso)
      setReparti(data.reparti)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore caricamento")
      setReparti([])
    } finally {
      setLoading(false)
    }
  }, [dateIso, searching, weekFrom, weekTo])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    document.title = "Piano operativo · FitCenter"
  }, [])

  const totalSlots = reparti.reduce(
    (n, r) => n + (compartoUsesShiftRange(r.comparto) ? dedupeShiftEvents(r.events).length : r.events.length),
    0
  )

  const hits = useMemo((): HitSlot[] => {
    if (!searching) return []
    const out: HitSlot[] = []
    for (const r of reparti) {
      const slots = compartoUsesShiftRange(r.comparto) ? dedupeShiftEvents(r.events) : r.events
      for (const e of slots) {
        if (!slotMatchesName(e, qTrim)) continue
        out.push({
          dateIso: e.dateIso || dateIso,
          label: r.label,
          comparto: r.comparto,
          event: e,
        })
      }
    }
    out.sort(
      (a, b) =>
        a.dateIso.localeCompare(b.dateIso) ||
        compareByShiftRange(a.event, b.event) ||
        a.event.staffDisplay.localeCompare(b.event.staffDisplay, "it")
    )
    return out
  }, [searching, qTrim, reparti, dateIso])

  const hitsByDay = useMemo(() => {
    const m = new Map<string, HitSlot[]>()
    for (const h of hits) {
      const list = m.get(h.dateIso) ?? []
      list.push(h)
      m.set(h.dateIso, list)
    }
    return m
  }, [hits])

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => isoYmd(addDays(weekStart, i))), [weekFrom])

  return (
    <div className="min-h-full bg-zinc-950 p-4 text-zinc-100 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Piano operativo</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Turni e corsi di tutti i reparti. Apri un calendario per modificare gli orari.
            </p>
            {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/calendario/personale" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
              Personale
            </Link>
            {role === "admin" ? (
              <Link to="/" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Dashboard vendite
              </Link>
            ) : null}
          </div>
        </header>

        <WeekDayPicker valueIso={dateIso} onChange={setDateIso} />

        <CercaFiltroInput
          value={q}
          onChange={setQ}
          placeholder="Cerca persona o corso (es. Marta, reception…)"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
        />

        {loading ? <p className="text-sm text-zinc-500">Caricamento turni…</p> : null}
        {!loading && !err && !searching ? (
          <p className="text-xs text-zinc-500">
            {totalSlots} {totalSlots === 1 ? "slot" : "slot"} in {reparti.filter((r) => r.events.length > 0).length}{" "}
            reparti
          </p>
        ) : null}

        {searching && !loading ? (
          <section className="rounded-2xl border border-[#46A6D9]/40 bg-zinc-900/50">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-100">
                Orari{hits.length ? ` · ${hits.length} ${hits.length === 1 ? "turno" : "turni"}` : ""}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Settimana {weekStart.toLocaleDateString("it-IT", { day: "numeric", month: "short" })} –{" "}
                {addDays(weekStart, 6).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
                {qTrim ? ` · «${qTrim}»` : ""}
              </p>
            </div>
            {hits.length === 0 ? (
              <p className="px-4 py-4 text-sm text-zinc-500">Nessun orario trovato per questo nome in settimana.</p>
            ) : (
              <div className="divide-y divide-zinc-800/80">
                {weekDays.map((iso) => {
                  const dayHits = hitsByDay.get(iso) ?? []
                  if (!dayHits.length) return null
                  const d = parseIsoLocal(iso)
                  const selected = iso === dateIso
                  return (
                    <div key={iso} className={cn("px-4 py-3", selected && "bg-[#46A6D9]/10")}>
                      <button
                        type="button"
                        onClick={() => setDateIso(iso)}
                        className="mb-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-200"
                      >
                        {d ? d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }) : iso}
                      </button>
                      <ul className="space-y-1.5">
                        {dayHits.map((h) => {
                          const t = eventTimeRange(h.event)
                          return (
                            <li
                              key={`${h.comparto}-${h.event.stableKey}-${iso}`}
                              className="flex flex-wrap items-baseline gap-x-2 text-sm"
                            >
                              <span className="font-medium tabular-nums text-zinc-100">
                                {t.start}–{t.end}
                              </span>
                              <span className="text-zinc-300">{h.event.staffDisplay || h.event.staff || "—"}</span>
                              <span className="text-zinc-500">
                                · {h.label}
                                {h.event.title ? ` · ${h.event.title}` : ""}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}

        <div className={cn("space-y-4", searching && "hidden")}>
          {reparti.map((r) => {
            const seg = apiToSegmento(r.comparto)
            const href = seg ? calendarioPath(seg) : null
            return (
              <section key={r.comparto} className="rounded-2xl border border-zinc-800 bg-zinc-900/30">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
                  <h2 className="text-sm font-semibold text-zinc-200">{r.label}</h2>
                  {href ? (
                    <Link to={href} className="text-xs font-medium text-[#46A6D9] hover:underline">
                      Apri calendario reparto →
                    </Link>
                  ) : null}
                </div>
                {(() => {
                  const slots = compartoUsesShiftRange(r.comparto)
                    ? dedupeShiftEvents(r.events)
                    : [...r.events].sort(compareByShiftRange)
                  if (slots.length === 0) {
                    return <p className="px-4 py-3 text-sm text-zinc-600">Nessun turno in questo giorno.</p>
                  }
                  return (
                  <ul className="divide-y divide-zinc-800/80">
                    {slots.map((e) => (
                      <li key={e.stableKey} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                        <SlotTimeLabel e={e} comparto={r.comparto} />
                        <span className="text-zinc-300">{e.title}</span>
                        <span className="text-zinc-500">· {e.staffDisplay || e.staff || "—"}</span>
                        {e.note ? <span className="w-full text-xs text-amber-200/90">{e.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                  )
                })()}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
