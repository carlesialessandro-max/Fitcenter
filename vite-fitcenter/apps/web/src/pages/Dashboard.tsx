import { useQuery } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { dataApi } from "@/api/data"
import { chiamateApi } from "@/api/chiamate"

const COLORS_FONTE = ["#3b82f6", "#22c55e", "#f97316"]
const COLORS_CAT = ["#8b5cf6", "#06b6d4", "#ec4899", "#eab308", "#f97316"]

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => dataApi.getDashboard(),
  })
  const { data: chiamateStats } = useQuery({
    queryKey: ["chiamate-stats"],
    queryFn: () => chiamateApi.getStats(),
  })

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-zinc-400">
        Caricamento...
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-6 text-red-400">
        Errore: {(error as Error)?.message ?? "Dati non disponibili"}. Avvia l’API backend.
      </div>
    )
  }

  const oggi = new Date().toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">
        Panoramica del centro fitness
      </h1>
      <p className="mt-1 text-sm text-zinc-400">— {oggi}</p>

      {/* KPI */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Lead totali</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">{data.leadTotali}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {data.leadVinti} vinti — {data.leadPersi} persi
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Abbonamenti attivi</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-400">{data.abbonamentiAttivi}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {data.abbonamentiInScadenza} in scadenza
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Entrate mese</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">
            €{data.entrateMese.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">{data.percentualeBudget}% del budget</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Tasso conversione</p>
          <p className="mt-1 text-2xl font-semibold text-violet-400">{data.tassoConversione}%</p>
          <p className="mt-0.5 text-xs text-zinc-500">{data.clientiAttivi} clienti attivi</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Chiamate</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-400">{chiamateStats?.oggi ?? 0}</p>
          <p className="mt-0.5 text-xs text-zinc-500">oggi — {chiamateStats?.settimana ?? 0} questa settimana</p>
        </div>
      </div>

      {/* Chiamate per consulente */}
      {chiamateStats && chiamateStats.perConsulente.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Chiamate per consulente</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[200px] text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-left text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Consulente</th>
                  <th className="pb-2 font-medium text-right">N° chiamate</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {chiamateStats.perConsulente.map((row) => (
                  <tr key={row.consulenteNome} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4">{row.consulenteNome}</td>
                    <td className="py-2 text-right font-medium text-cyan-400">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grafici */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Vendite vs budget mensile</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.venditePerMese}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="mese" stroke="#71717a" fontSize={12} />
                <YAxis stroke="#71717a" fontSize={12} tickFormatter={(v) => `€${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46" }}
                  formatter={(value: number) => [`€${value.toLocaleString("it-IT")}`, ""]}
                  labelFormatter={(l) => l}
                />
                <Legend />
                <Bar dataKey="vendite" name="Vendite" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="budget" name="Budget" fill="#52525b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Lead per fonte</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.leadPerFonte}
                  dataKey="count"
                  nameKey="fonte"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  label={({ fonte, count }) => `${fonte}: ${count}`}
                >
                  {data.leadPerFonte.map((_, i) => (
                    <Cell key={i} fill={COLORS_FONTE[i % COLORS_FONTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Abbonamenti attivi per categoria</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.abbonamentiPerCategoria}
                  dataKey="count"
                  nameKey="categoria"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  paddingAngle={2}
                  label={({ categoria, count }) => `${categoria}: ${count}`}
                >
                  {data.abbonamentiPerCategoria.map((_, i) => (
                    <Cell key={i} fill={COLORS_CAT[i % COLORS_CAT.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Abbonamenti in scadenza (30 giorni)</h2>
          <ul className="mt-3 space-y-2">
            {data.abbonamentiInScadenzaLista.length === 0 ? (
              <li className="text-sm text-zinc-500">Nessuno in scadenza</li>
            ) : (
              data.abbonamentiInScadenzaLista.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-zinc-200">{item.clienteNome}</span>
                  <span className="text-zinc-500">{item.piano}</span>
                  <span className="text-amber-400">Scade: {formatDate(item.dataFine)}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

function formatDate(s: string) {
  try {
    return new Date(s).toLocaleDateString("it-IT")
  } catch {
    return s
  }
}
