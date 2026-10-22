import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useAuth } from "@/contexts/AuthContext"
import {
  amministrazioneApi,
  type AmmBusta,
  type AmmFornitoreQuoteMeta,
  type AmmQuota,
  type AmmReparto,
  type AmmSpesa,
  type AmmStipendiPdfRiga,
  type AmmTipoCosto,
} from "@/api/amministrazione"
import { extractPdfText, extractPdfTextWithOcr } from "@/lib/pdf-fattura-text"
import { downloadAmmExcelTemplate, parseAmmExcel, type AmmExcelPreview } from "@/lib/amm-excel"
import { macroSplitLabel, macroSplitTargets, normalizeMacroSplitQuote } from "@/lib/amm-macro-split"
import { downloadAmmMastrinoTemplate, parseAmmMastrino, type AmmMastrinoPreview } from "@/lib/amm-mastrino"

const COLORS = ["#46A6D9", "#F59E0B", "#34D399", "#A78BFA", "#F87171", "#FBBF24", "#60A5FA", "#C084FC"]
const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function macroPrimarioRicavo(r: {
  macro: string
  ripartizione?: { macro: string; importo: number }[]
}): string {
  if (r.ripartizione?.length === 1) return r.ripartizione[0]!.macro
  if (r.ripartizione?.length) {
    return r.ripartizione.reduce((best, q) => (q.importo > best.importo ? q : best)).macro
  }
  return r.macro.split("+")[0]?.trim().toLowerCase() || "altro"
}

function macroDettaglioLabel(id: string): string {
  if (id === "piscina") return "Piscina"
  if (id === "fitness") return "Fitness"
  if (id === "spa") return "SPA"
  return "Altri incassi"
}

function repartoDettaglioLabel(r: {
  macro: string
  ripartizione?: { macro: string; importo: number }[]
}): string {
  if (r.ripartizione?.length) {
    return r.ripartizione.map((quota) => `${macroDettaglioLabel(quota.macro)} ${eur(quota.importo)}`).join(" · ")
  }
  const parts = r.macro.split("+").map((s) => s.trim()).filter(Boolean)
  if (parts.length > 1) {
    return parts.map((p) => macroDettaglioLabel(p.toLowerCase())).join(" · ")
  }
  return macroDettaglioLabel(macroPrimarioRicavo(r))
}

function fmtDateIt(iso: string): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function currentYm(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}

function quoteSum(q: AmmQuota[]): number {
  return Math.round(q.reduce((s, x) => s + Number(x.percentuale || 0), 0) * 100) / 100
}

function macrosOf(reparti: AmmReparto[]): AmmReparto[] {
  return reparti.filter((r) => r.attivo && r.livello === "macro").sort((a, b) => a.ordine - b.ordine)
}

function sottoOf(reparti: AmmReparto[], macroId: string): AmmReparto[] {
  return reparti.filter((r) => r.attivo && r.livello === "sotto" && r.macroId === macroId).sort((a, b) => a.ordine - b.ordine)
}

function nomeReparto(reparti: AmmReparto[], id: string): string {
  return reparti.find((r) => r.id === id)?.nome ?? id
}

function origineLabel(o: AmmSpesa["origine"]): string {
  if (o === "fattureincloud") return "Fatture in Cloud"
  if (o === "excel") return "Excel"
  if (o === "ocr") return "PDF"
  return "Manuale"
}

type Tab = "dashboard" | "spese" | "stipendi" | "reparti"
type Imputazione = "sotto" | "macro"

export function AmministrazioneCosti() {
  const { role } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  if (role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Amministrazione</h2>
          <p className="mt-2 text-sm text-zinc-500">Pagina disponibile solo per amministratori.</p>
        </div>
      </div>
    )
  }
  const tab: Tab = loc.pathname.includes("/reparti")
    ? "reparti"
    : loc.pathname.includes("/stipendi")
      ? "stipendi"
      : loc.pathname.includes("/spese")
        ? "spese"
        : "dashboard"
  const tabs: { id: Tab; to: string; label: string }[] = [
    { id: "dashboard", to: "/amministrazione", label: "Risultato per reparto" },
    { id: "spese", to: "/amministrazione/spese", label: "Registro spese" },
    { id: "stipendi", to: "/amministrazione/stipendi", label: "Stipendi" },
    { id: "reparti", to: "/amministrazione/reparti", label: "Reparti e centri di costo" },
  ]
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Amministrazione</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Si inseriscono i costi per capire se un reparto guadagna o perde. I fissi di struttura sono la somma di Gestione
        & Direzione e Spese generali & Utenze (non imputabili ai singoli reparti) e vengono ripartiti su Piscina,
        Fitness e SPA in base ai ricavi del periodo.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? btnAmber : btnGhost}
            onClick={() => nav(t.to)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "dashboard" ? (
        <DashboardTab />
      ) : tab === "spese" ? (
        <RegistroTab />
      ) : tab === "stipendi" ? (
        <StipendiTab />
      ) : (
        <RepartiTab />
      )}
    </div>
  )
}

