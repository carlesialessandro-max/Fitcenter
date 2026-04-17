import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

export function Campus() {
  const { role } = useAuth()
  const queryClient = useQueryClient()
  if (role !== "admin" && role !== "campus") return <Navigate to="/" replace />

  const { data, isLoading, error } = useQuery({
    queryKey: ["campus"],
    queryFn: () => dataApi.getCampus(),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const [search, setSearch] = useState("")

  const patchCliente = useMutation({
    mutationFn: (args: { clienteId: string; allergie?: string; note?: string }) =>
      dataApi.patchCampusCliente(args.clienteId, { allergie: args.allergie, note: args.note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campus"] }),
  })
  const patchWeek = useMutation({
    mutationFn: (args: { clienteId: string; weekKey: string; note?: string }) =>
      dataApi.patchCampusWeekNote(args.clienteId, args.weekKey, { note: args.note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campus"] }),
  })

  const filtered = useMemo(() => {
    const list = data?.clienti ?? []
    if (!search.trim()) return list
    const s = search.trim().toLowerCase()
    return list.filter((c) => c.clienteNome.toLowerCase().includes(s))
  }, [data?.clienti, search])

  if (isLoading) return <div className="p-6 text-zinc-400">Caricamento...</div>
  if (error || !data) {
    return (
      <div className="p-6 text-red-400">
        Errore: {(error as Error)?.message ?? "Dati non disponibili"}. Avvia l’API backend.
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Campus sportivi</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Abbonamenti filtrati: <span className="text-zinc-300">MacroCategoria=Corsi</span> e{" "}
            <span className="text-zinc-300">Categoria=Campus Sportivi</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Cerca nominativo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["campus"] })}
            className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            title="Ricarica elenco"
          >
            Aggiorna
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/50">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-400">Nominativo</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Settimane</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Allergie</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.map((c) => {
              const weeksForCliente = new Set<string>()
              c.items.forEach((it) => it.settimane.forEach((w) => weeksForCliente.add(w)))
              const weekLabels = data.weeks
                .filter((w) => weeksForCliente.has(w.key))
                .map((w) => w.label)
                .join(", ")
              return (
                <tr key={c.clienteId} className="align-top hover:bg-zinc-800/20">
                  <td className="px-4 py-3 font-medium text-zinc-200">{c.clienteNome}</td>
                  <td className="px-4 py-3 text-zinc-300">
                    <div className="flex flex-wrap gap-2">
                      {data.weeks
                        .filter((w) => weeksForCliente.has(w.key))
                        .map((w) => {
                          const val = c.weekNotes?.[w.key]?.note ?? ""
                          return (
                            <div key={w.key} className="min-w-[12rem]">
                              <div className="mb-1 text-[11px] text-zinc-500">{w.label}</div>
                              <input
                                type="text"
                                defaultValue={val}
                                onBlur={(e) => {
                                  const next = e.target.value
                                  if (next !== val) patchWeek.mutate({ clienteId: c.clienteId, weekKey: w.key, note: next })
                                }}
                                placeholder="Nota settimana..."
                                className="w-full rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
                              />
                            </div>
                          )
                        })}
                      {!weekLabels && <span className="text-zinc-500">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <textarea
                      defaultValue={c.allergie ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value
                        if (v !== (c.allergie ?? "")) patchCliente.mutate({ clienteId: c.clienteId, allergie: v })
                      }}
                      rows={2}
                      placeholder="Allergie..."
                      className="w-72 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <textarea
                      defaultValue={c.note ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value
                        if (v !== (c.note ?? "")) patchCliente.mutate({ clienteId: c.clienteId, note: v })
                      }}
                      rows={2}
                      placeholder="Note..."
                      className="w-80 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
                    />
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-zinc-500">
                  Nessun abbonamento Campus Sportivi trovato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(patchCliente.isPending || patchWeek.isPending) && (
        <div className="mt-3 text-xs text-zinc-500">Salvataggio...</div>
      )}
    </div>
  )
}

