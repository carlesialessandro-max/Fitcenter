import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import { ChiamaButton } from "@/components/ChiamaButton"
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
  const { role, consulenteFilter } = useAuth()
  const [tab, setTab] = useState<"abbonamenti" | "andamento">("abbonamenti")

  const { data: dashboard } = useQuery({
    queryKey: ["dashboard", consulenteFilter],
    queryFn: () => dataApi.getDashboard(consulenteFilter),
  })
  const { data: abbonamenti = [], isLoading, error } = useQuery({
    queryKey: ["data", "abbonamenti", consulenteFilter],
    queryFn: () => dataApi.getAbbonamenti(consulenteFilter),
  })
  const { data: clienti = [] } = useQuery({
    queryKey: ["data", "clienti"],
    queryFn: () => dataApi.getClienti(),
  })

  const telefonoByClienteId = useMemo(() => {
    const map = new Map<string, string>()
    clienti.forEach((c) => map.set(c.id, c.telefono ?? ""))
    return map
  }, [clienti])

  /** Solo abbonamenti attivi che scadono da oggi a 60 giorni, ordinati per data scadenza */
  const listaAbbonamenti = useMemo(() => {
    const oggi = new Date()
    oggi.setHours(0, 0, 0, 0)
    const tra60 = new Date(oggi)
    tra60.setDate(tra60.getDate() + 60)
    return abbonamenti
      .filter((a) => {
        if (a.stato !== "attivo") return false
        const fine = new Date(a.dataFine)
        fine.setHours(0, 0, 0, 0)
        return fine >= oggi && fine <= tra60
      })
      .sort((a, b) => new Date(a.dataFine).getTime() - new Date(b.dataFine).getTime())
  }, [abbonamenti])

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Abbonamenti & Vendite</h1>
          <p className="text-sm text-zinc-400">Gestione abbonamenti, vendite e budget</p>
        </div>
        {role === "admin" && (
          <a href="/" className="rounded-md border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">
            Imposta budget (Dashboard)
          </a>
        )}
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

      {/* Tab: Abbonamenti e Andamento Vendite (no Catalogo Piani) */}
      <div className="mt-6 flex gap-2 border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("abbonamenti")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "abbonamenti" ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Abbonamenti
        </button>
        <button
          type="button"
          onClick={() => setTab("andamento")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "andamento" ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Andamento Vendite
        </button>
      </div>

      {tab === "abbonamenti" && (
      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="text-sm font-medium text-zinc-400">Abbonamenti</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Abbonamenti attivi in scadenza da oggi a 60 giorni, ordinati per data di scadenza
        </p>
        <div className="mt-4 overflow-x-auto">
          {isLoading && (
            <div className="flex justify-center py-12 text-zinc-400">Caricamento...</div>
          )}
          {error && (
            <div className="py-8 text-center text-red-400">{(error as Error).message}</div>
          )}
          {!isLoading && !error && listaAbbonamenti.length === 0 && (
            <p className="text-sm text-zinc-500">Nessun abbonamento in scadenza nei prossimi 60 giorni.</p>
          )}
          {!isLoading && !error && listaAbbonamenti.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Cliente</th>
                  <th className="pb-2 pr-4 font-medium">Piano</th>
                  <th className="pb-2 pr-4 font-medium">Categoria</th>
                  <th className="pb-2 pr-4 font-medium">Prezzo</th>
                  <th className="pb-2 pr-4 font-medium">Scadenza</th>
                  <th className="pb-2 pr-4 font-medium">Consulente</th>
                  <th className="pb-2 font-medium">Azioni</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {listaAbbonamenti.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2 pr-4 font-medium text-zinc-200">{a.clienteNome}</td>
                    <td className="py-2 pr-4">{a.pianoNome}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${CAT_COLORS[a.categoria]}`}>
                        {CAT_LABELS[a.categoria]}
                      </span>
                    </td>
                    <td className="py-2 pr-4">€{a.prezzo.toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 pr-4 text-amber-400">{new Date(a.dataFine).toLocaleDateString("it-IT")}</td>
                    <td className="py-2 pr-4 text-zinc-400">{a.consulenteNome ?? "—"}</td>
                    <td className="py-2">
                      {telefonoByClienteId.get(a.clienteId) ? (
                        <ChiamaButton
                          telefono={telefonoByClienteId.get(a.clienteId)!}
                          nomeContatto={a.clienteNome}
                          tipo="cliente"
                          clienteId={a.clienteId}
                        />
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
