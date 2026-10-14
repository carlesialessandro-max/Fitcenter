import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useAuth } from "@/contexts/AuthContext"
import {
  amministrazioneApi,
  type AmmBusta,
  type AmmQuota,
  type AmmReparto,
  type AmmSpesa,
  type AmmStipendiPdfRiga,
  type AmmTipoCosto,
} from "@/api/amministrazione"
import { extractPdfText } from "@/lib/pdf-fattura-text"
import { downloadAmmExcelTemplate, parseAmmExcel, type AmmExcelPreview } from "@/lib/amm-excel"
import { downloadAmmMastrinoTemplate, parseAmmMastrino, type AmmMastrinoPreview } from "@/lib/amm-mastrino"

const COLORS = ["#46A6D9", "#F59E0B", "#34D399", "#A78BFA", "#F87171", "#FBBF24", "#60A5FA", "#C084FC"]
const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
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
        Si inseriscono i costi per capire se un reparto guadagna o perde. I fissi di struttura (utenze, paghe desk,
        amministrativi, manutentori, amministratori) vengono ripartiti sui reparti in base ai ricavi del periodo.
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
            <Kpi title="Ricavi" value={eur(d.totRicavi ?? 0)} hint={d.ricaviDisponibili ? "Incassi gestionale del periodo" : "Gestionale non disponibile"} />
            <Kpi title="Costi dopo riparto" value={eur(d.totCostoPnl ?? d.tot)} hint={`Di cui fissi di struttura ${eur(d.totStruttura ?? 0)}`} />
            <Kpi
              title="Risultato"
              value={eur(d.totUtile ?? 0)}
              hint={d.marginePct == null ? "Serve almeno un ricavo" : `${d.marginePct}% sui ricavi`}
              tone={(d.totUtile ?? 0) >= 0 ? "ok" : "ko"}
            />
            <Kpi title="Costi diretti" value={eur(d.tot)} hint={`${d.nSpese} documenti · ${d.nBuste ?? 0} buste · collaboratori ${eur(d.totCollaboratori)}`} />
          </div>
          {(d.totRicaviAltri ?? 0) > 0.009 && (
            <p className="text-xs text-zinc-500">
              Altri incassi non attribuiti a Piscina / Fitness / SPA: {eur(d.totRicaviAltri ?? 0)}. Non entrano nel risultato dei tre reparti.
            </p>
          )}
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Reparto</th>
                  <th className="px-3 py-2 font-medium text-right">Ricavi</th>
                  <th className="px-3 py-2 font-medium text-right">Costi diretti</th>
                  <th className="px-3 py-2 font-medium text-right">Quota fissi</th>
                  <th className="px-3 py-2 font-medium text-right">Costo totale</th>
                  <th className="px-3 py-2 font-medium text-right">Risultato</th>
                  <th className="px-3 py-2 font-medium text-right">% su ricavi</th>
                </tr>
              </thead>
              <tbody>
                {pnl.length ? (
                  pnl.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-800">
                      <td className="px-3 py-2 text-zinc-100">
                        {r.nome}
                        <span className="ml-2 text-xs text-zinc-500">fissi {r.ripartoFissiPct}%</span>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-200">{eur(r.ricavi)}</td>
                      <td className="px-3 py-2 text-right text-zinc-400">{eur(r.costiDiretti)}</td>
                      <td className="px-3 py-2 text-right text-zinc-400">{eur(r.quotaFissi)}</td>
                      <td className="px-3 py-2 text-right text-zinc-200">{eur(r.costoTotale)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${r.utile >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {eur(r.utile)}
                      </td>
                      <td className={`px-3 py-2 text-right ${r.utile >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {r.marginePct == null ? "—" : `${r.marginePct}%`}
                      </td>
                    </tr>
                  ))
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
                    <td className="px-3 py-2 text-zinc-100">Totale</td>
                    <td className="px-3 py-2 text-right">{eur(d.totRicavi ?? 0)}</td>
                    <td className="px-3 py-2 text-right text-zinc-400">
                      {eur(pnl.reduce((s, r) => s + r.costiDiretti, 0))}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-400">{eur(d.totStruttura ?? 0)}</td>
                    <td className="px-3 py-2 text-right">{eur(d.totCostoPnl ?? 0)}</td>
                    <td className={`px-3 py-2 text-right ${(d.totUtile ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {eur(d.totUtile ?? 0)}
                    </td>
                    <td className={`px-3 py-2 text-right ${(d.totUtile ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {d.marginePct == null ? "—" : `${d.marginePct}%`}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Esempio: 100.000 € di costi piscina su 200.000 € di ricavi è un utile; 100.000 € di costi palestra su 50.000 € di
            incassi è una perdita, e va tagliato il budget o spinta la vendita. I fissi di struttura sono spalmati sui tre
            reparti in proporzione ai ricavi, altrimenti il risultato sarebbe gonfiato.
          </p>
          {(d.strutturaByMacro ?? []).length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              <li className="font-medium text-zinc-400">Costi di struttura ripartiti:</li>
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
  }
}

function formFromSpesa(s: AmmSpesa, reparti: AmmReparto[]): FormState {
  const one = s.quote.length === 1 && Math.abs(s.quote[0].percentuale - 100) < 0.05
  const target = one ? reparti.find((r) => r.id === s.quote[0].repartoId) : undefined
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
    quote: sotto ? [] : s.quote.map((x) => ({ ...x })),
  }
}

function quoteDaForm(f: FormState): AmmQuota[] {
  if (f.imputazione === "sotto") return f.sottoId ? [{ repartoId: f.sottoId, percentuale: 100 }] : []
  return f.quote.filter((q) => q.percentuale > 0)
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
  const reparti = meta.data?.reparti ?? []
  const attivi = reparti.filter((r) => r.attivo)
  const macros = macrosOf(attivi)
  const [form, setForm] = useState<FormState>(emptyForm)
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
    setForm(formFromSpesa(s, reparti))
    setOpen(true)
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
    },
    onError: (e: Error) => setError(e.message),
  })
  const ficDisconnectMut = useMutation({
    mutationFn: () => amministrazioneApi.ficDisconnect(),
    onSuccess: () => {
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-fic"] })
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
      setForm((f) => ({
        ...f,
        fornitore: r.fornitoreNoto?.ragioneSociale || p.fornitore || f.fornitore,
        numeroDocumento: p.numeroDocumento || f.numeroDocumento,
        dataDocumento: p.dataDocumento || f.dataDocumento,
        descrizione: p.descrizione || f.descrizione,
        totale: p.totale != null ? String(p.totale).replace(".", ",") : f.totale,
      }))
      const missing: string[] = []
      if (!(r.fornitoreNoto?.ragioneSociale || p.fornitore)) missing.push("fornitore")
      if (p.totale == null) missing.push("importo")
      if (!p.dataDocumento) missing.push("data")
      setOcrMsg(
        missing.length
          ? `PDF letto in parte: manca ${missing.join(", ")}. Completa a mano e scegli il reparto.`
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
      return { ...f, quote: quoteNext.filter((x) => x.percentuale > 0) }
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
      {ficOpen && (
        <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-300">
          <p className="text-zinc-400">
            In Fatture in Cloud: Impostazioni → Applicazioni collegate → Collega una nuova applicazione. Crea prima
            un’app su developers.fattureincloud.it, copia l’identificativo applicazione, autorizza la lettura degli
            acquisti e incolla qui il token. In alternativa si può mettere il token e l’id azienda nel file di
            configurazione dell’API.
          </p>
          {fic.data?.connected ? (
            <p className="text-emerald-300">
              Collegato a {fic.data.companyName || "azienda"} ({fic.data.tokenMasked}
              {fic.data.fromEnv ? ", da .env" : ""}). Le nuove spese vanno su «Altri costi»: poi le riassegni al
              sotto-reparto.
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
                onChange={(e) => setForm((f) => ({ ...f, fornitore: e.target.value }))}
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
              <input type="date" value={form.dataDocumento} onChange={(e) => setForm((f) => ({ ...f, dataDocumento: e.target.value }))} className={inputCls} required />
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
                  onChange={() => setForm((f) => ({ ...f, imputazione: "sotto" }))}
                  className="accent-amber-500"
                />
                Sotto-reparto specifico (es. cloro → Piscina coperta)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="imputazione"
                  checked={form.imputazione === "macro"}
                  onChange={() => setForm((f) => ({ ...f, imputazione: "macro" }))}
                  className="accent-amber-500"
                />
                Split su macro-aree (es. gas 60% Piscina / 20% SPA / 20% Fitness)
              </label>
            </div>
            {form.imputazione === "sotto" ? (
              <label className="grid gap-1 text-xs text-zinc-500">
                Sotto-reparto
                <select
                  value={form.sottoId}
                  onChange={(e) => setForm((f) => ({ ...f, sottoId: e.target.value }))}
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
                  {macros.map((r) => {
                    const perc = form.quote.find((x) => x.repartoId === r.id)?.percentuale ?? 0
                    return (
                      <label key={r.id} className="grid gap-1 text-xs text-zinc-500">
                        {r.nome}
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
  const importMut = useMutation({
    mutationFn: (righe: AmmMastrinoPreview[] | AmmStipendiPdfRiga[]) =>
      amministrazioneApi.importBuste(
        (righe as AmmStipendiPdfRiga[]).some((x) => "tipo" in x && x.tipo === "dipendente")
          ? (righe as AmmStipendiPdfRiga[]).map((x) => ({ ...x, origine: "pdf" }))
          : righe
      ),
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
      const text = await extractPdfText(file, 80)
      const parsed = await amministrazioneApi.parseStipendiPdf(text, file.name, mese)
      if (kind === "sportivi") {
        const righe = [...parsed.sportivi, ...parsed.gestionali]
        if (!righe.length) throw new Error("Nessun collaboratore nel PDF. Serve il riepilogo Studio Mattonai.")
        setCollabPreview(righe)
        setBustePdfPreview(null)
        setPreview(null)
      } else {
        if (!parsed.dipendenti.length) throw new Error("Nessuna busta paga nel PDF. Serve il file Teamsystem delle buste.")
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

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Mese competenza
          <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className={inputCls} />
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {importMsg && <p className="text-sm text-emerald-300">{importMsg}</p>}

      <section className="space-y-3 rounded-2xl border border-zinc-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">Collaboratori sportivi</h3>
            <p className="text-xs text-zinc-500">
              Il PDF dello Studio Mattonai è la fonte: nominativi e importi di quel file. Chi emette fattura è già
              escluso lì; chi ha anche busta resta in lista se fa funzioni fuori dal libro paga. All’import si
              sostituisce tutto il mese (via la stima dei turni). Il report annuale (tutte le mensilità, modifica
              importo, aggiungi istruttore) è nel{" "}
              <Link to="/libro-paga?tab=collaboratori" className="underline">
                libro paga
              </Link>
              , visibile solo ad admin e Alberto.
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
        <p className="text-lg font-semibold text-zinc-100">{eur(collab.data?.tot ?? 0)}</p>
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1">{fonteRiepilogo ? "Nominativo" : "Reparto"}</th>
              {!fonteRiepilogo && <th className="py-1 text-right">Turni</th>}
              <th className="py-1 text-right">Importo</th>
              {fonteRiepilogo && <th className="py-1" />}
            </tr>
          </thead>
          <tbody>
            {(collab.data?.righe ?? []).map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="py-1.5">
                  {r.nome}
                  {fonteRiepilogo && r.tipo === "gestionale" && (
                    <span className="ml-2 text-xs text-zinc-500">amm/gest</span>
                  )}
                </td>
                {!fonteRiepilogo && <td className="py-1.5 text-right text-zinc-400">{r.nTurni}</td>}
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
            {!collab.data?.righe.length && (
              <tr>
                <td className="py-4 text-zinc-500" colSpan={fonteRiepilogo ? 3 : 3}>
                  Nessun collaboratore in questo mese. Importa il riepilogo PDF di fine mese.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">Dipendenti fissi · buste paga</h3>
            <p className="text-xs text-zinc-500">
              Buste paga Teamsystem (PDF) o mastrino Excel. Importo = lordo competenze della busta.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`${btnAmber} cursor-pointer`}>
              Importa buste PDF
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
                Anteprima buste: {bustePdfPreview.length} persone, {eur(bustePdfPreview.reduce((s, x) => s + x.totale, 0))}
              </p>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => setBustePdfPreview(null)}>
                  Annulla
                </button>
                <button
                  type="button"
                  className={btnAmber}
                  disabled={importMut.isPending}
                  onClick={() => importMut.mutate(bustePdfPreview)}
                >
                  {importMut.isPending ? "Caricamento…" : `Importa ${bustePdfPreview.length}`}
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-auto text-xs">
              {bustePdfPreview.map((p, i) => (
                <p key={`${p.nominativo}-${i}`} className="text-zinc-300">
                  {p.nominativo} · {eur(p.totale)} · {nomeReparto(attivi, p.quote[0]?.repartoId ?? "")}
                </p>
              ))}
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
              Importo lordo / costo
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
        e spese generali).
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
