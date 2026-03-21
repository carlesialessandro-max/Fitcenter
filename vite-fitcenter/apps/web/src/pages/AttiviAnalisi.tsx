import { useSearchParams, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

function localIsoDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

const COL_BAR = "#34d399"
const COL_BAR_BAMBINI = "#a78bfa"
const COL_PIE = ["#34d399", "#a78bfa", "#64748b"]

export function AttiviAnalisi() {
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const asOfParam = searchParams.get("asOf")?.trim()
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : localIsoDate()

  const { data, isLoading, error } = useQuery({
    queryKey: ["abbonamenti-attivi-analisi", asOf],
    queryFn: () => dataApi.getAbbonamentiAttiviAnalisi(asOf),
    enabled: role === "admin",
    retry: false,
  })

  if (role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Attivi — analisi</h2>
          <p className="mt-2 text-sm text-zinc-500">Disponibile solo per admin.</p>
          <Link to="/" className="mt-4 inline-block text-sm text-amber-400 hover:underline">
            Torna alla dashboard
          </Link>
        </div>
      </div>
    )
  }

  const setAsOf = (v: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("asOf", v)
    setSearchParams(next, { replace: true })
  }

  const pieData =
    data != null
      ? [
          { name: "Adulti", value: data.adulti.totale },
          { name: "Bambini", value: data.bambini.totale },
        ].filter((x) => x.value > 0)
      : []

  const pctSuTotale = (n: number, tot: number) => {
    if (tot <= 0) return "0"
    const p = (n / tot) * 100
    return Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1)
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/" className="text-sm text-zinc-500 hover:text-amber-400">
              ← Dashboard
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Abbonamenti attivi — ripartizione</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Solo KPI attivi / questa pagina: tutte le categorie, esclusi i tesseramenti. La pagina Abbonamenti e le vendite usano ancora le esclusioni per categoria (DANZA, ACQUATICITÀ, …).
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Data riferimento
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
          />
        </label>
      </div>

      {isLoading && <p className="mt-8 text-zinc-500">Caricamento…</p>}
      {error && (
        <p className="mt-8 text-red-400">
          {(error as Error)?.message ?? "Errore caricamento dati"}
        </p>
      )}

      {data && !isLoading && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm text-zinc-400">Totale attivi (KPI)</p>
              <p className="mt-1 text-3xl font-semibold text-emerald-400">{data.totaleAttivi}</p>
              <p className="mt-1 text-xs text-zinc-500">abbonamenti al {data.asOf}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm text-zinc-400">Adulti</p>
              <p className="mt-1 text-3xl font-semibold text-emerald-400">{data.adulti.totale}</p>
              <p className="mt-1 text-xs text-zinc-500">
                abbonamenti
                {data.totaleAttivi > 0 && (
                  <span className="text-zinc-600"> · {pctSuTotale(data.adulti.totale, data.totaleAttivi)}% sul totale</span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm text-zinc-400">Bambini</p>
              <p className="mt-1 text-3xl font-semibold text-violet-400">{data.bambini.totale}</p>
              <p className="mt-1 text-xs text-zinc-500">
                abbonamenti
                {data.totaleAttivi > 0 && (
                  <span className="text-zinc-600"> · {pctSuTotale(data.bambini.totale, data.totaleAttivi)}% sul totale</span>
                )}
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
            <table className="w-full min-w-[320px] text-left text-sm">
              <caption className="border-b border-zinc-800 px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Conteggio abbonamenti (valori assoluti)
              </caption>
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="px-4 py-2 font-medium">Segmento</th>
                  <th className="px-4 py-2 font-medium text-right">N. abbonamenti</th>
                  <th className="px-4 py-2 font-medium text-right text-zinc-600">% sul totale KPI</th>
                </tr>
              </thead>
              <tbody className="text-zinc-200">
                <tr className="border-b border-zinc-800/80">
                  <td className="px-4 py-2">Adulti</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-emerald-400">{data.adulti.totale}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                    {data.totaleAttivi > 0 ? `${pctSuTotale(data.adulti.totale, data.totaleAttivi)}%` : "—"}
                  </td>
                </tr>
                <tr className="border-b border-zinc-800/80">
                  <td className="px-4 py-2">Bambini</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-violet-400">{data.bambini.totale}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                    {data.totaleAttivi > 0 ? `${pctSuTotale(data.bambini.totale, data.totaleAttivi)}%` : "—"}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-medium text-zinc-400">Totale (adulti + bambini)</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-zinc-100">
                    {data.adulti.totale + data.bambini.totale}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-zinc-600">
                    deve coincidere con {data.totaleAttivi}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-4 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3 text-xs text-zinc-500">
            <span className="font-medium text-zinc-400">
              Età: {data.attiviConEta}/{data.totaleAttivi} attivi con dato — soglia {data.sogliaEtaAdulti} anni.{" "}
            </span>
            {data.notaClassificazione}
          </p>

          {pieData.length > 0 && (
            <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-lg font-semibold text-zinc-100">
                Adulti vs bambini
                {data.attiviConEta < data.totaleAttivi && data.totaleAttivi > 0 && (
                  <span className="ml-2 text-xs font-normal text-zinc-500">(età parziale: vedi nota)</span>
                )}
              </h2>
              <div className="mt-4 h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) =>
                        `${name}: ${value} abb.`
                      }
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COL_PIE[i % COL_PIE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const item = payload[0]
                        const v = Number(item.value)
                        const nm = String(item.name ?? item.payload?.name ?? "")
                        const pct =
                          data.totaleAttivi > 0 ? pctSuTotale(v, data.totaleAttivi) : "0"
                        return (
                          <div className="rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm shadow-lg">
                            <p className="font-medium text-zinc-100">{nm}</p>
                            <p className="tabular-nums text-emerald-300">
                              <span className="text-lg font-semibold">{v}</span> abbonamenti
                            </p>
                            <p className="text-xs text-zinc-500">{pct}% sul totale attivi ({data.totaleAttivi})</p>
                          </div>
                        )
                      }}
                    />
                    <Legend formatter={(value, entry) => {
                      const v = (entry as { payload?: { value?: number } }).payload?.value
                      return typeof v === "number" ? `${value}: ${v} abb.` : String(value)
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-lg font-semibold text-zinc-100">Adulti — conteggio per durata</h2>
              <p className="mt-1 text-xs text-zinc-500">Fascia ricavata da mesi o da testo abbonamento</p>
              <div className="mt-4 h-[320px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.adulti.byDurata} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                    <XAxis dataKey="durata" tick={{ fill: "#a1a1aa", fontSize: 11 }} angle={-25} textAnchor="end" height={70} />
                    <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }}
                      labelStyle={{ color: "#e4e4e7" }}
                      formatter={(value: number | string) => [`${value} abbonamenti`, "Conteggio"]}
                    />
                    <Bar dataKey="count" name="N. abbonamenti" fill={COL_BAR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-lg font-semibold text-zinc-100">Bambini — conteggio per durata</h2>
              <p className="mt-1 text-xs text-zinc-500">Stessa logica fascie; sottoinsieme classificato come attività minori</p>
              <div className="mt-4 h-[320px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.bambini.byDurata} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                    <XAxis dataKey="durata" tick={{ fill: "#a1a1aa", fontSize: 11 }} angle={-25} textAnchor="end" height={70} />
                    <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }}
                      labelStyle={{ color: "#e4e4e7" }}
                      formatter={(value: number | string) => [`${value} abbonamenti`, "Conteggio"]}
                    />
                    <Bar dataKey="count" name="N. abbonamenti" fill={COL_BAR_BAMBINI} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
