import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useAuth } from "@/contexts/AuthContext"
import { api } from "@/api/client"

type Segment = "all" | "adulti" | "bambini" | "danza" | "ticket" | "altro"
type DetailSeg = Exclude<Segment, "all">

type IncassiResponse = {
  from: string
  to: string
  segment: Segment
  count: number
  total: number
  rows: Record<string, unknown>[]
}

type SegTot = { total: number; count: number }

type IncassiRiepilogo = {
  from: string
  to: string
  total: number
  count: number
  segments: Record<DetailSeg, SegTot>
}

const MESI = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
]

const SEG_LABEL: Record<DetailSeg, string> = {
  adulti: "Adulti",
  bambini: "Bambini",
  danza: "Danza",
  ticket: "Ticket (giornalieri)",
  altro: "Altro",
}

const SEG_ORDER: DetailSeg[] = ["adulti", "bambini", "danza", "ticket", "altro"]

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function isoTodayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function firstOfMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function withYear(iso: string, year: number): string {
  const parts = iso.split("-")
  const m = Number(parts[1] ?? 1)
  const d = Number(parts[2] ?? 1)
  const last = new Date(year, m, 0).getDate()
  return `${year}-${pad2(m)}-${pad2(Math.min(d, last))}`
}

function eur(n: number): string {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" })
}

function fmtEuro(n: number): string {
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`
}

function fmtDateTimeIt(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) {
    const d = v
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  }
  const s = String(v)
  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) return null
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`
}

function emptySegs(): Record<DetailSeg, SegTot> {
  return {
    adulti: { total: 0, count: 0 },
    bambini: { total: 0, count: 0 },
    danza: { total: 0, count: 0 },
    ticket: { total: 0, count: 0 },
    altro: { total: 0, count: 0 },
  }
}

