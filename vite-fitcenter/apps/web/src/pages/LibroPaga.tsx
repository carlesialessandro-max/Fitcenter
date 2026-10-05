import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  libroPagaApi,
  type LibroPagaSnapshot,
  type LpagaPersonale,
  type LpagaRuolo,
  type LpagaTreeNode,
} from "@/api/libroPaga"
import { useAuth } from "@/contexts/AuthContext"
import { LibroPagaMensilitaTab } from "@/components/LibroPagaMensilita"

type Tab = "home" | "livelli" | "personale" | "turni" | "convalide" | "mensilita" | "admin"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function currentMese(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(
      new Date()
    )
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}

function todayIso(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
const COLORS = ["#46A6D9", "#F59E0B", "#34D399", "#A78BFA", "#F87171", "#FBBF24", "#60A5FA", "#C084FC"]

export function LibroPaga() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>("home")
  const [mese, setMese] = useState(currentMese)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")

  const snap = useQuery({
    queryKey: ["libro-paga", mese],
    queryFn: () => libroPagaApi.get(mese),
    enabled: role === "admin",
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ["libro-paga"] })
  const importMut = useMutation({
    mutationFn: () => libroPagaApi.importDump(),
    onSuccess: (r) => {
      setError("")
      invalidate()
      alert(
        `Importati ${r.livelli} livelli, ${r.personale} persone, ${r.turni} turni (storage ${r.storage}).`
      )
    },
    onError: (e: Error) => setError(e.message),
  })

  if (role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Libro paga</h2>
          <p className="mt-2 text-sm text-zinc-500">Pagina disponibile solo per amministratori.</p>
        </div>
      </div>
    )
  }

  const data = snap.data
  const tabs: { id: Tab; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "livelli", label: "Livelli" },
    { id: "personale", label: "Personale" },
    { id: "turni", label: "Turnazioni" },
    { id: "convalide", label: "Convalide" },
    { id: "mensilita", label: "Mensilità" },
    { id: "admin", label: "Amministrazione" },
  ]

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Libro paga</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Payroll FitCenter: livelli, ruoli, turni, convalide e mensilità. Vista completa admin. Istruttori e
            responsabili entrano da <span className="font-mono text-zinc-400">/lpaga</span> senza login FitCenter.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm text-zinc-400">
            <span className="text-xs">Mese</span>
            <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className={inputCls} />
          </label>
          <button
            type="button"
            className={btnGhost}
            disabled={importMut.isPending}
            onClick={() => {
              if (confirm("Importare lo storico da Payroll (libropaga.it)? Password vecchie non vengono copiate.")) {
                importMut.mutate()
              }
            }}
          >
            {importMut.isPending ? "Import in corso…" : "Importa backup Payroll"}
          </button>
        </div>
      </div>

      {data?.storage === "json" && (
        <p className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90">
          Dati su file FitCenter (JSON). Se SQL write è disponibile, l’import userà le tabelle FcLibroPaga*.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t.id ? "bg-amber-500/20 text-amber-200" : "border border-zinc-700 text-zinc-400"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {snap.isLoading && <p className="mt-4 text-sm text-zinc-500">Caricamento…</p>}
      {snap.isError && <p className="mt-4 text-sm text-red-400">{(snap.error as Error).message}</p>}

      {data && tab === "home" && <HomeTab data={data} />}
      {data && tab === "livelli" && (
        <LivelliTab data={data} q={q} setQ={setQ} onError={setError} onDone={() => { setError(""); invalidate() }} />
      )}
      {data && tab === "personale" && (
        <PersonaleTab data={data} q={q} setQ={setQ} onError={setError} onDone={() => { setError(""); invalidate() }} />
      )}
      {data && tab === "turni" && (
        <TurniTab data={data} mese={mese} q={q} setQ={setQ} onError={setError} onDone={() => { setError(""); invalidate() }} />
      )}
      {data && tab === "convalide" && <ConvalideTab data={data} />}
      {data && tab === "mensilita" && (
        <MensilitaTab data={data} mese={mese} onError={setError} onDone={() => { setError(""); invalidate() }} />
      )}
      {data && tab === "admin" && <AdminTab data={data} />}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-300">{title}</h2>
      {children}
    </div>
  )
}

