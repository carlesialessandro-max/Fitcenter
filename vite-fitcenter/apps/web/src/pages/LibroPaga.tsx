import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
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
} from "@/api/libroPaga"
import { useAuth } from "@/contexts/AuthContext"
import { LibroPagaMensilitaTab, LibroPagaPersonaleDettaglio } from "@/components/LibroPagaMensilita"
import { LibroPagaRepartiMulti, livelloAlberoUnionUi, livelloIdsFromPersona } from "@/components/LibroPagaRepartiMulti"
import { LibroPagaReport } from "@/components/LibroPagaReport"
import { LibroPagaLivelliTab } from "@/components/LibroPagaLivelli"
import { LibroPagaConvalidaMesePanel, LibroPagaConvalidaPanel, LibroPagaConvalideLista, LibroPagaTurniConvalidaElenco, LibroPagaDelegheForm, rootsFiltroTurniConvalide, useLibroPagaConvalida, useLibroPagaConvalidaMese } from "@/components/LibroPagaConvalida"
import { LpagaSearchSelect, MansioneSearchSelect } from "@/components/MansioneSearchSelect"
import { LibroPagaSlot, QualificheCorsiFields } from "@/components/LibroPagaSlot"
import { qualificheForDisplay, visitaMedicaFromQualifiche } from "@/lib/personale-qualifiche"
import type { QualificaConData } from "@/lib/personale-qualifiche"
import { ReportCollaboratori } from "@/pages/ReportCollaboratori"
import { canVedereReportCollaboratori } from "@/lib/report-collaboratori-access"
import { cmpNomeCognome } from "@/lib/personale-sort"
import { RUOLO_LEGENDA } from "@/lib/lpaga-ruolo"

