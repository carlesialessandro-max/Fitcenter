import { useMemo, useState } from "react"
import type { CalendarioIstruttore, CalendarioMergedEventDto } from "@/api/calendario"
import { calendarioApi } from "@/api/calendario"
import { eventTimeRange } from "@/lib/reception-shift"

const H2_BLUE = "#46A6D9"
const IT_DOW = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"] as const

function isoYmd(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function fmtIt(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, "0")
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

type Props = {
  open: boolean
  onClose: () => void
  instructors: CalendarioIstruttore[]
  events: CalendarioMergedEventDto[]
  weekStart: Date
  weekEnd: Date
}

export function CalendarioInviaTurniModal({ open, onClose, instructors, events, weekStart, weekEnd }: Props) {
  const [istruttoreId, setIstruttoreId] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const withEmail = useMemo(() => instructors.filter((i) => String(i.email ?? "").trim()), [instructors])

  const preview = useMemo(() => {
    if (!istruttoreId) return []
    return events
      .filter((e) => e.istruttoreId === istruttoreId)
      .sort((a, b) => a.dow - b.dow || a.start.localeCompare(b.start))
  }, [events, istruttoreId])

  const previewByDay = useMemo(() => {
    const m = new Map<number, CalendarioMergedEventDto[]>()
    for (const e of preview) {
      const list = m.get(e.dow) ?? []
      list.push(e)
      m.set(e.dow, list)
    }
    return m
  }, [preview])

  if (!open) return null

  async function send() {
    setMsg(null)
    setErr(null)
    if (!istruttoreId) {
      setErr("Seleziona un bagnino dall'anagrafica.")
      return
    }
    const ins = instructors.find((i) => i.id === istruttoreId)
    if (!ins?.email?.trim()) {
      setErr("Email mancante: aggiungila in Anagrafica istruttori.")
      return
    }
    if (preview.length === 0) {
      setErr("Nessun turno assegnato a questo bagnino nel calendario.")
      return
    }
    setBusy(true)
    try {
      const res = await calendarioApi.sendTurniEmail("piscina", {
        istruttoreId,
        weekStart: isoYmd(weekStart),
      })
      if (res.sent) {
        setMsg(`Email inviata a ${res.to}`)
      } else {
        setMsg(`SMTP non configurato: messaggio registrato in log server (destinatario ${res.to}).`)
      }
    } catch (e) {
      setErr((e as Error).message || "Invio non riuscito")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[95] flex items-end justify-center p-4 sm:items-center"
    >
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="Chiudi" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-zinc-100">Invia turni via email</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Settimana tipo {fmtIt(weekStart)} – {fmtIt(weekEnd)}. Il bagnino deve essere assegnato dall&apos;anagrafica sullo slot.
        </p>

        <label className="mt-4 block text-xs font-medium text-zinc-400">
          Bagnino
          <select
            value={istruttoreId}
            onChange={(ev) => {
              setIstruttoreId(ev.target.value)
              setMsg(null)
              setErr(null)
            }}
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">— Seleziona —</option>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.cognome} {i.nome}
                {!i.email?.trim() ? " (senza email)" : ""}
              </option>
            ))}
          </select>
        </label>

        {withEmail.length < instructors.length ? (
          <p className="mt-2 text-[11px] text-amber-400/90">
            Alcuni bagnini non hanno email in anagrafica: non potranno ricevere i turni.
          </p>
        ) : null}

        {istruttoreId ? (
          <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-2 text-xs text-zinc-300">
            {preview.length === 0 ? (
              <p className="text-zinc-500">Nessun turno con questo bagnino.</p>
            ) : (
              <ul className="space-y-2">
                {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
                  const slots = previewByDay.get(dow)
                  if (!slots?.length) return null
                  return (
                    <li key={dow}>
                      <span className="font-medium text-zinc-200">{IT_DOW[dow]}</span>
                      <ul className="mt-0.5 space-y-0.5 pl-2">
                        {slots.map((e) => {
                          const { start, end } = eventTimeRange(e)
                          return (
                            <li key={e.stableKey}>
                              {start}–{end} · {e.title.replace(/\s*·\s*\d{1,2}[:.]\d{2}.*$/i, "").trim() || e.title}
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : null}

        {err ? <p className="mt-3 text-sm text-red-400">{err}</p> : null}
        {msg ? <p className="mt-3 text-sm text-emerald-400">{msg}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
            Chiudi
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
            style={{ backgroundColor: H2_BLUE }}
          >
            {busy ? "Invio…" : "Invia email"}
          </button>
        </div>
      </div>
    </div>
  )
}
