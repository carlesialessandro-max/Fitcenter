import type { DettaglioBlocco, DettaglioConsulente } from "@/types/gestionale"

export function fmtEuro(n: number) {
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}
/** Budget: senza decimali. */
export function fmtEuroBudget(n: number) {
  return `${Math.round(n).toLocaleString("it-IT")} €`
}
export function fmtPct(n: number) {
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

export function TrendCell({ trend }: { trend: number }) {
  const isPos = trend >= 0
  const isZero = trend === 0
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${isZero ? "text-zinc-400" : isPos ? "text-emerald-400" : "text-red-400"}`}>
      {!isZero && (isPos ? "↑" : "↓")}
      {fmtPct(trend)}
    </span>
  )
}

export function KpiRow({ b }: { b: DettaglioBlocco }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 md:grid-cols-7">
      <div>
        <p className="text-xs text-zinc-500">Budget</p>
        <p className="font-medium text-zinc-200">{fmtEuroBudget(b.budget)}</p>
      </div>
      <div>
        <p className="text-xs text-zinc-500">Budget progressivo</p>
        <p className="font-medium text-zinc-200">{fmtEuroBudget(b.budgetProgressivo)}</p>
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

export function TabellaConsulenti({ rows }: { rows: DettaglioConsulente[] }) {
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
              <td className="px-4 py-2 text-right">{fmtEuroBudget(r.budget)}</td>
              <td className="px-4 py-2 text-right">{fmtEuroBudget(r.budgetProgressivo)}</td>
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
