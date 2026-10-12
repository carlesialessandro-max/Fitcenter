import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useAuth } from "@/contexts/AuthContext"
import {
  amministrazioneApi,
  type AmmQuota,
  type AmmReparto,
  type AmmSpesa,
  type AmmTipoCosto,
} from "@/api/amministrazione"
import { extractPdfText } from "@/lib/pdf-fattura-text"

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

type Tab = "dashboard" | "spese" | "reparti"

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
    : loc.pathname.includes("/spese")
      ? "spese"
      : "dashboard"
  const tabs: { id: Tab; to: string; label: string }[] = [
    { id: "dashboard", to: "/amministrazione", label: "Dashboard costi" },
    { id: "spese", to: "/amministrazione/spese", label: "Registro spese" },
    { id: "reparti", to: "/amministrazione/reparti", label: "Reparti e centri di costo" },
  ]
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Amministrazione</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Costi di struttura per competenza (data documento). I pagamenti fornitori non entrano. I collaboratori sportivi
        arrivano dal libro paga.
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
      {tab === "dashboard" ? <DashboardTab /> : tab === "spese" ? <RegistroTab /> : <RepartiTab />}
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
  const fissoPct = d && d.tot > 0 ? Math.round((d.totFisso / d.tot) * 100) : 0
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
            {(meta.data?.reparti ?? []).filter((r) => r.attivo).map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      {dash.isLoading && <p className="text-sm text-zinc-500">Caricamento…</p>}
      {dash.isError && <p className="text-sm text-red-400">{(dash.error as Error).message}</p>}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi title="Totale competenza" value={eur(d.tot)} hint={`${d.nSpese} documenti + collaboratori sportivi`} />
            <Kpi title="Fissi" value={eur(d.totFisso)} hint={`${fissoPct}% del totale`} />
            <Kpi title="Variabili" value={eur(d.totVariabile)} hint={`di cui libro paga ${eur(d.totCollaboratori)}`} />
            <Kpi title="Solo registro spese" value={eur(d.totSpese)} hint="Senza collaboratori sportivi" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 p-4">
              <h3 className="mb-3 text-sm font-medium text-zinc-200">Spese per reparto</h3>
              {d.byReparto.length ? (
                <div className="h-64">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={d.byReparto} dataKey="importo" nameKey="nome" innerRadius={50} outerRadius={90} paddingAngle={2}>
                        {d.byReparto.map((_, i) => (
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
                {d.byReparto.map((r, i) => (
                  <li key={r.id} className="flex justify-between gap-3">
                    <span>
                      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      {r.nome}
                    </span>
                    <span>{eur(r.importo)}</span>
                  </li>
                ))}
              </ul>
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

function Kpi({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <p className="text-xs text-zinc-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-100">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </div>
  )
}

function emptyForm(reparti: AmmReparto[]): {
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  descrizione: string
  totale: string
  tipoCosto: AmmTipoCosto
  quote: AmmQuota[]
} {
  const first = reparti.find((r) => r.attivo) ?? reparti[0]
  return {
    fornitore: "",
    numeroDocumento: "",
    dataDocumento: currentYm() + "-01",
    descrizione: "",
    totale: "",
    tipoCosto: "fisso",
    quote: first ? [{ repartoId: first.id, percentuale: 100 }] : [],
  }
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
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const list = useQuery({
    queryKey: ["amm-spese", mese, q],
    queryFn: () => amministrazioneApi.listSpese(mese, q),
  })
  const reparti = meta.data?.reparti ?? []
  const attivi = reparti.filter((r) => r.attivo)
  const [form, setForm] = useState(() => emptyForm([]))
  const somma = quoteSum(form.quote)
  const okSplit = Math.abs(somma - 100) < 0.05 && form.quote.length > 0

  function startNew() {
    setEditId(null)
    setPdf(null)
    setOcrMsg("")
    setForm(emptyForm(attivi))
    setOpen(true)
  }
  function startEdit(s: AmmSpesa) {
    setEditId(s.id)
    setPdf(null)
    setOcrMsg("")
    setForm({
      fornitore: s.fornitore,
      numeroDocumento: s.numeroDocumento,
      dataDocumento: s.dataDocumento,
      descrizione: s.descrizione,
      totale: String(s.totale),
      tipoCosto: s.tipoCosto,
      quote: s.quote.map((x) => ({ ...x })),
    })
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
          quote: form.quote,
          origine: pdf ? "ocr" : "manuale",
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

  async function onPdf(file: File | null) {
    setPdf(file)
    if (!file) return
    setOcrMsg("Lettura PDF…")
    try {
      const text = await extractPdfText(file)
      const r = await amministrazioneApi.ocr(text)
      const p = r.parsed
      setForm((f) => ({
        ...f,
        fornitore: r.fornitoreNoto?.ragioneSociale || p.fornitore || f.fornitore,
        numeroDocumento: p.numeroDocumento || f.numeroDocumento,
        dataDocumento: p.dataDocumento || f.dataDocumento,
        descrizione: p.descrizione || f.descrizione,
        totale: p.totale != null ? String(p.totale) : f.totale,
      }))
      setOcrMsg(
        r.fornitoreNoto
          ? `Letto: fornitore già in anagrafica (${r.fornitoreNoto.ragioneSociale}). Controlla e conferma.`
          : "Dati precompilati dal PDF. Controlla e conferma il reparto."
      )
    } catch (e) {
      setOcrMsg((e as Error).message || "Lettura PDF non riuscita: inserisci a mano.")
    }
  }

  function setPerc(id: string, perc: number) {
    setForm((f) => {
      const quote = f.quote.some((q) => q.repartoId === id)
        ? f.quote.map((q) => (q.repartoId === id ? { ...q, percentuale: perc } : q))
        : [...f.quote, { repartoId: id, percentuale: perc }]
      return { ...f, quote: quote.filter((q) => q.percentuale > 0) }
    })
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Mese competenza
          <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className={inputCls} />
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca fornitore, n. documento…" className={`${inputCls} min-w-[16rem] flex-1`} />
        <button type="button" className={btnAmber} onClick={startNew}>
          + Nuova spesa
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
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
                onChange={(e) => setForm({ ...form, fornitore: e.target.value })}
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
              <input value={form.numeroDocumento} onChange={(e) => setForm({ ...form, numeroDocumento: e.target.value })} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Data documento
              <input type="date" value={form.dataDocumento} onChange={(e) => setForm({ ...form, dataDocumento: e.target.value })} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Totale lordo
              <input value={form.totale} onChange={(e) => setForm({ ...form, totale: e.target.value })} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Tipo costo
              <select
                value={form.tipoCosto}
                onChange={(e) => setForm({ ...form, tipoCosto: e.target.value as AmmTipoCosto })}
                className={inputCls}
              >
                <option value="fisso">Fisso</option>
                <option value="variabile">Variabile</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
              Descrizione
              <input value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} className={inputCls} />
            </label>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-200">Ripartizione per reparto</span>
              <span className={okSplit ? "text-emerald-300" : "text-red-400"}>Somma {somma.toFixed(1)}% {okSplit ? "· ok" : "· deve essere 100%"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full ${okSplit ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, somma)}%` }} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {attivi.map((r) => {
                const perc = form.quote.find((q) => q.repartoId === r.id)?.percentuale ?? 0
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
                <td className="px-3 py-2 text-xs text-zinc-400">
                  {s.quote
                    .map((q) => `${attivi.find((r) => r.id === q.repartoId)?.nome ?? q.repartoId} ${q.percentuale}%`)
                    .join(" · ")}
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
                <td className="px-3 py-6 text-zinc-500" colSpan={7}>
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

function RepartiTab() {
  const qc = useQueryClient()
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const [nome, setNome] = useState("")
  const [tipo, setTipo] = useState<"operativo" | "struttura">("operativo")
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
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-zinc-500">
        Macro-aree di competenza. Piscina accorpa coperta/estiva/parco; Fitness accorpa palestra, corsi, pole e PT.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!nome.trim()) return
          saveMut.mutate({ nome: nome.trim(), tipo, ordine: 50, attivo: true })
        }}
      >
        <label className="grid gap-1 text-xs text-zinc-500">
          Nuovo centro di costo
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} placeholder="Nome" />
        </label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as "operativo" | "struttura")} className={inputCls}>
          <option value="operativo">Operativo</option>
          <option value="struttura">Struttura / da ripartire</option>
        </select>
        <button type="submit" className={btnAmber} disabled={saveMut.isPending}>
          Aggiungi
        </button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2">Attivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{r.nome}</td>
                <td className="px-3 py-2 capitalize">{r.tipo}</td>
                <td className="px-3 py-2 text-zinc-400">{r.note ?? "—"}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-xs text-amber-300 hover:underline"
                    onClick={() => saveMut.mutate({ id: r.id, nome: r.nome, tipo: r.tipo, attivo: !r.attivo, ordine: r.ordine, note: r.note })}
                  >
                    {r.attivo ? "Disattiva" : "Riattiva"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
