import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { dataApi, type OraLavorata } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

function localIsoDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function fmtDateIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

function minutesBetween(start: string, end: string): number {
  const m1 = /^(\d{1,2}):(\d{2})$/.exec(start)
  const m2 = /^(\d{1,2}):(\d{2})$/.exec(end)
  if (!m1 || !m2) return 0
  const a = Number(m1[1]) * 60 + Number(m1[2])
  const b = Number(m2[1]) * 60 + Number(m2[2])
  return Math.max(0, b - a)
}

function fmtHours(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${String(m).padStart(2, "0")}m`
}

export function ConvalideConsulenti() {
  const { role, consulenteNome } = useAuth()
  const now = new Date()
  const [anno, setAnno] = useState(now.getFullYear())
  const [mese, setMese] = useState(now.getMonth() + 1)
  const [consulenteSel, setConsulenteSel] = useState("")
  const queryClient = useQueryClient()

  const debugQ = useQuery({
    queryKey: ["debug-consulenti"],
    queryFn: () => dataApi.getDebugConsulenti(),
    enabled: role === "admin",
    retry: false,
    staleTime: 60_000,
  })
  const consulenti = useMemo(
    () => (debugQ.data?.consulenti ?? []).map((c) => c.nome).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [debugQ.data?.consulenti]
  )

  const selected = role === "admin" ? (consulenteSel || consulenti[0] || "") : (consulenteNome ?? "")

  const { data: ore = [], isLoading, error } = useQuery({
    queryKey: ["ore-lavorate", selected, anno, mese],
    queryFn: () => dataApi.getOreLavorate({ consulente: selected || undefined, anno, mese }),
    enabled: !!selected,
    retry: false,
  })

  const totalMinutes = useMemo(() => ore.reduce((s, r) => s + minutesBetween(r.oraInizio, r.oraFine), 0), [ore])

  const todayStr = localIsoDate(now)
  const [giorno, setGiorno] = useState(todayStr)
  const [oraInizio, setOraInizio] = useState("09:00")
  const [oraFine, setOraFine] = useState("18:00")

  const postMutation = useMutation({
    mutationFn: () => dataApi.postOraLavorata({ consulenteNome: selected, giorno, oraInizio, oraFine }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ore-lavorate", selected, anno, mese] })
      setGiorno(todayStr)
      setOraInizio("09:00")
      setOraFine("18:00")
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => dataApi.deleteOraLavorata(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ore-lavorate", selected, anno, mese] }),
  })

  if (role !== "admin" && role !== "operatore") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Convalide consulenti</h2>
          <p className="mt-2 text-sm text-zinc-500">Pagina disponibile solo per admin/operatore.</p>
          <Link to="/" className="mt-4 inline-block text-sm text-amber-400 hover:underline">
            Torna alla dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Convalide ore lavorate</h1>
          <p className="text-sm text-zinc-500">Riepilogo ore lavorate per mese</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        {role === "admin" ? (
          <label className="flex flex-col gap-1 text-sm text-zinc-400">
            Consulente
            <select
              value={selected}
              onChange={(e) => setConsulenteSel(e.target.value)}
              className="min-w-[360px] rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
            >
              {consulenti.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="flex flex-col gap-1 text-sm text-zinc-400">
            Consulente
            <div className="min-w-[360px] rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-zinc-100">
              {selected || "—"}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Anno
          <input
            type="number"
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value))}
            className="w-28 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Mese
          <select
            value={mese}
            onChange={(e) => setMese(Number(e.target.value))}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"].map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-200">
          Totale mese: <span className="font-semibold text-amber-300">{fmtHours(totalMinutes)}</span>
        </div>
      </div>

      {role === "operatore" ? (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="mb-3 text-lg font-semibold text-zinc-100">Aggiungi</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Data
              <input
                type="date"
                value={giorno}
                onChange={(e) => setGiorno(e.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Ora inizio
              <input
                type="time"
                value={oraInizio}
                onChange={(e) => setOraInizio(e.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Ora fine
              <input
                type="time"
                value={oraFine}
                onChange={(e) => setOraFine(e.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <button
              type="button"
              onClick={() => postMutation.mutate()}
              disabled={postMutation.isPending}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              Aggiungi
            </button>
            {postMutation.isError ? (
              <div className="text-sm text-red-400">{String((postMutation.error as any)?.message ?? "Errore")}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        {isLoading ? <div className="p-4 text-sm text-zinc-500">Caricamento…</div> : null}
        {error ? <div className="p-4 text-sm text-red-400">{(error as Error).message}</div> : null}
        {!isLoading && !error ? (
          <table className="min-w-[900px] w-full table-auto">
            <thead className="bg-zinc-950/40">
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Ora inizio</th>
                <th className="px-3 py-2">Ora fine</th>
                <th className="px-3 py-2">Totale</th>
                <th className="px-3 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {(ore as OraLavorata[]).map((r) => {
                const mins = minutesBetween(r.oraInizio, r.oraFine)
                return (
                  <tr key={r.id} className="border-t border-zinc-800 text-sm text-zinc-200">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(r.giorno)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.oraInizio}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.oraFine}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-amber-300">{fmtHours(mins)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(r.id)}
                        disabled={deleteMutation.isPending || (role === "operatore" && selected !== consulenteNome)}
                        className="text-red-400 hover:underline disabled:opacity-50"
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                )
              })}
              {(ore as OraLavorata[]).length === 0 ? (
                <tr className="border-t border-zinc-800">
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-500">
                    Nessuna riga per questo mese.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  )
}

