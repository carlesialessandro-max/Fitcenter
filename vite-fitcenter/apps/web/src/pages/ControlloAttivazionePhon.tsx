import { useState } from "react"
import { Navigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

function formatData(value: string): string {
  if (!value) return "—"
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("it-IT")
}

export function ControlloAttivazionePhon() {
  const { role } = useAuth()
  const [sogliaInput, setSogliaInput] = useState("2")
  const soglia = Math.max(2, Number(sogliaInput) || 2)
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["controllo-attivazione-phon", soglia],
    queryFn: () => dataApi.getControlloAttivazionePhon(soglia),
    enabled: role === "admin",
    retry: false,
  })

  if (role !== "admin") return <Navigate to="/" replace />

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Controllo attivazioni Phone</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Clienti con più inserimenti dell&apos;abbonamento Attivazione Phon nello storico gestionale.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          Aggiorna
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <label htmlFor="soglia-attivazioni" className="text-sm text-zinc-300">
          Mostra chi ha almeno
        </label>
        <input
          id="soglia-attivazioni"
          type="number"
          min={2}
          step={1}
          value={sogliaInput}
          onChange={(event) => setSogliaInput(event.target.value)}
          className="w-24 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
        />
        <span className="text-sm text-zinc-300">inserimenti del servizio</span>
      </div>

      {isLoading && <p className="mt-6 text-sm text-zinc-400">Caricamento abbonamenti…</p>}
      {error && (
        <p className="mt-6 rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          {(error as Error).message || "Errore nel caricamento dei dati."}
        </p>
      )}

      {data && !isLoading && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm text-zinc-400">Clienti con almeno {data.soglia} inserimenti</p>
              <p className="mt-1 text-2xl font-semibold text-amber-300">{data.totaleClienti}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm text-zinc-400">Inserimenti trovati in elenco</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">{data.totaleAttivazioni}</p>
            </div>
          </div>

          {data.clienti.length === 0 ? (
            <p className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
              Nessun cliente raggiunge questa soglia.
            </p>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-left text-sm">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Cliente</th>
                    <th scope="col" className="px-4 py-3 font-medium">Inserimenti</th>
                    <th scope="col" className="px-4 py-3 font-medium">Dettaglio abbonamenti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                  {data.clienti.map((cliente) => (
                    <tr key={cliente.clienteId} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-100">
                        {cliente.clienteNome}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex min-w-8 justify-center rounded-full bg-amber-500/15 px-2 py-1 font-semibold text-amber-200">
                          {cliente.numeroAttivazioni}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ul className="space-y-1 text-zinc-300">
                          {cliente.attivazioni.map((attivazione) => (
                            <li key={attivazione.id}>
                              <span className="text-zinc-100">{attivazione.abbonamento}</span>
                              <span className="text-zinc-500">
                                {" "}
                                · dal {formatData(attivazione.dataInizio)} al {formatData(attivazione.dataFine)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
