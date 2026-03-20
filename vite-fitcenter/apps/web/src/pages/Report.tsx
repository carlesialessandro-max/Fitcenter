import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

type Periodo = "week" | "month" | "year"

function todayIso(): string {
  const d = new Date()
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

export function Report() {
  const { role } = useAuth()
  const [periodo, setPeriodo] = useState<Periodo>("week")
  const [asOf, setAsOf] = useState<string>(todayIso())

  const { data, isLoading, error } = useQuery({
    queryKey: ["report-consulenti", periodo, asOf],
    queryFn: () => dataApi.getReportConsulenti({ periodo, asOf }),
    enabled: role === "admin",
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const rows = useMemo(() => data?.rows ?? [], [data?.rows])

  if (role !== "admin") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Report</h1>
        <p className="mt-2 text-sm text-zinc-500">Disponibile solo per admin.</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Report consulenti</h1>
          <p className="text-sm text-zinc-400">
            Totali per periodo con vendite, telefonate e ore lavorate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Data
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              lang="it-IT"
              title="Formato data: gg/mm/aaaa"
              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
            />
            <span className="text-xs text-zinc-500">{fmtDateIt(asOf)}</span>
          </label>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setPeriodo("week")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            periodo === "week" ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Settimana
        </button>
        <button
          type="button"
          onClick={() => setPeriodo("month")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            periodo === "month" ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Mese
        </button>
        <button
          type="button"
          onClick={() => setPeriodo("year")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            periodo === "year" ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Anno
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        {isLoading && <div className="py-10 text-center text-zinc-400">Caricamento...</div>}
        {error && <div className="py-6 text-center text-red-400">{(error as Error).message}</div>}
        {!isLoading && !error && data && (
          <>
            <p className="text-xs text-zinc-500">
              Periodo: <span className="text-zinc-300">{data.from}</span> → <span className="text-zinc-300">{data.to}</span>
              {" "}· Ore attese: <span className="text-zinc-300">{rows[0]?.oreAttese ?? 0}h</span> (lun–ven × 8h)
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-700 text-zinc-500">
                    <th className="pb-2 pr-4 font-medium">Consulente</th>
                    <th className="pb-2 pr-4 font-medium text-right">Vendite</th>
                    <th className="pb-2 pr-4 font-medium text-right">Telefonate</th>
                    <th className="pb-2 pr-4 font-medium text-right">Ore</th>
                    <th className="pb-2 pr-4 font-medium text-right">% ore</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {rows.map((r) => (
                    <tr key={r.consulenteNome} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-2 pr-4 font-medium text-zinc-200">{r.consulenteNome}</td>
                      <td className="py-2 pr-4 text-right font-medium text-amber-400">
                        €{r.vendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 pr-4 text-right font-medium text-cyan-400">{r.telefonate}</td>
                      <td className="py-2 pr-4 text-right">{r.oreLavorate.toLocaleString("it-IT")}h</td>
                      <td className="py-2 pr-4 text-right">{r.percentualeOre.toLocaleString("it-IT")}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

