import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import jsPDF from "jspdf"
import autoTable, { type CellHookData, type UserOptions } from "jspdf-autotable"
import { useAuth } from "@/contexts/AuthContext"
import { dataApi, type ReportConsulenteRow, type ReportConsulentiResponse } from "@/api/data"

const DEFAULT_CONSULENTI = ["Carmen Severino", "Ombretta Zenoni", "Serena Del Prete"]

type PrintMode = "dettaglio" | "riepilogo"
type JsPdfInstance = InstanceType<typeof jsPDF>
type JsPdfWithAutoTable = JsPdfInstance & { lastAutoTable?: { finalY?: number } }

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
const PDF_FOOT_GRAY: [number, number, number] = [240, 240, 240]
const PDF_ALT_ROW: [number, number, number] = [248, 248, 248]

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

const pdfTableBase: Partial<UserOptions> = {
  margin: { left: PDF_MARGIN_X, right: PDF_MARGIN_X },
  styles: { fontSize: 8, halign: "left", valign: "middle", cellPadding: 1.8, textColor: 20 },
  headStyles: { fillColor: PDF_HEAD_BLUE, textColor: 255, halign: "left", fontStyle: "bold" },
  footStyles: { fillColor: PDF_FOOT_GRAY, textColor: 20, fontStyle: "bold", halign: "left" },
  alternateRowStyles: { fillColor: PDF_ALT_ROW },
  showFoot: "lastPage",
}

const detailColumnStyles: UserOptions["columnStyles"] = {
  0: { cellWidth: 34 },
  1: { cellWidth: 18 },
  2: { cellWidth: 52 },
  3: { cellWidth: 58 },
  4: { cellWidth: 24, halign: "right" },
}

const summary3ColStyles = (tw: number): UserOptions["columnStyles"] => ({
  0: { cellWidth: tw * 0.52 },
  1: { cellWidth: tw * 0.18, halign: "right" },
  2: { cellWidth: tw * 0.3, halign: "right" },
})

const summary2ColStyles = (tw: number): UserOptions["columnStyles"] => ({
  0: { cellWidth: tw * 0.62 },
  1: { cellWidth: tw * 0.38, halign: "right" },
})

function stylePdfFootCell(data: CellHookData) {
  if (data.section !== "foot") return
  data.cell.styles.textColor = 20
  data.cell.styles.halign = data.column.index === 0 ? "left" : "right"
}

function styleTotalRows(totalRowIndexes: Set<number>) {
  return (data: CellHookData) => {
    if (data.section === "foot") {
      data.cell.styles.textColor = 20
      data.cell.styles.halign = data.column.index === 0 ? "left" : "right"
      return
    }
    if (data.section !== "body" || !totalRowIndexes.has(data.row.index)) return
    data.cell.styles.fillColor = PDF_FOOT_GRAY
    data.cell.styles.fontStyle = "bold"
    data.cell.styles.textColor = 20
    if (data.column.index > 0) data.cell.styles.halign = "right"
  }
}

function sectionTitle(doc: JsPdfInstance, y: number, title: string): number {
  y = ensurePdfSpace(doc as JsPdfWithAutoTable, y)
  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.text(title, PDF_MARGIN_X, y)
  doc.setFont("helvetica", "normal")
  return y
}

function appendSummaryTable(
  doc: JsPdfWithAutoTable,
  y: number,
  head: string[],
  body: string[][],
  columnStyles: UserOptions["columnStyles"],
) {
  const totalIndexes = new Set<number>([body.length - 1])
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tableWidth(doc),
    startY: y,
    head: [head],
    body,
    columnStyles,
    showHead: "firstPage",
    didParseCell: styleTotalRows(totalIndexes),
  })
  return autoTableNextY(doc, y + 12)
}

type MovimentiSectionOpts = {
  title: string
  rows: ReportConsulenteRow[]
  mode: PrintMode
  pickRows: (r: ReportConsulenteRow) => { data: string; cliente: string; abbonamento: string; importo: number }[]
  pickCount: (r: ReportConsulenteRow) => number
  pickEuro: (r: ReportConsulenteRow) => number
  /** Solo conteggio clienti, senza colonna importo (inviti). */
  countOnly?: boolean
}