type Tab = "home" | "livelli" | "personale" | "turni" | "convalide" | "mensilita" | "report" | "collaboratori"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return "—"
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
  const { role, user } = useAuth()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const canFull = role === "admin"
  const canCollab = canVedereReportCollaboratori(user)
  const [tab, setTab] = useState<Tab>(() => {
    if (params.get("tab") === "collaboratori" && canCollab) return "collaboratori"
    if (!canFull && canCollab) return "collaboratori"
    return "home"
  })
  const [mese, setMese] = useState(currentMese)
  const [reparto, setReparto] = useState("")
  const [error, setError] = useState("")
  const [q, setQ] = useState("")

  const snap = useQuery({
    queryKey: ["libro-paga", mese, reparto],
    queryFn: () => libroPagaApi.get(mese, reparto || undefined),
    enabled: canFull,
  })

  const lpSnapshots = useQuery({
    queryKey: ["libro-paga-snapshots"],
    queryFn: () => libroPagaApi.listSnapshots(),
    enabled: canFull,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ["libro-paga"] })
  const importMut = useMutation({
    mutationFn: (file: File) => libroPagaApi.importDump(file),
    onSuccess: (r) => {
      setError("")
      invalidate()
      void qc.invalidateQueries({ queryKey: ["libro-paga-snapshots"] })
      alert(
        `Importati ${r.turni} turni da ${r.dump}. Ruoli e anagrafica non modificati. Snapshot salvato.`
      )
    },
    onError: (e: Error) => setError(e.message),
  })

  const restoreSnapMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.restoreSnapshot(id),
    onSuccess: () => {
      setError("")
      invalidate()
      alert("Libro paga ripristinato dallo snapshot.")
    },
    onError: (e: Error) => setError(e.message),
  })

  const repairRuoliMut = useMutation({
    mutationFn: () => {
      const raw = window.prompt(
        "Username admin libro paga (separati da virgola). «admin» resta sempre amministratore.",
        "admin"
      )
      if (raw === null) return Promise.reject(new Error("Annullato"))
      const adminUsernames = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      return libroPagaApi.repairRuoli(adminUsernames)
    },
    onSuccess: (r) => {
      setError("")
      invalidate()
      alert(`Ripristinati ${r.managers} responsabili e ${r.admins} admin (da deleghe / lista).`)
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!canFull && !canCollab) {
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
  const tabs: { id: Tab; label: string }[] = canFull
    ? [
        { id: "home", label: "Home" },
        { id: "livelli", label: "Livelli" },
        { id: "personale", label: "Personale" },
        { id: "turni", label: "Turnazioni" },
        { id: "convalide", label: "Convalide" },
        { id: "mensilita", label: "Mensilità" },
        { id: "report", label: "Report" },
        ...(canCollab ? [{ id: "collaboratori" as Tab, label: "Collaboratori sportivi" }] : []),
      ]
    : [{ id: "collaboratori", label: "Collaboratori sportivi" }]

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
        {canFull ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm text-zinc-400">
            <span className="text-xs">Reparto</span>
            <select value={reparto} onChange={(e) => setReparto(e.target.value)} className={inputCls}>
              <option value="">Tutti i reparti</option>
              {(data?.reparti ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-zinc-400">
            <span className="text-xs">Mese</span>
            <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className={inputCls} />
          </label>
          <label className={`${btnGhost} cursor-pointer ${importMut.isPending ? "pointer-events-none opacity-50" : ""}`}>
            {importMut.isPending ? "Import in corso…" : "Importa turni Payroll"}
            <input
              type="file"
              accept=".sql,.gz,application/sql,application/gzip"
              className="hidden"
              disabled={importMut.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ""
                if (!file) return
                if (
                  !confirm(
                    `Importare solo i TURNI da «${file.name}»? Anagrafica, ruoli, date corsi e certificati non vengono toccati.`
                  )
                ) {
                  return
                }
                importMut.mutate(file)
              }}
            />
          </label>
          <button
            type="button"
            className={btnGhost}
            disabled={repairRuoliMut.isPending}
            onClick={() => repairRuoliMut.mutate()}
            title="Ripristina responsabili da deleghe convalida; opzionale lista username admin"
          >
            {repairRuoliMut.isPending ? "Ripristino…" : "Ripristina ruoli"}
          </button>
          {(lpSnapshots.data?.snapshots.length ?? 0) > 0 ? (
            <label className="grid gap-1 text-sm text-zinc-400">
              <span className="text-xs">Snapshot libro paga</span>
              <select
                className={inputCls}
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value
                  if (!id) return
                  e.target.value = ""
                  if (
                    confirm(
                      "Ripristinare tutto il libro paga (personale, ruoli, turni) da questo snapshot? Sovrascrive lo stato attuale."
                    )
                  ) {
                    restoreSnapMut.mutate(id)
                  }
                }}
              >
                <option value="">Ripristina snapshot…</option>
                {lpSnapshots.data!.snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} · {s.createdAt.slice(0, 16).replace("T", " ")} · {s.personale} pers.
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        ) : null}
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
      {canFull && snap.isLoading && <p className="mt-4 text-sm text-zinc-500">Caricamento…</p>}
      {canFull && snap.isError && <p className="mt-4 text-sm text-red-400">{(snap.error as Error).message}</p>}

      {tab === "collaboratori" && canCollab ? <ReportCollaboratori compact /> : null}
      {data && tab === "home" && <HomeTab data={data} />}
      {data && tab === "livelli" && (
        <LibroPagaLivelliTab
          data={data}
          q={q}
          setQ={setQ}
          onError={setError}
          onDone={() => {
            setError("")
            invalidate()
          }}
          createLivello={(body) => libroPagaApi.createLivello(body)}
          patchLivello={(id, body) => libroPagaApi.patchLivello(id, body)}
          deleteLivello={(id) => libroPagaApi.deleteLivello(id)}
          showTreeDefault
        />
      )}
      {data && tab === "personale" && (
        <PersonaleTab data={data} q={q} setQ={setQ} onError={setError} onDone={() => { setError(""); invalidate() }} />
      )}
        {data && tab === "turni" && (
          <TurniTab data={data} mese={mese} q={q} setQ={setQ} reparto={reparto} onError={setError} onDone={() => { setError(""); invalidate() }} />
        )}
      {data && tab === "convalide" && (
        <ConvalideTab
          data={data}
          mese={mese}
          onDone={() => {
            setError("")
            invalidate()
          }}
        />
      )}
      {data && tab === "mensilita" && (
        <MensilitaTab data={data} mese={mese} reparto={reparto} onError={setError} onDone={() => { setError(""); invalidate() }} />
      )}
      {data && tab === "report" && <LibroPagaReport data={data} />}
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
  const [livelloIds, setLivelloIds] = useState<string[]>([])
  const [contratto, setContratto] = useState("")
  const [iban, setIban] = useState("")
  const [email, setEmail] = useState("")
  const [qualifiche, setQualifiche] = useState<QualificaConData[]>([])
  const [password, setPassword] = useState("")
  const [nuovoOpen, setNuovoOpen] = useState(false)
  const [pwdId, setPwdId] = useState<string | null>(null)
  const [pwdNew, setPwdNew] = useState("")
  const [dettaglioId, setDettaglioId] = useState<string | null>(null)
  const n = q.trim().toLowerCase()
  const match = (p: LpagaPersonale) =>
    !n || `${p.nominativo} ${p.username} ${p.repartoNome}`.toLowerCase().includes(n)
  const users = data.personale.filter((p) => p.ruolo === "user" && match(p)).sort(cmpNomeCognome)
  const managers = data.personale.filter((p) => p.ruolo === "manager" && match(p)).sort(cmpNomeCognome)
  const admins = data.personale.filter((p) => p.ruolo === "admin" && match(p)).sort(cmpNomeCognome)
  const createMut = useMutation({
    mutationFn: () =>
      libroPagaApi.createPersonale({
        nome,
        cognome,
        username,
        password,
        ruolo,
        livelloIds,
        livelloId: livelloIds[0] ?? "",
        contratto,
        iban,
        email,
        qualifiche,
        visitaMedica: visitaMedicaFromQualifiche(qualifiche),
        attivo: true,
      }),
    onSuccess: () => {
      setNome("")
      setCognome("")
      setUsername("")
      setPassword("")
      setQualifiche([])
      setContratto("")
      setIban("")
      setEmail("")
      setLivelloIds([])
      setNuovoOpen(false)
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const pwdMut = useMutation({
    mutationFn: () => libroPagaApi.setPersonalePassword(pwdId!, pwdNew),
    onSuccess: () => {
      setPwdId(null)
      setPwdNew("")
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deletePersonale(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const ruoloMut = useMutation({
    mutationFn: ({ id, ruolo }: { id: string; ruolo: LpagaRuolo }) => libroPagaApi.patchPersonale(id, { ruolo }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  const Table = ({ title, rows, showReparto }: { title: string; rows: LpagaPersonale[]; showReparto?: boolean }) => (
    <Card title={title}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Cognome</th>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Ruolo</th>
              {showReparto && <th className="px-3 py-2">Reparto</th>}
              <th className="px-3 py-2">Scad. contratto</th>
              <th className="px-3 py-2">Visita medica</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{r.nome}</td>
                <td className="px-3 py-2">{r.cognome ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.username ?? "—"}</td>
                <td className="px-3 py-2">
                  <select
                    className={inputCls}
                    value={r.ruolo}
                    disabled={ruoloMut.isPending}
                    aria-label={`Ruolo di ${r.nominativo ?? r.username ?? r.id}`}
                    onChange={(e) => ruoloMut.mutate({ id: r.id, ruolo: e.target.value as LpagaRuolo })}
                  >
                    <option value="user">Istruttore</option>
                    <option value="manager">Responsabile</option>
                    <option value="admin">Amministratore</option>
                  </select>
                </td>
                {showReparto && <td className="px-3 py-2">{r.repartoNome}</td>}
                <td className="px-3 py-2">{fmtDateIt(r.contratto)}</td>
                <td className="px-3 py-2">{fmtDateIt(visitaMedicaFromQualifiche(qualificheForDisplay(r)))}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    className="mr-2 text-xs text-zinc-300 hover:underline"
                    onClick={() => setDettaglioId(r.id)}
                  >
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="mr-2 text-xs text-amber-300 hover:underline"
                    onClick={() => {
                      setPwdId(r.id)
                      setPwdNew("")
                    }}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-400 hover:underline"
                    onClick={() => {
                      const nome = r.nominativo ?? `${r.nome} ${r.cognome ?? ""}`.trim()
                      if (!window.confirm(`Eliminare ${nome} dal libro paga? Vengono cancellati anche i suoi turni.`)) return
                      delMut.mutate(r.id)
                    }}
                  >
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
      <PersonaleDelegheAdmin data={data} onError={onError} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca personale…" className={inputCls} />
      {dettaglioId && (() => {
        const persona = data.personale.find((p) => p.id === dettaglioId)
        if (!persona) return null
        return (
          <LibroPagaPersonaleDettaglio
            persona={persona}
            mese={data.mese}
            mensilita={data.mensilita.find((m) => m.personaleId === dettaglioId)}
            lezioni={data.turni.filter((t) => t.personaleId === dettaglioId).sort((a, b) => b.giorno.localeCompare(a.giorno))}
            onClose={() => setDettaglioId(null)}
            canEdit
            allowAdminRole
            livelli={data.livelli}
            onSavePersonale={(id, body) => libroPagaApi.patchPersonale(id, body)}
            onError={onError}
            onDone={onDone}
          />
        )
      })()}
      {!nuovoOpen && (
        <button type="button" className={btnGhost} onClick={() => setNuovoOpen(true)}>
          + Aggiungi utente
        </button>
      )}
      {nuovoOpen && (
        <LibroPagaSlot title="Nuovo utente">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              createMut.mutate()
            }}
          >
            <label className="grid gap-1 text-xs text-zinc-500">
              Cognome
              <input value={cognome} onChange={(e) => setCognome(e.target.value)} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Nome
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={inputCls}
                required
                minLength={6}
              />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Ruolo
              <select value={ruolo} onChange={(e) => setRuolo(e.target.value as LpagaRuolo)} className={inputCls}>
                <option value="user">Istruttore</option>
                <option value="manager">Responsabile</option>
                <option value="admin">Amministratore</option>
              </select>
            </label>
            <div className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
              <span>Reparti / sotto-reparti</span>
              <LibroPagaRepartiMulti
                reparti={data.livelli}
                value={livelloIds}
                onChange={setLivelloIds}
              />
            </div>
            <label className="grid gap-1 text-xs text-zinc-500">
              Scadenza contratto
              <input type="date" value={contratto} onChange={(e) => setContratto(e.target.value)} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              IBAN
              <input value={iban} onChange={(e) => setIban(e.target.value)} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                autoComplete="email"
              />
            </label>
            <p className="text-xs text-zinc-500 sm:col-span-2">
              Tesseramento ASI, certificato medico e anagrafica (CF, recapiti, indirizzo) arrivano dal gestionale (categoria STAFF) e non si modificano qui.
            </p>
            <QualificheCorsiFields value={qualifiche} onChange={setQualifiche} inputCls={inputCls} />
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className={btnGhost} onClick={() => setNuovoOpen(false)}>
                Annulla
              </button>
              <button type="submit" className={btnAmber} disabled={createMut.isPending}>
                {createMut.isPending ? "Salvataggio…" : "Salva"}
              </button>
            </div>
          </form>
        </LibroPagaSlot>
      )}
      {pwdId && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            pwdMut.mutate()
          }}
        >
          <p className="w-full text-sm text-amber-200/90">
            Nuova password per {data.personale.find((p) => p.id === pwdId)?.nominativo ?? pwdId}
          </p>
          <input
            type="password"
            value={pwdNew}
            onChange={(e) => setPwdNew(e.target.value)}
            placeholder="Nuova password"
            autoComplete="new-password"
            className={inputCls}
            required
            minLength={6}
          />
          <button type="submit" className={btnAmber} disabled={pwdMut.isPending}>
            Salva password
          </button>
          <button type="button" className={btnGhost} onClick={() => setPwdId(null)}>
            Annulla
          </button>
        </form>
      )}
      <p className="text-xs text-zinc-500">{RUOLO_LEGENDA}</p>
      <Table title={`Istruttori · ${users.length}`} rows={users} />
      <Table title={`Responsabili · ${managers.length}`} rows={managers} showReparto />
      <Table title={`Amministratori · ${admins.length}`} rows={admins} />
    </div>
  )
}

function TurniTab({
  data,
  mese,
  q,
  setQ,
  reparto,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  mese: string
  q: string
  setQ: (s: string) => void
  reparto: string
  onError: (s: string) => void
  onDone: () => void
}) {
  const attiviP = data.personale.filter((p) => p.attivo)
  const treeIds = useMemo(() => {
    if (!reparto) return null
    const ids = new Set<string>([reparto])
    let added = true
    while (added) {
      added = false
      for (const l of data.livelli) {
        if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
          ids.add(l.id)
          added = true
        }
      }
    }
    return ids
  }, [data.livelli, reparto])
  const attiviL = data.livelli.filter((l) => l.attivo && l.retribuibile && (!treeIds || treeIds.has(l.id)))
  const personeItems = useMemo(
    () =>
      attiviP
        .slice()
        .sort(cmpNomeCognome)
        .map((p) => ({
          id: p.id,
          label: p.nominativo ?? `${p.nome} ${p.cognome ?? ""}`.trim(),
        })),
    [attiviP]
  )
  const [personaleId, setPersonaleId] = useState(attiviP[0]?.id ?? "")
  const [livelloId, setLivelloId] = useState(attiviL[0]?.id ?? "")
  const [giorno, setGiorno] = useState(() => {
    const t = todayIso()
    return t.startsWith(mese) ? t : `${mese}-01`
  })
  const [quantita, setQuantita] = useState("1")
  const [note, setNote] = useState("")
  const [cercaData, setCercaData] = useState("")
  const [nuovoTurno, setNuovoTurno] = useState(false)
  const n = q.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  const rows = data.turni.filter((t) => {
    if (cercaData && t.giorno !== cercaData) return false
    if (!n) return true
    const nome = (t.personaleNome ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    const mans = (t.livelloNome ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    return nome.includes(n) || mans.includes(n) || t.giorno.includes(n) || fmtDateIt(t.giorno).includes(q.trim())
  })
  const createMut = useMutation({
    mutationFn: () =>
      libroPagaApi.createTurno({
        personaleId,
        livelloId,
        giorno,
        quantita: Number(quantita.replace(",", ".")),
        note,
      }),
    onSuccess: () => {
      setNote("")
      setQuantita("1")
      setNuovoTurno(false)
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deleteTurno(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  return (
    <div className="mt-4 space-y-4">
      {!nuovoTurno && (
        <button type="button" className={btnGhost} onClick={() => setNuovoTurno(true)}>
          + Aggiungi turno di lavoro
        </button>
      )}
      {nuovoTurno && (
        <LibroPagaSlot title="Nuovo turno di lavoro">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              createMut.mutate()
            }}
          >
            <label className="grid gap-1 text-xs text-zinc-400 sm:col-span-2">
              <span>Dipendente</span>
              <LpagaSearchSelect
                items={personeItems}
                value={personaleId}
                onChange={setPersonaleId}
                placeholder="Cerca dipendente…"
                required
              />
            </label>
            <label className="grid gap-1 text-xs text-zinc-400 sm:col-span-2">
              <span>Mansione</span>
              <MansioneSearchSelect items={attiviL} value={livelloId} onChange={setLivelloId} required />
            </label>
            <label className="grid gap-1 text-xs text-zinc-400">
              <span>Data</span>
              <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-400">
              <span>Valore</span>
              <input value={quantita} onChange={(e) => setQuantita(e.target.value)} className={inputCls} />
              <span className="text-[11px] text-zinc-500">Ore se paga oraria, servizi se paga fissa</span>
            </label>
            <label className="grid gap-1 text-xs text-zinc-400 sm:col-span-2">
              <span>Note</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Orario / sostituzioni / altro"
                className={inputCls}
              />
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className={btnGhost} onClick={() => setNuovoTurno(false)}>
                Annulla
              </button>
              <button type="submit" className={btnAmber} disabled={createMut.isPending}>
                {createMut.isPending ? "Salvataggio…" : "Salva"}
              </button>
            </div>
          </form>
        </LibroPagaSlot>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca turnazioni: dipendente, mansione o data…"
          className={`${inputCls} min-w-[16rem] flex-1`}
        />
        <input type="date" value={cercaData} onChange={(e) => setCercaData(e.target.value)} className={inputCls} />
      </div>
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

function PersonaleDelegheAdmin({
  data,
  onError,
}: {
  data: LibroPagaSnapshot
  onError: (s: string) => void
}) {
  const managers = data.personale.filter((p) => p.ruolo === "manager" && p.attivo).sort(cmpNomeCognome)
  const [managerId, setManagerId] = useState(managers[0]?.id ?? "")
  const q = useQuery({
    queryKey: ["lpaga-deleghe", managerId],
    queryFn: () => libroPagaApi.getDeleghe(managerId),
    enabled: Boolean(managerId),
  })
  const persone = data.personale
    .filter((p) => {
      if (p.ruolo !== "user") return false
      const mgr = data.personale.find((x) => x.id === managerId)
      const roots = livelloIdsFromPersona(mgr)
      if (!roots.length) return true
      const ids = livelloAlberoUnionUi(data.livelli, roots)
      return Boolean(p.livelloId && ids.has(p.livelloId))
    })
    .sort(cmpNomeCognome)
    .map((p) => ({
      id: p.id,
      label: `${p.nominativo ?? `${p.nome} ${p.cognome ?? ""}`.trim()}${p.repartoNome ? ` · ${p.repartoNome}` : ""}`,
    }))
  if (!managers.length) return null
  return (
    <LibroPagaDelegheForm
      persone={persone}
      selected={q.data?.deleghe ?? []}
      onSave={(ids) => libroPagaApi.putDeleghe(managerId, ids)}
      onError={onError}
      extra={
        <label className="grid gap-1 text-xs text-zinc-400">
          <span>Responsabile da delegare</span>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={inputCls}>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nominativo ?? `${m.nome} ${m.cognome ?? ""}`.trim()}
                {m.repartoNome ? ` · ${m.repartoNome}` : ""}
              </option>
            ))}
          </select>
          {q.isLoading ? <span className="text-zinc-500">Caricamento deleghe…</span> : null}
        </label>
      }
    />
  )
}

function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fmtDateIt(iso)
  return d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
}

function ConvalideTab({
  data,
  mese,
  onDone,
}: {
  data: LibroPagaSnapshot
  mese: string
  onDone: () => void
}) {
  const riep = data.convalideRiepilogo
  const responsabili = riep?.responsabili ?? data.convalide
  const [vista, setVista] = useState<"mese" | "settimana">("mese")
  const [sett, setSett] = useState("")
  const [meseOpen, setMeseOpen] = useState(false)
  const [filtri, setFiltri] = useState({ scope: "", from: "", to: "" })
  const [aperto, setAperto] = useState<string | null>(null)
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>([])
  const convMese = useLibroPagaConvalidaMese(
    mese,
    meseOpen,
    (m) => libroPagaApi.getConvalidaMese(m, { scope: filtri.scope || undefined, from: filtri.from || undefined, to: filtri.to || undefined }),
    `${filtri.scope}|${filtri.from}|${filtri.to}`
  )
  const weeks = riep?.settimane ?? []
  const weekSel = weeks.find((w) => w.from === sett)
  const respSel = responsabili.find((r) => r.personaleId === aperto)
  const turniVista = useMemo(() => {
    let list = data.turni
    if (vista === "settimana" && weekSel) {
      list = list.filter((t) => t.giorno >= weekSel.from && t.giorno <= weekSel.to)
    }
    const roots = rootsFiltroTurniConvalide(respSel, selectedScopeIds)
    if (roots === null) return list
    if (!roots.length) return []
    const ids = livelloAlberoUnionUi(data.livelli, roots)
    return list.filter((t) => ids.has(t.livelloId))
  }, [data.turni, data.livelli, vista, weekSel, respSel, selectedScopeIds])
  const elencoTitle = vista === "settimana" ? "Turni della settimana" : "Turni del mese"
  const elencoHint = !respSel
    ? "Tutti i turni. Clicca un responsabile per filtrare il reparto, poi i sottoreparti."
    : selectedScopeIds.length
      ? `${respSel.nominativo} · ${selectedScopeIds.length} ${selectedScopeIds.length === 1 ? "sottoreparto" : "sottoreparti"}`
      : `${respSel.nominativo} · tutto il reparto`

  return (
    <div className="mt-4 space-y-4">
      {meseOpen && convMese.isLoading && <p className="text-sm text-zinc-500">Controllo turni…</p>}
      {meseOpen && convMese.isError && <p className="text-sm text-red-400">{(convMese.error as Error).message}</p>}
      {meseOpen && convMese.data && (
        <LibroPagaConvalidaMesePanel
          data={convMese.data}
          showCalendariFitCenter
          onClose={() => setMeseOpen(false)}
          onSaveTurno={(body) => libroPagaApi.putConvalidaTurno(body).then(onDone)}
          onConfermaAllineati={() =>
            libroPagaApi.postConvalidaMese(mese, {
              scope: filtri.scope || undefined,
              from: filtri.from || undefined,
              to: filtri.to || undefined,
            }).then((r) => {
              onDone()
              return r
            })
          }
          onFiltriChange={(f) => setFiltri(f)}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={vista === "mese" ? "rounded-md bg-amber-500/20 px-3 py-1.5 text-sm text-amber-200" : btnGhost}
            onClick={() => setVista("mese")}
          >
            Mese
          </button>
          <button
            type="button"
            className={vista === "settimana" ? "rounded-md bg-amber-500/20 px-3 py-1.5 text-sm text-amber-200" : btnGhost}
            onClick={() => {
              setVista("settimana")
              if (!sett && weeks[0]) setSett(weeks[0].from)
            }}
          >
            Settimana
          </button>
          {vista === "settimana" && (
            <select value={sett} onChange={(e) => setSett(e.target.value)} className={inputCls}>
              {weeks.map((w) => (
                <option key={w.id} value={w.from}>
                  {w.label} · {w.nConfermati}/{w.nTurni}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="button"
          className={btnAmber}
          onClick={() => {
            setFiltri((f) => ({ ...f, scope: "" }))
            setMeseOpen(true)
          }}
        >
          Convalida turni
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card title="Turni periodo">
          <p className="text-2xl font-semibold">{vista === "settimana" && weekSel ? weekSel.nTurni : riep?.nTurni ?? data.turni.length}</p>
        </Card>
        <Card title="Confermati">
          <p className="text-2xl font-semibold text-emerald-300">
            {vista === "settimana" && weekSel ? weekSel.nConfermati : riep?.nConfermati ?? 0}
          </p>
        </Card>
        <Card title="Da fare">
          <p className="text-2xl font-semibold text-amber-300">
            {vista === "settimana" && weekSel ? weekSel.nDaFare : riep?.nDaFare ?? 0}
          </p>
        </Card>
        <Card title="Ultima convalida">
          <p className="text-sm text-zinc-200">{fmtStamp(riep?.ultima)}</p>
          <p className="mt-1 text-xs text-zinc-500">{riep?.ultimaDa || "—"}</p>
        </Card>
      </div>
      <Card title="Responsabili">
        <p className="mb-3 text-xs text-zinc-500">
          Clicca un responsabile per vedere i turni di tutto il suo reparto. Poi seleziona uno o più sottoreparti per
          filtrare l’elenco in fondo. «Convalida questo ambito» apre il controllo turni.
        </p>
        <LibroPagaConvalideLista
          responsabili={responsabili}
          aperto={aperto}
          onApertoChange={setAperto}
          selectedScopeIds={selectedScopeIds}
          onSelectedScopeIdsChange={setSelectedScopeIds}
          onApriScope={(scope) => {
            setFiltri((f) => ({ ...f, scope }))
            setMeseOpen(true)
          }}
        />
      </Card>
      <LibroPagaTurniConvalidaElenco turni={turniVista} title={elencoTitle} hint={elencoHint} />
    </div>
  )
}

function MensilitaTab({
  data,
  mese,
  reparto,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  mese: string
  reparto: string
  onError: (s: string) => void
  onDone: () => void
}) {
  const [convId, setConvId] = useState<string | null>(null)
  const [meseOpen, setMeseOpen] = useState(false)
  const [filtri, setFiltri] = useState({ scope: reparto || "", from: "", to: "" })
  const conv = useLibroPagaConvalida(mese, convId, (m, id) => libroPagaApi.getConvalida(m, id, reparto || undefined))
  const convMese = useLibroPagaConvalidaMese(
    mese,
    meseOpen,
    (m) =>
      libroPagaApi.getConvalidaMese(m, {
        scope: filtri.scope || undefined,
        from: filtri.from || undefined,
        to: filtri.to || undefined,
      }),
    `${filtri.scope}|${filtri.from}|${filtri.to}`
  )
  const row = convId ? data.mensilita.find((r) => r.personaleId === convId) : undefined
  return (
    <div className="mt-4 space-y-4">
      {meseOpen && convMese.isLoading && <p className="text-sm text-zinc-500">Controllo turni del mese…</p>}
      {meseOpen && convMese.isError && <p className="text-sm text-red-400">{(convMese.error as Error).message}</p>}
      {meseOpen && convMese.data && (
        <LibroPagaConvalidaMesePanel
          data={convMese.data}
          showCalendariFitCenter
          onClose={() => setMeseOpen(false)}
          onSaveTurno={(body) => libroPagaApi.putConvalidaTurno(body)}
          onConfermaAllineati={() =>
            libroPagaApi.postConvalidaMese(mese, {
              scope: filtri.scope || undefined,
              from: filtri.from || undefined,
              to: filtri.to || undefined,
            })
          }
          onFiltriChange={setFiltri}
        />
      )}
      {convId && conv.isLoading && <p className="text-sm text-zinc-500">Caricamento convalida…</p>}
      {convId && conv.isError && <p className="text-sm text-red-400">{(conv.error as Error).message}</p>}
      {conv.data && (
        <LibroPagaConvalidaPanel
          data={conv.data}
          showCalendariFitCenter
          onClose={() => setConvId(null)}
          onSaveTurno={(body) => libroPagaApi.putConvalidaTurno(body)}
          onChiudiMese={
            row
              ? () =>
                  libroPagaApi
                    .putMensilita({
                      personaleId: row.personaleId,
                      mese,
                      bonifico: row.bonifico,
                      nota: row.nota,
                      chiuso: true,
                    })
                    .then(onDone)
              : undefined
          }
        />
      )}
      <LibroPagaMensilitaTab
        data={data}
        mese={mese}
        canEdit={() => true}
        onSave={(body) => libroPagaApi.putMensilita(body)}
        onError={onError}
        onDone={onDone}
        onConvalida={(id) => {
          setMeseOpen(false)
          setConvId(id)
        }}
        onConvalidaMese={() => {
          setConvId(null)
          setMeseOpen(true)
        }}
      />
    </div>
  )
}
