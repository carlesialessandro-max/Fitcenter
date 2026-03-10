import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { ChiamaButton } from "@/components/ChiamaButton"

export function Clienti() {
  const [search, setSearch] = useState("")
  const [filterStato, setFilterStato] = useState<string>("")

  const { data: clienti = [], isLoading, error } = useQuery({
    queryKey: ["data", "clienti"],
    queryFn: () => dataApi.getClienti(),
  })

  const filtered = useMemo(() => {
    let list = [...clienti]
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(
        (c) =>
          `${c.nome} ${c.cognome}`.toLowerCase().includes(s) ||
          c.email.toLowerCase().includes(s) ||
          (c.telefono && c.telefono.includes(s)) ||
          (c.codiceFiscale && c.codiceFiscale.toLowerCase().includes(s))
      )
    }
    if (filterStato === "attivo") list = list.filter((c) => c.stato === "attivo")
    if (filterStato === "inattivo") list = list.filter((c) => c.stato === "inattivo")
    return list
  }, [clienti, search, filterStato])

  const totale = clienti.length
  const attivi = clienti.filter((c) => c.stato === "attivo").length
  const inattivi = clienti.filter((c) => c.stato === "inattivo").length

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Gestione Clienti</h1>
          <p className="text-sm text-zinc-400">Anagrafica e storico clienti</p>
        </div>
        <button className="inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400">
          + Nuovo Cliente
        </button>
      </div>

      {/* KPI */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Totale clienti</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">{totale}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Clienti attivi</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-400">{attivi}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Clienti inattivi</p>
          <p className="mt-1 text-2xl font-semibold text-red-400">{inattivi}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-4">
        <input
          type="search"
          placeholder="Cerca per nome, email, telefono, codice fiscale..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[280px] flex-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
        />
        <select
          value={filterStato}
          onChange={(e) => setFilterStato(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100"
        >
          <option value="">Tutti</option>
          <option value="attivo">Attivi</option>
          <option value="inattivo">Inattivi</option>
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
                <th className="px-4 py-3 font-medium text-zinc-400">Nome</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Email</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Telefono</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Città</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Abb. attivi</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Stato</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-800/30">
                  <td className="px-4 py-3 font-medium text-zinc-200">
                    {c.nome} {c.cognome}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{c.email}</td>
                  <td className="px-4 py-3 text-zinc-300">{c.telefono}</td>
                  <td className="px-4 py-3 text-zinc-400">{c.citta}</td>
                  <td className="px-4 py-3 text-zinc-300">{c.abbonamentiAttivi}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                        c.stato === "attivo"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/20 text-red-400 border-red-500/30"
                      }`}
                    >
                      {c.stato === "attivo" ? "Attivo" : "Inattivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {c.telefono && (
                        <ChiamaButton
                          telefono={c.telefono}
                          nomeContatto={`${c.nome} ${c.cognome}`}
                          tipo="cliente"
                          clienteId={c.id}
                        />
                      )}
                      <button className="text-zinc-400 hover:text-zinc-200" title="Dettaglio">
                        👁
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
