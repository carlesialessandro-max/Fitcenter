import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { api } from "@/api/client"

type Segment = "all" | "adulti" | "bambini"

type IncassiResponse = {
  from: string
  to: string
  segment: Segment
  count: number
  total: number
  rows: Record<string, unknown>[]
}

function isoTodayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function eur(n: number): string {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" })
}

export function Incassi() {
  const { role } = useAuth()
  if (role !== "admin") return <Navigate to="/" replace />

  const [from, setFrom] = useState<string>(() => isoTodayLocal())
  const [to, setTo] = useState<string>(() => isoTodayLocal())
  const [segment, setSegment] = useState<Segment>("all")

  const q = useQuery({
    queryKey: ["incassi", from, to, segment],
    queryFn: () => api.get<IncassiResponse>(`/data/incassi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&segment=${segment}`),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  })

  const rows = q.data?.rows ?? []
  const cols = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) s.add(k)
    const preferred = ["DataOperazione", "DataPagamento", "Data", "Importo", "Totale", "Metodo", "Cognome", "Nome", "NomeCorso", "Descrizione"]
    const rest = Array.from(s).filter((k) => !preferred.includes(k)).sort((a, b) => a.localeCompare(b))
    return [...preferred.filter((k) => s.has(k)), ...rest].slice(0, 16)
  }, [rows])

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Incassi</h2>
            <p className="text-sm text-zinc-500">Da tabella/view pagamenti abbonamenti.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-zinc-500">
              Da
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              />
            </label>
            <label className="text-xs text-zinc-500">
              A
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 block rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Tipo
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value as Segment)}
                className="mt-1 block rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="all">Tutti</option>
                <option value="adulti">Adulti</option>
                <option value="bambini">Bambini</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-zinc-200">
            Totale: <span className="font-semibold text-amber-300">{eur(q.data?.total ?? 0)}</span>
          </div>
          <div className="text-zinc-500">
            Righe: <span className="text-zinc-200">{q.data?.count ?? 0}</span>
          </div>
          {q.isFetching ? <div className="text-zinc-500">Aggiornamento…</div> : null}
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="min-w-[900px] w-full table-auto">
          <thead className="bg-zinc-950/40">
            <tr className="text-left text-xs text-zinc-500">
              {cols.map((c) => (
                <th key={c} className="px-3 py-2">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className="border-t border-zinc-800 text-sm text-zinc-200">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2 whitespace-nowrap">
                    {String((r as any)[c] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {q.isError ? <div className="p-3 text-sm text-red-200">Errore caricamento incassi.</div> : null}
      </div>
    </div>
  )
}

