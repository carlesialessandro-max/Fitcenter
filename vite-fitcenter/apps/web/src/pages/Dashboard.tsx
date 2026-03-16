import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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
import { useAuth } from "@/contexts/AuthContext"
import { DettaglioMeseModal } from "@/components/DettaglioMeseModal"
import { DettaglioVenditePrimoPiano } from "@/components/DettaglioVenditePrimoPiano"
import { KpiRow, TabellaConsulenti } from "@/components/DettaglioBloccoView"

const COLORS_FONTE = ["#3b82f6", "#22c55e", "#f97316"]
const COLORS_CAT = ["#8b5cf6", "#06b6d4", "#ec4899", "#eab308", "#f97316"]

export function Dashboard() {
  const queryClient = useQueryClient()
  const { role, consulenteFilter } = useAuth()
  const [budgetModal, setBudgetModal] = useState(false)
  const [dettaglioMese, setDettaglioMese] = useState<{ anno: number; mese: number; meseLabel: string } | null>(null)
  const [storicoAnno, setStoricoAnno] = useState(new Date().getFullYear())
  const annoInCorso = new Date().getFullYear()
  const [budgetAnno, setBudgetAnno] = useState(annoInCorso)
  const [budgetMese, setBudgetMese] = useState(new Date().getMonth() + 1)
  const [budgetPerConsulente, setBudgetPerConsulente] = useState<Record<string, number>>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", consulenteFilter],
    queryFn: () => dataApi.getDashboard(consulenteFilter),
  })

  const { data: budgetData } = useQuery({
    queryKey: ["budget", budgetAnno],
    queryFn: () => dataApi.getBudget(budgetAnno),
    enabled: budgetModal && role === "admin",
  })

  const setBudgetMutation = useMutation({
    mutationFn: async () => {
      const consulenti = budgetData?.consulenti ?? []
      for (const label of consulenti) {
        const val = budgetPerConsulente[label]
        if (typeof val === "number") {
          await dataApi.setBudget(budgetAnno, budgetMese, val, label)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["budget"] })
      setBudgetModal(false)
    },
  })
  const { data: chiamateStats } = useQuery({
    queryKey: ["chiamate-stats"],
    queryFn: () => chiamateApi.getStats(),
  })

  useEffect(() => {
    if (!budgetModal || !budgetData?.perConsulente) return
    const byLabel: Record<string, number> = {}
    budgetData.perConsulente
      .filter((p) => p.anno === budgetAnno && p.mese === budgetMese)
      .forEach((p) => { byLabel[p.consulenteLabel] = p.budget })
    setBudgetPerConsulente((prev) => ({ ...byLabel, ...prev }))
  }, [budgetModal, budgetData?.perConsulente, budgetAnno, budgetMese])

  const { data: storicoData } = useQuery({
    queryKey: ["vendite-storico", storicoAnno, consulenteFilter],
    queryFn: () => dataApi.getVenditeStorico(storicoAnno, consulenteFilter),
  })
  const venditeStorico = storicoData?.venditePerMese ?? []

  const { data: totaliAnniData } = useQuery({
    queryKey: ["totali-anni"],
    queryFn: () => dataApi.getTotaliAnni(),
    enabled: role === "admin",
  })
  const totaliAnni = totaliAnniData?.totali ?? []

  const oggiDate = new Date()
  const annoOggi = oggiDate.getFullYear()
  const meseOggi = oggiDate.getMonth() + 1
  const giornoOggi = oggiDate.getDate()

  const { data: dettaglioGiornoMese } = useQuery({
    queryKey: ["dettaglio-oggi-mese", annoOggi, meseOggi, giornoOggi, consulenteFilter],
    queryFn: () => dataApi.getDettaglioMese(annoOggi, meseOggi, giornoOggi, consulenteFilter),
  })

  const { data: dettaglioAnnoData } = useQuery({
    queryKey: ["dettaglio-anno", annoInCorso],
    queryFn: () => dataApi.getDettaglioAnno(annoInCorso),
  })

  function downloadReportTotaliAnni() {
    const header = "Anno;Vendite (€);Budget (€);% Raggiungimento\n"
    const rows = totaliAnni.map((r) => `${r.anno};${r.vendite.toFixed(2)};${r.budget.toFixed(2)};${r.percentuale}`).join("\n")
    const csv = "\uFEFF" + header + rows
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `report-totali-anni-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadReportStoricoAnno() {
    const header = "Mese;Anno;Vendite (€);Budget (€);% Raggiungimento\n"
    const rows = venditeStorico.map((r) => `${r.mese};${r.anno};${r.vendite.toFixed(2)};${r.budget.toFixed(2)};${r.percentuale}`).join("\n")
    const csv = "\uFEFF" + header + rows
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `report-storico-${storicoAnno}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">
            {role === "admin" ? "Panoramica del centro fitness" : "Le tue vendite"}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">— {oggi}</p>
        </div>
        {role === "admin" && (
          <button
            type="button"
            onClick={() => setBudgetModal(true)}
            className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
          >
            Imposta budget
          </button>
        )}
      </div>

      {/* Consulente: in primo piano due card (Giorno / Mese) con vendite e % obiettivo */}
      {role === "operatore" && (
        <div className="mt-6">
          <DettaglioVenditePrimoPiano />
        </div>
      )}

      {/* KPI: per operatore titolo "Riepilogo" per dare contesto */}
      <div className="mt-8">
        {role === "operatore" && (
          <h2 className="mb-3 text-sm font-medium text-zinc-500">Riepilogo</h2>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            {data.abbonamentiInScadenza} (30 gg) — {data.abbonamentiInScadenza60 ?? 0} (60 gg)
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
      </div>

      {/* Totale del giorno / Totale per mese / Totale per anno (stessi parametri per consulenti) */}
      {(dettaglioGiornoMese || dettaglioAnnoData) && (
        <div className="mt-8 space-y-8">
          {dettaglioGiornoMese && (
            <>
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                <h2 className="mb-3 text-lg font-semibold text-zinc-100">
                  {dettaglioGiornoMese.giornoLabel ?? `Giorno ${giornoOggi}/${meseOggi}/${annoOggi}`}
                </h2>
                <KpiRow b={dettaglioGiornoMese.dettaglioGiorno} />
                <TabellaConsulenti rows={dettaglioGiornoMese.dettaglioGiorno.perConsulente} />
              </section>
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                <h2 className="mb-3 text-lg font-semibold text-zinc-100">
                  {dettaglioGiornoMese.meseLabel ?? `Mese ${meseOggi} ${annoOggi}`}
                </h2>
                <KpiRow b={dettaglioGiornoMese.dettaglioMese} />
                <TabellaConsulenti rows={dettaglioGiornoMese.dettaglioMese.perConsulente} />
              </section>
            </>
          )}
          {dettaglioAnnoData && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="mb-3 text-lg font-semibold text-zinc-100">
                {dettaglioAnnoData.annoLabel}
              </h2>
              <KpiRow b={dettaglioAnnoData.dettaglio} />
              <TabellaConsulenti rows={dettaglioAnnoData.dettaglio.perConsulente} />
            </section>
          )}
        </div>
      )}

      {/* Admin: anno in corso e dettaglio mese (selettore anno per storico) */}
      {role === "admin" && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Anno in corso ({annoInCorso})</h2>
          <p className="mt-1 text-xs text-zinc-500">Riepilogo vendite e budget. Clicca su un mese sotto per il dettaglio di tutte le consulenti.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-left text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Anno</th>
                  <th className="pb-2 pr-4 font-medium text-right">Vendite (€)</th>
                  <th className="pb-2 pr-4 font-medium text-right">Budget (€)</th>
                  <th className="pb-2 font-medium text-right">% raggiungimento</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {totaliAnni.filter((r) => r.anno === annoInCorso).length === 0 && (
                  <tr><td colSpan={4} className="py-3 text-zinc-500">Nessun dato per l&apos;anno in corso.</td></tr>
                )}
                {totaliAnni.filter((r) => r.anno === annoInCorso).map((r) => (
                  <tr key={r.anno} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4 font-medium text-zinc-200">{r.anno}</td>
                    <td className="py-2 pr-4 text-right">€{r.vendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 pr-4 text-right">€{r.budget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-medium">{r.percentuale}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadReportTotaliAnni}
              disabled={totaliAnni.length === 0}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              Scarica report totali anni (CSV)
            </button>
            <button
              type="button"
              onClick={downloadReportStoricoAnno}
              disabled={venditeStorico.length === 0}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              Scarica report storico {storicoAnno} (CSV)
            </button>
          </div>
        </div>
      )}

      {/* Admin: storico vendite per anno, tutti i mesi, tutte le consulenti; clic mese → dettaglio giorno/mese */}
      {role === "admin" && (
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium text-zinc-400">Storico vendite e budget (tutti i mesi e consulenti)</h2>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Anno
            <select
              value={storicoAnno}
              onChange={(e) => setStoricoAnno(Number(e.target.value))}
              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
            >
              {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-1 text-xs text-zinc-500">Clicca su un mese per il dettaglio giorno e mese</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-left text-zinc-500">
                <th className="pb-2 pr-4 font-medium">Mese</th>
                <th className="pb-2 pr-4 font-medium text-right">Vendite</th>
                <th className="pb-2 pr-4 font-medium text-right">Budget</th>
                <th className="pb-2 font-medium text-right">% raggiungimento</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {venditeStorico.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => setDettaglioMese({ anno: row.anno, mese: row.meseNum, meseLabel: `${row.mese} ${row.anno}` })}
                  className="cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/50"
                >
                  <td className="py-2 pr-4 font-medium text-amber-400/90">{row.mese}</td>
                  <td className="py-2 pr-4 text-right">€{row.vendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 pr-4 text-right">€{row.budget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 text-right font-medium">{row.percentuale}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {dettaglioMese && (
        <DettaglioMeseModal
          anno={dettaglioMese.anno}
          mese={dettaglioMese.mese}
          meseLabel={dettaglioMese.meseLabel}
          onClose={() => setDettaglioMese(null)}
        />
      )}

      {/* Analisi: venduto, telefonate, ore lavorate */}
      {role === "admin" && chiamateStats && chiamateStats.perConsulente.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Telefonate fatte (analisi per consulente)</h2>
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
          <h2 className="text-sm font-medium text-zinc-400">In scadenza (30 giorni)</h2>
          <p className="mt-3 text-2xl font-semibold text-amber-400">{data.abbonamentiInScadenza ?? 0}</p>
          <p className="mt-0.5 text-xs text-zinc-500">totale</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">In scadenza (60 giorni)</h2>
          <p className="mt-3 text-2xl font-semibold text-amber-400">{data.abbonamentiInScadenza60 ?? 0}</p>
          <p className="mt-0.5 text-xs text-zinc-500">totale</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Ore lavorate</h2>
          <p className="mt-3 text-sm text-zinc-500">In sviluppo</p>
          <p className="mt-0.5 text-xs text-zinc-500">Analisi ore in preparazione</p>
        </div>
      </div>

      {budgetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-lg font-semibold text-zinc-100">Budget per consulente (totale mese = somma)</h3>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500">Anno</label>
                  <input
                    type="number"
                    value={budgetAnno}
                    onChange={(e) => setBudgetAnno(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500">Mese</label>
                  <select
                    value={budgetMese}
                    onChange={(e) => setBudgetMese(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  >
                    {["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"].map((nome, i) => (
                      <option key={i} value={i + 1}>{nome}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(budgetData?.consulenti ?? []).map((label) => (
                <div key={label}>
                  <label className="block text-xs text-zinc-500">Budget {label} (€)</label>
                  <input
                    type="number"
                    value={budgetPerConsulente[label] ?? 2000}
                    onChange={(e) => setBudgetPerConsulente((prev) => ({ ...prev, [label]: Number(e.target.value) }))}
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
              ))}
              <p className="text-xs text-zinc-500">
                Totale mese: €
                {(budgetData?.consulenti ?? []).reduce(
                  (s, label) => s + (budgetPerConsulente[label] ?? 2000),
                  0
                ).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setBudgetModal(false)} className="rounded-md border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Annulla
              </button>
              <button type="button" onClick={() => setBudgetMutation.mutate()} disabled={setBudgetMutation.isPending} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400">
                {setBudgetMutation.isPending ? "Salvataggio..." : "Salva"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