function appendMovimentiSection(doc: JsPdfWithAutoTable, y: number, opts: MovimentiSectionOpts) {
  const { title, rows, mode, pickRows, pickCount, pickEuro, countOnly = false } = opts
  const tw = tableWidth(doc)
  y = sectionTitle(doc, y, title)

  if (mode === "dettaglio") {
    const body: string[][] = []
    for (const r of rows) {
      for (const m of pickRows(r)) {
        if (countOnly) {
          body.push([r.consulenteNome, fmtDateShort(m.data), m.cliente || "—", m.abbonamento || "—"])
        } else {
          body.push([
            r.consulenteNome,
            fmtDateShort(m.data),
            m.cliente || "—",
            m.abbonamento || "—",
            fmtEuro(m.importo),
          ])
        }
      }
    }
    if (body.length === 0) {
      body.push(
        countOnly
          ? ["—", "—", "Nessun movimento nel periodo", "—"]
          : ["—", "—", "Nessun movimento nel periodo", "—", "—"],
      )
    }
    autoTable(doc, {
      ...pdfTableBase,
      tableWidth: tw,
      startY: y + 2,
      head: [
        countOnly
          ? ["Consulente", "Data", "Cliente", "Abbonamento"]
          : ["Consulente", "Data", "Cliente", "Abbonamento", "Importo €"],
      ],
      body,
      columnStyles: countOnly
        ? { 0: { cellWidth: 38 }, 1: { cellWidth: 20 }, 2: { cellWidth: 58 }, 3: { cellWidth: 70 } }
        : detailColumnStyles,
      showFoot: "never",
    })
    y = autoTableNextY(doc, y + 16, 4)
  }

  const summaryHead = countOnly ? ["Consulente", "Clienti invitati"] : ["Consulente", "Mov.", "Totale €"]
  const summaryBody = rows.map((r) =>
    countOnly
      ? [r.consulenteNome, String(pickCount(r))]
      : [r.consulenteNome, String(pickCount(r)), fmtEuro(pickEuro(r))],
  )
  summaryBody.push(
    countOnly
      ? ["TOTALE", String(rows.reduce((s, r) => s + pickCount(r), 0))]
      : [
          "TOTALE",
          String(rows.reduce((s, r) => s + pickCount(r), 0)),
          fmtEuro(rows.reduce((s, r) => s + pickEuro(r), 0)),
        ],
  )

  y = ensurePdfSpace(doc, y, countOnly ? 28 : 32)
  return appendSummaryTable(
    doc,
    y,
    summaryHead,
    summaryBody,
    countOnly ? summary2ColStyles(tw) : summary3ColStyles(tw),
  )
}

function appendCrossSection(doc: JsPdfWithAutoTable, y: number, rows: ReportConsulenteRow[], mode: PrintMode) {
  const tw = tableWidth(doc)
  y = sectionTitle(doc, y, "ABBONAMENTI CROSS")

  if (mode === "dettaglio") {
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
      tableWidth: tw,
      startY: y + 2,
      head: [["Consulente", "Data", "Cliente", "Abbonamento", "Totale €"]],
      body,
      columnStyles: detailColumnStyles,
      showFoot: "never",
    })
    y = autoTableNextY(doc, y + 16, 4)
  }

  const summaryBody = rows.map((r) => [
    r.consulenteNome,
    String(r.crossAbbonamenti ?? 0),
    fmtEuro(r.crossTotaleEuro ?? 0),
  ])
  summaryBody.push([
    "TOTALE",
    String(rows.reduce((s, r) => s + (r.crossAbbonamenti ?? 0), 0)),
    fmtEuro(rows.reduce((s, r) => s + (r.crossTotaleEuro ?? 0), 0)),
  ])

  y = ensurePdfSpace(doc, y, 32)
  return appendSummaryTable(doc, y, ["Consulente", "Cross", "Totale €"], summaryBody, summary3ColStyles(tw))
}

