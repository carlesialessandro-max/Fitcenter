import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { DettaglioBlocco, DettaglioConsulente } from "@/types/gestionale"
import { useAuth } from "@/contexts/AuthContext"

type Props = {
  anno: number
  mese: number
  meseLabel: string
  onClose: () => void
}

function fmtEuro(n: number) {
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}
function fmtPct(n: number) {
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function TrendCell({ trend }: { trend: number }) {
  const isPos = trend >= 0
  const isZero = trend === 0
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${isZero ? "text-zinc-400" : isPos ? "text-emerald-400" : "text-red-400"}`}>
      {!isZero && (isPos ? "↑" : "↓")}
      {fmtPct(trend)}
    </span>
  )
}

function KpiRow({ b }: { b: DettaglioBlocco }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 md:grid-cols-7">
      <div>
        <p className="text-xs text-zinc-500">Budget</p>
        <p className="font-medium text-zinc-200">{fmtEuro(b.budget)}</p>
      </div>
      <div>
        <p className="text-xs text-zinc-500">Budget progressivo</p>
        <p className="font-medium text-zinc-200">{fmtEuro(b.budgetProgressivo)}</p>
      </div>
      <div>
        <p className="text-xs text-zinc-500">Consuntivo</p>
        <p className="font-medium text-amber-400">{fmtEuro(b.consuntivo)}</p>
      </div>
      <div>
        <p className="text-xs text-zinc-500">Scostamento</p>
        <p className={`font-medium ${b.scostamento >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {b.scostamento >= 0 ? "+" : ""}{fmtEuro(b.scostamento)}
        </p>
      </div>
      <div>
        <p className="text-xs text-zinc-500">Assenze</p>
        <p className="font-medium text-zinc-300">{fmtPct(b.assenze)}</p>
      </div>
      <div>
        <p className="text-xs text-zinc-500">Improduttivi</p>
        <p className="font-medium text-zinc-300">{fmtPct(b.improduttivi)}</p>
      </div>
      <div>
        <p className="text-xs text-zinc-500">Trend</p>
        <TrendCell trend={b.trend} />
      </div>
    </div>
  )
}

function TabellaConsulenti({ rows }: { rows: DettaglioConsulente[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-sky-900/80 text-zinc-100">
            <th className="px-4 py-2.5 text-left font-medium">Consulente</th>
            <th className="px-4 py-2.5 text-right font-medium">Budget</th>
            <th className="px-4 py-2.5 text-right font-medium">Budget progressivo</th>
            <th className="px-4 py-2.5 text-right font-medium">Consuntivo</th>
            <th className="px-4 py-2.5 text-right font-medium">Scostamento</th>
            <th className="px-4 py-2.5 text-right font-medium">Assenze</th>
            <th className="px-4 py-2.5 text-right font-medium">Improduttivi</th>
            <th className="px-4 py-2.5 text-right font-medium">Trend</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-800/30">
              <td className="px-4 py-2 font-medium text-zinc-200">{r.consulente}</td>
              <td className="px-4 py-2 text-right">{fmtEuro(r.budget)}</td>
              <td className="px-4 py-2 text-right">{fmtEuro(r.budgetProgressivo)}</td>
              <td className="px-4 py-2 text-right text-amber-400">{fmtEuro(r.consuntivo)}</td>
              <td className={`px-4 py-2 text-right ${r.scostamento >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {r.scostamento >= 0 ? "+" : ""}{fmtEuro(r.scostamento)}
              </td>
              <td className="px-4 py-2 text-right">{fmtPct(r.assenze)}</td>
              <td className="px-4 py-2 text-right">{fmtPct(r.improduttivi)}</td>
              <td className="px-4 py-2 text-right">
                <TrendCell trend={r.trend} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DettaglioMeseModal({ anno, mese, meseLabel, onClose }: Props) {
  const { consulenteFilter } = useAuth()
  const [giorno, setGiorno] = useState(10)

  const { data, isLoading, error } = useQuery({
    queryKey: ["dettaglio-mese", anno, mese, giorno, consulenteFilter],
    queryFn: () => dataApi.getDettaglioMese(anno, mese, giorno, consulenteFilter),
  })

  useEffect(() => {
    if (data?.giorniNelMese != null && giorno > data.giorniNelMese) {
      setGiorno(data.giorniNelMese)
    }
  }, [data?.giorniNelMese, giorno])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-8 w-full max-w-5xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
          <h2 className="text-xl font-semibold text-zinc-100">Dettaglio vendite e budget — {meseLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-8">
          {data?.giorniNelMese != null && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-500">Giorno:</label>
              <select
                value={giorno}
                onChange={(e) => setGiorno(Number(e.target.value))}
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
              >
                {Array.from({ length: data.giorniNelMese }, (_, i) => i + 1).map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          )}

          {isLoading && (
            <div className="py-12 text-center text-zinc-400">Caricamento...</div>
          )}
          {error && (
            <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {(error as Error).message}
            </div>
          )}

          {data && !error && (
            <>
              {/* Sezione giorno */}
              <section>
                <h3 className="mb-3 text-lg font-semibold text-zinc-100">
                  {data.giornoLabel ?? `${anno}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`}
                </h3>
                <KpiRow b={data.dettaglioGiorno} />
                <TabellaConsulenti rows={data.dettaglioGiorno.perConsulente} />
              </section>

              {/* Sezione mese */}
              <section>
                <h3 className="mb-3 text-lg font-semibold text-zinc-100">{data.meseLabel}</h3>
                <KpiRow b={data.dettaglioMese} />
                <TabellaConsulenti rows={data.dettaglioMese.perConsulente} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
