import { useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { nuotoLiberoApi } from "@/api/nuotoLibero"
import { TabellaOrariaSettimana } from "@/components/TabellaOrariaSettimana"
import { useAuth } from "@/contexts/AuthContext"
import { isoToday, fmtDateIt } from "@/pages/Corsi"
import { weekMondaySunday } from "@/lib/tabella-oraria"

export function NuotoLiberoPresenze() {
  const { role } = useAuth()
  const enabled = role === "admin" || role === "corsi" || role === "bagnini"
  const canEdit = enabled
  const queryClient = useQueryClient()
  const [day, setDay] = useState(() => isoToday())
  const week = useMemo(() => weekMondaySunday(day), [day])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const q = useQuery({
    queryKey: ["nuoto-libero", week.from, week.to],
    queryFn: () => nuotoLiberoApi.getRange(week.from, week.to),
    enabled,
    staleTime: 10_000,
  })

  const values = useMemo(() => {
    const cells = q.data?.cells ?? {}
    const out: Record<string, Record<string, number | null>> = {}
    for (const d of week.days) {
      out[d] = { ...(cells[d] ?? {}) }
    }
    return out
  }, [q.data, week.days])

  const mut = useMutation({
    mutationFn: (p: { giorno: string; ora: string; presenze: number | null }) =>
      nuotoLiberoApi.setCell(p.giorno, p.ora, p.presenze),
    onError: () => void queryClient.invalidateQueries({ queryKey: ["nuoto-libero", week.from, week.to] }),
  })

  function setCell(giorno: string, ora: string, value: number | null) {
    queryClient.setQueryData(["nuoto-libero", week.from, week.to], (prev: { cells?: Record<string, Record<string, number>> } | undefined) => {
      const cells = { ...(prev?.cells ?? {}) }
      const row = { ...(cells[giorno] ?? {}) }
      if (value == null) delete row[ora]
      else row[ora] = value
      if (Object.keys(row).length) cells[giorno] = row
      else delete cells[giorno]
      return { cells }
    })
    const k = `${giorno}|${ora}`
    const prevT = timers.current[k]
    if (prevT) clearTimeout(prevT)
    timers.current[k] = setTimeout(() => {
      delete timers.current[k]
      mut.mutate({ giorno, ora, presenze: value })
    }, 450)
  }

  if (!enabled) {
    return <div className="p-6 text-red-400">Permessi insufficienti.</div>
  }

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Nuoto libero</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Non serve prenotazione: si inserisce solo quante persone ci sono in vasca per ogni ora (non i turni del personale).
          </p>
          {role !== "bagnini" ? (
            <Link to="/corsi/presenze" className="mt-2 inline-block text-sm font-medium text-[#46A6D9] underline-offset-2 hover:underline">
              Report presenze corsi
            </Link>
          ) : (
            <Link to="/piscina" className="mt-2 inline-block text-sm font-medium text-[#46A6D9] underline-offset-2 hover:underline">
              Mappa piscina
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Settimana (scegli un giorno)</span>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
            />
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-zinc-600 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
          >
            Stampa
          </button>
        </div>
      </div>

      <p className="mt-4 text-sm text-zinc-400 print:text-zinc-700">
        Presenze N.L. · {fmtDateIt(week.from)} – {fmtDateIt(week.to)}
      </p>
      {q.isError ? (
        <p className="mt-2 text-sm text-red-400">{String((q.error as Error).message ?? q.error)}</p>
      ) : null}

      <div className="mt-4">
        <TabellaOrariaSettimana
          days={week.days}
          values={values}
          editable={canEdit}
          disabled={q.isLoading}
          onChange={setCell}
        />
      </div>
      <p className="mt-3 text-xs text-zinc-500 print:hidden">
        Cella vuota = non compilata (non entra nelle medie). Zero = fascia vuota, nessuno in vasca.
      </p>
    </div>
  )
}