function appendOreConvalidazioniSection(
  doc: JsPdfWithAutoTable,
  y: number,
  rows: ReportConsulenteRow[],
  totals: ReportConsulentiResponse["totals"],
  mode: PrintMode,
) {
  const tw = tableWidth(doc)
  y = sectionTitle(doc, y, "ORE LAVORATE E CONVALIDAZIONI")

  if (mode === "dettaglio") {
    const body: string[][] = []
    for (const r of rows) {
      for (const o of r.dettaglioOreLavorate ?? []) {
        body.push([
          r.consulenteNome,
          fmtDateShort(o.giorno),
          o.oraInizio,
          o.oraFine,
          String(o.ore),
          o.convalidato ? "Sì" : "No",
        ])
      }
    }
    if (body.length === 0) {
      body.push(["—", "—", "Nessuna ora registrata nel periodo", "—", "—", "—"])
    }
    autoTable(doc, {
      ...pdfTableBase,
      tableWidth: tw,
      startY: y + 2,
      head: [["Consulente", "Giorno", "Inizio", "Fine", "Ore", "Convalidato"]],
      body,
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 22 },
        2: { cellWidth: 18 },
        3: { cellWidth: 18 },
        4: { cellWidth: 16, halign: "right" },
        5: { cellWidth: 24, halign: "center" },
      },
      showFoot: "never",
    })
    y = autoTableNextY(doc, y + 16, 4)
  }

  const summaryBody = rows.map((r) => [
    r.consulenteNome,
    String(r.oreLavorate ?? 0),
    String(r.oreAttese ?? 0),
    `${(r.percentualeOre ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 1 })}%`,
    String(r.giorniConvalidati ?? 0),
    r.giorniConvalidatiLista || "—",
  ])
  summaryBody.push([
    "TOTALE",
    String(totals.oreLavorate ?? 0),
    String(totals.oreAttese ?? 0),
    `${(totals.percentualeOre ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 1 })}%`,
    String(totals.giorniConvalidati ?? 0),
    "—",
  ])

  y = ensurePdfSpace(doc, y, 36)
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tw,
    startY: y,
    head: [["Consulente", "Ore lav.", "Ore attese", "% Ore", "Giorni conv.", "Elenco giorni convalidati"]],
    body: summaryBody,
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 18, halign: "right" },
      2: { cellWidth: 20, halign: "right" },
      3: { cellWidth: 16, halign: "right" },
      4: { cellWidth: 20, halign: "right" },
      5: { cellWidth: 72 },
    },
    showHead: "firstPage",
    didParseCell: styleTotalRows(new Set([summaryBody.length - 1])),
  })
  return autoTableNextY(doc, y + 12)
}

