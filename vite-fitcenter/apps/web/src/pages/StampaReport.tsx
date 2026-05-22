import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { useAuth } from "@/contexts/AuthContext"
import { dataApi, type ReportConsulenteRow, type ReportConsulentiResponse } from "@/api/data"

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

function fmtDateShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}`
}

function fmtEuro(n: number): string {
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`
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

const PDF_MARGIN_X = 10
const PDF_HEAD_BLUE: [number, number, number] = [70, 166, 217]

function tableWidth(doc: JsPdfInstance): number {
  return doc.internal.pageSize.getWidth() - PDF_MARGIN_X * 2
}

function ensurePdfSpace(doc: JsPdfWithAutoTable, y: number, reserveMm = 52): number {
  const pageH = doc.internal.pageSize.getHeight()
  if (y > pageH - reserveMm) {
    doc.addPage()
    return 14
  }
  return y
}

const pdfTableBase = {
  margin: { left: PDF_MARGIN_X, right: PDF_MARGIN_X },
  styles: { fontSize: 8, halign: "left" as const, valign: "middle" as const, cellPadding: 1.8 },
  headStyles: { fillColor: PDF_HEAD_BLUE, textColor: 255, halign: "left" as const, fontStyle: "bold" as const },
  footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" as const, fontSize: 8, halign: "left" as const },
  alternateRowStyles: { fillColor: [248, 248, 248] },
}

const detailColumnStyles = {
  0: { cellWidth: 34 },
  1: { cellWidth: 18 },
  2: { cellWidth: 52 },
  3: { cellWidth: 58 },
  4: { cellWidth: 24, halign: "right" as const },
}

function sectionTitle(doc: JsPdfInstance, y: number, title: string): number {
  y = ensurePdfSpace(doc as JsPdfWithAutoTable, y)
  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.text(title, PDF_MARGIN_X, y)
  doc.setFont("helvetica", "normal")
  return y
}

function appendMovimentiSection(
  doc: JsPdfWithAutoTable,
  y: number,
  title: string,
  rows: ReportConsulenteRow[],
  pickRows: (r: ReportConsulenteRow) => { data: string; cliente: string; abbonamento: string; importo: number }[],
  pickCount: (r: ReportConsulenteRow) => number,
  pickEuro: (r: ReportConsulenteRow) => number,
  importoLabel = "Importo €",
) {
  y = sectionTitle(doc, y, title)
  const body: string[][] = []
  for (const r of rows) {
    for (const m of pickRows(r)) {
      body.push([
        r.consulenteNome,
        fmtDateShort(m.data),
        m.cliente || "—",
        m.abbonamento || "—",
        fmtEuro(m.importo),
      ])
    }
  }
  if (body.length === 0) {
    body.push(["—", "—", "Nessun movimento nel periodo", "—", "—"])
  }
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tableWidth(doc),
    startY: y + 2,
    head: [["Consulente", "Data", "Cliente", "Abbonamento", importoLabel]],
    body,
    columnStyles: detailColumnStyles,
    foot: [
      ...rows.map((r) => [
        r.consulenteNome,
        "",
        `${pickCount(r)} mov.`,
        "Totale",
        fmtEuro(pickEuro(r)),
      ]),
      [
        "TOTALE",
        "",
        `${rows.reduce((s, r) => s + pickCount(r), 0)} mov.`,
        "",
        fmtEuro(rows.reduce((s, r) => s + pickEuro(r), 0)),
      ],
    ],
  })
  return autoTableNextY(doc, y + 20)
}

function appendCrossSection(doc: JsPdfWithAutoTable, y: number, rows: ReportConsulenteRow[]) {
  y = sectionTitle(doc, y, "ABBONAMENTI CROSS")
  const body: string[][] = []
  for (const r of rows) {
    for (const m of r.dettaglioCross ?? []) {
      body.push([
        r.consulenteNome,
        fmtDateShort(m.data),
        m.cliente || "—",
        m.abbonamento || "—",
        fmtEuro(m.totale),
      ])
    }
  }
  if (body.length === 0) {
    body.push(["—", "—", "Nessun cross nel periodo", "—", "—"])
  }
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tableWidth(doc),
    startY: y + 2,
    head: [["Consulente", "Data", "Cliente", "Abbonamento", "Totale €"]],
    body,
    columnStyles: detailColumnStyles,
    foot: [
      ...rows.map((r) => [
        r.consulenteNome,
        "",
        `${r.crossAbbonamenti ?? 0} mov.`,
        "Totale",
        fmtEuro(r.crossTotaleEuro ?? 0),
      ]),
      [
        "TOTALE",
        "",
        `${rows.reduce((s, r) => s + (r.crossAbbonamenti ?? 0), 0)} mov.`,
        "",
        fmtEuro(rows.reduce((s, r) => s + (r.crossTotaleEuro ?? 0), 0)),
      ],
    ],
  })
  return autoTableNextY(doc, y + 20)
}

