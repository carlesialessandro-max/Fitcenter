import { Fragment, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { amministrazioneApi, type AmmCollabReport, type AmmCollabReportRiga } from "@/api/amministrazione"
import { lpagaApi } from "@/api/lpaga"
import { parseCollabReportExcel, type CollabReportExcelRiga, type CollabReportExcelRimanenza } from "@/lib/collab-report-excel"

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function currentYear(): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric" }).format(new Date())
    )
  } catch {
    return new Date().getFullYear()
  }
}

function currentYm(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(
      new Date()
    )
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}

function CellImporto({
  nominativo,
  mese,
  value,
  origine,
  onSave,
  pending,
}: {
  nominativo: string
  mese: string
  value: number
  origine?: string
  onSave: (nominativo: string, mese: string, totale: number) => void
  pending: boolean
}) {
  const [edit, setEdit] = useState(false)
  const [raw, setRaw] = useState("")
  if (!edit) {
    return (
      <button
        type="button"
        title={origine === "manuale" ? "Importo modificato a mano (tracciato)" : "Clicca per modificare"}
        disabled={pending}
        onClick={() => {
          setRaw(value ? String(value).replace(".", ",") : "")
          setEdit(true)
        }}
        className={`w-full min-w-[4.5rem] rounded px-1 py-1 text-right tabular-nums hover:bg-zinc-800 ${
          origine === "manuale" ? "text-amber-200" : value ? "text-zinc-100" : "text-zinc-600"
        }`}
      >
        {value ? eur(value) : "—"}
      </button>
    )
  }
  return (
    <input
      autoFocus
      inputMode="decimal"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const n = Number(raw.replace(/\s/g, "").replace(",", "."))
        setEdit(false)
        if (!Number.isFinite(n) || n < 0) return
        if (Math.abs(n - value) < 0.005) return
        onSave(nominativo, mese, Math.round(n * 100) / 100)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") setEdit(false)
      }}
      className="w-full min-w-[4.5rem] rounded border border-amber-500/50 bg-zinc-950 px-1 py-1 text-right text-sm text-zinc-100"
    />
  )
}

