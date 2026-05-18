import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

const MESI = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
]

function euro(n: number) {
  return `€${n.toLocaleString("it-IT", { minimumFractionDigits: 2 })}`
}

export function VenditeCross() {
  const { role, consulenteFilter, consulenti } = useAuth()
  const now = new Date()
  const [anno, setAnno] = useState(now.getFullYear())
  const [mese, setMese] = useState(now.getMonth() + 1)
  const [adminConsulente, setAdminConsulente] = useState("")

  const effectiveConsulente =
    role === "admin" ? (adminConsulente.trim() || undefined) : consulenteFilter

  const { data: budgetData } = useQuery({
    queryKey: ["budget"],
    queryFn: () => dataApi.getBudget(),
    enabled: role === "admin",
  })
  const consulentiList =
    role === "admin" && budgetData?.consulenti?.length ? budgetData.consulenti : (consulenti ?? [])

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["vendite-cross", anno, mese, effectiveConsulente ?? ""],
    queryFn: () =>
      dataApi.getVenditeCross({
        anno,
        mese,
        consulente: effectiveConsulente,
      }),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 120_000,
    gcTime: 300_000,
  })

  const rows = data?.rows ?? []

  return (
    <div className="p-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Cross (cambio tipologia)</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Un evento cross nel log = una riga (prima IDIscrizione del cliente nel giorno).
          Totale = rate pagate nel mese + rate future. Stesso importo incluso in dashboard.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3">
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Anno
          <select
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value))}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {[anno - 1, anno, anno + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Mese
          <select
            value={mese}
            onChange={(e) => setMese(Number(e.target.value))}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {MESI.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {role === "admin" && (
          <label className="flex flex-col gap-1 text-sm text-zinc-300">
            Consulente
            <select
              value={adminConsulente}
              onChange={(e) => setAdminConsulente(e.target.value)}
              className="min-w-[180px] rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
            >
              <option value="">Tutte</option>
              {consulentiList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        {isFetching && !isLoading && (
          <span className="pb-2 text-xs text-zinc-500">Aggiornamento…</span>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
        {isLoading ? (
          <div className="py-10 text-center text-zinc-400">
            Caricamento cross…
          </div>
        ) : error ? (
          <div className="py-6 text-center text-red-400">{(error as Error).message}</div>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-violet-500/40 bg-violet-500/10 p-4">
              <p className="text-xs uppercase tracking-wider text-violet-300">Totale cross</p>
              <p className="mt-1 text-2xl font-semibold text-violet-200">{euro(data?.totale ?? 0)}</p>
              <p className="mt-1 text-xs text-zinc-500">
                Periodo {data?.from} → {data?.to} · {rows.length} righe
              </p>
            </div>

            {rows.length === 0 ? (
              <div className="py-8 text-center text-zinc-500">Nessun cross nel periodo selezionato.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 text-zinc-400">
                      <th className="py-2 pr-3 font-medium">Data</th>
                      <th className="py-2 pr-3 font-medium">Cliente</th>
                      <th className="py-2 pr-3 font-medium">Abbonamento</th>
                      <th className="py-2 pr-3 text-right font-medium">Rate pagate (mese)</th>
                      <th className="py-2 pr-3 text-right font-medium">Rate future</th>
                      <th className="py-2 pr-3 text-right font-medium">Mov. U</th>
                      <th className="py-2 text-right font-medium">Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.idIscrizione}-${r.dataCross}`} className="border-b border-zinc-800/80">
                        <td className="py-2 pr-3 text-zinc-300">{r.dataCross}</td>
                        <td className="py-2 pr-3 text-zinc-100">{r.cliente || "—"}</td>
                        <td
                          className="max-w-[200px] truncate py-2 pr-3 text-zinc-400"
                          title={r.abbonamento}
                        >
                          {r.abbonamento || "—"}
                        </td>
                        <td className="py-2 pr-3 text-right text-zinc-300">{euro(r.ratePagateMese)}</td>
                        <td className="py-2 pr-3 text-right text-zinc-300">{euro(r.rateFuture)}</td>
                        <td className="py-2 pr-3 text-right text-zinc-500">{euro(r.movimentoU)}</td>
                        <td className="py-2 text-right font-medium text-violet-300">{euro(r.totale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
