import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

function todayIso(): string {
  const d = new Date()
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

export function Report() {
  const { role } = useAuth()
  const [from, setFrom] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  })
  const [to, setTo] = useState<string>(todayIso())
  const [selectedConsulenti, setSelectedConsulenti] = useState<string[]>([])
  const [sections, setSections] = useState<Record<string, boolean>>({
    produzione_totale: true,
    clienti_nuovi: true,
    rinnovi: true,
    invito_clienti: true,
    contatti_telefonici: true,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ["report-consulenti", from, to, selectedConsulenti.join("|")],
    queryFn: () => dataApi.getReportConsulenti({ from, to, consulenti: selectedConsulenti }),
    enabled: role === "admin",
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const { data: budgetData } = useQuery({
    queryKey: ["budget-consulenti-report"],
    queryFn: () => dataApi.getBudget(),
    enabled: role === "admin",
  })

  const rows = useMemo(() => data?.rows ?? [], [data?.rows])
  const totals = data?.totals
  const consulenti = useMemo(() => budgetData?.consulenti ?? [], [budgetData?.consulenti])

  useEffect(() => {
    if (consulenti.length === 0) return
    if (selectedConsulenti.length > 0) return
    setSelectedConsulenti(consulenti)
  }, [consulenti, selectedConsulenti.length])

  function toggleSection(k: string) {
    setSections((prev) => ({ ...prev, [k]: !prev[k] }))
  }

  function toggleConsulente(nome: string) {
    setSelectedConsulenti((prev) => (prev.includes(nome) ? prev.filter((x) => x !== nome) : [...prev, nome]))
  }

  function generatePdf() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
    const footStyles = { fontStyle: "bold" as const, fontSize: 8, halign: "left" as const }
    const t = totals
    const sumMovimenti = t?.movimentiAndamento ?? rows.reduce((s, r) => s + (r.movimentiAndamento ?? 0), 0)
    const sumVendite = t?.vendite ?? rows.reduce((s, r) => s + r.vendite, 0)
    const sumBudget = t?.budget ?? rows.reduce((s, r) => s + r.budget, 0)
    const sumScost = t?.scostamento ?? Math.round((sumVendite - sumBudget) * 100) / 100
    const trendTotale =
      t?.percentualeBudget ??
      (sumBudget > 0 ? Math.round((sumVendite / sumBudget) * 1000) / 10 : 0)
    const totNuovi = t?.clientiNuovi ?? rows.reduce((s, r) => s + (r.clientiNuovi ?? 0), 0)
    const totRinnovi = t?.rinnovi ?? rows.reduce((s, r) => s + (r.rinnovi ?? 0), 0)
    const totInvito = t?.invitoClienti ?? rows.reduce((s, r) => s + (r.invitoClienti ?? 0), 0)
    const totTel = t?.telefonate ?? rows.reduce((s, r) => s + r.telefonate, 0)

    doc.setFontSize(14)
    doc.text("ANALISI PRODUZIONE - FitCenter", 10, 10)
    doc.setFontSize(10)
    doc.text(`Dal: ${fmtDateIt(from)}   Al: ${fmtDateIt(to)}`, 10, 16)
    doc.text(`Consulenti: ${selectedConsulenti.join(", ") || "Nessuna"}`, 10, 21)
    let y = 28

    if (sections.produzione_totale) {
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
            String(sumMovimenti),
            `${sumVendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
            `${sumBudget.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
            `${sumScost.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €`,
            `${trendTotale.toLocaleString("it-IT", { minimumFractionDigits: 2 })}%`,
          ],
        ],
        footStyles,
        styles: { fontSize: 8 },
      })
      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 45
    }

    if (sections.clienti_nuovi) {
      doc.setFontSize(11)
      doc.text("CLIENTI NUOVI", 10, y)
      autoTable(doc, {
        startY: y + 2,
        head: [["Consulente", "Nuovi clienti"]],
        body: rows.map((r) => [r.consulenteNome, String(r.clientiNuovi ?? 0)]),
        foot: [["TOTALE", String(totNuovi)]],
        footStyles,
        styles: { fontSize: 8 },
      })
      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 25
    }

    if (sections.rinnovi) {
      doc.setFontSize(11)
      doc.text("RINNOVI", 10, y)
      autoTable(doc, {
        startY: y + 2,
        head: [["Consulente", "Rinnovi"]],
        body: rows.map((r) => [r.consulenteNome, String(r.rinnovi ?? 0)]),
        foot: [["TOTALE", String(totRinnovi)]],
        footStyles,
        styles: { fontSize: 8 },
      })
      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 25
    }

    if (sections.invito_clienti) {
      doc.setFontSize(11)
      doc.text("INVITO CLIENTI", 10, y)
      autoTable(doc, {
        startY: y + 2,
        head: [["Consulente", "Invito clienti (categoria INVITO)"]],
        body: rows.map((r) => [r.consulenteNome, String(r.invitoClienti ?? 0)]),
        foot: [["TOTALE", String(totInvito)]],
        footStyles,
        styles: { fontSize: 8 },
      })
      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 25
    }

    if (sections.contatti_telefonici) {
      doc.setFontSize(11)
      doc.text("CONTATTI TELEFONICI", 10, y)
      autoTable(doc, {
        startY: y + 2,
        head: [["Consulente", "Contatti telefonici"]],
        body: rows.map((r) => [r.consulenteNome, String(r.telefonate)]),
        foot: [["TOTALE", String(totTel)]],
        footStyles,
        styles: { fontSize: 8 },
      })
    }
    doc.save(`analisi-produzione-${from}-${to}.pdf`)
  }

  if (role !== "admin") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Report</h1>
        <p className="mt-2 text-sm text-zinc-500">Disponibile solo per admin.</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h1 className="text-2xl font-semibold text-zinc-100">Reports</h1>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-300">
          <label>Dal</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5" />
          <label>Al</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5" />
        </div>
        <div className="mt-4">
          <p className="text-sm text-zinc-400">Seleziona i consulenti da includere.</p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {consulenti.map((c) => (
              <label key={c} className="inline-flex items-center gap-2 text-sm text-zinc-200">
                <input type="checkbox" checked={selectedConsulenti.includes(c)} onChange={() => toggleConsulente(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <p className="text-sm text-zinc-400">Seleziona i report da includere.</p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={sections.produzione_totale} onChange={() => toggleSection("produzione_totale")} />Produzione totale</label>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={sections.clienti_nuovi} onChange={() => toggleSection("clienti_nuovi")} />Clienti nuovi</label>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={sections.rinnovi} onChange={() => toggleSection("rinnovi")} />Rinnovi</label>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={sections.invito_clienti} onChange={() => toggleSection("invito_clienti")} />Invito clienti</label>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={sections.contatti_telefonici} onChange={() => toggleSection("contatti_telefonici")} />Contatti telefonici</label>
          </div>
        </div>
        <div className="mt-4">
          <button type="button" onClick={generatePdf} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400">
            Genera Report PDF
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        {isLoading && <div className="py-10 text-center text-zinc-400">Caricamento...</div>}
        {error && <div className="py-6 text-center text-red-400">{(error as Error).message}</div>}
        {!isLoading && !error && data && (
          <>
            <p className="text-xs text-zinc-500">
              Periodo: <span className="text-zinc-300">{data.from}</span> → <span className="text-zinc-300">{data.to}</span>
              {data.computedAt && (
                <span className="ml-2 text-zinc-600">
                  · Aggiornato: {new Date(data.computedAt).toLocaleString("it-IT")}
                </span>
              )}
              <span className="ml-2 text-zinc-600">
                · Vendite € = dashboard (view o, in fallback, stesso SQL del progressivo mese). Movimenti = Andamento vendite.
              </span>
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-700 text-zinc-500">
                    <th className="pb-2 pr-4 font-medium">Consulente</th>
                    <th className="pb-2 pr-4 font-medium text-right">Movimenti</th>
                    <th className="pb-2 pr-4 font-medium text-right">Vendite €</th>
                    <th className="pb-2 pr-4 font-medium text-right">Budget €</th>
                    <th className="pb-2 pr-4 font-medium text-right">Telefonate</th>
                    <th className="pb-2 pr-4 font-medium text-right">Ore</th>
                    <th className="pb-2 pr-4 font-medium text-right">% ore</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {rows.map((r) => (
                    <tr key={r.consulenteNome} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-2 pr-4 font-medium text-zinc-200">{r.consulenteNome}</td>
                      <td className="py-2 pr-4 text-right text-zinc-400">{r.movimentiAndamento ?? 0}</td>
                      <td className="py-2 pr-4 text-right font-medium text-amber-400">
                        €{r.vendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 pr-4 text-right text-zinc-300">
                        €{r.budget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 pr-4 text-right font-medium text-cyan-400">{r.telefonate}</td>
                      <td className="py-2 pr-4 text-right">{r.oreLavorate.toLocaleString("it-IT")}h</td>
                      <td className="py-2 pr-4 text-right">{r.percentualeOre.toLocaleString("it-IT")}%</td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr className="border-t-2 border-zinc-600 bg-zinc-800/40 font-semibold text-zinc-100">
                      <td className="py-2 pr-4">TOTALE</td>
                      <td className="py-2 pr-4 text-right text-zinc-300">{totals.movimentiAndamento}</td>
                      <td className="py-2 pr-4 text-right text-amber-400">
                        €{totals.vendite.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 pr-4 text-right text-zinc-200">
                        €{totals.budget.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 pr-4 text-right text-cyan-400">{totals.telefonate}</td>
                      <td className="py-2 pr-4 text-right">{totals.oreLavorate.toLocaleString("it-IT")}h</td>
                      <td className="py-2 pr-4 text-right">{totals.percentualeOre.toLocaleString("it-IT")}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

