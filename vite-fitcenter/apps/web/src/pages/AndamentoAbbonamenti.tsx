import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

function exportAndamentoPdf(args: {
  totalDistinct: number
  from?: string
  to?: string
  byCategoria: { name: string; count: number; pct: number; euro: number }[]
  byDurata: { name: string; count: number; pct: number; euro: number }[]
}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  doc.setFontSize(14)
  doc.text("Andamento Vendite", 14, 14)
  doc.setFontSize(10)
  const periodo = args.from && args.to ? `${args.from} -> ${args.to}` : "Mese corrente"
  doc.text(`Periodo: ${periodo}`, 14, 20)
  doc.text(`Totale movimenti: ${args.totalDistinct}`, 14, 25)

  autoTable(doc, {
    startY: 32,
    head: [["Categoria", "Movimenti", "%", "Totale €"]],
    body: args.byCategoria.map((r) => [
      r.name,
      String(r.count),
      `${r.pct.toLocaleString("it-IT")} %`,
      r.euro.toLocaleString("it-IT", { minimumFractionDigits: 2 }),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [59, 130, 246] },
  })
  const y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : 90
  autoTable(doc, {
    startY: y,
    head: [["Durata", "Movimenti", "%", "Totale €"]],
    body: args.byDurata.map((r) => [
      r.name,
      String(r.count),
      `${r.pct.toLocaleString("it-IT")} %`,
      r.euro.toLocaleString("it-IT", { minimumFractionDigits: 2 }),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [16, 185, 129] },
  })
  doc.save(`andamento-vendite-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export function AndamentoAbbonamenti() {
  const { role, consulenteFilter, consulenti } = useAuth()
  const [adminConsulente, setAdminConsulente] = useState<string>("")

  const effectiveConsulenteFilter = role === "admin"
    ? (adminConsulente.trim() ? adminConsulente.trim() : undefined)
    : consulenteFilter

  const { data: budgetData } = useQuery({
    queryKey: ["budget"],
    queryFn: () => dataApi.getBudget(),
    enabled: role === "admin",
  })
  const consulentiList = role === "admin" && budgetData?.consulenti?.length ? budgetData.consulenti : (consulenti ?? [])

  const {
    data: venditeMovimentiAndamento,
    isLoading: isLoadingVenditeMovimentiAndamento,
    error: venditeMovimentiAndamentoError,
  } = useQuery({
    queryKey: ["vendite-movimenti-andamento", effectiveConsulenteFilter ?? ""],
    queryFn: () =>
      dataApi.getVenditeMovimentiCategoriaDurata({
        months: 1,
        consulente: effectiveConsulenteFilter,
      }),
    enabled: true,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 60_000,
  })

  const computed = useMemo(() => {
    const rows = venditeMovimentiAndamento?.rows ?? []
    const totalDistinct = venditeMovimentiAndamento?.totalCount ?? 0
    const totalForPct = rows.reduce((s, r) => s + (r.count ?? 0), 0)
    if (totalForPct <= 0) return null

    const byCategoriaMap: Record<string, { count: number; euro: number }> = {}
    const byDurataMap: Record<string, { count: number; euro: number }> = {}
    rows.forEach((r) => {
      const cat = r.categoria ?? "palestra"
      byCategoriaMap[cat] = {
        count: (byCategoriaMap[cat]?.count ?? 0) + (r.count ?? 0),
        euro: (byCategoriaMap[cat]?.euro ?? 0) + Number(r.totalEuro ?? 0),
      }
      const durataLabel = r.durataMesi != null ? `${r.durataMesi} mesi` : "Sconosciuta"
      byDurataMap[durataLabel] = {
        count: (byDurataMap[durataLabel]?.count ?? 0) + (r.count ?? 0),
        euro: (byDurataMap[durataLabel]?.euro ?? 0) + Number(r.totalEuro ?? 0),
      }
    })

    const byCategoria = Object.entries(byCategoriaMap)
      .map(([name, v]) => ({
        name,
        count: v.count,
        euro: v.euro,
        pct: Math.round((v.count / totalForPct) * 1000) / 10,
      }))
      .sort((a, b) => b.count - a.count)

    const byDurata = Object.entries(byDurataMap)
      .map(([name, v]) => ({
        name,
        count: v.count,
        euro: v.euro,
        pct: Math.round((v.count / totalForPct) * 1000) / 10,
      }))
      .sort((a, b) => {
        const na = Number(a.name.split(" ")[0])
        const nb = Number(b.name.split(" ")[0])
        const oka = !Number.isNaN(na) && na > 0
        const okb = !Number.isNaN(nb) && nb > 0
        if (oka && okb) return na - nb
        if (oka) return -1
        if (okb) return 1
        return a.name.localeCompare(b.name)
      })

    const totalEuro = rows.reduce((s, r) => s + Number(r.totalEuro ?? 0), 0)
    return { rows, totalDistinct, byCategoria, byDurata, totalEuro }
  }, [venditeMovimentiAndamento])

  const paletteCat = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#eab308"]
  const paletteDur = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#60a5fa"]

  return (
    <div className="p-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Andamento Vendite</h1>
        <p className="text-sm text-zinc-400">Distribuzione vendite per categoria e durata</p>
      </div>

      {role === "admin" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3">
          <span className="text-sm font-medium text-zinc-300">Filtro consulente</span>
          <select
            value={adminConsulente}
            onChange={(e) => setAdminConsulente(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
            aria-label="Seleziona consulente"
          >
            <option value="">Tutte le consulenti</option>
            {consulentiList.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
        {isLoadingVenditeMovimentiAndamento ? (
          <div className="py-10 text-center text-zinc-400">Caricamento andamento...</div>
        ) : venditeMovimentiAndamentoError ? (
          <div className="py-6 text-center text-red-400">{(venditeMovimentiAndamentoError as Error).message}</div>
        ) : !computed ? (
          <div className="py-10 text-center text-zinc-500">Nessun dato per il periodo.</div>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-xs uppercase tracking-wider text-amber-300">Totale Generale</p>
              <div className="mt-1 flex flex-wrap items-end gap-6">
                <div>
                  <p className="text-xs text-zinc-400">Movimenti</p>
                  <p className="text-2xl font-semibold text-zinc-100">{computed.totalDistinct}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Vendite €</p>
                  <p className="text-2xl font-semibold text-amber-400">
                    €{computed.totalEuro.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="mb-1 text-sm font-medium text-zinc-400">Andamento vendite (mese corrente)</h2>
              <button
                type="button"
                onClick={() =>
                  exportAndamentoPdf({
                    totalDistinct: computed.totalDistinct,
                    from: venditeMovimentiAndamento?.from,
                    to: venditeMovimentiAndamento?.to,
                    byCategoria: computed.byCategoria,
                    byDurata: computed.byDurata,
                  })
                }
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Scarica PDF
              </button>
            </div>
            <div className="mb-4 text-sm text-zinc-500">
              Totale movimenti (inclusi tesseramenti): <span className="text-zinc-200">{computed.totalDistinct}</span>
            </div>
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                <p className="text-xs text-zinc-500">Totale vendite €</p>
                <p className="text-xl font-semibold text-amber-400">
                  €{computed.totalEuro.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                <p className="text-xs text-zinc-500">Totale movimenti</p>
                <p className="text-xl font-semibold text-zinc-100">{computed.totalDistinct}</p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-1">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">Distribuzione per categoria</p>
                <ResponsiveContainer width="100%" height={520}>
                  <PieChart>
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #27272a" }}
                      formatter={(_value: any, _name: any, props: any) => {
                        const payload = props?.payload as { name: string; count: number; pct: number }
                        return [`${payload.pct}% (${payload.count})`, payload.name]
                      }}
                    />
                    <Pie
                      data={computed.byCategoria}
                      dataKey="count"
                      nameKey="name"
                      outerRadius={185}
                      labelLine
                      label={(props: any) => {
                        const payload = props?.payload as { name?: string; pct?: number; count?: number }
                        const pct = payload?.pct ?? 0
                        const name = payload?.name ?? ""
                        const count = payload?.count ?? 0
                        if (pct >= 7) return `${name} (${pct}%) ${count}`
                        if (pct >= 3) return `${name} (${pct}%)`
                        return ""
                      }}
                    >
                      {computed.byCategoria.map((e, i) => (
                        <Cell key={e.name} fill={paletteCat[i % paletteCat.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">Distribuzione per durata</p>
                <ResponsiveContainer width="100%" height={520}>
                  <PieChart>
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #27272a" }}
                      formatter={(_value: any, _name: any, props: any) => {
                        const payload = props?.payload as { name: string; count: number; pct: number }
                        return [`${payload.pct}% (${payload.count})`, payload.name]
                      }}
                    />
                    <Pie
                      data={computed.byDurata}
                      dataKey="count"
                      nameKey="name"
                      outerRadius={185}
                      labelLine
                      label={(props: any) => {
                        const payload = props?.payload as { name?: string; pct?: number; count?: number }
                        const pct = payload?.pct ?? 0
                        const name = payload?.name ?? ""
                        const count = payload?.count ?? 0
                        if (pct >= 7) return `${name} (${pct}%) ${count}`
                        if (pct >= 3) return `${name} (${pct}%)`
                        return ""
                      }}
                    >
                      {computed.byDurata.map((e, i) => (
                        <Cell key={e.name} fill={paletteDur[i % paletteDur.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">Totali per categoria</p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="py-2 pr-2 font-medium">Categoria</th>
                      <th className="py-2 pr-2 text-right font-medium">N</th>
                      <th className="py-2 text-right font-medium">Totale €</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-200">
                    {computed.byCategoria.map((r) => (
                      <tr key={r.name} className="border-b border-zinc-800/70">
                        <td className="py-2 pr-2">{r.name}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{r.count}</td>
                        <td className="py-2 text-right tabular-nums">
                          €{r.euro.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-zinc-900/60 font-semibold text-zinc-100">
                      <td className="py-2 pr-2">TOTALE</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {computed.byCategoria.reduce((s, r) => s + r.count, 0)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-amber-400">
                        €{computed.byCategoria
                          .reduce((s, r) => s + r.euro, 0)
                          .toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">Totali per durata</p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="py-2 pr-2 font-medium">Durata</th>
                      <th className="py-2 pr-2 text-right font-medium">N</th>
                      <th className="py-2 text-right font-medium">Totale €</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-200">
                    {computed.byDurata.map((r) => (
                      <tr key={r.name} className="border-b border-zinc-800/70">
                        <td className="py-2 pr-2">{r.name}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{r.count}</td>
                        <td className="py-2 text-right tabular-nums">
                          €{r.euro.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-zinc-900/60 font-semibold text-zinc-100">
                      <td className="py-2 pr-2">TOTALE</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {computed.byDurata.reduce((s, r) => s + r.count, 0)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-amber-400">
                        €{computed.byDurata
                          .reduce((s, r) => s + r.euro, 0)
                          .toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