function HomeTab({ data }: { data: LibroPagaSnapshot }) {
  const h = data.home
  const mesi = h.costiMesi.map((c) => ({
    ...c,
    label: c.mese.slice(5) + "/" + c.mese.slice(2, 4),
  }))
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card title="Costo globale dipendenti">
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={mesi}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip formatter={(v: number) => eur(v)} />
              <Line type="monotone" dataKey="totale" stroke="#46A6D9" dot={false} name="Costo" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Pannello di controllo">
        <ul className="space-y-1.5 text-sm text-zinc-300">
          <li className="flex justify-between"><span>Amministratori</span><span>{h.admin}</span></li>
          <li className="flex justify-between"><span>Manager</span><span>{h.manager}</span></li>
          <li className="flex justify-between"><span>User</span><span>{h.user}</span></li>
          <li className="flex justify-between"><span>Livelli</span><span>{h.livelli}</span></li>
          <li className="flex justify-between"><span>Turni inseriti oggi</span><span>{h.turniOggi}</span></li>
          <li className="flex justify-between"><span>Convalide inserite oggi</span><span>{h.convalideOggi}</span></li>
        </ul>
      </Card>
      <Card title="Costo mese corrente">
        <div className="h-56">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={h.donut} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80}>
                {h.donut.map((d, i) => (
                  <Cell key={d.label} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => eur(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="lg:col-span-3">
        <Card title="Costo dipendenti per reparto">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={mesi}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} />
                <Tooltip formatter={(v: number) => eur(v)} />
                <Legend />
                <Line type="monotone" dataKey="piscina" stroke="#46A6D9" dot={false} name="piscina" />
                <Line type="monotone" dataKey="palestra" stroke="#F87171" dot={false} name="fitness" />
                <Line type="monotone" dataKey="ristorante" stroke="#34D399" dot={false} name="aqua" />
                <Line type="monotone" dataKey="miscellanea" stroke="#FBBF24" dot={false} name="miscellanea" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Tree({ nodes, depth = 0 }: { nodes: LpagaTreeNode[]; depth?: number }) {
  return (
    <ul className={depth ? "ml-4 border-l border-zinc-800 pl-3" : ""}>
      {nodes.map((n) => (
        <li key={n.id} className="py-0.5 text-sm text-zinc-300">
          <span className={n.retribuibile ? "text-zinc-200" : "italic text-zinc-400"}>{n.nome}</span>
          {n.children?.length ? <Tree nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  )
}

function LivelliTab({
  data,
  q,
  setQ,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  q: string
  setQ: (s: string) => void
  onError: (s: string) => void
  onDone: () => void
}) {
  const [showTree, setShowTree] = useState(false)
  const [nome, setNome] = useState("")
  const [parentId, setParentId] = useState("")
  const [retrib, setRetrib] = useState("")
  const [fissa, setFissa] = useState(false)
  const [retribuibile, setRetribuibile] = useState(true)
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return data.livelli.filter((l) => !n || `${l.nome} ${l.dominio} ${l.parentNome}`.toLowerCase().includes(n))
  }, [data.livelli, q])
  const createMut = useMutation({
    mutationFn: () =>
      libroPagaApi.createLivello({
        nome,
        parentId: parentId || undefined,
        retribuzione: Number(retrib.replace(",", ".") || 0),
        fissa,
        retribuibile,
        attivo: true,
      }),
    onSuccess: () => {
      setNome("")
      setRetrib("")
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deleteLivello(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca livello…" className={inputCls} />
        <button type="button" className={btnGhost} onClick={() => setShowTree((v) => !v)}>
          {showTree ? "Nascondi gerarchia" : "Visualizza gerarchia"}
        </button>
      </div>
      {showTree && (
        <Card title="Gerarchia livelli">
          <Tree nodes={data.tree} />
        </Card>
      )}
      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        <label className="grid gap-1 text-xs text-zinc-400">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} required />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Padre / dominio
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
            <option value="">(radice)</option>
            {data.livelli.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Paga €
          <input value={retrib} onChange={(e) => setRetrib(e.target.value)} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={retribuibile} onChange={(e) => setRetribuibile(e.target.checked)} />
          Retribuibile
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={fissa} onChange={(e) => setFissa(e.target.checked)} />
          Fissa
        </label>
        <button type="submit" className={btnAmber} disabled={createMut.isPending}>
          Aggiungi livello
        </button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Dominio</th>
              <th className="px-3 py-2">Retribuibile</th>
              <th className="px-3 py-2 text-right">Paga</th>
              <th className="px-3 py-2">Oraria/Fissa</th>
              <th className="px-3 py-2">Statistiche</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{r.nome}</td>
                <td className="px-3 py-2 text-zinc-400">{r.dominio}</td>
                <td className="px-3 py-2">{r.retribuibile ? "SI" : "NO"}</td>
                <td className="px-3 py-2 text-right">{r.retribuibile ? eur(r.retribuzione) : "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{r.retribuibile ? (r.fissa ? "fissa" : "oraria") : "—"}</td>
                <td className="px-3 py-2">{r.statistica ? "SI" : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => delMut.mutate(r.id)}>
                    Elimina
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

function PersonaleTab({
  data,
  q,
  setQ,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  q: string
  setQ: (s: string) => void
  onError: (s: string) => void
  onDone: () => void
}) {
  const [nome, setNome] = useState("")
  const [cognome, setCognome] = useState("")
  const [username, setUsername] = useState("")
  const [ruolo, setRuolo] = useState<LpagaRuolo>("user")
  const [livelloId, setLivelloId] = useState("")
  const [contratto, setContratto] = useState("")
  const [iban, setIban] = useState("")
  const n = q.trim().toLowerCase()
  const match = (p: LpagaPersonale) =>
    !n || `${p.nominativo} ${p.username} ${p.repartoNome}`.toLowerCase().includes(n)
  const users = data.personale.filter((p) => p.ruolo === "user" && match(p))
  const managers = data.personale.filter((p) => p.ruolo === "manager" && match(p))
  const admins = data.personale.filter((p) => p.ruolo === "admin" && match(p))
  const createMut = useMutation({
    mutationFn: () =>
      libroPagaApi.createPersonale({ nome, cognome, username, ruolo, livelloId, contratto, iban, attivo: true }),
    onSuccess: () => {
      setNome("")
      setCognome("")
      setUsername("")
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deletePersonale(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  const Table = ({ title, rows, showReparto }: { title: string; rows: LpagaPersonale[]; showReparto?: boolean }) => (
    <Card title={title}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Cognome</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Username</th>
              {showReparto && <th className="px-3 py-2">Reparto</th>}
              <th className="px-3 py-2">Scad. contratto</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{r.cognome ?? "—"}</td>
                <td className="px-3 py-2">{r.nome}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.username ?? "—"}</td>
                {showReparto && <td className="px-3 py-2">{r.repartoNome}</td>}
                <td className="px-3 py-2">{fmtDateIt(r.contratto)}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => delMut.mutate(r.id)}>
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )

  return (
    <div className="mt-4 space-y-4">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca persona…" className={inputCls} />
      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        <input value={cognome} onChange={(e) => setCognome(e.target.value)} placeholder="Cognome" className={inputCls} required />
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" className={inputCls} required />
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className={inputCls} />
        <select value={ruolo} onChange={(e) => setRuolo(e.target.value as LpagaRuolo)} className={inputCls}>
          <option value="user">User</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <select value={livelloId} onChange={(e) => setLivelloId(e.target.value)} className={inputCls}>
          <option value="">Reparto</option>
          {data.livelli.filter((l) => !l.retribuibile).map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <input type="date" value={contratto} onChange={(e) => setContratto(e.target.value)} className={inputCls} />
        <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IBAN" className={inputCls} />
        <button type="submit" className={btnAmber} disabled={createMut.isPending}>
          Aggiungi utente
        </button>
      </form>
      <Table title={`Dipendenti (user) · ${users.length}`} rows={users} />
      <Table title={`Responsabili (manager) · ${managers.length}`} rows={managers} showReparto />
      <Table title={`Amministratori (admin) · ${admins.length}`} rows={admins} />
    </div>
  )
}

function TurniTab({
  data,
  mese,
  q,
  setQ,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  mese: string
  q: string
  setQ: (s: string) => void
  onError: (s: string) => void
  onDone: () => void
}) {
  const attiviP = data.personale.filter((p) => p.attivo)
  const attiviL = data.livelli.filter((l) => l.attivo && l.retribuibile)
  const [personaleId, setPersonaleId] = useState(attiviP[0]?.id ?? "")
  const [livelloId, setLivelloId] = useState(attiviL[0]?.id ?? "")
  const [giorno, setGiorno] = useState(() => {
    const t = todayIso()
    return t.startsWith(mese) ? t : `${mese}-01`
  })
  const [quantita, setQuantita] = useState("1")
  const [note, setNote] = useState("")
  const n = q.trim().toLowerCase()
  const rows = data.turni.filter(
    (t) => !n || `${t.personaleNome} ${t.livelloNome} ${t.note}`.toLowerCase().includes(n)
  )
  const createMut = useMutation({
    mutationFn: () =>
      libroPagaApi.createTurno({
        personaleId,
        livelloId,
        giorno,
        quantita: Number(quantita.replace(",", ".")),
        note,
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deleteTurno(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  return (
    <div className="mt-4 space-y-4">
      <form
        className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        <select value={personaleId} onChange={(e) => setPersonaleId(e.target.value)} className={inputCls} required>
          {attiviP.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nominativo ?? `${p.cognome ?? ""} ${p.nome}`.trim()}
            </option>
          ))}
        </select>
        <select value={livelloId} onChange={(e) => setLivelloId(e.target.value)} className={inputCls} required>
          {attiviL.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} className={inputCls} />
        <input value={quantita} onChange={(e) => setQuantita(e.target.value)} className={inputCls} />
        <button type="submit" className={btnAmber} disabled={createMut.isPending}>
          Aggiungi turno
        </button>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className={`${inputCls} lg:col-span-5`} />
      </form>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca turno…" className={inputCls} />
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Mansione</th>
              <th className="px-3 py-2">Dipendente</th>
              <th className="px-3 py-2 text-right">Valore</th>
              <th className="px-3 py-2 text-right">Importo</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(t.giorno)}</td>
                <td className="px-3 py-2">{t.livelloNome}</td>
                <td className="px-3 py-2">{t.personaleNome}</td>
                <td className="px-3 py-2 text-right">{t.quantita}</td>
                <td className="px-3 py-2 text-right">{eur(t.importo)}</td>
                <td className="px-3 py-2 text-zinc-400">{t.note ?? ""}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => delMut.mutate(t.id)}>
                    Elimina
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

function ConvalideTab({ data }: { data: LibroPagaSnapshot }) {
  return (
    <div className="mt-4 space-y-4">
      <Card title="Convalide responsabili">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Responsabile</th>
                <th className="px-3 py-2">Reparto</th>
                <th className="px-3 py-2">Ultima convalida</th>
                <th className="px-3 py-2">Stato</th>
              </tr>
            </thead>
            <tbody>
              {data.convalide.map((c) => (
                <tr key={c.personaleId} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2">{c.nominativo}</td>
                  <td className="px-3 py-2">{c.reparto}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.ultima ? fmtDateIt(c.ultima) : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.okIeri ? "bg-emerald-400" : "bg-red-500"}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Presenze corsi (mese)">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Mansione</th>
                <th className="px-3 py-2">Dipendente</th>
                <th className="px-3 py-2 text-right">Quantità</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2 text-right">N. presenze</th>
              </tr>
            </thead>
            <tbody>
              {data.turni.map((t) => (
                <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2">{fmtDateIt(t.giorno)}</td>
                  <td className="px-3 py-2">{t.livelloNome}</td>
                  <td className="px-3 py-2">{t.personaleNome}</td>
                  <td className="px-3 py-2 text-right">{t.quantita}</td>
                  <td className="px-3 py-2 text-zinc-400">{t.note ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{t.presenzaValore ?? "?"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function MensilitaTab({
  data,
  mese,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  mese: string
  onError: (s: string) => void
  onDone: () => void
}) {
  return (
    <LibroPagaMensilitaTab
      data={data}
      mese={mese}
      canEdit={() => true}
      onSave={(body) => libroPagaApi.putMensilita(body)}
      onError={onError}
      onDone={onDone}
    />
  )
}

function AdminTab({ data }: { data: LibroPagaSnapshot }) {
  const mesi = data.home.costiMesi.map((c) => ({
    ...c,
    label: c.mese.slice(5) + "/" + c.mese.slice(2, 4),
  }))
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Costo miscellanea">
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={mesi}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip formatter={(v: number) => eur(v)} />
              <Line type="monotone" dataKey="miscellanea" stroke="#46A6D9" dot={false} name="miscellanea" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Costo mese corrente per miscellanea">
        <div className="h-56">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.home.miscDonut} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80}>
                {data.home.miscDonut.map((d, i) => (
                  <Cell key={d.label} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => eur(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}
