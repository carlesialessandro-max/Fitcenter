import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { chiamateApi, type Chiamata } from "@/api/chiamate"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import { ChiamaButton } from "@/components/ChiamaButton"

function isoToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function isoAddDays(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T12:00:00`)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function Telefonate() {
  const { role, consulenteFilter, consulenteNome, consulenti } = useAuth()
  const [adminConsulente, setAdminConsulente] = useState("")
  const effectiveConsulente =
    role === "admin" ? (adminConsulente.trim() ? adminConsulente.trim() : "") : (consulenteFilter ?? consulenteNome ?? "")

  const [da, setDa] = useState(() => isoAddDays(isoToday(), -7))
  const [a, setA] = useState(() => isoToday())
  const [crmTo, setCrmTo] = useState(() => isoAddDays(isoToday(), 14))

  const { data: chiamate = [], isLoading: loadingChiamate, error: errChiamate } = useQuery({
    queryKey: ["chiamate", "telefonate", role, effectiveConsulente, da, a],
    queryFn: () => chiamateApi.list({ da, a, consulenteId: role === "admin" ? (effectiveConsulente || undefined) : undefined }),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: crm, isLoading: loadingCrm, error: errCrm } = useQuery({
    queryKey: ["data", "crm-appuntamenti-operatore", role, effectiveConsulente, a, crmTo],
    queryFn: () => dataApi.getCrmAppuntamentiOperatore({ consulente: role === "admin" ? (effectiveConsulente || undefined) : undefined, from: a, to: crmTo }),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const chiamateCliente = useMemo(() => chiamate.filter((c) => c.tipo === "cliente"), [chiamate])
  const chiamateLead = useMemo(() => chiamate.filter((c) => c.tipo === "lead"), [chiamate])

  const fmtDateTime = (iso: string) =>
    iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Telefonate</h1>
          <p className="text-sm text-zinc-400">Storico chiamate e promemoria CRM.</p>
        </div>
      </div>

      {role === "admin" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3">
          <span className="text-sm font-medium text-zinc-300">Filtro consulente</span>
          <select
            value={adminConsulente}
            onChange={(e) => setAdminConsulente(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">Tutte le consulenti</option>
            {(consulenti ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">Se vuoto: per le chiamate mostra tutte; per CRM mostra quelle assegnate all’operatore selezionato.</p>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">Chiamate (range)</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-400">{chiamate.length}</p>
          <p className="mt-1 text-xs text-zinc-500">Clienti: {chiamateCliente.length} · Lead: {chiamateLead.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">CRM programmati</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">{crm?.rows?.length ?? 0}</p>
          <p className="mt-1 text-xs text-zinc-500">Da {a} a {crmTo}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">Filtri</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-500">
              Da
              <input value={da} onChange={(e) => setDa(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100" />
            </label>
            <label className="text-xs text-zinc-500">
              A
              <input value={a} onChange={(e) => setA(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100" />
            </label>
            <label className="col-span-2 text-xs text-zinc-500">
              CRM fino a
              <input value={crmTo} onChange={(e) => setCrmTo(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100" />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">CRM programmati</h2>
          {loadingCrm ? (
            <p className="mt-2 text-sm text-zinc-500">Caricamento...</p>
          ) : errCrm ? (
            <p className="mt-2 text-sm text-red-400">{(errCrm as Error).message}</p>
          ) : (crm?.rows?.length ?? 0) === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nessun appuntamento programmato nel range.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-zinc-800">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="px-3 py-2 font-medium text-zinc-400">Data</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Nome</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Cognome</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Tel</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Tipo</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Esito</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">CRM</th>
                    <th className="px-3 py-2 font-medium text-zinc-400"></th>
                  </tr>
                </thead>
                <tbody>
                  {(crm?.rows ?? []).map((r, i) => (
                    <tr key={i} className="border-b border-zinc-900 last:border-0">
                      <td className="px-3 py-2 text-zinc-200">{fmtDateTime(r.dataAppuntamento)}</td>
                      <td className="px-3 py-2 text-zinc-300">{(r.nome ?? "").trim() || "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{(r.cognome ?? "").trim() || "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{r.telefono || "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{r.tipoDescrizione || "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{r.esitoDescrizione || "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{r.crmDescrizione || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {r.telefono ? (
                          <ChiamaButton
                            telefono={r.telefono}
                            nomeContatto={`${(r.nome ?? "").trim()} ${(r.cognome ?? "").trim()}`.trim() || r.crmDescrizione || "CRM"}
                            tipo="cliente"
                            registraAlClick
                          />
                        ) : (
                          <span className="text-xs text-zinc-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Chiamate effettuate</h2>
          {loadingChiamate ? (
            <p className="mt-2 text-sm text-zinc-500">Caricamento...</p>
          ) : errChiamate ? (
            <p className="mt-2 text-sm text-red-400">{(errChiamate as Error).message}</p>
          ) : chiamate.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nessuna chiamata nel range.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-zinc-800">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="px-3 py-2 font-medium text-zinc-400">Data</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Nome</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Tipo</th>
                    <th className="px-3 py-2 font-medium text-zinc-400">Tel</th>
                    <th className="px-3 py-2 font-medium text-zinc-400"></th>
                  </tr>
                </thead>
                <tbody>
                  {chiamate.map((c: Chiamata) => (
                    <tr key={c.id} className="border-b border-zinc-900 last:border-0">
                      <td className="px-3 py-2 text-zinc-200">{fmtDateTime(c.dataOra)}</td>
                      <td className="px-3 py-2 text-zinc-300">{c.nomeContatto}</td>
                      <td className="px-3 py-2 text-zinc-300">{c.tipo}</td>
                      <td className="px-3 py-2 text-zinc-300">{c.telefono}</td>
                      <td className="px-3 py-2 text-right">
                        <ChiamaButton
                          telefono={c.telefono}
                          nomeContatto={c.nomeContatto}
                          tipo={c.tipo}
                          leadId={c.leadId}
                          clienteId={c.clienteId}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