export function Incassi() {
  const { role } = useAuth()
  const now = new Date()
  const yearNow = now.getFullYear()
  const monthNow = now.getMonth() + 1
  const [anno, setAnno] = useState(yearNow)
  const [mese, setMese] = useState(monthNow)
  const [annoConfronto, setAnnoConfronto] = useState(yearNow - 1)
  const isCurrent = anno === yearNow && mese === monthNow
  const [from, setFrom] = useState<string>(() => firstOfMonth(yearNow, monthNow))
  const [to, setTo] = useState<string>(() => isoTodayLocal())
  const [expanded, setExpanded] = useState<DetailSeg | null>(null)

  const anniOpts = useMemo(() => {
    const out: number[] = []
    for (let i = yearNow; i >= yearNow - 6; i--) out.push(i)
    return out
  }, [yearNow])

  const fromPrev = withYear(from, annoConfronto)
  const toPrev = withYear(to, annoConfronto)
  const meseLabel = MESI[mese - 1] ?? ""

  function applyMeseAnno(nextAnno: number, nextMese: number) {
    setAnno(nextAnno)
    setMese(nextMese)
    setFrom(firstOfMonth(nextAnno, nextMese))
    const current = nextAnno === yearNow && nextMese === monthNow
    setTo(current ? isoTodayLocal() : lastDayOfMonth(nextAnno, nextMese))
    if (nextAnno === annoConfronto) setAnnoConfronto(nextAnno === yearNow ? nextAnno - 1 : yearNow)
  }

  const qNow = useQuery({
    queryKey: ["incassi-riepilogo", from, to],
    queryFn: () =>
      api.get<IncassiRiepilogo>(`/data/incassi/riepilogo?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    enabled: role === "admin",
  })
  const qPrev = useQuery({
    queryKey: ["incassi-riepilogo", fromPrev, toPrev],
    queryFn: () =>
      api.get<IncassiRiepilogo>(
        `/data/incassi/riepilogo?from=${encodeURIComponent(fromPrev)}&to=${encodeURIComponent(toPrev)}`
      ),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    enabled: role === "admin" && annoConfronto !== anno,
  })
  const qDetail = useQuery({
    queryKey: ["incassi", from, to, expanded],
    queryFn: () =>
      api.get<IncassiResponse>(
        `/data/incassi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&segment=${encodeURIComponent(expanded ?? "adulti")}`
      ),
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    enabled: role === "admin" && !!expanded,
  })

  const segsNow = qNow.data?.segments ?? emptySegs()
  const segsPrev = qPrev.data?.segments ?? emptySegs()
  const totalNow = Number(qNow.data?.total ?? 0) || 0
  const totalPrev = Number(qPrev.data?.total ?? 0) || 0
  const countNow = Number(qNow.data?.count ?? 0) || 0
  const countPrev = Number(qPrev.data?.count ?? 0) || 0

  const groups = useMemo(() => {
    return SEG_ORDER.map((seg) => ({
      label: SEG_LABEL[seg],
      seg,
      total: Number(segsNow[seg]?.total ?? 0) || 0,
      count: Number(segsNow[seg]?.count ?? 0) || 0,
      prevTotal: Number(segsPrev[seg]?.total ?? 0) || 0,
      prevCount: Number(segsPrev[seg]?.count ?? 0) || 0,
    }))
  }, [segsNow, segsPrev])

  const analisi = useMemo(() => {
    const dEuro = totalNow - totalPrev
    const pctEuro = totalPrev > 0 ? (dEuro / totalPrev) * 100 : null
    const dN = countNow - countPrev
    const pctN = countPrev > 0 ? (dN / countPrev) * 100 : null
    const lines: string[] = []
    lines.push(
      `Dal ${from} al ${to} gli incassi sono € ${fmtEuro(totalNow)} (${countNow} movimenti), contro € ${fmtEuro(totalPrev)} (${countPrev} movimenti) nello stesso periodo del ${annoConfronto}.`
    )
    if (pctEuro != null) {
      lines.push(
        dEuro === 0
          ? "Il valore è invariato rispetto all'anno di confronto."
          : `Variazione di valore: ${fmtPct(pctEuro)} (${dEuro >= 0 ? "+" : ""}€ ${fmtEuro(dEuro)}).`
      )
    } else if (totalPrev === 0 && totalNow > 0) {
      lines.push("Nell'anno di confronto non risultano incassi nello stesso periodo: non si calcola la percentuale.")
    }
    if (pctN != null) {
      lines.push(`Variazione di quantità: ${fmtPct(pctN)} (${dN >= 0 ? "+" : ""}${dN} movimenti).`)
    }
    const crescono: string[] = []
    const calano: string[] = []
    for (const g of groups) {
      const d = g.total - g.prevTotal
      if (Math.abs(d) < 1) continue
      const bit = `${g.label} (${d >= 0 ? "+" : ""}€ ${fmtEuro(d)})`
      if (d > 0) crescono.push(bit)
      else calano.push(bit)
    }
    if (crescono.length) lines.push(`Crescono: ${crescono.join(", ")}.`)
    if (calano.length) lines.push(`Calano: ${calano.join(", ")}.`)
    return lines
  }, [totalNow, totalPrev, countNow, countPrev, from, to, annoConfronto, groups])

  const barData = useMemo(
    () =>
      groups
        .filter((g) => g.seg !== "altro" || g.total > 0 || g.prevTotal > 0)
        .map((g) => ({
          nome: g.seg === "ticket" ? "Ticket" : g.label,
          [String(anno)]: Math.round(g.total * 100) / 100,
          [String(annoConfronto)]: Math.round(g.prevTotal * 100) / 100,
        })),
    [groups, anno, annoConfronto]
  )

  const rows = (qDetail.data?.rows ?? []) as Record<string, unknown>[]
  const cols = useMemo(() => {
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
      "AbbonamentiDescrizione",
      "AbbonamentiCategorieDescrizione",
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

  if (role !== "admin") return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Incassi</h2>
            <p className="text-sm text-zinc-500">Movimenti di cassa univoci, raggruppati per categoria cliente e ticket.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-zinc-500">
              Mese
              <select
                value={mese}
                onChange={(e) => applyMeseAnno(anno, Number(e.target.value))}
                className="mt-1 block rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                {MESI.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-zinc-500">
              Anno
              <select
                value={anno}
                onChange={(e) => applyMeseAnno(Number(e.target.value), mese)}
                className="mt-1 block rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                {anniOpts.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-zinc-500">
              Confronta con
              <select
                value={annoConfronto}
                onChange={(e) => setAnnoConfronto(Number(e.target.value))}
                className="mt-1 block rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                {anniOpts
                  .filter((y) => y !== anno)
                  .map((y) => (
                    <option key={y} value={y}>
                      {y} (stesso periodo)
                    </option>
                  ))}
              </select>
            </label>
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
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {isCurrent
            ? `Mese in corso: dal 1° ${meseLabel.toLowerCase()} fino a oggi. Il confronto usa lo stesso giorno del ${annoConfronto}.`
            : `Periodo ${meseLabel} ${anno}. Il confronto usa lo stesso intervallo del ${annoConfronto}.`}{" "}
          Il report «centri di ricavo» del gestionale raggruppa per centro di costo (scuola nuoto, agonismo, quote…) e può includere altre sedi (NESSUNA): i totali non coincidono riga per riga.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-xs uppercase tracking-wider text-amber-300">
              {meseLabel} {anno}
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-400">{qNow.isLoading ? "…" : eur(totalNow)}</p>
            <p className="text-sm text-zinc-400">{countNow} movimenti</p>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              {meseLabel} {annoConfronto}
              {qPrev.isFetching ? "…" : ""}
            </p>
            <p className="mt-1 text-2xl font-semibold text-zinc-100">{qPrev.isLoading ? "…" : eur(totalPrev)}</p>
            <p className="text-sm text-zinc-400">{countPrev} movimenti</p>
          </div>
        </div>

        {qNow.isError || qPrev.isError ? (
          <div className="mt-4 text-sm text-red-200">
            Errore caricamento incassi: {String((qNow.error as Error)?.message ?? (qPrev.error as Error)?.message ?? "—")}
          </div>
        ) : null}

        {analisi.length > 0 && !qNow.isLoading ? (
          <div className="mt-4 rounded-lg border border-sky-800/60 bg-sky-950/30 p-4 text-sm text-sky-100/90 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-sky-400">Analisi confronto</p>
            {analisi.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}

        <div className="mt-4 h-64 rounded-lg border border-zinc-800 bg-zinc-900/20 p-3">
          <p className="mb-2 text-sm text-zinc-300">
            Confronto {anno} vs {annoConfronto}
          </p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="nome" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #27272a" }}
                formatter={(value: unknown) => eur(Number(value) || 0)}
              />
              <Legend />
              <Bar dataKey={String(anno)} fill="#f59e0b" />
              <Bar dataKey={String(annoConfronto)} fill="#64748b" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          {groups.map((g) => {
            if (g.seg === "altro" && g.total === 0 && g.prevTotal === 0) return null
            const d = g.total - g.prevTotal
            const pct = g.prevTotal > 0 ? (d / g.prevTotal) * 100 : null
            return (
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
                <div className="text-xs text-zinc-500">
                  Righe: <span className="text-zinc-200">{g.count}</span>
                  {pct != null ? (
                    <span className={d >= 0 ? "ml-2 text-emerald-400" : "ml-2 text-red-400"}>
                      {fmtPct(pct)} vs {annoConfronto}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
          {qNow.isFetching || qPrev.isFetching ? <div className="text-zinc-500">Aggiornamento…</div> : null}
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
              {qDetail.isLoading ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-zinc-500" colSpan={cols.length + 1}>
                    Caricamento dettaglio…
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={idx} className="border-t border-zinc-800 text-sm text-zinc-200">
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-amber-300">{eur(rowAmount(r))}</td>
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
                ))
              )}
            </tbody>
          </table>
          {qDetail.isError ? (
            <div className="p-3 text-sm text-red-200">Errore caricamento incassi: {String((qDetail.error as Error)?.message ?? "—")}</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-500">
          Seleziona un gruppo (Adulti/Bambini/Danza/Ticket/Altro) per vedere il dettaglio righe.
        </div>
      )}
    </div>
  )
}
