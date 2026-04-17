import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

type Tab = "elenco" | "settimane"

function CampusWeeksGrouped(props: {
  weekKey: string
  weeks: { key: string; label: string }[]
  list: any[]
  groupFilter: string
  patchCliente: (args: { clienteId: string; liv?: string; allergie?: string; genitore?: string; note?: string; gruppo?: string }) => void
  patchWeek: (args: { clienteId: string; weekKey: string; note?: string }) => void
}) {
  const { weekKey, weeks, list, groupFilter, patchCliente, patchWeek } = props
  const weekLabel = weeks.find((w) => w.key === weekKey)?.label ?? weekKey

  const enriched = useMemo(() => {
    return (list ?? [])
      .map((b) => {
        const weeksForB = new Set<string>()
        b.items?.forEach((it: any) => it.settimane?.forEach((w: string) => weeksForB.add(w)))
        const inWeek = weeksForB.has(weekKey)
        const weekGroup = b.weekNotes?.[weekKey]?.gruppo
        const groupEff = String(weekGroup || b.gruppo || "").trim() || "—"
        const liv = String(b.liv || "").trim() || "—"
        return { b, inWeek, groupEff, liv }
      })
      .filter((x) => x.inWeek)
      .filter((x) => (groupFilter ? x.groupEff === groupFilter : true))
      .sort((a, b) => a.b.cognomeNome.localeCompare(b.b.cognomeNome))
  }, [list, weekKey, groupFilter])

  const byGroup = useMemo(() => {
    const m = new Map<string, any[]>()
    enriched.forEach((x) => {
      const g = x.groupEff
      m.set(g, [...(m.get(g) ?? []), x])
    })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [enriched])

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/20 p-3">
      <div className="mb-3 text-sm text-zinc-400">
        Settimana selezionata: <span className="text-zinc-200 font-medium">{weekLabel}</span>
      </div>
      {byGroup.length === 0 ? (
        <div className="py-6 text-center text-zinc-500">Nessun bambino per questa settimana.</div>
      ) : (
        <div className="space-y-4">
          {byGroup.map(([groupName, rows]) => {
            const byLiv = new Map<string, any[]>()
            rows.forEach((x) => {
              const l = x.liv
              byLiv.set(l, [...(byLiv.get(l) ?? []), x])
            })
            const livBlocks = Array.from(byLiv.entries()).sort((a, b) => a[0].localeCompare(b[0]))
            return (
              <div key={groupName} className="rounded border border-zinc-800 bg-zinc-950/20 p-3">
                <div className="mb-2 text-sm font-semibold text-amber-300">
                  Gruppo: <span className="text-zinc-100">{groupName}</span>
                </div>
                <div className="space-y-3">
                  {livBlocks.map(([liv, items]) => (
                    <div key={liv}>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                        Livello {liv} · {items.length} bambini
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-left text-sm">
                          <thead>
                            <tr className="border-b border-zinc-800 text-zinc-500">
                              <th className="py-2 pr-3 font-medium">Cognome e nome</th>
                              <th className="py-2 pr-3 font-medium">LIV</th>
                              <th className="py-2 pr-3 font-medium">Allergie</th>
                              <th className="py-2 pr-3 font-medium">Note</th>
                              <th className="py-2 font-medium">Nota settimana</th>
                            </tr>
                          </thead>
                          <tbody className="text-zinc-200">
                            {items.map((x) => {
                              const b = x.b
                              const weekNoteVal = b.weekNotes?.[weekKey]?.note ?? ""
                              return (
                                <tr key={b.clienteId} className="border-b border-zinc-900/60 hover:bg-zinc-800/20">
                                  <td className="py-2 pr-3 font-medium">{b.cognomeNome}</td>
                                  <td className="py-2 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={b.liv ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== (b.liv ?? "")) patchCliente({ clienteId: b.clienteId, liv: v })
                                      }}
                                      className="w-16 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={b.allergie ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== (b.allergie ?? "")) patchCliente({ clienteId: b.clienteId, allergie: v })
                                      }}
                                      className="w-56 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={b.note ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== (b.note ?? "")) patchCliente({ clienteId: b.clienteId, note: v })
                                      }}
                                      className="w-[28rem] rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2">
                                    <input
                                      type="text"
                                      defaultValue={weekNoteVal}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== weekNoteVal) patchWeek({ clienteId: b.clienteId, weekKey, note: v })
                                      }}
                                      className="w-64 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                      placeholder="Nota settimana..."
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

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
  const [tab, setTab] = useState<Tab>("elenco")
  const [weekKey, setWeekKey] = useState("")
  const [groupFilter, setGroupFilter] = useState("")
  const importRef = useRef<HTMLInputElement | null>(null)

  const patchCliente = useMutation({
    mutationFn: (args: { clienteId: string; gruppo?: string; genitore?: string; liv?: string; allergie?: string; note?: string }) =>
      dataApi.patchCampusCliente(args.clienteId, { gruppo: args.gruppo, genitore: args.genitore, liv: args.liv, allergie: args.allergie, note: args.note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campus"] }),
  })
  const patchWeek = useMutation({
    mutationFn: (args: { clienteId: string; weekKey: string; note?: string }) =>
      dataApi.patchCampusWeekNote(args.clienteId, args.weekKey, { note: args.note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campus"] }),
  })

  const importPlanning = useMutation({
    mutationFn: async (file: File) => dataApi.importCampusPlanning(file),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["campus"] })
      alert(`Import completato. Aggiornati: ${r.updated} · Saltati: ${r.skipped}`)
    },
    onError: (e) => {
      alert(`Import fallito: ${(e as Error).message}`)
    },
  })

  const filtered = useMemo(() => {
    const list = data?.bambini ?? []
    if (!search.trim()) return list
    const s = search.trim().toLowerCase()
    return list.filter((c) => (c.cognomeNome || c.clienteNome).toLowerCase().includes(s))
  }, [data?.bambini, search])

  const groups = useMemo(() => {
    const set = new Set<string>()
    ;(data?.bambini ?? []).forEach((b) => {
      const g = (b.gruppo ?? "").trim()
      if (g) set.add(g)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [data?.bambini])

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
            Periodo: <span className="text-zinc-300">{data.range.from}</span> →{" "}
            <span className="text-zinc-300">{data.range.to}</span> · filtro:{" "}
            <span className="text-zinc-300">MacroCategoria=Corsi</span> e{" "}
            <span className="text-zinc-300">Categoria=Campus Sportivi</span>
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
          {(role === "admin" || role === "campus") && (
            <>
              <input
                ref={importRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  importPlanning.mutate(f)
                  e.target.value = ""
                }}
              />
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                disabled={importPlanning.isPending}
                className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                title="Importa da Excel (Planning Campus Sportivi)"
              >
                {importPlanning.isPending ? "Import..." : "Import Excel"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("elenco")}
          className={`rounded border px-3 py-1.5 text-sm ${
            tab === "elenco" ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          Elenco bambini
        </button>
        <button
          type="button"
          onClick={() => setTab("settimane")}
          className={`rounded border px-3 py-1.5 text-sm ${
            tab === "settimane" ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          Campus per settimane
        </button>
      </div>

      {tab === "settimane" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
          <label className="text-sm text-zinc-400">
            Settimana
            <select
              value={weekKey}
              onChange={(e) => setWeekKey(e.target.value)}
              className="ml-2 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-sm text-zinc-100"
            >
              <option value="">— Seleziona —</option>
              {data.weeks.map((w) => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-zinc-400">
            Gruppo
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="ml-2 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-sm text-zinc-100"
            >
              <option value="">Tutti</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <div className="text-xs text-zinc-500">
            {weekKey ? `Filtro settimana: ${data.weeks.find((w) => w.key === weekKey)?.label ?? weekKey}` : "Seleziona una settimana"}
          </div>
        </div>
      )}

      {tab === "settimane" && weekKey ? (
        <CampusWeeksGrouped
          weekKey={weekKey}
          weeks={data.weeks}
          list={filtered}
          groupFilter={groupFilter}
          patchCliente={(args) => patchCliente.mutate(args)}
          patchWeek={(args) => patchWeek.mutate(args)}
        />
      ) : null}

      {/* Quando lavoro per settimana, non mostro anche l'elenco completo sotto (evita doppio blocco). */}
      {!(tab === "settimane" && weekKey) && (
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/50">
            <tr>
              <th className="px-3 py-3 font-medium text-zinc-400">Cognome e nome</th>
              <th className="px-3 py-3 font-medium text-zinc-400 text-center">Età</th>
              <th className="px-3 py-3 font-medium text-zinc-400 text-center">LIV</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Allergie</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Genitore</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Cellulare</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Note</th>
              <th className="px-3 py-3 w-28 font-medium text-zinc-400 text-right whitespace-nowrap">Venduto</th>
              <th className="px-3 py-3 w-28 font-medium text-zinc-400 text-right whitespace-nowrap">Pagato</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Gruppo</th>
              {tab === "settimane" && <th className="px-3 py-3 font-medium text-zinc-400">Nota settimana</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered
              .filter((b) => (groupFilter ? (b.gruppo ?? "").trim() === groupFilter : true))
              .filter((b) => {
                if (tab !== "settimane") return true
                if (!weekKey) return true
                const weeksForB = new Set<string>()
                b.items.forEach((it) => it.settimane.forEach((w) => weeksForB.add(w)))
                return weeksForB.has(weekKey)
              })
              .map((b) => {
                const weekNoteVal = tab === "settimane" && weekKey ? (b.weekNotes?.[weekKey]?.note ?? "") : ""
                return (
                  <tr key={b.clienteId} className="hover:bg-zinc-800/20">
                    <td className="px-3 py-3 font-medium text-zinc-200">{b.cognomeNome || b.clienteNome}</td>
                    <td className="px-3 py-3 text-center text-zinc-300">{b.eta ?? "—"}</td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="text"
                        defaultValue={b.liv ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.liv ?? "")) patchCliente.mutate({ clienteId: b.clienteId, liv: v })
                        }}
                        className="w-16 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.allergie ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.allergie ?? "")) patchCliente.mutate({ clienteId: b.clienteId, allergie: v })
                        }}
                        className="w-64 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.genitore ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.genitore ?? "")) patchCliente.mutate({ clienteId: b.clienteId, genitore: v })
                        }}
                        className="w-48 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3 text-zinc-300">{b.cellulare ?? "—"}</td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.note ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.note ?? "")) patchCliente.mutate({ clienteId: b.clienteId, note: v })
                        }}
                        className="w-[28rem] rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-amber-300 tabular-nums whitespace-nowrap">
                      €{Number(b.totaleVenduto ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-emerald-300 tabular-nums whitespace-nowrap">
                      €{Number(b.totalePagato ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.gruppo ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.gruppo ?? "")) patchCliente.mutate({ clienteId: b.clienteId, gruppo: v })
                        }}
                        className="w-28 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                        placeholder="Gruppo..."
                      />
                    </td>
                    {tab === "settimane" && (
                      <td className="px-3 py-3">
                        {weekKey ? (
                          <input
                            type="text"
                            defaultValue={weekNoteVal}
                            onBlur={(e) => {
                              const v = e.target.value
                              if (v !== weekNoteVal) patchWeek.mutate({ clienteId: b.clienteId, weekKey, note: v })
                            }}
                            className="w-64 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                            placeholder="Nota settimana..."
                          />
                        ) : (
                          <span className="text-zinc-500">Seleziona una settimana</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={tab === "settimane" ? 11 : 10} className="px-4 py-10 text-center text-zinc-500">
                  Nessun bambino trovato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {(patchCliente.isPending || patchWeek.isPending) && (
        <div className="mt-3 text-xs text-zinc-500">Salvataggio...</div>
      )}
    </div>
  )
}

