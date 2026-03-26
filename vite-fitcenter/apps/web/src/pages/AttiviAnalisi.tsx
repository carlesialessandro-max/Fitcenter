import { useMemo } from "react"
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
const COL_CAT = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#eab308", "#06b6d4", "#ef4444"]

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
  const adultiTotByCategoria = data
    ? data.adulti.byCategoria
        .filter((r) => !String(r.categoria ?? "").toUpperCase().includes("DANZA"))
        .reduce((s, r) => s + r.totale, 0)
    : 0
  const bambiniTotByCategoria = data
    ? data.bambini.byCategoria
        .filter((r) => !String(r.categoria ?? "").toUpperCase().includes("DANZA"))
        .reduce((s, r) => s + r.totale, 0)
    : 0
  const categoriaRows = useMemo(() => {
    if (!data) return []
    const map = new Map<string, number>()
    const add = (categoria: string, totale: number) => {
      const key = (categoria ?? "").trim()
      if (!key) return
      if (key.toUpperCase().includes("DANZA")) return
      map.set(key, (map.get(key) ?? 0) + (totale ?? 0))
    }
    data.adulti.byCategoria.forEach((r) => add(r.categoria, r.totale))
    data.bambini.byCategoria.forEach((r) => add(r.categoria, r.totale))
    return Array.from(map.entries())
      .map(([categoria, count]) => ({ categoria, count }))
      .sort((a, b) => b.count - a.count)
  }, [data])

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
            Solo KPI attivi: esclusi i tesseramenti. Nella ripartizione adulti/bambini, per i bambini sono esclusi `DANZA` e `CAMPUS`. Bambini deduplicati per cliente (stesso bambino su più corsi contato una volta).
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
              <h2 className="text-lg font-semibold text-zinc-100">Adulti — totale abbonamenti per durata</h2>
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
                      formatter={(value: number | string) => [`${value} abbonamenti`, "Totale"]}
                    />
                    <Bar dataKey="count" name="N. abbonamenti" fill={COL_BAR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-lg font-semibold text-zinc-100">Bambini — totale abbonamenti per durata</h2>
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
                      formatter={(value: number | string) => [`${value} abbonamenti`, "Totale"]}
                    />
                    <Bar dataKey="count" name="N. abbonamenti" fill={COL_BAR_BAMBINI} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <h2 className="text-lg font-semibold text-zinc-100">Attivi per categoria</h2>
            <p className="mt-1 text-xs text-zinc-500">Vista dedicata completa. Categorie DANZA escluse.</p>
            <div className="mt-4 grid gap-6 lg:grid-cols-[2fr,1fr]">
              <div className="h-[520px] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoriaRows}
                      dataKey="count"
                      nameKey="categoria"
                      outerRadius={180}
                      label={({ categoria, count }) => `${categoria}: ${count}`}
                    >
                      {categoriaRows.map((_, i) => (
                        <Cell key={i} fill={COL_CAT[i % COL_CAT.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="max-h-[520px] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Legenda</p>
                <div className="space-y-2">
                  {categoriaRows.map((r, i) => (
                    <div key={r.categoria} className="flex items-center gap-2 text-sm text-zinc-200">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COL_CAT[i % COL_CAT.length] }} />
                      <span className="flex-1 truncate">{r.categoria}</span>
                      <span className="tabular-nums text-zinc-400">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-lg font-semibold text-zinc-100">Adulti — categorie</h2>
              <p className="mt-1 text-xs text-zinc-500">Totale abbonamenti per categoria</p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full min-w-[280px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="px-3 py-2 text-left font-medium">Categoria</th>
                      <th className="px-3 py-2 text-right font-medium">Totale</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-200">
                    {data.adulti.byCategoria.filter((r) => !String(r.categoria ?? "").toUpperCase().includes("DANZA")).map((r) => (
                      <tr key={`ad-${r.categoria}`} className="border-b border-zinc-800/70 last:border-b-0">
                        <td className="px-3 py-2">{r.categoria}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.totale}</td>
                      </tr>
                    ))}
                    <tr className="bg-zinc-900/60">
                      <td className="px-3 py-2 font-medium text-zinc-300">Totale adulti</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-400">{adultiTotByCategoria}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-lg font-semibold text-zinc-100">Bambini — categorie</h2>
              <p className="mt-1 text-xs text-zinc-500">Totale abbonamenti per categoria</p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full min-w-[280px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="px-3 py-2 text-left font-medium">Categoria</th>
                      <th className="px-3 py-2 text-right font-medium">Totale</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-200">
                    {data.bambini.byCategoria.filter((r) => !String(r.categoria ?? "").toUpperCase().includes("DANZA")).map((r) => (
                      <tr key={`ba-${r.categoria}`} className="border-b border-zinc-800/70 last:border-b-0">
                        <td className="px-3 py-2">{r.categoria}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.totale}</td>
                      </tr>
                    ))}
                    <tr className="bg-zinc-900/60">
                      <td className="px-3 py-2 font-medium text-zinc-300">Totale bambini</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-violet-400">{bambiniTotByCategoria}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
