import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]

type Ambito = "adulti" | "bambini"

type RowAgg = { name: string; count: number; pct: number; euro: number }

function fmtEuro(n: number) {
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number) {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`
}

function aggregate(data: {
  rows?: { categoria: string; durataMesi: number | null; count: number; totalEuro?: number }[]
  totalCount?: number
  totalEuro?: number
  crossEuro?: number
} | undefined) {
  const rows = data?.rows ?? []
  const totalDistinct = data?.totalCount ?? 0
  const totalForPct = rows.reduce((s, r) => s + (r.count ?? 0), 0)
  const crossEuro = data?.crossEuro ?? 0
  const totalEuro = data?.totalEuro ?? rows.reduce((s, r) => s + Number(r.totalEuro ?? 0), 0)
  if (totalForPct <= 0 && totalEuro <= 0) {
    return { rows, totalDistinct, byCategoria: [] as RowAgg[], byDurata: [] as RowAgg[], totalEuro, crossEuro, empty: true }
  }
  const byCategoriaMap: Record<string, { count: number; euro: number }> = {}
  const byDurataMap: Record<string, { count: number; euro: number }> = {}
  rows.forEach((r) => {
    const cat = r.categoria ?? "palestra"
    byCategoriaMap[cat] = {
      count: (byCategoriaMap[cat]?.count ?? 0) + (r.count ?? 0),
      euro: (byCategoriaMap[cat]?.euro ?? 0) + Number(r.totalEuro ?? 0),
    }
    const durataLabel = r.durataMesi != null ? `${r.durataMesi} mesi` : "Sconosciuta"
    byDurataMap[durataLabel] = {
      count: (byDurataMap[durataLabel]?.count ?? 0) + (r.count ?? 0),
      euro: (byDurataMap[durataLabel]?.euro ?? 0) + Number(r.totalEuro ?? 0),
    }
  })
  const byCategoria = Object.entries(byCategoriaMap)
    .map(([name, v]) => ({
      name,
      count: v.count,
      euro: v.euro,
      pct: totalForPct > 0 ? Math.round((v.count / totalForPct) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
  const byDurata = Object.entries(byDurataMap)
    .map(([name, v]) => ({
      name,
      count: v.count,
      euro: v.euro,
      pct: totalForPct > 0 ? Math.round((v.count / totalForPct) * 1000) / 10 : 0,
    }))
    .sort((a, b) => {
      const na = Number(a.name.split(" ")[0])
      const nb = Number(b.name.split(" ")[0])
      const oka = !Number.isNaN(na) && na > 0
      const okb = !Number.isNaN(nb) && nb > 0
      if (oka && okb) return na - nb
      if (oka) return -1
      if (okb) return 1
      return a.name.localeCompare(b.name)
    })
  return { rows, totalDistinct, byCategoria, byDurata, totalEuro, crossEuro, empty: false }
}

function analisiConfronto(args: {
  meseLabel: string
  anno: number
  annoPrev: number
  throughDay?: string
  curr: ReturnType<typeof aggregate>
  prev: ReturnType<typeof aggregate>
}) {
  const { meseLabel, anno, annoPrev, throughDay, curr, prev } = args
  const dEuro = curr.totalEuro - prev.totalEuro
  const pctEuro = prev.totalEuro > 0 ? (dEuro / prev.totalEuro) * 100 : null
  const dN = curr.totalDistinct - prev.totalDistinct
  const pctN = prev.totalDistinct > 0 ? (dN / prev.totalDistinct) * 100 : null
  const fino = throughDay ? ` (fino al ${throughDay})` : ""
  const lines: string[] = []
  lines.push(
    `Nel ${meseLabel} ${anno}${fino} il venduto è € ${fmtEuro(curr.totalEuro)} (${curr.totalDistinct} movimenti), contro € ${fmtEuro(prev.totalEuro)} (${prev.totalDistinct} movimenti) nello stesso periodo del ${annoPrev}.`
  )
  if (pctEuro != null) {
    lines.push(
      dEuro === 0
        ? "Il valore è invariato rispetto all'anno di confronto."
        : `Variazione di valore: ${fmtPct(pctEuro)} (${dEuro >= 0 ? "+" : ""}€ ${fmtEuro(dEuro)}).`
    )
  } else if (prev.totalEuro === 0 && curr.totalEuro > 0) {
    lines.push("Nell'anno di confronto non risultano vendite nello stesso periodo: non si calcola la percentuale.")
  }
  if (pctN != null) {
    lines.push(`Variazione di quantità: ${fmtPct(pctN)} (${dN >= 0 ? "+" : ""}${dN} movimenti).`)
  }
  const names = new Set([...curr.byCategoria.map((r) => r.name), ...prev.byCategoria.map((r) => r.name)])
  const crescono: string[] = []
  const calano: string[] = []
  for (const name of names) {
    const a = curr.byCategoria.find((r) => r.name === name)?.euro ?? 0
    const b = prev.byCategoria.find((r) => r.name === name)?.euro ?? 0
    const d = a - b
    if (Math.abs(d) < 1) continue
    const bit = `${name} (${d >= 0 ? "+" : ""}€ ${fmtEuro(d)})`
    if (d > 0) crescono.push(bit)
    else calano.push(bit)
  }
  if (crescono.length) lines.push(`Crescono: ${crescono.join(", ")}.`)
  if (calano.length) lines.push(`Calano: ${calano.join(", ")}.`)
  return lines
}

function exportAndamentoPdf(args: {
  titolo: string
  totalDistinct: number
  from?: string
  to?: string
  byCategoria: RowAgg[]
  byDurata: RowAgg[]
  byAbbonamento?: { name: string; count: number; euro: number }[]
}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  doc.setFontSize(14)
  doc.text(args.titolo, 14, 14)
  doc.setFontSize(10)
  const periodo = args.from && args.to ? `${args.from} -> ${args.to}` : "Mese"
  doc.text(`Periodo: ${periodo}`, 14, 20)
  doc.text(`Totale movimenti: ${args.totalDistinct}`, 14, 25)
  autoTable(doc, {
    startY: 32,
    head: [["Categoria", "Movimenti", "%", "Totale €"]],
    body: args.byCategoria.map((r) => [r.name, String(r.count), `${r.pct.toLocaleString("it-IT")} %`, fmtEuro(r.euro)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [59, 130, 246] },
  })
  const y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : 90
  if (args.byDurata.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Durata", "Movimenti", "%", "Totale €"]],
      body: args.byDurata.map((r) => [r.name, String(r.count), `${r.pct.toLocaleString("it-IT")} %`, fmtEuro(r.euro)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [16, 185, 129] },
    })
  }
  const y2 = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 60
  if (args.byAbbonamento?.length) {
    autoTable(doc, {
      startY: y2,
      head: [["Abbonamento", "Movimenti", "Totale €"]],
      body: args.byAbbonamento.map((r) => [r.name, String(r.count), fmtEuro(r.euro)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [245, 158, 11] },
      columnStyles: { 0: { cellWidth: 110 } },
    })
  }
  doc.save(`andamento-vendite-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export function AndamentoVenditeView({ ambito }: { ambito: Ambito }) {
  const { role, consulenteFilter, consulenti } = useAuth()
  const [adminConsulente, setAdminConsulente] = useState<string>("")
  const now = new Date()
  const [anno, setAnno] = useState(now.getFullYear())
  const [mese, setMese] = useState(now.getMonth() + 1)
  const [annoConfronto, setAnnoConfronto] = useState(now.getFullYear() - 1)
  const isCurrent = anno === now.getFullYear() && mese === now.getMonth() + 1

  const effectiveConsulenteFilter = role === "admin"
    ? (adminConsulente.trim() ? adminConsulente.trim() : undefined)
    : consulenteFilter

  const { data: budgetData } = useQuery({
    queryKey: ["budget"],
    queryFn: () => dataApi.getBudget(),
    enabled: role === "admin" && ambito === "adulti",
  })

  const queryBase = {
    anno,
    mese,
    consulente: effectiveConsulenteFilter,
    ambito,
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["vendite-movimenti-andamento", ambito, anno, mese, effectiveConsulenteFilter ?? ""],
    queryFn: () => dataApi.getVenditeMovimentiCategoriaDurata(queryBase),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: anno === now.getFullYear() && mese === now.getMonth() + 1 ? 60_000 : 7 * 24 * 60 * 60 * 1000,
  })

  const { data: dataPrev, isLoading: loadingPrev } = useQuery({
    queryKey: ["vendite-movimenti-andamento", ambito, annoConfronto, mese, isCurrent ? now.getDate() : "full", effectiveConsulenteFilter ?? ""],
    queryFn: () =>
      dataApi.getVenditeMovimentiCategoriaDurata({
        ...queryBase,
        anno: annoConfronto,
        giorno: isCurrent ? now.getDate() : undefined,
      }),
    enabled: annoConfronto !== anno && annoConfronto >= 2000,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  })

  const consulentiList =
    ambito === "bambini"
      ? (data?.consulenti?.length ? data.consulenti : ["Irene Carlesi", "Elisa Garisi", "Victoria", "Alba Salata", "Tommaso", "Simona Chiti"])
      : role === "admin" && budgetData?.consulenti?.length
        ? budgetData.consulenti
        : (consulenti ?? [])

  const computed = useMemo(() => aggregate(data), [data])
  const computedPrev = useMemo(() => aggregate(dataPrev), [dataPrev])

  const paletteCat = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#eab308", "#38bdf8"]
  const paletteDur = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#60a5fa"]
  const meseLabel = MESI[mese - 1] ?? String(mese)
  const analisi = useMemo(() => {
    if (computed.empty && computedPrev.empty) return []
    return analisiConfronto({
      meseLabel,
      anno,
      annoPrev: annoConfronto,
      throughDay: isCurrent ? data?.to?.slice(8) : undefined,
      curr: computed,
      prev: computedPrev,
    })
  }, [computed, computedPrev, meseLabel, anno, annoConfronto, isCurrent, data?.to])

  const barData = [
    {
      nome: meseLabel,
      [String(anno)]: Math.round(computed.totalEuro),
      [String(annoConfronto)]: Math.round(computedPrev.totalEuro),
    },
  ]

  const titolo = ambito === "bambini" ? "Andamento vendite bambini" : "Andamento vendite"
  const anniOpts = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{titolo}</h1>
          <p className="text-sm text-zinc-400">
            {ambito === "bambini"
              ? "Scuola nuoto include ASI e bracciali (non Carmen/Serena/Ombretta). Agonismo: rate in cassa."
              : "Distribuzione vendite adulti per categoria e durata — incluse gestanti; esclusi danza e Centro Arte Danza"}
          </p>
        </div>
        <div className="flex gap-2">
          {ambito === "adulti" ? (
            <Link to="/andamento-vendite-bambini" className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
              Pagina bambini
            </Link>
          ) : (
            <Link to="/andamento-vendite" className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
              Pagina adulti
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3">
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Mese
          <select value={mese} onChange={(e) => setMese(Number(e.target.value))} className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100">
            {MESI.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Anno
          <select value={anno} onChange={(e) => setAnno(Number(e.target.value))} className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100">
            {anniOpts.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Confronta con
          <select value={annoConfronto} onChange={(e) => setAnnoConfronto(Number(e.target.value))} className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100">
            {anniOpts.filter((y) => y !== anno).map((y) => (
              <option key={y} value={y}>{y} (stesso mese)</option>
            ))}
          </select>
        </label>
        {role === "admin" && (
          <label className="flex flex-col gap-1 text-sm text-zinc-400">
            Consulente
            <select value={adminConsulente} onChange={(e) => setAdminConsulente(e.target.value)} className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100">
              <option value="">{ambito === "bambini" ? "Tutte (escluse Carmen, Serena, Ombretta)" : "Tutte le consulenti"}</option>
              {consulentiList.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        I mesi già chiusi restano in cache e non cambiano. Solo il mese in corso si aggiorna (fino a oggi). Il confronto usa lo stesso giorno dell’altro anno.
      </p>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
        {isLoading ? (
          <div className="py-10 text-center text-zinc-400">Caricamento andamento...</div>
        ) : error ? (
          <div className="py-6 text-center text-red-400">{(error as Error).message}</div>
        ) : computed.empty ? (
          <div className="py-10 text-center text-zinc-500">Nessun dato per il periodo.</div>
        ) : (
          <>
            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-wider text-amber-300">{meseLabel} {anno}</p>
                <p className="mt-1 text-2xl font-semibold text-amber-400">€ {fmtEuro(computed.totalEuro)}</p>
                <p className="text-sm text-zinc-400">{computed.totalDistinct} movimenti</p>
              </div>
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-zinc-500">{meseLabel} {annoConfronto}{loadingPrev ? "…" : ""}</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-100">€ {fmtEuro(computedPrev.totalEuro)}</p>
                <p className="text-sm text-zinc-400">{computedPrev.totalDistinct} movimenti</p>
              </div>
            </div>

            {analisi.length > 0 && (
              <div className="mb-6 rounded-lg border border-sky-800/60 bg-sky-950/30 p-4 text-sm text-sky-100/90 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-sky-400">Analisi confronto</p>
                {analisi.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}

            <div className="mb-6 h-64 rounded-lg border border-zinc-800 bg-zinc-900/20 p-3">
              <p className="mb-2 text-sm text-zinc-300">Confronto {anno} vs {annoConfronto}</p>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="nome" stroke="#a1a1aa" />
                  <YAxis stroke="#a1a1aa" />
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a" }} />
                  <Legend />
                  <Bar dataKey={String(anno)} fill="#f59e0b" />
                  <Bar dataKey={String(annoConfronto)} fill="#64748b" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="mb-1 text-sm font-medium text-zinc-400">
                Dettaglio {meseLabel} {anno}
                {data?.from && data?.to ? ` (${data.from} → ${data.to})` : ""}
              </h2>
              <button
                type="button"
                onClick={() =>
                  exportAndamentoPdf({
                    titolo,
                    totalDistinct: computed.totalDistinct,
                    from: data?.from,
                    to: data?.to,
                    byCategoria: computed.byCategoria,
                    byDurata: ambito === "bambini" ? [] : computed.byDurata,
                    byAbbonamento:
                      ambito === "bambini"
                        ? []
                        : data?.byAbbonamento?.map((r) => ({
                            name: String(r.abbonamento ?? "—"),
                            count: Number(r.count ?? 0) || 0,
                            euro: Number(r.totalEuro ?? 0) || 0,
                          })) ?? [],
                  })
                }
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Scarica PDF
              </button>
            </div>

            {computed.crossEuro > 0 ? (
              <p className="mb-4 text-xs text-zinc-500">
                Cross €{fmtEuro(computed.crossEuro)} nel totale, come in dashboard (solo senza movimento di vendita nel mese)
              </p>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-1">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">
                  {ambito === "bambini" ? "Distribuzione per tipo abbonamento" : "Distribuzione per categoria"}
                </p>
                <ResponsiveContainer width="100%" height={520}>
                  <PieChart>
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #27272a" }}
                      formatter={(_value: unknown, _name: unknown, props: { payload?: RowAgg }) => {
                        const payload = props?.payload
                        if (!payload) return ["", ""]
                        return [`${payload.pct}% (${payload.count})`, payload.name]
                      }}
                    />
                    <Pie
                      data={computed.byCategoria}
                      dataKey="count"
                      nameKey="name"
                      outerRadius={185}
                      labelLine
                      label={(props: { payload?: RowAgg }) => {
                        const payload = props?.payload
                        const pct = payload?.pct ?? 0
                        const name = payload?.name ?? ""
                        const count = payload?.count ?? 0
                        if (pct >= 7) return `${name} (${pct}%) ${count}`
                        if (pct >= 3) return `${name} (${pct}%)`
                        return ""
                      }}
                    >
                      {computed.byCategoria.map((e, i) => (
                        <Cell key={e.name} fill={paletteCat[i % paletteCat.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {ambito === "adulti" ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">Distribuzione per durata</p>
                <ResponsiveContainer width="100%" height={520}>
                  <PieChart>
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #27272a" }}
                      formatter={(_value: unknown, _name: unknown, props: { payload?: RowAgg }) => {
                        const payload = props?.payload
                        if (!payload) return ["", ""]
                        return [`${payload.pct}% (${payload.count})`, payload.name]
                      }}
                    />
                    <Pie
                      data={computed.byDurata}
                      dataKey="count"
                      nameKey="name"
                      outerRadius={185}
                      labelLine
                      label={(props: { payload?: RowAgg }) => {
                        const payload = props?.payload
                        const pct = payload?.pct ?? 0
                        const name = payload?.name ?? ""
                        const count = payload?.count ?? 0
                        if (pct >= 7) return `${name} (${pct}%) ${count}`
                        if (pct >= 3) return `${name} (${pct}%)`
                        return ""
                      }}
                    >
                      {computed.byDurata.map((e, i) => (
                        <Cell key={e.name} fill={paletteDur[i % paletteDur.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              ) : null}
            </div>

            <div className={`mt-6 grid gap-6 ${ambito === "bambini" ? "lg:grid-cols-1" : "lg:grid-cols-2"}`}>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">{ambito === "bambini" ? "Totali per tipo abbonamento" : "Totali per categoria"}</p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="py-2 pr-2 font-medium">Voce</th>
                      <th className="py-2 pr-2 text-right font-medium">N</th>
                      <th className="py-2 text-right font-medium">Totale €</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-200">
                    {computed.byCategoria.map((r) => (
                      <tr key={r.name} className="border-b border-zinc-800/70">
                        <td className="py-2 pr-2">
                          {r.name}
                          {ambito === "bambini" && r.name === "Agonismo categorie" ? (
                            <span className="ml-2 text-xs font-normal text-zinc-500">rate cassa</span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{r.count}</td>
                        <td className="py-2 text-right tabular-nums">€{fmtEuro(r.euro)}</td>
                      </tr>
                    ))}
                    <tr className="bg-zinc-900/60 font-semibold text-zinc-100">
                      <td className="py-2 pr-2">TOTALE</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{computed.byCategoria.reduce((s, r) => s + r.count, 0)}</td>
                      <td className="py-2 text-right tabular-nums text-amber-400">
                        €{fmtEuro(computed.byCategoria.reduce((s, r) => s + r.euro, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {ambito === "bambini" && data?.noteAgonismo ? (
                  <p className="mt-3 text-xs text-zinc-500">{data.noteAgonismo}</p>
                ) : null}
              </div>
              {ambito === "adulti" ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">Totali per durata</p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="py-2 pr-2 font-medium">Durata</th>
                      <th className="py-2 pr-2 text-right font-medium">N</th>
                      <th className="py-2 text-right font-medium">Totale €</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-200">
                    {computed.byDurata.map((r) => (
                      <tr key={r.name} className="border-b border-zinc-800/70">
                        <td className="py-2 pr-2">{r.name}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{r.count}</td>
                        <td className="py-2 text-right tabular-nums">€{fmtEuro(r.euro)}</td>
                      </tr>
                    ))}
                    <tr className="bg-zinc-900/60 font-semibold text-zinc-100">
                      <td className="py-2 pr-2">TOTALE</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{computed.byDurata.reduce((s, r) => s + r.count, 0)}</td>
                      <td className="py-2 text-right tabular-nums text-amber-400">
                        €{fmtEuro(computed.byDurata.reduce((s, r) => s + r.euro, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              ) : null}
            </div>

            {ambito === "adulti" && data?.byAbbonamento && data.byAbbonamento.length > 0 ? (
              <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/20 p-4">
                <p className="mb-2 text-sm text-zinc-300">Dettaglio abbonamenti</p>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="py-2 pr-2 font-medium">Abbonamento</th>
                        <th className="py-2 pr-2 text-right font-medium">N</th>
                        <th className="py-2 text-right font-medium">Totale €</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-200">
                      {data.byAbbonamento.map((r) => (
                        <tr key={r.abbonamento} className="border-b border-zinc-800/70">
                          <td className="py-2 pr-2">{r.abbonamento}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{r.count}</td>
                          <td className="py-2 text-right tabular-nums">€{fmtEuro(r.totalEuro)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