function buildPdf(reportData: ReportConsulentiResponse, consulentiEffective: string[], from: string, to: string) {
  const { rows, totals } = reportData
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as JsPdfWithAutoTable
  const tw = tableWidth(doc)

  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text("ANALISI PRODUZIONE - FitCenter", PDF_MARGIN_X, 10)
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  doc.text(`Dal: ${fmtDateIt(from)}   Al: ${fmtDateIt(to)}`, PDF_MARGIN_X, 16)
  doc.text(`Consulenti: ${consulentiEffective.join(", ") || "Nessuna"}`, PDF_MARGIN_X, 21)
  let y = 28

  y = sectionTitle(doc, y, "BUDGET MESE (salvato)")
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tw,
    startY: y + 2,
    head: [["Consulente", "Budget mese €"]],
    body: rows.map((r) => [r.consulenteNome, fmtEuro(r.budgetMese ?? 0)]),
    foot: [["TOTALE", fmtEuro(totals.budgetMese ?? rows.reduce((s, r) => s + (r.budgetMese ?? 0), 0))]],
    columnStyles: { 0: { cellWidth: tw * 0.55 }, 1: { cellWidth: tw * 0.45, halign: "right" } },
  })
  y = autoTableNextY(doc, y + 18)

  y = sectionTitle(doc, y, "PRODUZIONE TOTALE")
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tw,
    startY: y + 2,
    head: [["Consulente", "Movimenti", "Produzione €", "Budget mese", "Budget periodo", "Scostamento", "Trend"]],
    body: rows.map((r) => [
      r.consulenteNome,
      String(r.movimentiAndamento ?? 0),
      fmtEuro(r.vendite),
      fmtEuro(r.budgetMese ?? 0),
      fmtEuro(r.budget),
      fmtEuro(r.vendite - r.budget),
      `${r.percentualeBudget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}%`,
    ]),
    foot: [
      [
        "TOTALE",
        String(totals.movimentiAndamento),
        fmtEuro(totals.vendite),
        fmtEuro(totals.budgetMese ?? 0),
        fmtEuro(totals.budget),
        fmtEuro(totals.scostamento),
        `${totals.percentualeBudget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}%`,
      ],
    ],
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 18, halign: "right" },
      2: { cellWidth: 28, halign: "right" },
      3: { cellWidth: 28, halign: "right" },
      4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 28, halign: "right" },
      6: { cellWidth: 18, halign: "right" },
    },
  })
  y = autoTableNextY(doc, y + 24)

  doc.addPage()
  y = 14

  y = appendMovimentiSection(
    doc,
    y,
    "CLIENTI NUOVI",
    rows,
    (r) => r.dettaglioClientiNuovi ?? [],
    (r) => r.clientiNuovi ?? 0,
    (r) => r.totaleEuroClientiNuovi ?? 0,
  )
  y = appendMovimentiSection(
    doc,
    y,
    "RINNOVI",
    rows,
    (r) => r.dettaglioRinnovi ?? [],
    (r) => r.rinnovi ?? 0,
    (r) => r.totaleEuroRinnovi ?? 0,
  )
  y = appendMovimentiSection(
    doc,
    y,
    "INVITO CLIENTI",
    rows,
    (r) => r.dettaglioInvito ?? [],
    (r) => r.invitoClienti ?? 0,
    () => 0,
    "Importo €",
  )
  y = appendCrossSection(doc, y, rows)

  y = ensurePdfSpace(doc, y, 30)
  y = sectionTitle(doc, y, "CONTATTI TELEFONICI")
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tw,
    startY: y + 2,
    head: [["Consulente", "Contatti telefonici"]],
    body: rows.map((r) => [r.consulenteNome, String(r.telefonate)]),
    foot: [["TOTALE", String(totals.telefonate)]],
    columnStyles: { 0: { cellWidth: tw * 0.55 }, 1: { cellWidth: tw * 0.45, halign: "right" } },
  })

  doc.save(`analisi-produzione-${from}-${to}.pdf`)
}

export function StampaReport() {
  const { role } = useAuth()
  if (role !== "admin") return <Navigate to="/" replace />

  const todayIso = localIsoDate()
  const [from, setFrom] = useState(() => monthStartIso(todayIso))
  const [to, setTo] = useState(() => todayIso)

  const allConsulenti = useMemo(() => [...DEFAULT_CONSULENTI].sort((a, b) => a.localeCompare(b)), [])

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
    buildPdf(reportData, consulentiEffective, from, to)
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Stampa report</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Pagina 1: budget e produzione. Pagina 2: movimenti per categoria (nuovi, rinnovi, inviti, cross) con totali.
          </p>
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