export function ReportCollaboratori({
  source = "fitcenter",
  compact = false,
}: {
  source?: "fitcenter" | "lpaga"
  compact?: boolean
}) {
  const qc = useQueryClient()
  const [anno, setAnno] = useState(currentYear())
  const [q, setQ] = useState("")
  const [tipo, setTipo] = useState<"tutti" | "sportivo" | "gestionale">("tutti")
  const [repartoFiltro, setRepartoFiltro] = useState("tutti")
  const [nomeNew, setNomeNew] = useState("")
  const [meseNew, setMeseNew] = useState(currentYm())
  const [impNew, setImpNew] = useState("")
  const [tipoNew, setTipoNew] = useState<"sportivo" | "gestionale">("sportivo")
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")
  const [preview, setPreview] = useState<{
    nPersone: number
    tot: number
    totSettembre: number
    totRimanenze: number
    righe: CollabReportExcelRiga[]
    rimanenze: CollabReportExcelRimanenza[]
  } | null>(null)

  const report = useQuery({
    queryKey: ["amm-collab-report", source, anno],
    queryFn: (): Promise<AmmCollabReport> =>
      source === "lpaga" ? lpagaApi.reportCollaboratori(anno) : amministrazioneApi.reportCollaboratori(anno),
  })

  const saveMut = useMutation({
    mutationFn: (body: { nominativo: string; mese: string; totale: number; tipo?: "sportivo" | "gestionale" }) =>
      source === "lpaga" ? lpagaApi.setImportoCollaboratore(body) : amministrazioneApi.setImportoCollaboratore(body),
    onSuccess: () => {
      setErr("")
      setMsg("Importo aggiornato (modifica tracciata).")
      void qc.invalidateQueries({ queryKey: ["amm-collab-report"] })
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => {
      setMsg("")
      setErr(e.message)
    },
  })

  const rimMut = useMutation({
    mutationFn: (body: { nominativo: string; anno: number; importo: number }) =>
      source === "lpaga" ? lpagaApi.setRimanenzeCollaboratore(body) : amministrazioneApi.setRimanenzeCollaboratore(body),
    onSuccess: () => {
      setErr("")
      setMsg("Rimanenze aggiornate (modifica tracciata).")
      void qc.invalidateQueries({ queryKey: ["amm-collab-report"] })
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => {
      setMsg("")
      setErr(e.message)
    },
  })

  const filtered = useMemo(() => {
    const list = report.data?.righe ?? []
    const needle = q.trim().toLowerCase()
    return list.filter((r) => {
      if (tipo !== "tutti" && r.tipo !== tipo) return false
      if (repartoFiltro !== "tutti" && (r.reparto || "Senza reparto") !== repartoFiltro) return false
      if (needle && !r.nominativo.toLowerCase().includes(needle)) return false
      return true
    })
  }, [report.data?.righe, q, tipo, repartoFiltro])
  const reparti = useMemo(() => {
    const set = new Set<string>()
    for (const r of report.data?.righe ?? []) set.add(r.reparto || "Senza reparto")
    return [...set]
  }, [report.data?.righe])
  const groups = useMemo(() => {
    const out: { reparto: string; righe: AmmCollabReportRiga[] }[] = []
    for (const r of filtered) {
      const k = r.reparto || "Senza reparto"
      const last = out[out.length - 1]
      if (last && last.reparto === k) last.righe.push(r)
      else out.push({ reparto: k, righe: [r] })
    }
    return out
  }, [filtered])
  const mesi = report.data?.mesi ?? []
  const totMese = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of mesi) {
      out[m.id] = Math.round(filtered.reduce((s, r) => s + (r.mesi[m.id]?.totale ?? 0), 0) * 100) / 100
    }
    return out
  }, [filtered, mesi])
  const totAnno = Math.round(filtered.reduce((s, r) => s + r.tot, 0) * 100) / 100

  const importMut = useMutation({
    mutationFn: (body: { righe: CollabReportExcelRiga[]; rimanenze: CollabReportExcelRimanenza[] }) =>
      source === "lpaga"
        ? lpagaApi.importCollaboratoriReport(anno, body.righe, body.rimanenze)
        : amministrazioneApi.importCollaboratoriReport(anno, body.righe, body.rimanenze),
    onSuccess: (r) => {
      setPreview(null)
      setErr("")
      setMsg(
        `Importati ${r.nPersone ?? 0} nominativi, ${r.inserite} mensilità` +
          (r.sostituite ? ` (prima ${r.sostituite} righe dell'anno)` : "") +
          "."
      )
      void qc.invalidateQueries({ queryKey: ["amm-collab-report"] })
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => {
      setMsg("")
      setErr(e.message)
    },
  })

  async function onExcel(file: File | null) {
    if (!file) return
    setErr("")
    setMsg("")
    try {
      const buf = await file.arrayBuffer()
      const parsed = parseCollabReportExcel(buf, anno)
      const totSettembre =
        Math.round(parsed.righe.filter((r) => r.mese.endsWith("-09")).reduce((s, r) => s + r.totale, 0) * 100) / 100
      setPreview({
        nPersone: parsed.nPersone,
        tot: parsed.tot,
        totSettembre,
        totRimanenze: parsed.totRimanenze,
        righe: parsed.righe,
        rimanenze: parsed.rimanenze,
      })
    } catch (e) {
      setPreview(null)
      setErr((e as Error).message || "Excel non leggibile")
    }
  }

  function saveCell(nominativo: string, mese: string, totale: number, tipoRiga?: AmmCollabReportRiga["tipo"]) {
    saveMut.mutate({ nominativo, mese, totale, tipo: tipoRiga })
  }

  function addIstruttore() {
    const nominativo = nomeNew.trim()
    if (!nominativo) {
      setErr("Inserisci il nominativo.")
      return
    }
    const totale = Number(String(impNew).replace(",", ".")) || 0
    saveMut.mutate(
      { nominativo, mese: meseNew, totale, tipo: tipoNew },
      {
        onSuccess: () => {
          setNomeNew("")
          setImpNew("")
          setMsg(`Aggiunto ${nominativo}.`)
        },
      }
    )
  }

  return (
    <div className={`${compact ? "mt-4" : "p-4 sm:p-6"} print:p-0`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          {compact ? (
            <h2 className="text-lg font-semibold text-zinc-100">Collaboratori sportivi · tutte le mensilità</h2>
          ) : (
            <h1 className="text-2xl font-semibold text-zinc-100">Report collaboratori sportivi</h1>
          )}
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Come il REPORT GENERALE: tutte le mensilità, rimanenze anni precedenti, importo modificabile, oltre 5.000 € e
            oltre 15.000 €. Elenco ordinato per reparto del libro paga. Importa l’Excel, correggi gli importi o aggiungi
            un istruttore. Ogni modifica è tracciata. Solo admin e Alberto.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`${btnAmber} cursor-pointer`}>
            Importa Excel
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                void onExcel(e.target.files?.[0] ?? null)
                e.target.value = ""
              }}
            />
          </label>
          <button type="button" className={btnGhost} onClick={() => window.print()}>
            Stampa / PDF
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
        <label className="grid gap-1 text-xs text-zinc-500">
          Anno
          <input
            type="number"
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value) || currentYear())}
            className={inputCls}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Cerca
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nominativo" className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className={inputCls}>
            <option value="tutti">Tutti</option>
            <option value="sportivo">Istruttori</option>
            <option value="gestionale">Amm / gestionale</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Reparto
          <select value={repartoFiltro} onChange={(e) => setRepartoFiltro(e.target.value)} className={inputCls}>
            <option value="tutti">Tutti</option>
            {reparti.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {err ? <p className="mt-3 text-sm text-red-400 print:hidden">{err}</p> : null}
      {msg ? <p className="mt-3 text-sm text-emerald-300 print:hidden">{msg}</p> : null}
      {preview ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 print:hidden">
          <p className="text-sm text-zinc-300">
            File letto: {preview.nPersone} persone, {preview.righe.length} mensilità, {eur(preview.tot)} per il {anno}
            {preview.totSettembre ? ` · settembre ${eur(preview.totSettembre)}` : ""}
            {preview.totRimanenze ? ` · rimanenze ${eur(preview.totRimanenze)}` : ""}. Sostituisce i dati già presenti di
            quest’anno. Le partite IVA non vengono importate.
          </p>
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={() => setPreview(null)}>
              Annulla
            </button>
            <button
              type="button"
              className={btnAmber}
              disabled={importMut.isPending}
              onClick={() => importMut.mutate({ righe: preview.righe, rimanenze: preview.rimanenze })}
            >
              {importMut.isPending ? "Importazione…" : `Importa ${preview.nPersone}`}
            </button>
          </div>
        </div>
      ) : null}

      <form
        className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-3 print:hidden"
        onSubmit={(e) => {
          e.preventDefault()
          addIstruttore()
        }}
      >
        <label className="grid gap-1 text-xs text-zinc-500">
          Aggiungi istruttore
          <input
            value={nomeNew}
            onChange={(e) => setNomeNew(e.target.value)}
            placeholder="COGNOME NOME"
            className={`${inputCls} min-w-[14rem]`}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Mese
          <input type="month" value={meseNew} onChange={(e) => setMeseNew(e.target.value)} className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Importo
          <input
            value={impNew}
            onChange={(e) => setImpNew(e.target.value)}
            placeholder="0,00"
            inputMode="decimal"
            className={`${inputCls} w-28`}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Tipo
          <select value={tipoNew} onChange={(e) => setTipoNew(e.target.value as typeof tipoNew)} className={inputCls}>
            <option value="sportivo">Istruttore</option>
            <option value="gestionale">Amm / gestionale</option>
          </select>
        </label>
        <button type="submit" className={btnAmber} disabled={saveMut.isPending}>
          Aggiungi
        </button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800 print:border-zinc-400">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/50 text-zinc-400">
              <th className="sticky left-0 z-10 bg-zinc-950 px-3 py-2 font-medium print:static print:bg-white">Nominativo</th>
              {mesi.map((m) => (
                <th key={m.id} className="px-2 py-2 text-right font-medium">
                  {m.label}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium" title="Rimanenze degli anni precedenti">
                Rimanenze
              </th>
              <th className="px-2 py-2 text-right font-medium">IMPORTO</th>
              <th className="px-2 py-2 text-right font-medium">oltre € 5.000</th>
              <th className="px-2 py-2 text-right font-medium">oltre € 15.000</th>
            </tr>
          </thead>
          <tbody>
            {report.isLoading ? (
              <tr>
                <td colSpan={17} className="px-3 py-6 text-zinc-500">
                  Caricamento…
                </td>
              </tr>
            ) : null}
            {!report.isLoading && filtered.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-3 py-6 text-zinc-500">
                  Nessun collaboratore in questo anno. Importa i riepiloghi mensili in Stipendi, oppure aggiungi un
                  istruttore qui.
                </td>
              </tr>
            ) : null}
            {groups.map((g) => {
              const totG = Math.round(g.righe.reduce((s, r) => s + r.tot, 0) * 100) / 100
              return (
                <Fragment key={g.reparto}>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80">
                    <td
                      colSpan={17}
                      className="sticky left-0 z-10 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200 print:static print:bg-zinc-200 print:text-zinc-800"
                    >
                      {g.reparto}
                      <span className="ml-2 font-normal normal-case tracking-normal text-zinc-500">
                        {g.righe.length} · {eur(totG)}
                      </span>
                    </td>
                  </tr>
                  {g.righe.map((r) => (
                    <tr key={r.nominativo} className="border-b border-zinc-800/60">
                      <td className="sticky left-0 z-10 bg-zinc-950 px-3 py-1 font-medium text-zinc-100 print:static print:bg-white">
                        {r.nominativo}
                        {r.tipo === "gestionale" ? (
                          <span className="ml-2 text-[10px] font-normal uppercase text-zinc-500">gest. amm.</span>
                        ) : null}
                        {r.mansione && r.mansione !== g.reparto ? (
                          <span className="ml-2 text-[10px] font-normal text-zinc-500">{r.mansione}</span>
                        ) : null}
                      </td>
                      {mesi.map((m) => {
                        const cell = r.mesi[m.id]
                        return (
                          <td key={m.id} className="px-0.5 py-0.5">
                            <CellImporto
                              nominativo={r.nominativo}
                              mese={m.id}
                              value={cell?.totale ?? 0}
                              origine={cell?.origine}
                              pending={saveMut.isPending}
                              onSave={(nom, mese, tot) => saveCell(nom, mese, tot, r.tipo)}
                            />
                          </td>
                        )
                      })}
                      <td className="px-0.5 py-0.5">
                        <CellImporto
                          nominativo={r.nominativo}
                          mese={`${anno}-rim`}
                          value={r.rimanenze ?? 0}
                          pending={rimMut.isPending}
                          onSave={(nom, _mese, tot) => rimMut.mutate({ nominativo: nom, anno, importo: tot })}
                        />
                      </td>
                      <td className="px-2 py-1 text-right font-medium tabular-nums text-zinc-100">{eur(r.tot)}</td>
                      <td
                        className={`px-2 py-1 text-right tabular-nums ${r.oltre5000 ? "text-amber-200" : "text-zinc-600"}`}
                      >
                        {r.oltre5000 ? eur(r.oltre5000) : "—"}
                      </td>
                      <td
                        className={`px-2 py-1 text-right tabular-nums ${r.oltre15000 ? "text-red-300" : "text-zinc-600"}`}
                      >
                        {r.oltre15000 ? eur(r.oltre15000) : "—"}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
          {filtered.length ? (
            <tfoot>
              <tr className="border-t border-zinc-700 bg-zinc-950/80 font-medium text-zinc-100">
                <td className="sticky left-0 z-10 bg-zinc-950 px-3 py-2 print:static">TOTALE ({filtered.length})</td>
                {mesi.map((m) => (
                  <td key={m.id} className="px-2 py-2 text-right tabular-nums">
                    {totMese[m.id] ? eur(totMese[m.id] ?? 0) : "—"}
                  </td>
                ))}
                <td className="px-2 py-2 text-right tabular-nums">
                  {eur(filtered.reduce((s, r) => s + (r.rimanenze ?? 0), 0))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{eur(totAnno)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {eur(filtered.reduce((s, r) => s + r.oltre5000, 0))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {eur(filtered.reduce((s, r) => s + r.oltre15000, 0))}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {(report.data?.audit ?? []).length ? (
        <section className="mt-6 print:hidden">
          <h2 className="text-sm font-semibold text-zinc-200">Registro modifiche</h2>
          <p className="mt-1 text-xs text-zinc-500">Traccia per controlli esterni: ultime variazioni di importo.</p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="px-3 py-1.5 font-medium">Quando</th>
                  <th className="px-3 py-1.5 font-medium">Chi</th>
                  <th className="px-3 py-1.5 font-medium">Nominativo</th>
                  <th className="px-3 py-1.5 font-medium">Mese</th>
                  <th className="px-3 py-1.5 font-medium text-right">Da</th>
                  <th className="px-3 py-1.5 font-medium text-right">A</th>
                </tr>
              </thead>
              <tbody>
                {(report.data?.audit ?? []).map((a) => (
                  <tr key={a.id} className="border-b border-zinc-800/50 text-zinc-300">
                    <td className="px-3 py-1.5 text-zinc-500">
                      {a.at.slice(0, 10)} {a.at.slice(11, 16)}
                    </td>
                    <td className="px-3 py-1.5">{a.user}</td>
                    <td className="px-3 py-1.5">{a.nominativo}</td>
                    <td className="px-3 py-1.5">
                      {/^\d{4}$/.test(a.mese) && a.nominativo !== "Import Excel" ? `Rimanenze ${a.mese}` : a.mese}
                    </td>
                    <td className="px-3 py-1.5 text-right">{a.da == null ? "—" : eur(a.da)}</td>
                    <td className="px-3 py-1.5 text-right">{a.a == null ? "—" : eur(a.a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
