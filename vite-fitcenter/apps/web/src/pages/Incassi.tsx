import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { api } from "@/api/client"

type Segment = "all" | "adulti" | "bambini" | "danza" | "ticket"

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

function fmtDateTimeIt(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) {
    const d = v
    const dd = String(d.getDate()).padStart(2, "0")
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const yy = d.getFullYear()
    const hh = String(d.getHours()).padStart(2, "0")
    const mi = String(d.getMinutes()).padStart(2, "0")
    const ss = String(d.getSeconds()).padStart(2, "0")
    return `${dd}/${mm}/${yy} ${hh}:${mi}:${ss}`
  }
  const s = String(v)
  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) return null
  const dd = String(dt.getDate()).padStart(2, "0")
  const mm = String(dt.getMonth() + 1).padStart(2, "0")
  const yy = dt.getFullYear()
  const hh = String(dt.getHours()).padStart(2, "0")
  const mi = String(dt.getMinutes()).padStart(2, "0")
  const ss = String(dt.getSeconds()).padStart(2, "0")
  return `${dd}/${mm}/${yy} ${hh}:${mi}:${ss}`
}

export function Incassi() {
  const { role } = useAuth()
  if (role !== "admin") return <Navigate to="/" replace />

  const [from, setFrom] = useState<string>(() => isoTodayLocal())
  const [to, setTo] = useState<string>(() => isoTodayLocal())
  const [expanded, setExpanded] = useState<Exclude<Segment, "all"> | null>(null)

  const qAdulti = useQuery({
    queryKey: ["incassi", from, to, "adulti"],
    queryFn: () =>
      api.get<IncassiResponse>(`/data/incassi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&segment=adulti`),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  })
  const qBambini = useQuery({
    queryKey: ["incassi", from, to, "bambini"],
    queryFn: () =>
      api.get<IncassiResponse>(`/data/incassi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&segment=bambini`),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  })
  const qDanza = useQuery({
    queryKey: ["incassi", from, to, "danza"],
    queryFn: () =>
      api.get<IncassiResponse>(`/data/incassi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&segment=danza`),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  })
  const qTicket = useQuery({
    queryKey: ["incassi", from, to, "ticket"],
    queryFn: () =>
      api.get<IncassiResponse>(`/data/incassi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&segment=ticket`),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  })

  const groups = useMemo(() => {
    const mk = (label: string, seg: Exclude<Segment, "all">, q: any) => ({
      label,
      seg,
      total: Number(q.data?.total ?? 0) || 0,
      count: Number(q.data?.count ?? 0) || 0,
      rows: (q.data?.rows ?? []) as Record<string, unknown>[],
      isLoading: !!q.isLoading,
      isFetching: !!q.isFetching,
      isError: !!q.isError,
      errorMessage: String((q.error as any)?.message ?? ""),
    })
    return [
      mk("Adulti", "adulti", qAdulti),
      mk("Bambini", "bambini", qBambini),
      mk("Danza", "danza", qDanza),
      mk("Ticket (giornalieri)", "ticket", qTicket),
    ]
  }, [
    qAdulti.data,
    qAdulti.isLoading,
    qAdulti.isFetching,
    qAdulti.isError,
    qAdulti.error,
    qBambini.data,
    qBambini.isLoading,
    qBambini.isFetching,
    qBambini.isError,
    qBambini.error,
    qDanza.data,
    qDanza.isLoading,
    qDanza.isFetching,
    qDanza.isError,
    qDanza.error,
    qTicket.data,
    qTicket.isLoading,
    qTicket.isFetching,
    qTicket.isError,
    qTicket.error,
  ])

  const totalDay = useMemo(() => groups.reduce((s, g) => s + (g.total || 0), 0), [groups])

  const activeGroup = groups.find((g) => g.seg === expanded) ?? null
  const rows = activeGroup?.rows ?? []
  const cols = useMemo(() => {
    // Tabella: colonne utili richieste (nome/cognome, abbonamento/descrizione, venditore, ecc.).
    const s = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) s.add(k)
    const preferred = [
      "CassaMovimentiDataOperazione",
      "CassaMovimentiData",
      "CassaMovimentiCausale",
      "DataOperazione",
      "DataPagamento",
      "Data",
      "Cognome",
      "Nome",
      "NomeUtente",
      "UtenteNome",
      "Abbonamento",
      "AbbonamentoDescrizione",
      "AbbonamentoDurataDescrizione",
      "Descrizione",
      "NomeCorso",
      "Servizio",
      "CategoriaDescrizione",
      "Venditore",
      "NomeVenditore",
      "VenditoreNome",
      "Operatore",
    ]
    const have = preferred.filter((k) => s.has(k))
    // evita troppe colonne ma lascia più info di prima
    return have.slice(0, 12)
  }, [rows])

  function rowAmount(r: Record<string, unknown>): number {
    const candidates = ["CassaMovimentiImporto", "Importo", "Totale", "ImportoPagato", "ImportoTotale", "Prezzo", "importo", "totale"]
    for (const k of candidates) {
      const raw = (r as any)[k]
      const v = (() => {
        if (raw == null) return 0
        if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0
        const s0 = String(raw).trim()
        if (!s0) return 0
        const s1 = s0
          .replace(/[€\s]/g, "")
          .replace(/\.(?=\d{3}(\D|$))/g, "")
          .replace(",", ".")
        const n = Number(s1)
        return Number.isFinite(n) ? n : 0
      })()
      if (Number.isFinite(v) && v !== 0) return v
    }
    const v0 = (r as any).CassaMovimentiImporto ?? (r as any).Importo ?? (r as any).Totale ?? 0
    return typeof v0 === "number" ? (Number.isFinite(v0) ? v0 : 0) : 0
  }

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
              Dettaglio
              <div className="mt-1 flex gap-2">
                {groups.map((g) => {
                  const on = expanded === g.seg
                  return (
                    <button
                      key={g.seg}
                      type="button"
                      onClick={() => setExpanded(on ? null : g.seg)}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        on ? "border-amber-500 bg-amber-500/20 text-amber-300" : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900"
                      }`}
                      title={on ? "Nascondi dettagli" : "Mostra dettagli"}
                    >
                      {g.label}
                    </button>
                  )
                })}
              </div>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-zinc-200">
            Totale giorno: <span className="font-semibold text-amber-300">{eur(totalDay)}</span>
          </div>
          {groups.map((g) => (
            <button
              key={g.seg}
              type="button"
              onClick={() => setExpanded(expanded === g.seg ? null : g.seg)}
              className={`rounded-lg border px-3 py-2 text-left ${
                expanded === g.seg ? "border-amber-500/50 bg-amber-500/10" : "border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50"
              }`}
            >
              <div className="text-xs text-zinc-500">{g.label}</div>
              <div className="font-semibold text-zinc-100">{eur(g.total)}</div>
              <div className="text-xs text-zinc-500">Righe: <span className="text-zinc-200">{g.count}</span></div>
            </button>
          ))}
          {(qAdulti.isFetching || qBambini.isFetching || qDanza.isFetching || qTicket.isFetching) ? (
            <div className="text-zinc-500">Aggiornamento…</div>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="min-w-[900px] w-full table-auto">
          <thead className="bg-zinc-950/40">
            <tr className="text-left text-xs text-zinc-500">
              <th className="px-3 py-2">Importo</th>
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
                <td className="px-3 py-2 whitespace-nowrap font-semibold text-amber-300">
                  {eur(rowAmount(r))}
                </td>
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2 whitespace-nowrap">
                    {(() => {
                      const raw = (r as any)[c]
                      if (
                        c === "CassaMovimentiDataOperazione" ||
                        c === "CassaMovimentiData" ||
                        c === "DataOperazione" ||
                        c === "DataPagamento" ||
                        c === "Data" ||
                        c === "DataOra"
                      ) {
                        return fmtDateTimeIt(raw) ?? String(raw ?? "—")
                      }
                      return String(raw ?? "—")
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {activeGroup?.isError ? (
          <div className="p-3 text-sm text-red-200">
            Errore caricamento incassi: {activeGroup.errorMessage || "—"}
          </div>
        ) : null}
      </div>
      ) : (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-500">
          Seleziona un gruppo (Adulti/Bambini/Danza/Ticket) per vedere il dettaglio righe.
        </div>
      )}
    </div>
  )
}

