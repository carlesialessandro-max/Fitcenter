import { useMemo, useState, useEffect } from "react"
import { Link, Navigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { dataApi, type OraLavorata } from "@/api/data"
import { chiamateApi } from "@/api/chiamate"
import { useAuth } from "@/contexts/AuthContext"
import { DettaglioVenditePrimoPiano } from "@/components/DettaglioVenditePrimoPiano"
import { KpiRow, TabellaConsulenti } from "@/components/DettaglioBloccoView"

const COLORS_FONTE = ["#3b82f6", "#22c55e", "#f97316"]

function localIsoDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function fmtDateIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

type JsPdfInstance = InstanceType<typeof jsPDF>
type JsPdfWithAutoTable = JsPdfInstance & { lastAutoTable?: { finalY?: number } }

function autoTableNextY(doc: JsPdfWithAutoTable, fallbackY: number, gap = 8): number {
  const finalY = doc.lastAutoTable?.finalY
  return typeof finalY === "number" ? finalY + gap : fallbackY
}

function monthStartIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[1]}-${m[2]}-01`
}

export function Dashboard() {
  const queryClient = useQueryClient()
  const { role, consulenteFilter, consulenteNome } = useAuth()
  if (role === "istruttore") return <Navigate to="/corsi" replace />
  const [budgetModal, setBudgetModal] = useState(false)
  const annoInCorso = new Date().getFullYear()
  const [asOf, setAsOf] = useState(() => localIsoDate())
  const todayIso = localIsoDate()
  const isAdminToday = role === "admin" ? asOf === todayIso : true
  const [budgetAnno, setBudgetAnno] = useState(annoInCorso)
  const [budgetMese, setBudgetMese] = useState(new Date().getMonth() + 1)
  const [budgetPerConsulente, setBudgetPerConsulente] = useState<Record<string, number>>({})
  const now = new Date()
  const [giornoConsulente, setGiornoConsulente] = useState(now.getDate())
  const todayStr = localIsoDate(now)
  const [oraLavorataGiorno, setOraLavorataGiorno] = useState(todayStr)
  const [oraLavorataInizio, setOraLavorataInizio] = useState("09:00")
  const [oraLavorataFine, setOraLavorataFine] = useState("18:00")

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", consulenteFilter, role === "admin" ? asOf : null],
    queryFn: () => dataApi.getDashboard(consulenteFilter, role === "admin" ? asOf : undefined),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Per date storiche (asOf != oggi) i dati sono "fissi": evitiamo refetch inutili.
    staleTime: role === "admin" && !isAdminToday ? 6 * 60 * 60 * 1000 : 30_000,
    gcTime: role === "admin" && !isAdminToday ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  })

  const { data: budgetData } = useQuery({
    queryKey: ["budget", budgetAnno],
    queryFn: () => dataApi.getBudget(budgetAnno),
    enabled: budgetModal && role === "admin",
  })

  const setBudgetMutation = useMutation({
    mutationFn: async () => {
      const consulenti = budgetData?.consulenti ?? []
      for (const label of consulenti) {
        const val = budgetPerConsulente[label]
        if (typeof val === "number") {
          await dataApi.setBudget(budgetAnno, budgetMese, val, label)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["budget"] })
      setBudgetModal(false)
    },
  })
  const { data: chiamateStats } = useQuery({
    queryKey: ["chiamate-stats"],
    queryFn: () => chiamateApi.getStats(),
  })

  useEffect(() => {
    if (!budgetModal || !budgetData?.perConsulente) return
    const byLabel: Record<string, number> = {}
    budgetData.perConsulente
      .filter((p) => p.anno === budgetAnno && p.mese === budgetMese)
      .forEach((p) => { byLabel[p.consulenteLabel] = p.budget })
    setBudgetPerConsulente((prev) => ({ ...byLabel, ...prev }))
  }, [budgetModal, budgetData?.perConsulente, budgetAnno, budgetMese])

  const oggiDate = role === "admin" ? new Date(`${asOf}T12:00:00Z`) : new Date()
  const annoOggi = oggiDate.getFullYear()
  const meseOggi = oggiDate.getMonth() + 1
  const giornoOggi = role === "admin" ? oggiDate.getDate() : giornoConsulente

  const { data: dettaglioGiornoMese } = useQuery({
    queryKey: ["dettaglio-oggi-mese", annoOggi, meseOggi, giornoOggi, consulenteFilter, role === "admin" ? asOf : null],
    queryFn: () => dataApi.getDettaglioMese(annoOggi, meseOggi, giornoOggi, consulenteFilter, role === "admin" ? asOf : undefined),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: role === "admin" && !isAdminToday ? 6 * 60 * 60 * 1000 : 30_000,
    gcTime: role === "admin" && !isAdminToday ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  })

  const allConsulentiFromDettaglio = useMemo(() => {
    const list = dettaglioGiornoMese?.dettaglioMese?.perConsulente?.map((x) => x.consulente) ?? []
    return Array.from(new Set(list)).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [dettaglioGiornoMese?.dettaglioMese?.perConsulente])

  // Report: range e consulenti selezionabili (admin).
  const [reportFrom, setReportFrom] = useState(() => monthStartIso(todayIso))
  const [reportTo, setReportTo] = useState(() => todayIso)
  const [reportConsulentiSel, setReportConsulentiSel] = useState<string[]>([])
  const reportConsulentiEffective = reportConsulentiSel.length > 0 ? reportConsulentiSel : allConsulentiFromDettaglio

  useEffect(() => {
    if (role !== "admin") return
    // Quando cambi asOf: default range mese corrente fino ad asOf (ma l’utente può sempre cambiare manualmente).
    setReportFrom(monthStartIso(asOf))
    setReportTo(asOf)
    // Se non c'è una selezione esplicita, lasciamo che si aggiorni in base al dettaglio.
    // Se invece l'utente ha già selezionato consulenti, non tocchiamo.
  }, [role, asOf])

  const reportQuery = useQuery({
    queryKey: ["report-consulenti", reportFrom, reportTo, reportConsulentiEffective.join("|")],
    queryFn: () => dataApi.getReportConsulenti({ from: reportFrom, to: reportTo, consulenti: reportConsulentiEffective }),
    enabled: false, // fetch solo on-demand quando clicchi "Stampa Report"
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
  })

  const { data: dettaglioAnnoData } = useQuery({
    queryKey: ["dettaglio-anno", annoInCorso, role === "admin" ? asOf : null],
    queryFn: () => dataApi.getDettaglioAnno(annoInCorso, role === "admin" ? asOf : undefined),
    enabled: role === "admin",
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
  })

  const annoOre = now.getFullYear()
  const meseOre = now.getMonth() + 1
  const { data: oreLavorate = [] } = useQuery({
    queryKey: ["ore-lavorate", consulenteNome, annoOre, meseOre],
    queryFn: () => dataApi.getOreLavorate({ consulente: consulenteNome || undefined, anno: annoOre, mese: meseOre }),
    enabled: role === "operatore" && !!consulenteNome,
  })
  const postOraLavorataMutation = useMutation({
    mutationFn: () =>
      dataApi.postOraLavorata({
        consulenteNome: consulenteNome ?? "",
        giorno: oraLavorataGiorno,
        oraInizio: oraLavorataInizio,
        oraFine: oraLavorataFine,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ore-lavorate"] })
      setOraLavorataGiorno(todayStr)
      setOraLavorataInizio("09:00")
      setOraLavorataFine("18:00")
    },
  })
  const deleteOraLavorataMutation = useMutation({
    mutationFn: (id: string) => dataApi.deleteOraLavorata(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ore-lavorate"] }),
  })

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-zinc-400">
        Caricamento...
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-6 text-red-400">
        Errore: {(error as Error)?.message ?? "Dati non disponibili"}. Avvia l’API backend.
      </div>
    )
  }

  const safeNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

  const oggi = role === "admin"
    ? fmtDateIt(asOf)
    : (() => {
        const d = new Date(annoOggi, meseOggi - 1, giornoOggi)
        return d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })
      })()


  async function stampaReportPdf() {
    if (role !== "admin") return
    if (!reportFrom || !reportTo) return
    if (reportFrom > reportTo) return
    if (reportConsulentiEffective.length === 0) return
    const out = await reportQuery.refetch()
    const reportData = out.data
    if (!reportData) return
    const { rows, totals } = reportData
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as JsPdfWithAutoTable
    const footStyles = { fontStyle: "bold" as const, fontSize: 8, halign: "left" as const }

    doc.setFontSize(14)
    doc.text("ANALISI PRODUZIONE - FitCenter", 10, 10)
    doc.setFontSize(10)
    doc.text(`Dal: ${fmtDateIt(reportFrom)}   Al: ${fmtDateIt(reportTo)}`, 10, 16)
    doc.text(`Consulenti: ${reportConsulentiEffective.join(", ") || "Nessuna"}`, 10, 21)
    let y = 28

    doc.setFontSize(11)
    doc.text("PRODUZIONE TOTALE", 10, y)
    autoTable(doc, {
      startY: y + 2,
      head: [["Consulente", "Movimenti", "Produzione €", "Budget", "Scostamento", "Trend"]],
      body: rows.map((r) => [
        r.consulenteNome,
        String(r.movimentiAndamento ?? 0),
        `${r.vendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
        `${r.budget.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
        `${(r.vendite - r.budget).toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
        `${r.percentualeBudget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}%`,
      ]),
      foot: [
        [
          "TOTALE",
          String(totals.movimentiAndamento),
          `${totals.vendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
          `${totals.budget.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
          `${totals.scostamento.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
          `${totals.percentualeBudget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}%`,
        ],
      ],
      footStyles,
      styles: { fontSize: 8 },
    })
    y = autoTableNextY(doc, y + 45)

    doc.setFontSize(11)
    doc.text("CLIENTI NUOVI", 10, y)
    autoTable(doc, {
      startY: y + 2,
      head: [["Consulente", "Nuovi clienti"]],
      body: rows.map((r) => [r.consulenteNome, String(r.clientiNuovi ?? 0)]),
      foot: [["TOTALE", String(totals.clientiNuovi)]],
      footStyles,
      styles: { fontSize: 8 },
    })
    y = autoTableNextY(doc, y + 25)

    doc.setFontSize(11)
    doc.text("RINNOVI", 10, y)
    autoTable(doc, {
      startY: y + 2,
      head: [["Consulente", "Rinnovi"]],
      body: rows.map((r) => [r.consulenteNome, String(r.rinnovi ?? 0)]),
      foot: [["TOTALE", String(totals.rinnovi)]],
      footStyles,
      styles: { fontSize: 8 },
    })
    y = autoTableNextY(doc, y + 25)

    doc.setFontSize(11)
    doc.text("INVITO CLIENTI", 10, y)
    autoTable(doc, {
      startY: y + 2,
      head: [["Consulente", "Invito clienti (categoria INVITO)"]],
      body: rows.map((r) => [r.consulenteNome, String(r.invitoClienti ?? 0)]),
      foot: [["TOTALE", String(totals.invitoClienti)]],
      footStyles,
      styles: { fontSize: 8 },
    })
    y = autoTableNextY(doc, y + 25)

    doc.setFontSize(11)
    doc.text("CONTATTI TELEFONICI", 10, y)
    autoTable(doc, {
      startY: y + 2,
      head: [["Consulente", "Contatti telefonici"]],
      body: rows.map((r) => [r.consulenteNome, String(r.telefonate)]),
      foot: [["TOTALE", String(totals.telefonate)]],
      footStyles,
      styles: { fontSize: 8 },
    })

    doc.save(`analisi-produzione-${reportFrom}-${reportTo}.pdf`)
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">
            {role === "admin" ? "Panoramica del centro fitness" : "Le tue vendite"}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">— {oggi}</p>
        </div>
        {role === "admin" && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Data
              <input
                type="date"
                value={asOf}
                max={todayIso}
                onChange={(e) => {
                  const v = e.target.value
                  setAsOf(v > todayIso ? todayIso : v)
                }}
                lang="it-IT"
                title="Formato data: gg/mm/aaaa"
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Dal
              <input
                type="date"
                value={reportFrom}
                max={todayIso}
                onChange={(e) => {
                  const v = e.target.value
                  setReportFrom(v > todayIso ? todayIso : v)
                }}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Al
              <input
                type="date"
                value={reportTo}
                max={todayIso}
                onChange={(e) => {
                  const v = e.target.value
                  setReportTo(v > todayIso ? todayIso : v)
                }}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <button
              type="button"
              onClick={stampaReportPdf}
              disabled={
                reportQuery.isFetching ||
                !reportFrom ||
                !reportTo ||
                reportFrom > reportTo ||
                reportConsulentiEffective.length === 0
              }
              title={
                reportFrom && reportTo && reportFrom > reportTo
                  ? "Intervallo non valido: Dal è dopo Al"
                  : reportConsulentiEffective.length === 0
                    ? "Seleziona almeno una consulente"
                    : reportQuery.isFetching
                      ? "Preparazione report..."
                      : "Genera PDF con range e consulenti selezionati"
              }
              className="rounded-md border border-zinc-600 bg-zinc-900/40 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              {reportQuery.isFetching ? "Preparazione..." : "Stampa Report"}
            </button>
            <button
              type="button"
              onClick={() => setBudgetModal(true)}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
            >
              Imposta budget
            </button>
          </div>
        )}
      </div>

      {role === "admin" && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-300">Consulenti per Stampa Report</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Se non selezioni nulla, verranno usate automaticamente quelle presenti nel dettaglio mese del giorno scelto.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {allConsulentiFromDettaglio.map((c) => {
              const active = reportConsulentiSel.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    setReportConsulentiSel((prev) =>
                      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                    )
                  }
                  className={`rounded border px-3 py-1.5 text-xs ${
                    active
                      ? "border-amber-500 bg-amber-500/20 text-amber-400"
                      : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                  title={active ? "Inclusa nel report" : "Esclusa dal report"}
                >
                  {c}
                </button>
              )
            })}
            {allConsulentiFromDettaglio.length > 0 && (
              <button
                type="button"
                onClick={() => setReportConsulentiSel([])}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
                title="Reset selezione (auto)"
              >
                Reset (Auto)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Consulente: in primo piano due card (Giorno / Mese) con vendite e % obiettivo */}
      {role === "operatore" && (
        <div className="mt-6">
          <DettaglioVenditePrimoPiano
            giornoSelezionato={giornoConsulente}
            onGiornoChange={setGiornoConsulente}
          />
        </div>
      )}

      {/* Convalide ore lavorate (solo consulenti): data, ora inizio, ora fine */}
      {role === "operatore" && consulenteNome && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="mb-3 text-lg font-semibold text-zinc-100">Convalide ore lavorate</h2>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Data
              <input
                type="date"
                value={oraLavorataGiorno}
                onChange={(e) => setOraLavorataGiorno(e.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Ora inizio
              <input
                type="time"
                value={oraLavorataInizio}
                onChange={(e) => setOraLavorataInizio(e.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Ora fine
              <input
                type="time"
                value={oraLavorataFine}
                onChange={(e) => setOraLavorataFine(e.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
              />
            </label>
            <button
              type="button"
              onClick={() => postOraLavorataMutation.mutate()}
              disabled={postOraLavorataMutation.isPending}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {postOraLavorataMutation.isPending ? "Salvataggio..." : "Aggiungi"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Data</th>
                  <th className="pb-2 pr-4 font-medium">Ora inizio</th>
                  <th className="pb-2 pr-4 font-medium">Ora fine</th>
                  <th className="pb-2 font-medium">Azioni</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {oreLavorate.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-zinc-500">
                      Nessuna ora registrata per questo mese. Aggiungi con data, ora inizio e ora fine.
                    </td>
                  </tr>
                )}
                {oreLavorate.map((r: OraLavorata) => (
                  <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2 pr-4">{new Date(r.giorno + "T12:00:00").toLocaleDateString("it-IT")}</td>
                    <td className="py-2 pr-4">{r.oraInizio}</td>
                    <td className="py-2 pr-4">{r.oraFine}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => deleteOraLavorataMutation.mutate(r.id)}
                        disabled={deleteOraLavorataMutation.isPending}
                        className="text-red-400 hover:underline disabled:opacity-50"
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KPI: per operatore titolo "Riepilogo" per dare contesto */}
      <div className="mt-8">
        {role === "operatore" && (
          <h2 className="mb-3 text-sm font-medium text-zinc-500">Riepilogo</h2>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Lead totali</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">{data.leadTotali}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {data.leadVinti} vinti — {data.leadPersi} persi
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Abbonamenti attivi</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-400">{data.abbonamentiAttivi}</p>
          <p className="mt-0.5 text-xs text-zinc-500">esclusi tesseramenti — {data.abbonamentiInScadenza} (30 gg) / {data.abbonamentiInScadenza60 ?? 0} (60 gg) in scadenza</p>
          {role === "admin" && (
            <Link
              to={`/attivi-analisi?asOf=${encodeURIComponent(asOf)}`}
              className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/20"
            >
              Grafici attivi (durata · adulti / bambini)
            </Link>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Entrate mese (consuntivo a oggi)</p>
          <p
            className={`mt-1 text-2xl font-semibold ${
              safeNum(data.entrateMese) < 0 ? "text-red-400" : "text-amber-400"
            }`}
          >
            €{safeNum(data.entrateMese).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">{data.percentualeBudget}% del budget mese</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Budget mese / anno</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            €{Math.round(data.budgetMese ?? 0).toLocaleString("it-IT")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">anno: €{Math.round(data.budgetAnno ?? 0).toLocaleString("it-IT")} (somma Carmen + Serena + Ombretta)</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Tasso conversione</p>
          <p className="mt-1 text-2xl font-semibold text-violet-400">{data.tassoConversione}%</p>
          <p className="mt-0.5 text-xs text-zinc-500">{data.clientiAttivi} clienti attivi</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Chiamate</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-400">{chiamateStats?.oggi ?? 0}</p>
          <p className="mt-0.5 text-xs text-zinc-500">oggi — {chiamateStats?.settimana ?? 0} questa settimana</p>
        </div>
        </div>
      </div>

      {/* Totale del giorno / Totale per mese / Totale per anno (stessi parametri per consulenti) */}
      {(dettaglioGiornoMese || dettaglioAnnoData) && (
        <div className="mt-8 space-y-8">
          {dettaglioGiornoMese && (
            <>
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                <h2 className="mb-3 text-lg font-semibold text-zinc-100">
                  {dettaglioGiornoMese.giornoLabel ?? `Giorno ${giornoOggi}/${meseOggi}/${annoOggi}`}
                </h2>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Riepilogo</p>
                <KpiRow b={dettaglioGiornoMese.dettaglioGiorno} />
                {role === "admin" && (
                  <>
                    <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Dettaglio per consulente</p>
                    <TabellaConsulenti rows={dettaglioGiornoMese.dettaglioGiorno.perConsulente} />
                  </>
                )}
              </section>
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                <h2 className="mb-3 text-lg font-semibold text-zinc-100">
                  {dettaglioGiornoMese.meseLabel ?? `Mese ${meseOggi} ${annoOggi}`}
                </h2>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Riepilogo</p>
                <KpiRow b={dettaglioGiornoMese.dettaglioMese} />
                {role === "admin" && (
                  <>
                    <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Dettaglio per consulente</p>
                    <TabellaConsulenti rows={dettaglioGiornoMese.dettaglioMese.perConsulente} />
                  </>
                )}
              </section>
            </>
          )}
          {dettaglioAnnoData && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="mb-3 text-lg font-semibold text-zinc-100">
                {dettaglioAnnoData.annoLabel}
              </h2>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Riepilogo</p>
              <KpiRow b={dettaglioAnnoData.dettaglio} />
              {role === "admin" && (
                <>
                  <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Dettaglio per consulente</p>
                  <TabellaConsulenti rows={dettaglioAnnoData.dettaglio.perConsulente} />
                </>
              )}
            </section>
          )}
        </div>
      )}

      {/* Analisi: venduto, telefonate, ore lavorate */}
      {role === "admin" && chiamateStats && chiamateStats.perConsulente.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Telefonate fatte (analisi per consulente)</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[200px] text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-left text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Consulente</th>
                  <th className="pb-2 font-medium text-right">N° chiamate</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {chiamateStats.perConsulente.map((row) => (
                  <tr key={row.consulenteNome} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4">{row.consulenteNome}</td>
                    <td className="py-2 text-right font-medium text-cyan-400">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grafici */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Vendite vs budget mensile</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.venditePerMese}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="mese" stroke="#71717a" fontSize={12} />
                <YAxis stroke="#71717a" fontSize={12} tickFormatter={(v) => `€${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46" }}
                  formatter={(value: number) => [`€${value.toLocaleString("it-IT")}`, ""]}
                  labelFormatter={(l) => l}
                />
                <Legend />
                <Bar dataKey="vendite" name="Vendite" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="budget" name="Budget" fill="#52525b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Lead per fonte</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.leadPerFonte}
                  dataKey="count"
                  nameKey="fonte"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  label={({ fonte, count }) => `${fonte}: ${count}`}
                >
                  {data.leadPerFonte.map((_, i) => (
                    <Cell key={i} fill={COLORS_FONTE[i % COLORS_FONTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #3f3f46" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">In scadenza (30 giorni)</h2>
          <p className="mt-3 text-2xl font-semibold text-amber-400">{data.abbonamentiInScadenza ?? 0}</p>
          <p className="mt-0.5 text-xs text-zinc-500">totale</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">In scadenza (60 giorni)</h2>
          <p className="mt-3 text-2xl font-semibold text-amber-400">{data.abbonamentiInScadenza60 ?? 0}</p>
          <p className="mt-0.5 text-xs text-zinc-500">totale</p>
        </div>
      </div>

      {budgetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-lg font-semibold text-zinc-100">Budget per consulente (totale mese = somma)</h3>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500">Anno</label>
                  <input
                    type="number"
                    value={budgetAnno}
                    onChange={(e) => {
                      setBudgetPerConsulente({})
                      setBudgetAnno(Number(e.target.value))
                    }}
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500">Mese</label>
                  <select
                    value={budgetMese}
                    onChange={(e) => {
                      setBudgetPerConsulente({})
                      setBudgetMese(Number(e.target.value))
                    }}
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  >
                    {["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"].map((nome, i) => (
                      <option key={i} value={i + 1}>{nome}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(budgetData?.consulenti ?? []).map((label) => (
                <div key={label}>
                  <label className="block text-xs text-zinc-500">Budget {label} (€)</label>
                  <input
                    type="number"
                    value={budgetPerConsulente[label] ?? 20000}
                    onChange={(e) => setBudgetPerConsulente((prev) => ({ ...prev, [label]: Number(e.target.value) }))}
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  />
                </div>
              ))}
              <p className="text-xs text-zinc-500">
                Totale mese: €
                {Math.round(
                  (budgetData?.consulenti ?? []).reduce(
                    (s, label) => s + (budgetPerConsulente[label] ?? 20000),
                    0
                  )
                ).toLocaleString("it-IT")}
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setBudgetModal(false)} className="rounded-md border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Annulla
              </button>
              <button type="button" onClick={() => setBudgetMutation.mutate()} disabled={setBudgetMutation.isPending} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400">
                {setBudgetMutation.isPending ? "Salvataggio..." : "Salva"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
