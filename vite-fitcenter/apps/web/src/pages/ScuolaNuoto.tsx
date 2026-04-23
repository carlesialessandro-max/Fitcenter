import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { scuolaNuotoApi, type ScuolaNuotoCorso } from "@/api/scuolaNuoto"
import { useAuth } from "@/contexts/AuthContext"
import { Navigate } from "react-router-dom"

function corsoTitle(c: ScuolaNuotoCorso): string {
  const orario = c.oraInizio && c.oraFine ? `${c.oraInizio}-${c.oraFine}` : c.oraInizio ? c.oraInizio : ""
  const parts = [
    orario,
    c.corso,
    c.livello ? `Livello ${c.livello}` : null,
    c.istruttore ? `Istr: ${c.istruttore}` : null,
    c.corsia ? `Corsia ${c.corsia}` : null,
    c.servizio,
    c.vasca,
  ].filter(Boolean)
  return parts.join(" · ")
}

export function ScuolaNuoto() {
  const { role } = useAuth()
  if (role === "firme") return <Navigate to="/firma-cassa" replace />
  if (role !== "admin" && role !== "scuola_nuoto") return <Navigate to="/" replace />

  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ["scuola-nuoto", "today"],
    queryFn: () => scuolaNuotoApi.today(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const corsi = q.data?.corsi ?? []

  const selected = useMemo(() => {
    if (!corsi.length) return null
    const direct = selectedKey ? corsi.find((c) => c.key === selectedKey) : null
    return direct ?? corsi[0] ?? null
  }, [corsi, selectedKey])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Scuola Nuoto</h2>
            <p className="text-sm text-zinc-500">
              {q.data ? (
                <>
                  {q.data.weekday} · {q.data.today} · corsi: {q.data.corsi.length} (righe: {q.data.countMatched}/{q.data.countRows})
                </>
              ) : (
                "Corsi del giorno della settimana (per periodo)"
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 sm:mt-0 sm:w-auto"
          >
            Aggiorna
          </button>
        </div>
        {q.isError ? (
          <div className="mt-3 rounded-lg border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-200">
            Errore nel caricamento corsi.
          </div>
        ) : null}
        {q.isLoading ? <div className="mt-3 text-sm text-zinc-400">Caricamento...</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[320px_1fr]">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="mb-2 text-xs font-medium text-zinc-500">Corsi</div>
          <div className="flex flex-col gap-1">
            {corsi.length === 0 && !q.isLoading ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-500">Nessun corso trovato.</div>
            ) : null}
            {corsi.map((c) => {
              const active = selected?.key === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setSelectedKey(c.key)}
                  className={
                    "w-full rounded-lg border px-3 py-2 text-left transition-colors " +
                    (active
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-800/60")
                  }
                >
                  <div className="truncate text-sm font-medium">{corsoTitle(c)}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    Iscritti: <span className="text-zinc-300">{c.utenti.length}</span>
                    {c.periodo ? <span className="ml-2">· {c.periodo}</span> : null}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-medium text-zinc-500">Partecipanti</div>
              <div className="text-sm font-semibold text-zinc-100">{selected ? corsoTitle(selected) : "—"}</div>
            </div>
            <div className="text-xs text-zinc-500">
              Totale: <span className="text-zinc-200">{selected?.utenti.length ?? 0}</span>
            </div>
          </div>

          {selected?.utenti?.length ? (
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <table className="w-full table-auto">
                <thead className="bg-zinc-950/40">
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="px-3 py-2">Nome</th>
                    <th className="px-3 py-2">Cognome</th>
                    <th className="px-3 py-2">Età</th>
                    <th className="px-3 py-2">Cellulare</th>
                    <th className="px-3 py-2">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.utenti.map((u, idx) => (
                    <tr key={`${u.nome ?? ""}-${u.cognome ?? ""}-${idx}`} className="border-t border-zinc-800 text-sm">
                      <td className="px-3 py-2">{u.nome ?? "—"}</td>
                      <td className="px-3 py-2">{u.cognome ?? "—"}</td>
                      <td className="px-3 py-2">{u.eta ?? "—"}</td>
                      <td className="px-3 py-2">{u.cellulare ?? "—"}</td>
                      <td className="px-3 py-2">{u.email ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-500">
              Seleziona un corso per vedere gli utenti.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