function DashboardTab() {
  const now = currentYm()
  const [anno, setAnno] = useState(Number(now.slice(0, 4)))
  const [mese, setMese] = useState(now.slice(5, 7))
  const [tuttoAnno, setTuttoAnno] = useState(false)
  const [reparto, setReparto] = useState("")
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const dash = useQuery({
    queryKey: ["amm-dash", anno, tuttoAnno ? "" : mese, reparto],
    queryFn: () => amministrazioneApi.dashboard(anno, tuttoAnno ? undefined : `${anno}-${mese}`, reparto || undefined),
  })
  const d = dash.data
  const pie = d?.byMacro?.length ? d.byMacro : (d?.byReparto ?? [])
  const attivi = (meta.data?.reparti ?? []).filter((r) => r.attivo)
  const pnl = d?.risultato ?? []
  const costiDirettiReparti = pnl.reduce((sum, row) => sum + row.costiDiretti, 0)
  const costiAltriCentri = d?.totCostiFuoriReparti ?? 0
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Anno
          <input type="number" value={anno} onChange={(e) => setAnno(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Mese
          <input
            type="month"
            value={`${anno}-${mese}`}
            disabled={tuttoAnno}
            onChange={(e) => {
              const v = e.target.value
              if (/^\d{4}-\d{2}$/.test(v)) {
                setAnno(Number(v.slice(0, 4)))
                setMese(v.slice(5, 7))
              }
            }}
            className={inputCls}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={tuttoAnno} onChange={(e) => setTuttoAnno(e.target.checked)} className="accent-amber-500" />
          Intero anno
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Reparto
          <select value={reparto} onChange={(e) => setReparto(e.target.value)} className={inputCls}>
            <option value="">Tutti</option>
            {macrosOf(attivi).map((m) => (
              <optgroup key={m.id} label={m.nome}>
                <option value={m.id}>{m.nome} (macro)</option>
                {sottoOf(attivi, m.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {dash.isLoading && <p className="text-sm text-zinc-500">Caricamento…</p>}
      {dash.isError && <p className="text-sm text-red-400">{(dash.error as Error).message}</p>}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              title="Ricavi totali"
              value={d.ricaviDisponibili ? eur(d.totRicaviAzienda) : "—"}
              hint={
                d.ricaviDisponibili
                  ? `${eur(d.totRicavi ?? 0)} Piscina/Fitness/SPA + ${eur(d.totRicaviAltri ?? 0)} altri incassi`
                  : "Incassi gestionali non disponibili"
              }
            />
            <Kpi
              title="Costi attribuiti ai reparti"
              value={eur(d.totCostoPnl ?? d.tot)}
              hint={`${eur(costiDirettiReparti)} costi diretti + ${eur(d.totStruttura ?? 0)} quota fissi ripartiti`}
            />
            <Kpi
              title="Risultato impresa"
              value={d.ricaviDisponibili ? eur(d.totUtileAzienda) : "—"}
              hint={
                d.ricaviDisponibili
                  ? `Ricavi totali ${eur(d.totRicaviAzienda)} − tutti i costi ${eur(d.totCostiAzienda)}`
                  : "Incassi gestionali non disponibili: risultato non calcolabile"
              }
              tone={d.ricaviDisponibili ? (d.totUtileAzienda >= 0 ? "ok" : "ko") : undefined}
            />
            <Kpi
              title="Totale costi azienda"
              value={eur(d.totCostiAzienda)}
              hint={`${eur(d.totCostiFuoriReparti)} in altri centri, oltre ai tre reparti commerciali`}
            />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs leading-relaxed text-zinc-400">
            <p>
              <span className="font-medium text-zinc-200">Come leggere i totali:</span> il risultato impresa è dato da
              tutti i ricavi gestionali meno tutti i costi registrati. I costi attribuiti a Piscina, Fitness e SPA
              comprendono i costi diretti più la quota dei fissi di struttura ripartita in base ai ricavi.
            </p>
            <p className="mt-1">
              I costi di altri centri (per esempio Manutenzione, Pulizie o Varie) sono mostrati nella riga dedicata e
              inclusi nel totale e nel risultato dell’impresa: il riparto non li elimina.
            </p>
            <p className="mt-1">
              I ricavi ordinari arrivano dagli incassi del gestionale. Gli incassi Danza sono esclusi: per il Centro
              Arte Danza si considerano solo le fatture emesse in Fatture in Cloud. Le fatture a Big Food con
              descrizione energia/gas riducono automaticamente le utenze.
            </p>
            <p className="mt-1">I totali aziendali restano complessivi anche quando si seleziona un reparto nel filtro.</p>
          </div>
          {d.ricaviErrore && (
            <p className="rounded-lg border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
              Ricavi e risultato non completi: {d.ricaviErrore}
            </p>
          )}
          {d.ricaviDisponibili && (d.ricaviDettaglio?.length ?? 0) > 0 && (
            <details className="rounded-xl border border-zinc-800 px-3 py-2">
              <summary className="cursor-pointer text-sm text-zinc-300">Dettaglio ricavi per voce</summary>
              <p className="mt-2 text-[11px] text-zinc-500">
                Allineato a «Movimenti di cassa»: data operazione e importo cassa nel periodo. La data nel testo «PAGAMENTO
                RATA del …» è la scadenza, non l’incasso: una rata di gennaio pagata a dicembre (o non pagata) non entra
                qui. Le rate incassate nel mese stanno sotto il prodotto (es. 1 M MENSILE 3VS).
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-left text-zinc-500">
                    <tr>
                      <th className="px-2 py-1">Categoria / abbonamento</th>
                      <th className="px-2 py-1">Reparto</th>
                      <th className="px-2 py-1 text-right">Movimenti/fatture</th>
                      <th className="px-2 py-1 text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ricaviDettaglio?.flatMap((r, index) => {
                      const macroId = macroPrimarioRicavo(r)
                      const prevMacro =
                        index > 0 ? macroPrimarioRicavo(d.ricaviDettaglio![index - 1]!) : null
                      const header =
                        index === 0 || macroId !== prevMacro ? (
                          <tr key={`hdr-${macroId}-${index}`} className="border-t border-zinc-700 bg-zinc-900/60">
                            <td colSpan={4} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                              {macroDettaglioLabel(macroId)}
                            </td>
                          </tr>
                        ) : null
                      const row = (
                        <tr key={`${r.voce}-${macroId}-${index}`} className="border-t border-zinc-800/80 text-zinc-300">
                          <td className="px-2 py-1 pl-4">{r.voce}</td>
                          <td className="px-2 py-1 text-zinc-400">{repartoDettaglioLabel(r)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.n}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{eur(r.importo)}</td>
                        </tr>
                      )
                      return header ? [header, row] : [row]
                    })}
                  </tbody>
                </table>
              </div>
              {(d.totRecuperiUtenze ?? 0) > 0.009 && (
                <p className="mt-2 text-xs text-zinc-400">
                  Recuperi Big Food sottratti alle utenze: {eur(d.totRecuperiUtenze ?? 0)}.
                </p>
              )}
              {(d.totRicaviDanza ?? 0) > 0.009 && (
                <p className="mt-1 text-xs text-zinc-400">
                  Fatture Danza al Centro Arte Danza incluse: {eur(d.totRicaviDanza ?? 0)} ({d.nFattureDanza ?? 0} documenti).
                </p>
              )}
            </details>
          )}
          {d.ricaviDisponibili && (
            <details className="rounded-xl border border-zinc-800 px-3 py-2">
              <summary className="cursor-pointer text-sm text-zinc-300">
                Fatture emesse considerate ({d.fattureEmesseDettaglio?.length ?? 0})
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-left text-zinc-500">
                    <tr>
                      <th className="px-2 py-1">Data</th>
                      <th className="px-2 py-1">N. documento</th>
                      <th className="px-2 py-1">Cliente</th>
                      <th className="px-2 py-1">Descrizione</th>
                      <th className="px-2 py-1">Considerata come</th>
                      <th className="px-2 py-1 text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.fattureEmesseDettaglio?.map((doc, index) => (
                      <tr
                        key={`${doc.dataDocumento}-${doc.numeroDocumento}-${index}`}
                        className="border-t border-zinc-800 text-zinc-300"
                      >
                        <td className="px-2 py-1">{fmtDateIt(doc.dataDocumento)}</td>
                        <td className="px-2 py-1">{doc.numeroDocumento}</td>
                        <td className="px-2 py-1">{doc.cliente}</td>
                        <td className="px-2 py-1">{doc.descrizione || "—"}</td>
                        <td className="px-2 py-1">{doc.tipo}</td>
                        <td className="px-2 py-1 text-right">{eur(doc.totale)}</td>
                      </tr>
                    ))}
                    {!d.fattureEmesseDettaglio?.length && (
                      <tr>
                        <td className="px-2 py-3 text-zinc-500" colSpan={6}>
                          Nessuna fattura Danza o recupero utenze Big Food nel periodo selezionato.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Le fatture Danza concorrono ai ricavi; i recuperi Big Food sono sottratti dai costi utenze.
              </p>
            </details>
          )}
          {(d.totRicaviAltri ?? 0) > 0.009 && (
            <p className="text-xs text-zinc-500">
              Altri incassi non attribuiti a Piscina / Fitness / SPA: {eur(d.totRicaviAltri ?? 0)}. Sono inclusi nel risultato dell’impresa.
            </p>
          )}
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Reparto / centro</th>
                  <th className="px-3 py-2 font-medium text-right">Ricavi</th>
                  <th className="px-3 py-2 font-medium text-right" title="Costi assegnati direttamente al reparto o centro, prima del riparto dei costi fissi">
                    Costi diretti
                  </th>
                  <th className="px-3 py-2 font-medium text-right" title="Quota dei costi fissi di struttura assegnata al reparto in base ai ricavi">
                    Quota fissi
                  </th>
                  <th className="px-3 py-2 font-medium text-right" title="Costi diretti più quota dei fissi; per gli altri centri comprende tutti i costi non inclusi nei tre reparti">
                    Costo totale
                  </th>
                  <th className="px-3 py-2 font-medium text-right">Risultato</th>
                  <th className="px-3 py-2 font-medium text-right">% su ricavi</th>
                </tr>
              </thead>
              <tbody>
                {pnl.length ? (
                  <>
                    {pnl.map((r) => (
                      <tr key={r.id} className="border-t border-zinc-800">
                        <td className="px-3 py-2 text-zinc-100">
                          {r.nome}
                          <span className="ml-2 text-xs text-zinc-500">fissi {r.ripartoFissiPct}%</span>
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-200">{eur(r.ricavi)}</td>
                        <td className="px-3 py-2 text-right text-zinc-400">{eur(r.costiDiretti)}</td>
                        <td className="px-3 py-2 text-right text-zinc-400">{eur(r.quotaFissi)}</td>
                        <td className="px-3 py-2 text-right text-zinc-200">{eur(r.costoTotale)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${!d.ricaviDisponibili ? "text-zinc-400" : r.utile >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {d.ricaviDisponibili ? eur(r.utile) : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right ${!d.ricaviDisponibili ? "text-zinc-400" : r.utile >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {d.ricaviDisponibili && r.marginePct != null ? `${r.marginePct}%` : "—"}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-zinc-800 bg-zinc-900/20">
                      <td className="px-3 py-2 text-zinc-100">Altri centri di costo (Manutenzione, Pulizie, Varie...)</td>
                      <td className="px-3 py-2 text-right text-zinc-400">—</td>
                      <td className="px-3 py-2 text-right text-zinc-400">{eur(costiAltriCentri)}</td>
                      <td className="px-3 py-2 text-right text-zinc-400">—</td>
                      <td className="px-3 py-2 text-right text-zinc-200">{eur(costiAltriCentri)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${!d.ricaviDisponibili || costiAltriCentri <= 0 ? "text-zinc-400" : "text-red-400"}`}>
                        {d.ricaviDisponibili ? eur(costiAltriCentri > 0 ? -costiAltriCentri : 0) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-400">—</td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td className="px-3 py-4 text-zinc-500" colSpan={7}>
                      Nessun dato nel periodo. Inserisci i costi nel registro: il risultato ha senso quando ci sono ricavi e
                      costi dello stesso mese.
                    </td>
                  </tr>
                )}
              </tbody>
              {pnl.length ? (
                <tfoot>
                  <tr className="border-t border-zinc-700 bg-zinc-900/40 font-medium">
                    <td className="px-3 py-2 text-zinc-100">Totale impresa</td>
                    <td className="px-3 py-2 text-right">{d.ricaviDisponibili ? eur(d.totRicaviAzienda) : "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-400">
                      {eur(costiDirettiReparti + costiAltriCentri)}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-400">{eur(d.totStruttura ?? 0)}</td>
                    <td className="px-3 py-2 text-right">{eur(d.totCostiAzienda)}</td>
                    <td className={`px-3 py-2 text-right ${!d.ricaviDisponibili ? "text-zinc-400" : d.totUtileAzienda >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {d.ricaviDisponibili ? eur(d.totUtileAzienda) : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right ${!d.ricaviDisponibili ? "text-zinc-400" : d.totUtileAzienda >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {d.ricaviDisponibili && d.margineAziendaPct != null ? `${d.margineAziendaPct}%` : "—"}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Il totale impresa considera tutti i centri di costo. Solo i fissi di struttura sono ripartiti tra Piscina,
            Fitness e SPA in proporzione ai ricavi; gli altri costi restano nella riga “Altri centri” e concorrono
            comunque al risultato complessivo.
          </p>
          {(d.strutturaByMacro ?? []).length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              <li className="font-medium text-zinc-400">
                Fissi di struttura da ripartire {eur(d.totStruttura ?? 0)}:
              </li>
              {(d.strutturaByMacro ?? []).map((r) => (
                <li key={r.id}>
                  {r.nome} {eur(r.importo)}
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 p-4">
              <h3 className="mb-3 text-sm font-medium text-zinc-200">Spese per macro-area</h3>
              {pie.length ? (
                <div className="h-64">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={pie} dataKey="importo" nameKey="nome" innerRadius={50} outerRadius={90} paddingAngle={2}>
                        {pie.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => eur(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Nessun costo nel periodo.</p>
              )}
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                {pie.map((r, i) => (
                  <li key={r.id} className="flex justify-between gap-3">
                    <span>
                      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      {r.nome}
                    </span>
                    <span>{eur(r.importo)}</span>
                  </li>
                ))}
              </ul>
              {(d.byReparto ?? []).some((r) => r.macroId && r.macroId !== r.id) && (
                <ul className="mt-3 space-y-1 border-t border-zinc-800 pt-2 text-xs text-zinc-500">
                  {d.byReparto
                    .filter((r) => r.id !== r.macroId)
                    .map((r) => (
                      <li key={r.id} className="flex justify-between gap-3">
                        <span>{r.nome}</span>
                        <span>{eur(r.importo)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-zinc-800 p-4">
              <h3 className="mb-3 text-sm font-medium text-zinc-200">Andamento {anno}</h3>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={d.byMese}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" stroke="#71717a" />
                    <YAxis stroke="#71717a" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip formatter={(v) => eur(Number(v))} />
                    <Bar dataKey="importo" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({
  title,
  value,
  hint,
  tone,
}: {
  title: string
  value: string
  hint: string
  tone?: "ok" | "ko"
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <p className="text-xs text-zinc-500">{title}</p>
      <p
        className={`mt-1 text-xl font-semibold ${
          tone === "ok" ? "text-emerald-400" : tone === "ko" ? "text-red-400" : "text-zinc-100"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </div>
  )
}

type FormState = {
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  descrizione: string
  totale: string
  tipoCosto: AmmTipoCosto
  imputazione: Imputazione
  sottoId: string
  quote: AmmQuota[]
  memoriaQuote: "default" | "eccezione"
}

function emptyForm(): FormState {
  return {
    fornitore: "",
    numeroDocumento: "",
    dataDocumento: currentYm() + "-01",
    descrizione: "",
    totale: "",
    tipoCosto: "fisso",
    imputazione: "sotto",
    sottoId: "",
    quote: [],
    memoriaQuote: "default",
  }
}

function formFromSpesa(s: AmmSpesa, reparti: AmmReparto[]): FormState {
  const quoteNorm = normalizeMacroSplitQuote(s.quote.map((x) => ({ ...x })))
  const one = quoteNorm.length === 1 && Math.abs(quoteNorm[0].percentuale - 100) < 0.05
  const target = one ? reparti.find((r) => r.id === quoteNorm[0].repartoId) : undefined
  const sotto = target?.livello === "sotto"
  return {
    fornitore: s.fornitore,
    numeroDocumento: s.numeroDocumento,
    dataDocumento: s.dataDocumento,
    descrizione: s.descrizione,
    totale: String(s.totale),
    tipoCosto: s.tipoCosto,
    imputazione: sotto ? "sotto" : "macro",
    sottoId: sotto && target ? target.id : "",
    quote: sotto ? [] : quoteNorm.map((x) => ({ ...x })),
    memoriaQuote: s.quoteEccezione ? "eccezione" : "default",
  }
}

function quoteDaForm(f: FormState): AmmQuota[] {
  if (f.imputazione === "sotto") return f.sottoId ? [{ repartoId: f.sottoId, percentuale: 100 }] : []
  return f.quote.filter((q) => q.percentuale > 0)
}

function compactFornitore(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "")
}

function inFinestraPiscinaEstateUi(
  dataDocumento: string,
  fornitore: string,
  fornitoriQuote: AmmFornitoreQuoteMeta[],
  speseAnno: AmmSpesa[],
  excludeSpesaId?: string | null
): boolean {
  const doc = String(dataDocumento).slice(0, 10)
  const m = Number(doc.slice(5, 7))
  const anno = doc.slice(0, 4)
  if (m < 6 || m > 9) return false
  if (m >= 6 && m <= 8) return true
  const hit = quoteMetaFor(fornitore, fornitoriQuote)
  const matchFornitore = (nome: string) => {
    if (!hit) return compactFornitore(nome) === compactFornitore(fornitore)
    return [hit.chiave, hit.ragioneSociale].some((k) => {
      const c = compactFornitore(k)
      const n = compactFornitore(nome)
      return Boolean(c && n && (n === c || n.includes(c) || (c.length >= 8 && c.includes(n))))
    })
  }
  const settembre = [
    ...speseAnno
      .filter((s) => !excludeSpesaId || s.id !== excludeSpesaId)
      .filter((s) => matchFornitore(s.fornitore))
      .map((s) => s.dataDocumento.slice(0, 10)),
    doc,
  ]
    .filter((d) => d.startsWith(`${anno}-09`))
    .sort()
  const primaFornitura = settembre[0]
  if (!primaFornitura) return true
  return doc <= primaFornitura
}

function quotePiscinaStagionale(
  dataDocumento: string,
  opts?: {
    fornitore?: string
    fornitoriQuote?: AmmFornitoreQuoteMeta[]
    speseAnno?: AmmSpesa[]
    excludeSpesaId?: string | null
  }
): AmmQuota[] {
  const inWindow =
    opts?.fornitore && opts.fornitoriQuote && opts.speseAnno
      ? inFinestraPiscinaEstateUi(
          dataDocumento,
          opts.fornitore,
          opts.fornitoriQuote,
          opts.speseAnno,
          opts.excludeSpesaId
        )
      : (() => {
          const m = Number(String(dataDocumento ?? "").slice(5, 7))
          return m >= 6 && m <= 8
        })()
  if (inWindow) {
    return [
      { repartoId: "piscina-estiva", percentuale: 75 },
      { repartoId: "piscina-coperta", percentuale: 25 },
    ]
  }
  return [{ repartoId: "piscina-coperta", percentuale: 100 }]
}

function quoteMetaFor(nome: string, list: AmmFornitoreQuoteMeta[]): AmmFornitoreQuoteMeta | undefined {
  const n = compactFornitore(nome)
  if (!n) return undefined
  return list.find((r) => {
    const keys = [r.chiave, r.ragioneSociale]
    return keys.some((k) => {
      const c = compactFornitore(k)
      return Boolean(c) && (n === c || n.includes(c) || (c.length >= 8 && c.includes(n)))
    })
  })
}

function quotesMatch(a: AmmQuota[], b: AmmQuota[]): boolean {
  if (a.length !== b.length) return false
  const map = new Map(b.map((x) => [x.repartoId, Number(x.percentuale)]))
  return a.every((x) => Math.abs((map.get(x.repartoId) ?? NaN) - Number(x.percentuale)) < 0.05)
}

function memoriaQuoteDaRiparto(
  fornitore: string,
  quote: AmmQuota[],
  list: AmmFornitoreQuoteMeta[]
): FormState["memoriaQuote"] | null {
  const hit = quoteMetaFor(fornitore, list)
  if (!hit?.quote?.length || hit.stagionale === "piscina-estate") return null
  return quotesMatch(quote, hit.quote) ? "default" : "eccezione"
}

function formFromQuote(quote: AmmQuota[], reparti: AmmReparto[]): Pick<FormState, "imputazione" | "sottoId" | "quote"> {
  const one = quote.length === 1 && Math.abs(quote[0].percentuale - 100) < 0.05
  const target = one ? reparti.find((r) => r.id === quote[0].repartoId) : undefined
  if (target?.livello === "sotto") return { imputazione: "sotto", sottoId: target.id, quote: [] }
  return { imputazione: "macro", sottoId: "", quote: quote.map((x) => ({ ...x })) }
}

function RegistroTab() {
  const qc = useQueryClient()
  const now = currentYm()
  const [mese, setMese] = useState(now)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [ocrMsg, setOcrMsg] = useState("")
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<AmmExcelPreview[] | null>(null)
  const [importMsg, setImportMsg] = useState("")
  const [ficToken, setFicToken] = useState("")
  const [ficOpen, setFicOpen] = useState(false)
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const fic = useQuery({ queryKey: ["amm-fic"], queryFn: amministrazioneApi.ficStatus })
  const list = useQuery({
    queryKey: ["amm-spese", mese, q],
    queryFn: () => amministrazioneApi.listSpese(mese, q),
  })
  const [form, setForm] = useState<FormState>(emptyForm)
  const quoteAnno = form.dataDocumento.slice(0, 4)
  const speseAnnoQuote = useQuery({
    queryKey: ["amm-spese", quoteAnno, "piscina-estate"],
    queryFn: () => amministrazioneApi.listSpese(quoteAnno, ""),
    enabled: open && /^\d{4}$/.test(quoteAnno),
  })
  const reparti = meta.data?.reparti ?? []
  const attivi = reparti.filter((r) => r.attivo)
  const macros = macrosOf(attivi)
  const macroSplit = macroSplitTargets(attivi)
  const quote = quoteDaForm(form)
  const somma = quoteSum(quote)
  const okSplit = Math.abs(somma - 100) < 0.05 && quote.length > 0

  function startNew() {
    setEditId(null)
    setPdf(null)
    setOcrMsg("")
    setForm(emptyForm())
    setOpen(true)
  }
  function startEdit(s: AmmSpesa) {
    setEditId(s.id)
    setPdf(null)
    setOcrMsg("")
    let next = formFromSpesa(s, reparti)
    if (!s.quoteEccezione) {
      const auto = applyQuoteFornitore(s.fornitore, s.dataDocumento, undefined, s.id)
      if (auto) next = { ...next, ...auto, memoriaQuote: "default" }
    }
    setForm(next)
    setOpen(true)
  }

  function applyQuoteFornitore(
    nome: string,
    dataDocumento: string,
    quoteOverride?: AmmQuota[],
    excludeSpesaId?: string | null
  ): Pick<FormState, "imputazione" | "sottoId" | "quote"> | null {
    const fornitoriQuote = meta.data?.fornitoriQuote ?? []
    const speseAnno = speseAnnoQuote.data?.spese ?? []
    const q =
      quoteOverride?.length
        ? quoteOverride
        : (() => {
            const hit = quoteMetaFor(nome, fornitoriQuote)
            const stagionale =
              hit?.stagionale === "piscina-estate" ||
              /diversey|toscochimic|ramo/.test(compactFornitore(nome))
            if (stagionale) {
              return quotePiscinaStagionale(dataDocumento, {
                fornitore: nome,
                fornitoriQuote,
                speseAnno,
                excludeSpesaId: excludeSpesaId ?? editId,
              })
            }
            if (!hit) return null
            return hit.quote
          })()
    if (!q?.length) return null
    return formFromQuote(q, attivi)
  }

  const saveMut = useMutation({
    mutationFn: () =>
      amministrazioneApi.saveSpesa(
        {
          id: editId ?? undefined,
          fornitore: form.fornitore,
          numeroDocumento: form.numeroDocumento,
          dataDocumento: form.dataDocumento,
          descrizione: form.descrizione,
          totale: Number(form.totale.replace(",", ".")),
          tipoCosto: form.tipoCosto,
          quote,
          rememberQuote: form.memoriaQuote !== "eccezione",
          quoteEccezione: form.memoriaQuote === "eccezione",
          origine: pdf ? "ocr" : editId ? undefined : "manuale",
        },
        pdf
      ),
    onSuccess: () => {
      setOpen(false)
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-spese"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
      void qc.invalidateQueries({ queryKey: ["amm-meta"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => amministrazioneApi.deleteSpesa(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["amm-spese"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const ficConnectMut = useMutation({
    mutationFn: () =>
      amministrazioneApi.ficConnect({
        accessToken: ficToken.trim() || undefined,
        defaultRepartoId: "altri-costi",
      }),
    onSuccess: () => {
      setFicToken("")
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-fic"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const ficDisconnectMut = useMutation({
    mutationFn: () => amministrazioneApi.ficDisconnect(),
    onSuccess: () => {
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-fic"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const ficSyncMut = useMutation({
    mutationFn: () => amministrazioneApi.ficSync(mese, fic.data?.defaultRepartoId || "altri-costi"),
    onSuccess: (r) => {
      setImportMsg(
        `Fatture in Cloud: ${r.lette ?? 0} lette, ${r.inserite} nuove` +
          (r.saltate ? `, ${r.saltate} già presenti` : "") +
          (r.errori.length ? `, ${r.errori.length} errori` : "") +
          "."
      )
      void qc.invalidateQueries({ queryKey: ["amm-spese"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
      void qc.invalidateQueries({ queryKey: ["amm-meta"] })
      void qc.invalidateQueries({ queryKey: ["amm-fic"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const importMut = useMutation({
    mutationFn: (righe: AmmExcelPreview[]) => amministrazioneApi.importSpese(righe),
    onSuccess: (r) => {
      setPreview(null)
      setImportMsg(`Importate ${r.inserite} spese` + (r.saltate ? `, ${r.saltate} già presenti` : "") + (r.errori.length ? `, ${r.errori.length} errori` : "") + ".")
      void qc.invalidateQueries({ queryKey: ["amm-spese"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
      void qc.invalidateQueries({ queryKey: ["amm-meta"] })
    },
    onError: (e: Error) => setError(e.message),
  })

  async function onPdf(file: File | null) {
    setPdf(file)
    if (!file) return
    setOcrMsg("Lettura PDF…")
    try {
      const text = await extractPdfText(file)
      const r = await amministrazioneApi.ocr(text, file.name)
      const p = r.parsed
      const fornitore = r.fornitoreNoto?.ragioneSociale || p.fornitore || ""
      const dataDocumento = p.dataDocumento || ""
      const auto = applyQuoteFornitore(fornitore, dataDocumento, r.quoteSuggerite)
      setForm((f) => ({
        ...f,
        fornitore: fornitore || f.fornitore,
        numeroDocumento: p.numeroDocumento || f.numeroDocumento,
        dataDocumento: dataDocumento || f.dataDocumento,
        descrizione: p.descrizione || f.descrizione,
        totale: p.totale != null ? String(p.totale).replace(".", ",") : f.totale,
        ...(auto ?? {}),
        memoriaQuote: auto ? "default" : f.memoriaQuote,
      }))
      const missing: string[] = []
      if (!(r.fornitoreNoto?.ragioneSociale || p.fornitore)) missing.push("fornitore")
      if (p.totale == null) missing.push("importo")
      if (!p.dataDocumento) missing.push("data")
      setOcrMsg(
        missing.length
          ? `PDF letto in parte: manca ${missing.join(", ")}. Completa a mano e scegli il reparto.`
          : auto
            ? `Letto: ripartizione del fornitore applicata in automatico. Controlla e conferma.`
            : r.fornitoreNoto
              ? `Letto: fornitore già in anagrafica (${r.fornitoreNoto.ragioneSociale}). Controlla e conferma il reparto.`
              : "Dati precompilati dal PDF. Controlla e scegli il sotto-reparto o lo split sulle macro-aree."
      )
    } catch (e) {
      setOcrMsg((e as Error).message || "Lettura PDF non riuscita: inserisci a mano.")
    }
  }

  async function onExcel(file: File | null) {
    if (!file) return
    setError("")
    setImportMsg("")
    try {
      const buf = await file.arrayBuffer()
      setPreview(parseAmmExcel(buf, attivi))
    } catch (e) {
      setError((e as Error).message || "Excel non leggibile")
    }
  }

  function setPerc(id: string, perc: number) {
    setForm((f) => {
      const quoteNext = f.quote.some((x) => x.repartoId === id)
        ? f.quote.map((x) => (x.repartoId === id ? { ...x, percentuale: perc } : x))
        : [...f.quote, { repartoId: id, percentuale: perc }]
      const quote = quoteNext.filter((x) => x.percentuale > 0)
      const auto = memoriaQuoteDaRiparto(f.fornitore, quote, meta.data?.fornitoriQuote ?? [])
      return { ...f, quote, memoriaQuote: auto ?? f.memoriaQuote }
    })
  }

  const okPreview = (preview ?? []).filter((p) => !p.errore)

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Mese competenza
          <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className={inputCls} />
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca fornitore, n. documento…" className={`${inputCls} min-w-[16rem] flex-1`} />
        <button type="button" className={btnGhost} onClick={() => downloadAmmExcelTemplate()}>
          Modello Excel
        </button>
        <label className={`${btnGhost} cursor-pointer`}>
          Importa Excel
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void onExcel(e.target.files?.[0] ?? null)} />
        </label>
        <button
          type="button"
          className={btnAmber}
          disabled={ficSyncMut.isPending}
          onClick={() => {
            if (!fic.data?.connected) {
              setFicOpen(true)
              setError("Collega Fatture in Cloud per scaricare gli acquisti del mese.")
              return
            }
            ficSyncMut.mutate()
          }}
        >
          {ficSyncMut.isPending ? "Scarico…" : "Scarica da Fatture in Cloud"}
        </button>
        <button type="button" className={btnGhost} onClick={() => setFicOpen((v) => !v)}>
          {fic.data?.connected ? `Collegato: ${fic.data.companyName || "Fatture in Cloud"}` : "Collega Fatture in Cloud"}
        </button>
        <button type="button" className={btnAmber} onClick={startNew}>
          + Nuova spesa
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        All’inserimento puoi confermare che le percentuali restano la regola del fornitore, oppure segnarle come
        eccezione del mese (i prossimi scarichi tengono la regola precedente). RA.MO, Diversey e Toscochimica: fino a
        maggio e dopo la prima fornitura di settembre 100% piscina coperta; da giugno fino a quella fornitura
        (apertura piscina esterna) 75% piscina esterna / 25% coperta. Si ricalcola anche sulle fatture già scaricate.
      </p>
      {ficOpen && (
        <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-300">
          <p className="text-zinc-400">
            In Fatture in Cloud: Impostazioni → Applicazioni collegate → Collega una nuova applicazione. Crea prima
            un’app su developers.fattureincloud.it, copia l’identificativo applicazione, autorizza la lettura degli
            acquisti e delle fatture emesse, quindi incolla qui il token. La dashboard legge dal cloud le fatture al
            Centro Arte Danza e i recuperi utenze a Big Food. In alternativa si può mettere il token e l’id azienda
            nel file di configurazione dell’API.
          </p>
          {fic.data?.connected ? (
            <p className="text-emerald-300">
              Collegato a {fic.data.companyName || "azienda"} ({fic.data.tokenMasked}
              {fic.data.fromEnv ? ", da .env" : ""}). Allo scarico si riapplicano le ripartizioni già usate per quel
              fornitore (o i default: Mattonai, TeamSystem, utenze, Technogym, prodotti piscina, ecc.).
            </p>
          ) : (
            <p className="text-zinc-500">Non collegato: senza token non si possono scaricare gli acquisti.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {!fic.data?.fromEnv && (
              <label className="grid min-w-[18rem] flex-1 gap-1 text-xs text-zinc-500">
                Token di accesso
                <input
                  type="password"
                  autoComplete="off"
                  value={ficToken}
                  onChange={(e) => setFicToken(e.target.value)}
                  placeholder="Incolla il token"
                  className={inputCls}
                />
              </label>
            )}
            <button
              type="button"
              className={btnAmber}
              disabled={ficConnectMut.isPending || (!ficToken.trim() && !fic.data?.connected && !fic.data?.fromEnv)}
              onClick={() => ficConnectMut.mutate()}
            >
              {ficConnectMut.isPending ? "Verifica…" : fic.data?.connected ? "Aggiorna collegamento" : "Collega"}
            </button>
            {fic.data?.connected && !fic.data.fromEnv && (
              <button type="button" className={btnGhost} disabled={ficDisconnectMut.isPending} onClick={() => ficDisconnectMut.mutate()}>
                Scollega
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {importMsg && <p className="text-sm text-emerald-300">{importMsg}</p>}
      {preview && (
        <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-200">
              Anteprima import: {okPreview.length} valide, {preview.length - okPreview.length} con errori
            </h3>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => setPreview(null)}>
                Annulla
              </button>
              <button
                type="button"
                className={btnAmber}
                disabled={!okPreview.length || importMut.isPending}
                onClick={() => importMut.mutate(okPreview)}
              >
                {importMut.isPending ? "Caricamento…" : `Importa ${okPreview.length}`}
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Stesso fornitore + n. documento + data + totale su più righe = una spesa con split %. Le duplicate già in
            archivio vengono saltate.
          </p>
          <div className="max-h-72 overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="px-2 py-1">Riga</th>
                  <th className="px-2 py-1">Fornitore</th>
                  <th className="px-2 py-1">Data</th>
                  <th className="px-2 py-1">Totale</th>
                  <th className="px-2 py-1">Ripartizione</th>
                  <th className="px-2 py-1">Esito</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={`${p.riga}-${p.fornitore}`} className={p.errore ? "text-red-300" : "text-zinc-200"}>
                    <td className="px-2 py-1">{p.riga}</td>
                    <td className="px-2 py-1">{p.fornitore || "—"}</td>
                    <td className="px-2 py-1">{p.dataDocumento ? fmtDateIt(p.dataDocumento) : "—"}</td>
                    <td className="px-2 py-1">{p.totale ? eur(p.totale) : "—"}</td>
                    <td className="px-2 py-1">
                      {p.quote.map((x) => `${nomeReparto(attivi, x.repartoId)} ${x.percentuale}%`).join(" · ")}
                    </td>
                    <td className="px-2 py-1">{p.errore ?? "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {open && (
        <form
          className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!okSplit) return
            saveMut.mutate()
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-200">{editId ? "Modifica spesa" : "Nuova spesa"}</h3>
            <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
              Chiudi
            </button>
          </div>
          <label className="grid gap-1 text-xs text-zinc-500">
            PDF fattura (opzionale)
            <input
              type="file"
              accept="application/pdf"
              className={inputCls}
              onChange={(e) => void onPdf(e.target.files?.[0] ?? null)}
            />
          </label>
          {ocrMsg && <p className="text-xs text-amber-200/90">{ocrMsg}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
              Fornitore
              <input
                list="amm-fornitori"
                value={form.fornitore}
                onChange={(e) => {
                  const fornitore = e.target.value
                  setForm((f) => {
                    const hit = quoteMetaFor(fornitore, meta.data?.fornitoriQuote ?? [])
                    if (editId && hit?.stagionale !== "piscina-estate") return { ...f, fornitore }
                    const auto = applyQuoteFornitore(fornitore, f.dataDocumento)
                    return { ...f, fornitore, ...(auto ?? {}), memoriaQuote: auto ? "default" : f.memoriaQuote }
                  })
                }}
                className={inputCls}
                required
              />
              <datalist id="amm-fornitori">
                {(meta.data?.fornitori ?? []).map((f) => (
                  <option key={f.id} value={f.ragioneSociale} />
                ))}
              </datalist>
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              N. documento
              <input value={form.numeroDocumento} onChange={(e) => setForm((f) => ({ ...f, numeroDocumento: e.target.value }))} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Data documento
              <input
                type="date"
                value={form.dataDocumento}
                onChange={(e) => {
                  const dataDocumento = e.target.value
                  setForm((f) => {
                    const hit = quoteMetaFor(f.fornitore, meta.data?.fornitoriQuote ?? [])
                    if (editId && hit?.stagionale !== "piscina-estate") return { ...f, dataDocumento }
                    if (hit?.stagionale !== "piscina-estate") return { ...f, dataDocumento }
                    const auto = applyQuoteFornitore(f.fornitore, dataDocumento)
                    return { ...f, dataDocumento, ...(auto ?? {}) }
                  })
                }}
                className={inputCls}
                required
              />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Totale lordo
              <input value={form.totale} onChange={(e) => setForm((f) => ({ ...f, totale: e.target.value }))} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Tipo costo
              <select
                value={form.tipoCosto}
                onChange={(e) => setForm((f) => ({ ...f, tipoCosto: e.target.value as AmmTipoCosto }))}
                className={inputCls}
              >
                <option value="fisso">Fisso</option>
                <option value="variabile">Variabile</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
              Descrizione
              <input value={form.descrizione} onChange={(e) => setForm((f) => ({ ...f, descrizione: e.target.value }))} className={inputCls} />
            </label>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-zinc-200">Imputazione</p>
            <div className="flex flex-wrap gap-3 text-sm text-zinc-300">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="imputazione"
                  checked={form.imputazione === "sotto"}
                  onChange={() =>
                    setForm((f) => {
                      const next = { ...f, imputazione: "sotto" as const }
                      const q = quoteDaForm(next)
                      const auto = memoriaQuoteDaRiparto(f.fornitore, q, meta.data?.fornitoriQuote ?? [])
                      return { ...next, memoriaQuote: auto ?? f.memoriaQuote }
                    })
                  }
                  className="accent-amber-500"
                />
                Sotto-reparto specifico (es. cloro → Piscina coperta)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="imputazione"
                  checked={form.imputazione === "macro"}
                  onChange={() =>
                    setForm((f) => {
                      const next = { ...f, imputazione: "macro" as const }
                      const q = quoteDaForm(next)
                      const auto = memoriaQuoteDaRiparto(f.fornitore, q, meta.data?.fornitoriQuote ?? [])
                      return { ...next, memoriaQuote: auto ?? f.memoriaQuote }
                    })
                  }
                  className="accent-amber-500"
                />
                Split su macro-aree (es. gas 40% Piscina / 20% Piscina esterna / 20% SPA / 20% Fitness)
              </label>
            </div>
            {form.imputazione === "sotto" ? (
              <label className="grid gap-1 text-xs text-zinc-500">
                Sotto-reparto
                <select
                  value={form.sottoId}
                  onChange={(e) => {
                    const sottoId = e.target.value
                    setForm((f) => {
                      const next = { ...f, sottoId }
                      const auto = memoriaQuoteDaRiparto(
                        f.fornitore,
                        quoteDaForm(next),
                        meta.data?.fornitoriQuote ?? []
                      )
                      return { ...next, memoriaQuote: auto ?? f.memoriaQuote }
                    })
                  }}
                  className={inputCls}
                  required
                >
                  <option value="">Seleziona…</option>
                  {macros.map((m) => (
                    <optgroup key={m.id} label={m.nome}>
                      {sottoOf(attivi, m.id).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-zinc-300">Percentuali sulle macro-aree</span>
                  <span className={okSplit ? "text-emerald-300" : "text-red-400"}>
                    Somma {somma.toFixed(1)}% {okSplit ? "· ok" : "· deve essere 100%"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className={`h-full ${okSplit ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, somma)}%` }} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {macroSplit.map((r) => {
                    const perc = form.quote.find((x) => x.repartoId === r.id)?.percentuale ?? 0
                    return (
                      <label key={r.id} className="grid gap-1 text-xs text-zinc-500">
                        {macroSplitLabel(r)}
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={perc}
                          onChange={(e) => setPerc(r.id, Number(e.target.value))}
                          className={inputCls}
                        />
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            {form.imputazione === "sotto" && (
              <p className={okSplit ? "text-xs text-emerald-300" : "text-xs text-red-400"}>
                {okSplit ? "Imputazione 100% sul sotto-reparto." : "Seleziona il sotto-reparto per salvare."}
              </p>
            )}
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-sm font-medium text-zinc-200">Regola del fornitore</p>
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input
                  type="radio"
                  name="memoriaQuote"
                  checked={form.memoriaQuote === "default"}
                  onChange={() => setForm((f) => ({ ...f, memoriaQuote: "default" }))}
                  className="mt-0.5 accent-amber-500"
                />
                <span>
                  <span className="font-medium text-zinc-100">Rimangono così</span>
                  <span className="block text-xs text-zinc-500">
                    Diventa la regola di questo fornitore: i prossimi scarichi (aprile, maggio, …) la riapplicano da soli.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input
                  type="radio"
                  name="memoriaQuote"
                  checked={form.memoriaQuote === "eccezione"}
                  onChange={() => setForm((f) => ({ ...f, memoriaQuote: "eccezione" }))}
                  className="mt-0.5 accent-amber-500"
                />
                <span>
                  <span className="font-medium text-zinc-100">Eccezione del mese</span>
                  <span className="block text-xs text-zinc-500">
                    Vale solo su questo documento. La regola precedente del fornitore resta per gli scarichi successivi.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
              Annulla
            </button>
            <button type="submit" className={btnAmber} disabled={!okSplit || saveMut.isPending}>
              {saveMut.isPending ? "Salvataggio…" : "Salva"}
            </button>
          </div>
        </form>
      )}
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Fornitore</th>
              <th className="px-3 py-2">N. doc</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Origine</th>
              <th className="px-3 py-2">Ripartizione</th>
              <th className="px-3 py-2 text-right">Totale</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(list.data?.spese ?? []).map((s) => (
              <tr key={s.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(s.dataDocumento)}</td>
                <td className="px-3 py-2">{s.fornitore}</td>
                <td className="px-3 py-2">{s.numeroDocumento || "—"}</td>
                <td className="px-3 py-2 capitalize">{s.tipoCosto}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">{origineLabel(s.origine)}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">
                  {s.quote.map((x) => `${nomeReparto(reparti, x.repartoId)} ${x.percentuale}%`).join(" · ")}
                  {s.quoteEccezione ? <span className="ml-1 text-amber-400/90">· eccezione</span> : null}
                </td>
                <td className="px-3 py-2 text-right">{eur(s.totale)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {s.pathPdf && (
                    <button type="button" className="mr-2 text-xs text-amber-300 hover:underline" onClick={() => void amministrazioneApi.openPdf(s.id)}>
                      PDF
                    </button>
                  )}
                  <button type="button" className="mr-2 text-xs text-zinc-300 hover:underline" onClick={() => startEdit(s)}>
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-400 hover:underline"
                    onClick={() => {
                      if (confirm("Eliminare questa spesa?")) delMut.mutate(s.id)
                    }}
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
            {!list.data?.spese.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={8}>
                  Nessuna spesa in questo mese. I collaboratori sportivi non si inseriscono qui: restano nel libro paga.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StipendiTab() {
  const qc = useQueryClient()
  const now = currentYm()
  const [mese, setMese] = useState(now)
  const [error, setError] = useState("")
  const [importMsg, setImportMsg] = useState("")
  const [preview, setPreview] = useState<AmmMastrinoPreview[] | null>(null)
  const [collabPreview, setCollabPreview] = useState<AmmStipendiPdfRiga[] | null>(null)
  const [bustePdfPreview, setBustePdfPreview] = useState<AmmStipendiPdfRiga[] | null>(null)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [nominativo, setNominativo] = useState("")
  const [totale, setTotale] = useState("")
  const [descrizione, setDescrizione] = useState("Busta paga")
  const [repartoId, setRepartoId] = useState("amministrazione-uffici")
  const [formMese, setFormMese] = useState(now)
  const [filtroCollaboratore, setFiltroCollaboratore] = useState("")
  const [rimborsoOpen, setRimborsoOpen] = useState(false)
  const [rimborsoNominativo, setRimborsoNominativo] = useState("")
  const [rimborsoDescrizione, setRimborsoDescrizione] = useState("")
  const [rimborsoImporto, setRimborsoImporto] = useState("")
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const buste = useQuery({
    queryKey: ["amm-buste", mese],
    queryFn: () => amministrazioneApi.listBuste(mese),
  })
  const collab = useQuery({
    queryKey: ["amm-collab", mese],
    queryFn: () => amministrazioneApi.collaboratori(Number(mese.slice(0, 4)), mese),
  })
  const attivi = (meta.data?.reparti ?? []).filter((r) => r.attivo)
  const macros = macrosOf(attivi)

  function startNew() {
    setEditId(null)
    setNominativo("")
    setTotale("")
    setDescrizione("Busta paga")
    setRepartoId("amministrazione-uffici")
    setFormMese(mese)
    setOpen(true)
  }
  function startEdit(b: AmmBusta) {
    setEditId(b.id)
    setNominativo(b.nominativo)
    setTotale(String(b.totale).replace(".", ","))
    setDescrizione(b.descrizione)
    setRepartoId(b.quote[0]?.repartoId ?? "amministrazione-uffici")
    setFormMese(b.mese)
    setOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: () =>
      amministrazioneApi.saveBusta({
        id: editId ?? undefined,
        nominativo,
        mese: formMese,
        descrizione,
        totale: Number(totale.replace(",", ".")),
        quote: [{ repartoId, percentuale: 100 }],
        origine: "manuale",
      }),
    onSuccess: () => {
      setOpen(false)
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-buste"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => amministrazioneApi.deleteBusta(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["amm-buste"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const importCollabMut = useMutation({
    mutationFn: (righe: AmmStipendiPdfRiga[]) => amministrazioneApi.importCollaboratori(righe),
    onSuccess: (r) => {
      setCollabPreview(null)
      setImportMsg(
        `Mese sostituito dal riepilogo: ${r.inserite} nominativi` +
          (r.sostituite ? ` (prima ${r.sostituite})` : "") +
          (r.errori.length ? `, ${r.errori.length} errori` : "") +
          "."
      )
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const delCollabMut = useMutation({
    mutationFn: (id: string) => amministrazioneApi.deleteCollaboratore(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const saveRimborsoMut = useMutation({
    mutationFn: () =>
      amministrazioneApi.saveCollaboratoreRimborso({
        nominativo: rimborsoNominativo,
        mese,
        descrizione: rimborsoDescrizione,
        totale: Number(rimborsoImporto.replace(",", ".")),
      }),
    onSuccess: () => {
      setRimborsoOpen(false)
      setRimborsoDescrizione("")
      setRimborsoImporto("")
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const delRimborsoMut = useMutation({
    mutationFn: (id: string) => amministrazioneApi.deleteCollaboratoreRimborso(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const centroCostoMut = useMutation({
    mutationFn: ({ nominativo, repartoId }: { nominativo: string; repartoId: string }) =>
      amministrazioneApi.setCentroCostoCollaboratore(nominativo, repartoId),
    onSuccess: () => {
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-collab"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const importMut = useMutation({
    mutationFn: (righe: AmmMastrinoPreview[]) => amministrazioneApi.importBuste(righe),
    onSuccess: (r) => {
      setPreview(null)
      setBustePdfPreview(null)
      setImportMsg(
        `Importate ${r.inserite} buste` +
          (r.saltate ? `, ${r.saltate} già presenti` : "") +
          (r.errori.length ? `, ${r.errori.length} errori` : "") +
          "."
      )
      void qc.invalidateQueries({ queryKey: ["amm-buste"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const importConsuntivoMut = useMutation({
    mutationFn: (riga: AmmStipendiPdfRiga) => amministrazioneApi.importBustaConsuntivo(riga),
    onSuccess: (r) => {
      setBustePdfPreview(null)
      setImportMsg(
        `Consuntivo importato: ${eur(r.busta.totale)}` +
          (r.busta.dettaglioDipendenti?.length
            ? ` con dettaglio di ${r.busta.dettaglioDipendenti.length} dipendenti`
            : "") +
          (r.sostituite ? `; sostituite ${r.sostituite} vecchie righe PDF` : "") +
          ".",
      )
      void qc.invalidateQueries({ queryKey: ["amm-buste"] })
      void qc.invalidateQueries({ queryKey: ["amm-dash"] })
    },
    onError: (e: Error) => setError(e.message),
  })

  async function onExcel(file: File | null) {
    if (!file) return
    setError("")
    setImportMsg("")
    try {
      const buf = await file.arrayBuffer()
      setPreview(parseAmmMastrino(buf, attivi))
      setBustePdfPreview(null)
    } catch (e) {
      setError((e as Error).message || "Excel non leggibile")
    }
  }

  async function onStipendiPdf(file: File | null, kind: "sportivi" | "buste") {
    if (!file) return
    setError("")
    setImportMsg("")
    try {
      const isCostSummary = file.name.toLowerCase().includes("costo dipendenti")
      let text = await extractPdfText(file, kind === "buste" ? 250 : 80)
      if (kind === "buste" && (!text.trim() || isCostSummary)) {
        setImportMsg("PDF scansito: OCR locale in corso…")
        const ocrText = await extractPdfTextWithOcr(file, 5, (progress) => {
          setImportMsg(`Lettura OCR del riepilogo: ${Math.round(progress * 100)}%`)
        }, { rotateForConsuntivo: isCostSummary })
        if (ocrText.trim()) text = ocrText
      }
      const parsed = await amministrazioneApi.parseStipendiPdf(text, file.name, mese)
      if (kind === "sportivi") {
        const righe = [...parsed.sportivi, ...parsed.gestionali]
        if (!righe.length) throw new Error("Nessun collaboratore nel PDF. Serve il riepilogo Studio Mattonai.")
        setCollabPreview(righe)
        setBustePdfPreview(null)
        setPreview(null)
      } else {
        if (parsed.dipendenti.length !== 1) {
          throw new Error("Nel PDF non è stato trovato un totale consuntivo unico. Carica il riepilogo “Costo consuntivo del periodo”.")
        }
        setImportMsg("")
        setBustePdfPreview(parsed.dipendenti)
        setCollabPreview(null)
        setPreview(null)
      }
    } catch (e) {
      setError((e as Error).message || "PDF non leggibile")
    }
  }

  const okPreview = (preview ?? []).filter((p) => !p.errore)
  const totBusteMese = (buste.data?.buste ?? []).reduce((s, b) => s + b.totale, 0)
  const fonteRiepilogo = collab.data?.fonte === "riepilogo"
  const fonteMensilita = collab.data?.fonte === "libro-paga-mensilita"
  const fonteNominativi = fonteRiepilogo || fonteMensilita
  const fonteCollaboratoriLabel = fonteMensilita
    ? "Fonte: mensilità del Libro paga."
    : fonteRiepilogo
      ? "Fonte: dati importati in Amministrazione."
      : collab.data?.fonte === "libro-paga"
        ? "Fonte: turni del Libro paga."
        : ""
  const searchTerms = filtroCollaboratore
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("it")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const matchesCollaboratore = (name: string) => {
    const normalized = name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("it")
    return searchTerms.every((term) => normalized.includes(term))
  }
  const collaboratoriVisibili = (collab.data?.righe ?? []).filter((r) => matchesCollaboratore(r.nome))
  const rimborsiVisibili = (collab.data?.rimborsi ?? []).filter((r) => matchesCollaboratore(r.nominativo))

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Mese competenza
          <input
            type="month"
            value={mese}
            onChange={(e) => {
              setMese(e.target.value)
              setRimborsoOpen(false)
            }}
            className={inputCls}
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {importMsg && <p className="text-sm text-emerald-300">{importMsg}</p>}

      <section className="space-y-3 rounded-2xl border border-zinc-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">Collaboratori sportivi</h3>
            <p className="text-xs text-zinc-500">
              Di default mostra i nominativi e gli importi bonifico delle mensilità del Libro paga (se il bonifico non è
              ancora registrato, usa il totale dei turni). Il riepilogo PDF dello Studio Mattonai resta disponibile e,
              se caricato, sostituisce i dati del mese selezionato. Il report annuale (tutte le mensilità, modifica
              importo, aggiungi istruttore) è nel{" "}
              <Link to="/libro-paga?tab=collaboratori" className="underline">
                libro paga
              </Link>
              , visibile solo ad admin e Alberto.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Il centro di costo viene letto dal reparto principale assegnato nel Libro paga e vale anche per i
              rimborsi. Se manca un reparto in Libro paga, puoi impostare un centro predefinito dalla tabella.
            </p>
          </div>
          <label className={`${btnAmber} cursor-pointer`}>
            Importa riepilogo PDF
            <input type="file" accept=".pdf" className="hidden" onChange={(e) => void onStipendiPdf(e.target.files?.[0] ?? null, "sportivi")} />
          </label>
        </div>
        {collabPreview && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-zinc-400">
                Sostituisce il mese: {collabPreview.length} persone, {eur(collabPreview.reduce((s, x) => s + x.totale, 0))}
              </p>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => setCollabPreview(null)}>
                  Annulla
                </button>
                <button
                  type="button"
                  className={btnAmber}
                  disabled={importCollabMut.isPending}
                  onClick={() => importCollabMut.mutate(collabPreview)}
                >
                  {importCollabMut.isPending ? "Caricamento…" : `Importa ${collabPreview.length}`}
                </button>
              </div>
            </div>
            <div className="max-h-56 overflow-auto text-xs">
              {collabPreview.map((p, i) => (
                <p key={`${p.nominativo}-${i}`} className="text-zinc-300">
                  {p.nominativo} · {p.tipo === "gestionale" ? "amm/gest" : "istruttore"} · {eur(p.totale)}
                </p>
              ))}
            </div>
          </div>
        )}
        {collab.isLoading && <p className="text-sm text-zinc-500">Caricamento…</p>}
        {fonteCollaboratoriLabel && <p className="text-xs text-zinc-500">{fonteCollaboratoriLabel}</p>}
        <details className="rounded-xl border border-zinc-800 px-3 py-2">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-amber-300">
              Dettaglio collaboratori sportivi ({(collab.data?.righe ?? []).length} nominativi)
            </span>
            <span className="font-semibold text-zinc-100">
              Compensi {eur(collab.data?.tot ?? 0)} · Rimborsi {eur(collab.data?.totRimborsi ?? 0)}
            </span>
          </summary>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
            <label className="grid gap-1 text-xs text-zinc-500">
              Cerca collaboratore
              <input
                type="search"
                value={filtroCollaboratore}
                onChange={(e) => setFiltroCollaboratore(e.target.value)}
                placeholder="Nome o cognome"
                className={inputCls}
              />
            </label>
            <button
              type="button"
              className={btnAmber}
              disabled={!fonteNominativi || !collab.data?.righe.length}
              onClick={() => {
                setRimborsoNominativo(collab.data?.righe[0]?.nome ?? "")
                setRimborsoDescrizione("")
                setRimborsoImporto("")
                setRimborsoOpen(true)
              }}
            >
              Inserisci rimborso spese
            </button>
          </div>
          {!fonteNominativi && (
            <p className="mt-2 text-xs text-zinc-500">
              Per associare un rimborso serve il dettaglio nominativo del collaboratore per il mese selezionato.
            </p>
          )}
          {rimborsoOpen && (
            <form
              className="mt-3 grid gap-3 rounded-xl border border-zinc-800 p-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault()
                saveRimborsoMut.mutate()
              }}
            >
              <label className="grid gap-1 text-xs text-zinc-500">
                Collaboratore
                <select
                  value={rimborsoNominativo}
                  onChange={(e) => setRimborsoNominativo(e.target.value)}
                  className={inputCls}
                  required
                >
                  {(collab.data?.righe ?? []).map((r) => (
                    <option key={r.id} value={r.nome}>{r.nome}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-zinc-500">
                Importo rimborso
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={rimborsoImporto}
                  onChange={(e) => setRimborsoImporto(e.target.value)}
                  className={inputCls}
                  required
                />
              </label>
              <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
                Descrizione spesa
                <input
                  value={rimborsoDescrizione}
                  onChange={(e) => setRimborsoDescrizione(e.target.value)}
                  placeholder="Es. trasferta, materiale, parcheggio"
                  className={inputCls}
                  required
                />
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" className={btnAmber} disabled={saveRimborsoMut.isPending}>
                  {saveRimborsoMut.isPending ? "Salvataggio…" : "Salva rimborso"}
                </button>
                <button type="button" className={btnGhost} onClick={() => setRimborsoOpen(false)}>
                  Annulla
                </button>
              </div>
            </form>
          )}
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-1">{fonteNominativi ? "Nominativo" : "Reparto"}</th>
                  {fonteNominativi && <th className="py-1">Centro di costo predefinito</th>}
                  {!fonteNominativi && <th className="py-1 text-right">Turni</th>}
                  <th className="py-1 text-right">Importo</th>
                  {fonteRiepilogo && <th className="py-1" />}
                </tr>
              </thead>
              <tbody>
                {collaboratoriVisibili.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                    <td className="py-1.5">
                      {r.nome}
                      {fonteRiepilogo && r.tipo === "gestionale" && (
                        <span className="ml-2 text-xs text-zinc-500">amm/gest</span>
                      )}
                    </td>
                    {fonteNominativi && (
                      <td className="py-1.5">
                        {r.ripartizioneDaTurni && r.quote?.length ? (
                          <span className="text-zinc-300">
                            {r.quote
                              .map((q) => `${nomeReparto(attivi, q.repartoId)} ${q.percentuale}%`)
                              .join(" · ")}
                            <span className="ml-2 text-xs text-emerald-400">da turni del mese</span>
                          </span>
                        ) : r.repartoDaLibroPaga ? (
                          <span className="text-zinc-300">
                            {nomeReparto(attivi, r.repartoId ?? "personale-condiviso")}
                            <span className="ml-2 text-xs text-emerald-400">Libro paga</span>
                          </span>
                        ) : (
                          <select
                            value={r.repartoId ?? ""}
                            onChange={(e) => {
                              if (e.target.value) {
                                centroCostoMut.mutate({ nominativo: r.nome, repartoId: e.target.value })
                              }
                            }}
                            className={`${inputCls} py-1`}
                            disabled={centroCostoMut.isPending}
                            aria-label={`Centro di costo predefinito per ${r.nome}`}
                          >
                            <option value="">{r.repartoId ? "Seleziona centro di costo" : "Non assegnato"}</option>
                            {macros.map((reparto) => (
                              <option key={reparto.id} value={reparto.id}>{reparto.nome}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    )}
                    {!fonteNominativi && <td className="py-1.5 text-right text-zinc-400">{r.nTurni}</td>}
                    <td className="py-1.5 text-right">{eur(r.importo)}</td>
                    {fonteRiepilogo && (
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:underline"
                          onClick={() => {
                            if (confirm("Eliminare questa riga?")) delCollabMut.mutate(r.id)
                          }}
                        >
                          Elimina
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!collaboratoriVisibili.length && (
                  <tr>
                    <td className="py-4 text-zinc-500" colSpan={fonteNominativi ? (fonteRiepilogo ? 4 : 3) : 3}>
                      {searchTerms.length
                        ? "Nessun collaboratore corrisponde alla ricerca."
                        : "Nessun importo mensile nel Libro paga. Puoi caricare il riepilogo PDF di fine mese."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {(collab.data?.rimborsi ?? []).length > 0 && (
            <div className="mt-4 overflow-x-auto border-t border-zinc-800 pt-3">
              <h4 className="mb-2 text-xs font-semibold uppercase text-zinc-500">
                Rimborsi spese · {eur(collab.data?.totRimborsi ?? 0)}
              </h4>
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="py-1">Nominativo</th>
                    <th className="py-1">Descrizione</th>
                    <th className="py-1 text-right">Importo</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {rimborsiVisibili.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                      <td className="py-1.5">{r.nominativo}</td>
                      <td className="py-1.5">{r.descrizione}</td>
                      <td className="py-1.5 text-right">{eur(r.totale)}</td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:underline"
                          disabled={delRimborsoMut.isPending}
                          onClick={() => {
                            if (confirm(`Eliminare il rimborso di ${r.nominativo}?`)) delRimborsoMut.mutate(r.id)
                          }}
                        >
                          Elimina
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rimborsiVisibili.length && (
                    <tr>
                      <td className="py-3 text-zinc-500" colSpan={4}>Nessun rimborso corrisponde alla ricerca.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">Dipendenti fissi · buste paga</h3>
            <p className="text-xs text-zinc-500">
              Per vedere i nominativi, carica il PDF completo con tutte le buste: il totale aziendale resta quello del
              consuntivo e i costi individuali sono salvati come dettaglio, senza sommarli una seconda volta. Il PDF del
              solo consuntivo importa invece il totale senza nominativi. I PDF scansiti vengono letti con OCR nel browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`${btnAmber} cursor-pointer`}>
              Importa PDF paghe
              <input type="file" accept=".pdf" className="hidden" onChange={(e) => void onStipendiPdf(e.target.files?.[0] ?? null, "buste")} />
            </label>
            <button type="button" className={btnGhost} onClick={() => downloadAmmMastrinoTemplate()}>
              Modello mastrino
            </button>
            <label className={`${btnGhost} cursor-pointer`}>
              Importa mastrino
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void onExcel(e.target.files?.[0] ?? null)} />
            </label>
            <button type="button" className={btnAmber} onClick={startNew}>
              + Busta paga
            </button>
          </div>
        </div>
        <p className="text-lg font-semibold text-zinc-100">{eur(totBusteMese)}</p>
        {bustePdfPreview && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-zinc-400">
                Totale consuntivo del mese: {eur(bustePdfPreview[0]?.totale ?? 0)}
                {bustePdfPreview[0]?.dettaglioDipendenti?.length
                  ? ` · dettaglio di ${bustePdfPreview[0].dettaglioDipendenti.length} dipendenti`
                  : " · questo PDF non contiene il dettaglio nominativo"}
              </p>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => setBustePdfPreview(null)}>
                  Annulla
                </button>
                <button
                  type="button"
                  className={btnAmber}
                  disabled={importConsuntivoMut.isPending}
                  onClick={() => {
                    const riga = bustePdfPreview[0]
                    if (riga) importConsuntivoMut.mutate(riga)
                  }}
                >
                  {importConsuntivoMut.isPending ? "Caricamento…" : "Importa totale"}
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-auto text-xs">
              {bustePdfPreview[0] && (
                <>
                  <p className="mb-2 text-zinc-300">
                    {bustePdfPreview[0].descrizione} · {nomeReparto(attivi, bustePdfPreview[0].quote[0]?.repartoId ?? "")}
                  </p>
                  {bustePdfPreview[0].dettaglioDipendenti?.map((dipendente, index) => (
                    <p key={`${dipendente.nominativo}-${index}`} className="flex justify-between gap-4 text-zinc-300">
                      <span>{dipendente.nominativo}</span>
                      <span>{eur(dipendente.totale)}</span>
                    </p>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
        {preview && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-zinc-400">
                Anteprima: {okPreview.length} valide, {preview.length - okPreview.length} con errori
              </p>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => setPreview(null)}>
                  Annulla
                </button>
                <button
                  type="button"
                  className={btnAmber}
                  disabled={!okPreview.length || importMut.isPending}
                  onClick={() => importMut.mutate(okPreview)}
                >
                  {importMut.isPending ? "Caricamento…" : `Importa ${okPreview.length}`}
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-auto text-xs">
              {preview.map((p) => (
                <p key={p.riga} className={p.errore ? "text-red-300" : "text-zinc-300"}>
                  r.{p.riga} {p.nominativo || "—"} {p.mese} {p.totale ? eur(p.totale) : "—"}{" "}
                  {p.errore ?? nomeReparto(attivi, p.quote[0]?.repartoId ?? "")}
                </p>
              ))}
            </div>
          </div>
        )}
        {open && (
          <form
            className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              saveMut.mutate()
            }}
          >
            <label className="grid gap-1 text-xs text-zinc-500">
              Nominativo
              <input value={nominativo} onChange={(e) => setNominativo(e.target.value)} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Mese
              <input type="month" value={formMese} onChange={(e) => setFormMese(e.target.value)} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Costo azienda
              <input value={totale} onChange={(e) => setTotale(e.target.value)} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Reparto
              <select value={repartoId} onChange={(e) => setRepartoId(e.target.value)} className={inputCls}>
                {macros.map((m) => (
                  <optgroup key={m.id} label={m.nome}>
                    {sottoOf(attivi, m.id).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
              Descrizione
              <input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} className={inputCls} />
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
                Annulla
              </button>
              <button type="submit" className={btnAmber} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvataggio…" : "Salva"}
              </button>
            </div>
          </form>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-1 pr-3">Nominativo</th>
                <th className="py-1 pr-3">Reparto</th>
                <th className="py-1 pr-3">Origine</th>
                <th className="py-1 text-right">Importo</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {(buste.data?.buste ?? []).map((b) => (
                <tr key={b.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="py-1.5 pr-3">
                    {b.nominativo}
                    {b.descrizione && <span className="block text-xs text-zinc-500">{b.descrizione}</span>}
                    {b.dettaglioDipendenti?.length ? (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-amber-300">
                          Dettaglio di {b.dettaglioDipendenti.length} dipendenti
                        </summary>
                        <div className="mt-2 max-h-64 space-y-1 overflow-auto pr-2">
                          {b.dettaglioDipendenti.map((dipendente, index) => (
                            <p key={`${dipendente.nominativo}-${index}`} className="flex justify-between gap-4 text-zinc-300">
                              <span>{dipendente.nominativo}</span>
                              <span>{eur(dipendente.totale)}</span>
                            </p>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-400">
                    {b.quote.map((q) => `${nomeReparto(attivi, q.repartoId)} ${q.percentuale}%`).join(" · ")}
                  </td>
                  <td className="py-1.5 pr-3 text-zinc-400">
                    {b.origine === "pdf" ? "Busta PDF" : b.origine === "mastrino" ? "Mastrino" : "Manuale"}
                  </td>
                  <td className="py-1.5 text-right">{eur(b.totale)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button type="button" className="mr-2 text-xs text-zinc-300 hover:underline" onClick={() => startEdit(b)}>
                      Modifica
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:underline"
                      onClick={() => {
                        if (confirm("Eliminare questa busta paga?")) delMut.mutate(b.id)
                      }}
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
              {!buste.data?.buste.length && (
                <tr>
                  <td className="py-4 text-zinc-500" colSpan={5}>
                    Nessuna busta in questo mese. Importa il mastrino o inserisci a mano.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function RepartiTab() {
  const qc = useQueryClient()
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const [nome, setNome] = useState("")
  const [macroId, setMacroId] = useState("piscina")
  const [error, setError] = useState("")
  const saveMut = useMutation({
    mutationFn: (body: Partial<AmmReparto> & { nome: string }) => amministrazioneApi.saveReparto(body),
    onSuccess: () => {
      setNome("")
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-meta"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const rows = useMemo(() => [...(meta.data?.reparti ?? [])].sort((a, b) => a.ordine - b.ordine), [meta.data])
  const macros = rows.filter((r) => r.livello === "macro")
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-zinc-500">
        Macro-aree e sotto-reparti. Un costo si imputa al sotto-reparto oppure si ripartisce in % sulle macro-aree (utenze
        e spese generali). Nello split, la piscina è divisa in Piscina e Piscina esterna.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!nome.trim() || !macroId) return
          const parent = rows.find((r) => r.id === macroId)
          saveMut.mutate({
            nome: nome.trim(),
            tipo: parent?.tipo ?? "operativo",
            livello: "sotto",
            macroId,
            ordine: 50,
            attivo: true,
          })
        }}
      >
        <label className="grid gap-1 text-xs text-zinc-500">
          Nuovo sotto-reparto
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} placeholder="Nome" />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Macro-area
          <select value={macroId} onChange={(e) => setMacroId(e.target.value)} className={inputCls}>
            {macros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={btnAmber} disabled={saveMut.isPending}>
          Aggiungi
        </button>
      </form>
      <div className="space-y-3">
        {macros.map((m) => (
          <div key={m.id} className="overflow-hidden rounded-2xl border border-zinc-800">
            <div className="flex items-center justify-between bg-zinc-900/80 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-zinc-100">{m.nome}</p>
                {m.note && <p className="text-xs text-zinc-500">{m.note}</p>}
              </div>
              <span className="text-xs text-zinc-500">{m.tipo === "struttura" ? "Costi fissi / da ripartire" : "Operativo"}</span>
            </div>
            <table className="min-w-full text-left text-sm">
              <tbody>
                {rows
                  .filter((r) => r.macroId === m.id)
                  .map((r) => (
                    <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                      <td className="px-3 py-2">{r.nome}</td>
                      <td className="px-3 py-2 text-zinc-400">{r.note ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-xs text-amber-300 hover:underline"
                          onClick={() =>
                            saveMut.mutate({
                              id: r.id,
                              nome: r.nome,
                              tipo: r.tipo,
                              livello: r.livello,
                              macroId: r.macroId,
                              attivo: !r.attivo,
                              ordine: r.ordine,
                              note: r.note,
                            })
                          }
                        >
                          {r.attivo ? "Disattiva" : "Riattiva"}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
