import { useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { scuolaNuotoApi, type ScuolaNuotoArchivedNote, type ScuolaNuotoNotesPeriod } from "@/api/scuolaNuoto"
import { useAuth } from "@/contexts/AuthContext"

const PERIODS: { id: ScuolaNuotoNotesPeriod; label: string }[] = [
  { id: "current_week", label: "Settimana in corso" },
  { id: "previous_week", label: "Settimana precedente" },
  { id: "month", label: "Mese in corso" },
]

const WEEKDAY_IT: Record<string, string> = {
  lun: "Lunedì",
  mar: "Martedì",
  mer: "Mercoledì",
  gio: "Giovedì",
  ven: "Venerdì",
  sab: "Sabato",
  dom: "Domenica",
}

function fmtItDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

function noteSubject(row: ScuolaNuotoArchivedNote): string {
  if (row.baseKey.startsWith("corso:")) {
    return `Corso #${row.baseKey.slice("corso:".length)}`
  }
  if (row.kind === "child" && row.childKey) {
    const ck = row.childKey
    if (ck.startsWith("name:")) return ck.slice("name:".length)
    if (ck.startsWith("id:")) return `Utente #${ck.slice("id:".length)}`
    return ck
  }
  return row.baseKey
}

function groupByDate(rows: ScuolaNuotoArchivedNote[]): { date: string; items: ScuolaNuotoArchivedNote[] }[] {
  const m = new Map<string, ScuolaNuotoArchivedNote[]>()
  for (const r of rows) {
    const list = m.get(r.date) ?? []
    list.push(r)
    m.set(r.date, list)
  }
  return Array.from(m.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items }))
}

export function ScuolaNuotoNoteArchivio() {
  const { role } = useAuth()
  const [period, setPeriod] = useState<ScuolaNuotoNotesPeriod>("current_week")

  if (role === "firme") return <Navigate to="/firma-cassa" replace />
  if (role !== "admin" && role !== "scuola_nuoto") return <Navigate to="/" replace />

  const q = useQuery({
    queryKey: ["scuola-nuoto", "notes-archive", period],
    queryFn: () => scuolaNuotoApi.notesArchive(period),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const grouped = groupByDate(q.data?.rows ?? [])

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-lg font-semibold text-zinc-100">Archivio note — Scuola nuoto</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Note corso e partecipanti salvate con data. Le note create prima di questo aggiornamento restano sul giorno
          operativo.
        </p>
        <p className="mt-2">
          <Link to="/scuola-nuoto" className="text-sm font-medium text-[#46A6D9] hover:underline">
            ← Torna a Scuola nuoto
          </Link>
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={
                period === p.id
                  ? "rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-200"
                  : "rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        {q.data?.label ? (
          <p className="mt-3 text-xs text-zinc-500">
            {q.data.label} · {q.data.rows.length} note
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        {q.isLoading ? (
          <p className="py-8 text-center text-sm text-zinc-500">Caricamento note…</p>
        ) : q.error ? (
          <p className="py-6 text-center text-sm text-red-400">{(q.error as Error).message}</p>
        ) : grouped.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">Nessuna nota in questo periodo.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map(({ date, items }) => (
              <section key={date}>
                <h3 className="text-sm font-semibold text-zinc-200">
                  {WEEKDAY_IT[items[0]?.weekday ?? ""] ?? items[0]?.weekday} · {fmtItDate(date)}
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {items.map((row, i) => (
                    <li
                      key={`${row.date}-${row.kind}-${row.baseKey}-${row.childKey ?? ""}-${i}`}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span
                          className={
                            row.kind === "course"
                              ? "rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300"
                              : "rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300"
                          }
                        >
                          {row.kind === "course" ? "Corso" : "Partecipante"}
                        </span>
                        <span className="text-zinc-400">{noteSubject(row)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-100">{row.note}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}