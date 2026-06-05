import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

const ADMIN_TUTTI = "__ALL__"

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
  const { role, consulenti, consulenteNome } = useAuth()
  const [adminConsulente, setAdminConsulente] = useState(ADMIN_TUTTI)
  const [ym, setYm] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  })

  const year = Number(ym.slice(0, 4))
  const month = Number(ym.slice(5, 7))
  const adminTutti = role === "admin" && adminConsulente === ADMIN_TUTTI

  const { data: budgetData } = useQuery({
    queryKey: ["budget"],
    queryFn: () => dataApi.getBudget(),
    enabled: role === "admin",
  })
  const consulentiList =
    role === "admin" && budgetData?.consulenti?.length ? budgetData.consulenti : (consulenti ?? [])

  const query = useQuery({
    queryKey: ["referral-presentati", ym, role, adminTutti ? "tutti" : adminConsulente, consulenteNome],
    queryFn: () =>
      role === "admin"
        ? dataApi.getReferralPresentati({
            year,
            month,
            tutti: adminTutti ? true : undefined,
            consulente: adminTutti ? undefined : adminConsulente,
          })
        : dataApi.getReferralPresentati({ year, month, consulente: consulenteNome || undefined }),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    const items = query.data?.items ?? []
    if (!needle) return items
    return items.filter((it) =>
      `${it.cognome} ${it.nome} ${it.email ?? ""} ${it.telefono ?? ""} ${it.abbonamento ?? ""} ${it.presentatoDaNome ?? ""} ${it.dataPresentazione ?? ""}`.toLowerCase().includes(needle)
    )
  }, [query.data, needle])

  const totaleFiltrato = useMemo(
    () => Math.round(filtered.reduce((s, x) => s + x.totaleMese, 0) * 100) / 100,
    [filtered]
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Referral (porta un amico)</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Clienti con socio presentatore: il periodo filtra sulla{" "}
          <span className="text-zinc-400">data registrazione vendita</span> dell&apos;abbonamento (es. 04/06 anche se inizio
          abbonamento 01/07), non sulla data presentazione. Esclusi tesseramenti/attivazioni, solo importo pagato positivo.
          {role === "admin" ? (
            <> Admin: scegli «Tutti i venditori» o una consulente per filtrare le vendite attribuite.</>
          ) : (
            <> Operatore: solo referral con vendita attribuita a {consulenteNome || "te"}.</>
          )}
        </p>
      </div>

      {role === "admin" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-sm text-zinc-400">
            Consulente
            <select
              value={adminConsulente}
              onChange={(e) => setAdminConsulente(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 sm:w-80"
            >
              <option value={ADMIN_TUTTI}>Tutti i venditori</option>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Cerca nominativo, email, telefono…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 sm:max-w-md"
        />
        <div className="flex items-end justify-between gap-3 sm:justify-end">
          <label className="text-xs text-zinc-500">
            Mese
            <input
              type="month"
              value={ym}
              onChange={(e) => setYm(e.target.value)}
              className="mt-1 block rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <div className="text-right text-sm text-zinc-400">
            <div>
              Clienti referral:{" "}
              <span className="font-medium text-zinc-100">{query.data?.totaleClienti ?? (query.data?.items?.length ?? 0)}</span>
            </div>
            <div>
              Totale mese: <span className="font-medium text-zinc-100">{eur(query.data?.totaleEuro ?? 0)}</span>
            </div>
            {needle ? (
              <div className="text-xs text-zinc-500">
                Filtrati: {filtered.length} clienti · totale pagato mese{" "}
                <span className="text-zinc-300">{eur(totaleFiltrato)}</span>
              </div>
            ) : null}
            {query.data?.tuttiIVenditori ? (
              <div className="text-xs text-zinc-600">Vista: tutti i venditori</div>
            ) : query.data?.venditoreIdsResolved?.length ? (
              <div className="text-xs text-zinc-600">ID venditore: {query.data.venditoreIdsResolved.join(", ")}</div>
            ) : null}
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-zinc-500">Caricamento…</p>
      ) : query.error ? (
        <p className="text-sm text-red-400">{(query.error as Error).message}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nessun referral nel mese con questi criteri (presentatore, data presentazione o inizio abbonamento nel mese, importo pagato positivo
          {role === "admin" && !adminTutti ? ", venditore selezionato" : ""}), oppure SQL non disponibile.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[1060px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Data presentazione</th>
                <th className="px-3 py-2 font-medium">Presentato da</th>
                <th className="px-3 py-2 font-medium">Contatti</th>
                <th className="px-3 py-2 font-medium">Abbonamento</th>
                <th className="px-3 py-2 font-medium">Inizio / fine</th>
                <th className="px-3 py-2 text-right font-medium">Totale pagato (mese)</th>
                <th className="px-3 py-2 text-right font-medium">Pagato (riga)</th>
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
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-400 tabular-nums">
                    {it.dataPresentazione ? fmtDateIt(it.dataPresentazione) : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {it.presentatoDaNome ? (
                      <>
                        <div className="font-medium text-zinc-200">{it.presentatoDaNome}</div>
                        {it.presentatoDaId ? <div className="text-xs text-zinc-600">ID {it.presentatoDaId}</div> : null}
                      </>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
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
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-zinc-200">{eur(it.totaleMese)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-zinc-200">{eur(it.importoPagato)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
