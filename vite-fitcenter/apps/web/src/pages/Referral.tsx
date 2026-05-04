import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

export function Referral() {
  const { role, consulenteNome, consulenti } = useAuth()
  const [adminConsulente, setAdminConsulente] = useState("")
  const effectiveConsulente =
    role === "admin" ? (adminConsulente.trim() || undefined) : consulenteNome ?? undefined

  const query = useQuery({
    queryKey: ["referral-presentati", effectiveConsulente ?? ""],
    queryFn: () => dataApi.getReferralPresentati(effectiveConsulente),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: budgetData } = useQuery({
    queryKey: ["budget"],
    queryFn: () => dataApi.getBudget(),
    enabled: role === "admin",
  })

  const consulentiList =
    role === "admin" && budgetData?.consulenti?.length ? budgetData.consulenti : (consulenti ?? [])

  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    const items = query.data?.items ?? []
    if (!needle) return items
    return items.filter((it) =>
      `${it.cognome} ${it.nome} ${it.email ?? ""} ${it.telefono ?? ""} ${it.abbonamento ?? ""}`.toLowerCase().includes(needle)
    )
  }, [query.data, needle])

  const totaleFiltrato = useMemo(
    () => Math.round(filtered.reduce((s, x) => s + x.importoAbbonamento, 0) * 100) / 100,
    [filtered]
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Referral (porta un amico)</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Clienti presentati a te come consulente di riferimento, con ultimo abbonamento e totale importi (ultimo contratto).
        </p>
      </div>

      {role === "admin" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-sm text-zinc-400">
            Consulente
            <select
              value={adminConsulente}
              onChange={(e) => setAdminConsulente(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 sm:w-72"
            >
              <option value="">— scegli —</option>
              {consulentiList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {query.data?.hint ? <p className="text-xs text-amber-400/90 sm:self-end">{query.data.hint}</p> : null}
        </div>
      ) : null}

      {query.data?.hint && role !== "admin" ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{query.data.hint}</p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Cerca nominativo, email, telefono…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 sm:max-w-md"
        />
        <div className="text-right text-sm text-zinc-400">
          <div>
            Totale (lista): <span className="font-medium text-zinc-100">{eur(query.data?.totaleEuro ?? 0)}</span>
          </div>
          {needle ? (
            <div className="text-xs text-zinc-500">
              Filtrati: <span className="text-zinc-300">{eur(totaleFiltrato)}</span>
            </div>
          ) : null}
          {query.data?.presenterIdsResolved?.length ? (
            <div className="text-xs text-zinc-600">ID presentatore risolti: {query.data.presenterIdsResolved.join(", ")}</div>
          ) : null}
        </div>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-zinc-500">Caricamento…</p>
      ) : query.error ? (
        <p className="text-sm text-red-400">{(query.error as Error).message}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {role === "admin" && !adminConsulente.trim()
            ? "Seleziona una consulente per vedere i referral."
            : "Nessun cliente con presentatore impostato sui tuoi ID, oppure SQL non disponibile."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Contatti</th>
                <th className="px-3 py-2 font-medium">Abbonamento</th>
                <th className="px-3 py-2 font-medium">Inizio / fine</th>
                <th className="px-3 py-2 text-right font-medium">Importo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.clienteId} className="border-b border-zinc-800/80 hover:bg-zinc-900/40">
                  <td className="px-3 py-2 text-zinc-200">
                    <div className="font-medium">
                      {it.cognome} {it.nome}
                    </div>
                    <div className="text-xs text-zinc-600">ID {it.clienteId}</div>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {it.email ? <div className="truncate max-w-[200px]" title={it.email}>{it.email}</div> : <span className="text-zinc-600">—</span>}
                    {it.telefono ? <div className="text-xs text-zinc-500">{it.telefono}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {it.abbonamento ?? <span className="text-zinc-600">—</span>}
                    {it.idIscrizione ? <div className="text-xs text-zinc-600">Iscr. {it.idIscrizione}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {fmtDateIt(it.dataInizioAbb)} → {fmtDateIt(it.dataFineAbb)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-zinc-200">{eur(it.importoAbbonamento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
