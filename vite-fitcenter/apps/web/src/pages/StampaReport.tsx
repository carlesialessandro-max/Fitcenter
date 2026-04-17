import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { useAuth } from "@/contexts/AuthContext"
import { dataApi } from "@/api/data"

const DEFAULT_CONSULENTI = ["Carmen Severino", "Ombretta Zenoni", "Serena Del Prete"]

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

export function StampaReport() {
  const { role } = useAuth()
  if (role !== "admin") return <Navigate to="/" replace />

  const todayIso = localIsoDate()
  const [from, setFrom] = useState(() => monthStartIso(todayIso))
  const [to, setTo] = useState(() => todayIso)

  const allConsulenti = useMemo(() => {
    // Evita attese: lista pronta subito (nessun “precalcolo”).
    return [...DEFAULT_CONSULENTI].sort((a, b) => a.localeCompare(b))
  }, [])

  const [consulentiSel, setConsulentiSel] = useState<string[]>([])
  const consulentiEffective = consulentiSel.length > 0 ? consulentiSel : allConsulenti

  const reportQuery = useQuery({
    queryKey: ["report-consulenti", from, to, consulentiEffective.join("|")],
    queryFn: () => dataApi.getReportConsulenti({ from, to, consulenti: consulentiEffective }),
    enabled: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
  })

  async function stampaReportPdf() {
    if (!from || !to) return
    if (from > to) return
    if (consulentiEffective.length === 0) return
    const out = await reportQuery.refetch()
    const reportData = out.data
    if (!reportData) return
    const { rows, totals } = reportData
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as JsPdfWithAutoTable
    const footStyles = { fontStyle: "bold" as const, fontSize: 8, halign: "left" as const }

    doc.setFontSize(14)
    doc.text("ANALISI PRODUZIONE - FitCenter", 10, 10)
    doc.setFontSize(10)
    doc.text(`Dal: ${fmtDateIt(from)}   Al: ${fmtDateIt(to)}`, 10, 16)
    doc.text(`Consulenti: ${consulentiEffective.join(", ") || "Nessuna"}`, 10, 21)
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

    doc.save(`analisi-produzione-${from}-${to}.pdf`)
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Stampa report</h1>
          <p className="mt-1 text-sm text-zinc-400">Seleziona periodo e consulenti, poi genera il PDF.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Dal
            <input
              type="date"
              value={from}
              max={todayIso}
              onChange={(e) => {
                const v = e.target.value
                setFrom(v > todayIso ? todayIso : v)
              }}
              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Al
            <input
              type="date"
              value={to}
              max={todayIso}
              onChange={(e) => {
                const v = e.target.value
                setTo(v > todayIso ? todayIso : v)
              }}
              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <button
            type="button"
            onClick={stampaReportPdf}
            disabled={reportQuery.isFetching || !from || !to || from > to || consulentiEffective.length === 0}
            title={
              from && to && from > to
                ? "Intervallo non valido: Dal è dopo Al"
                : consulentiEffective.length === 0
                  ? "Seleziona almeno una consulente"
                  : reportQuery.isFetching
                    ? "Preparazione report..."
                    : "Genera PDF con range e consulenti selezionati"
            }
            className="rounded-md border border-zinc-600 bg-zinc-900/40 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {reportQuery.isFetching ? "Preparazione..." : "Stampa Report"}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="text-sm font-medium text-zinc-300">Consulenti</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Se non selezioni nulla, verranno usate automaticamente quelle presenti nel dettaglio mese del giorno selezionato in “Al”.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {allConsulenti.map((c) => {
            const active = consulentiSel.includes(c)
            return (
              <button
                key={c}
                type="button"
                onClick={() => setConsulentiSel((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
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
          {allConsulenti.length > 0 && (
            <button
              type="button"
              onClick={() => setConsulentiSel([])}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
              title="Reset selezione (auto)"
            >
              Reset (Auto)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

