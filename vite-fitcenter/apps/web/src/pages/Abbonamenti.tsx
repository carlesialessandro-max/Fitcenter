import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { Button } from "@workspace/ui/components/button"
import type { CategoriaAbbonamento } from "@/types/gestionale"

const CATEGORIE: CategoriaAbbonamento[] = ["palestra", "piscina", "spa", "corsi", "full_premium"]
const CAT_LABELS: Record<CategoriaAbbonamento, string> = {
  palestra: "Palestra",
  piscina: "Piscina",
  spa: "Spa",
  corsi: "Corsi",
  full_premium: "Full Premium",
}
const CAT_COLORS: Record<CategoriaAbbonamento, string> = {
  palestra: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  piscina: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  spa: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  corsi: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  full_premium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
}

export function Abbonamenti() {
  const [tab, setTab] = useState<"abbonamenti" | "catalogo" | "andamento">("abbonamenti")
  const [search, setSearch] = useState("")
  const [statoFilter, setStatoFilter] = useState<string>("")

  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => dataApi.getDashboard(),
  })
  const { data: abbonamenti = [], isLoading, error } = useQuery({
    queryKey: ["data", "abbonamenti"],
    queryFn: () => dataApi.getAbbonamenti(),
  })

  const filtered = abbonamenti.filter((a) => {
    const matchSearch =
      !search ||
      a.clienteNome.toLowerCase().includes(search.toLowerCase()) ||
      a.pianoNome.toLowerCase().includes(search.toLowerCase())
    const matchStato = !statoFilter || a.stato === statoFilter
    return matchSearch && matchStato
  })

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Abbonamenti & Vendite</h1>
          <p className="text-sm text-zinc-400">Gestione abbonamenti, vendite e budget</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">Imposta Budget</Button>
          <Button>Vendi Abbonamento</Button>
        </div>
      </div>

      {/* KPI */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Abbonamenti attivi</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-400">
            {dashboard?.abbonamentiAttivi ?? abbonamenti.filter((a) => a.stato === "attivo").length}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Entrate mese corrente</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">
            €{(dashboard?.entrateMese ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Budget mese</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            €{(dashboard?.budgetMese ?? 6000).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {dashboard?.percentualeBudget ?? 0}% raggiunto
          </p>
        </div>
      </div>

      {/* Tab */}
      <div className="mt-6 flex gap-2 border-b border-zinc-800">
        {(["abbonamenti", "catalogo", "andamento"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t === "abbonamenti" && "Abbonamenti"}
            {t === "catalogo" && "Catalogo Piani"}
            {t === "andamento" && "Andamento Vendite"}
          </button>
        ))}
      </div>

      {tab === "abbonamenti" && (
        <>
          <div className="mt-4 flex flex-wrap gap-4">
            <input
              type="search"
              placeholder="Cerca per piano, cliente, consulente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-[240px] flex-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
            />
            <select
              value={statoFilter}
              onChange={(e) => setStatoFilter(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="">Tutti gli stati</option>
              <option value="attivo">Attivo</option>
              <option value="scaduto">Scaduto</option>
            </select>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
            {isLoading && (
              <div className="flex justify-center py-12 text-zinc-400">Caricamento...</div>
            )}
            {error && (
              <div className="py-8 text-center text-red-400">{(error as Error).message}</div>
            )}
            {!isLoading && !error && (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-800 bg-zinc-900/50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-zinc-400">Cliente</th>
                    <th className="px-4 py-3 font-medium text-zinc-400">Piano</th>
                    <th className="px-4 py-3 font-medium text-zinc-400">Categoria</th>
                    <th className="px-4 py-3 font-medium text-zinc-400">Prezzo</th>
                    <th className="px-4 py-3 font-medium text-zinc-400">Inizio</th>
                    <th className="px-4 py-3 font-medium text-zinc-400">Fine</th>
                    <th className="px-4 py-3 font-medium text-zinc-400">Stato</th>
                    <th className="px-4 py-3 font-medium text-zinc-400">Consulente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filtered.map((a) => (
                    <tr key={a.id} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-medium text-zinc-200">{a.clienteNome}</td>
                      <td className="px-4 py-3 text-zinc-300">{a.pianoNome}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${CAT_COLORS[a.categoria]}`}
                        >
                          {CAT_LABELS[a.categoria]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        €{a.prezzo.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {new Date(a.dataInizio).toLocaleDateString("it-IT")}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {new Date(a.dataFine).toLocaleDateString("it-IT")}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                            a.stato === "attivo"
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-red-500/20 text-red-400 border-red-500/30"
                          }`}
                        >
                          {a.stato === "attivo" ? "Attivo" : "Scaduto"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{a.consulenteNome ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {tab === "catalogo" && (
        <div className="mt-4 rounded-lg border border-zinc-800 p-6 text-center text-zinc-500">
          Catalogo piani (in sviluppo)
        </div>
      )}
      {tab === "andamento" && (
        <div className="mt-4 rounded-lg border border-zinc-800 p-6 text-center text-zinc-500">
          Andamento vendite (grafico in sviluppo)
        </div>
      )}
    </div>
  )
}