function buildPdf(
  reportData: ReportConsulentiResponse,
  consulentiEffective: string[],
  from: string,
  to: string,
  mode: PrintMode,
) {
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
  doc.text(`Modalità: ${mode === "dettaglio" ? "con dettaglio clienti" : "solo riepilogo"}`, PDF_MARGIN_X, 26)
  let y = 32

  y = sectionTitle(doc, y, "BUDGET MESE (salvato)")
  autoTable(doc, {
    ...pdfTableBase,
    tableWidth: tw,
    startY: y + 2,
    head: [["Consulente", "Budget mese €"]],
    body: rows.map((r) => [r.consulenteNome, fmtEuro(r.budgetMese ?? 0)]),
    foot: [["TOTALE", fmtEuro(totals.budgetMese ?? rows.reduce((s, r) => s + (r.budgetMese ?? 0), 0))]],
    columnStyles: { 0: { cellWidth: tw * 0.55 }, 1: { cellWidth: tw * 0.45, halign: "right" } },
    didParseCell: stylePdfFootCell,
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
    footStyles: { fillColor: PDF_FOOT_GRAY, textColor: 20, fontStyle: "bold" },
    didParseCell: stylePdfFootCell,
  })
  y = autoTableNextY(doc, y + 18)

  y = appendOreConvalidazioniSection(doc, y, rows, totals, mode)

  doc.addPage()
  y = 14

  y = appendMovimentiSection(doc, y, {
    title: "CLIENTI NUOVI",
    rows,
    mode,
    pickRows: (r) => r.dettaglioClientiNuovi ?? [],
    pickCount: (r) => r.clientiNuovi ?? 0,
    pickEuro: (r) => r.totaleEuroClientiNuovi ?? 0,
  })
  y = appendMovimentiSection(doc, y, {
    title: "RINNOVI",
    rows,
    mode,
    pickRows: (r) => r.dettaglioRinnovi ?? [],
    pickCount: (r) => r.rinnovi ?? 0,
    pickEuro: (r) => r.totaleEuroRinnovi ?? 0,
  })
  y = appendMovimentiSection(doc, y, {
    title: "INVITO CLIENTI",
    rows,
    mode,
    pickRows: (r) => r.dettaglioInvito ?? [],
    pickCount: (r) => r.invitoClienti ?? 0,
    pickEuro: () => 0,
    countOnly: true,
  })
  y = appendCrossSection(doc, y, rows, mode)

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
    didParseCell: stylePdfFootCell,
  })

  const suffix = mode === "riepilogo" ? "-riepilogo" : "-dettaglio"
  doc.save(`analisi-produzione-${from}-${to}${suffix}.pdf`)
}

export function StampaReport() {
  const { role, consulenteNome } = useAuth()
  const isOperatore = role === "operatore"
  if (role !== "admin" && !isOperatore) return <Navigate to="/" replace />

  const todayIso = localIsoDate()
  const [from, setFrom] = useState(() => monthStartIso(todayIso))
  const [to, setTo] = useState(() => todayIso)
  const [printMode, setPrintMode] = useState<PrintMode>("dettaglio")

  const allConsulenti = useMemo(() => {
    if (isOperatore && consulenteNome.trim()) return [consulenteNome.trim()]
    return [...DEFAULT_CONSULENTI].sort((a, b) => a.localeCompare(b))
  }, [isOperatore, consulenteNome])

  const [consulentiSel, setConsulentiSel] = useState<string[]>([])
  const consulentiEffective = isOperatore
    ? allConsulenti
    : consulentiSel.length > 0
      ? consulentiSel
      : allConsulenti

  const reportQuery = useQuery({
    queryKey: ["report-consulenti", from, to, consulentiEffective.join("|")],
    queryFn: () => dataApi.getReportConsulenti({ from, to, consulenti: consulentiEffective }),
    enabled: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
  })

  async function stampaReportPdf(mode: PrintMode) {
    if (!from || !to) return
    if (from > to) return
    if (consulentiEffective.length === 0) return
    const out = await reportQuery.refetch()
    const reportData = out.data
    if (!reportData) return
    buildPdf(reportData, consulentiEffective, from, to, mode)
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Stampa report</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Pagina 1: budget, produzione e ore/convalidazioni. Pagina 2: categorie con riepilogo per consulente.
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
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="text-sm font-medium text-zinc-300">Modalità stampa</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPrintMode("dettaglio")}
            className={`rounded border px-3 py-1.5 text-xs ${
              printMode === "dettaglio"
                ? "border-amber-500 bg-amber-500/20 text-amber-400"
                : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            Con dettaglio clienti
          </button>
          <button
            type="button"
            onClick={() => setPrintMode("riepilogo")}
            className={`rounded border px-3 py-1.5 text-xs ${
              printMode === "riepilogo"
                ? "border-amber-500 bg-amber-500/20 text-amber-400"
                : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            Solo riepilogo
          </button>
        </div>
        <button
          type="button"
          onClick={() => void stampaReportPdf(printMode)}
          disabled={reportQuery.isFetching || !from || !to || from > to || consulentiEffective.length === 0}
          className="mt-3 rounded-md border border-zinc-600 bg-zinc-900/40 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {reportQuery.isFetching ? "Preparazione..." : "Stampa Report"}
        </button>
      </div>

      {!isOperatore && (
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
      )}
    </div>
  )
}
