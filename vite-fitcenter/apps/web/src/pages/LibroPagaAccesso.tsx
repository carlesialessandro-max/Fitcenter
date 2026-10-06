import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BrandLogo } from "@/components/BrandLogo"
import { PwaInstallHint } from "@/components/PwaInstallHint"
import { lpagaApi, setLpagaToken, type LpagaMe, type LpagaPortalSnapshot } from "@/api/lpaga"
import { LibroPagaMensilitaTab, LibroPagaPersonaleDettaglio } from "@/components/LibroPagaMensilita"
import { LibroPagaReport } from "@/components/LibroPagaReport"
import { LibroPagaConvalidaMesePanel, LibroPagaConvalidaPanel, LibroPagaDelegheForm, useLibroPagaConvalida, useLibroPagaConvalidaMese } from "@/components/LibroPagaConvalida"
import { LpagaSearchSelect, MansioneSearchSelect } from "@/components/MansioneSearchSelect"

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
const btnAmber = "rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"

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

function ruoloLabel(r: string): string {
  if (r === "admin") return "Amministratore"
  if (r === "manager") return "Responsabile"
  return "Istruttore"
}

export function LibroPagaAccesso() {
  const [tokenOn, setTokenOn] = useState(() => lpagaApi.hasToken())
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await lpagaApi.login(username, password)
      setLpagaToken(res.token)
      setTokenOn(true)
      setPassword("")
    } catch (err) {
      setError((err as Error).message ?? "Accesso non riuscito")
    } finally {
      setLoading(false)
    }
  }

  if (!tokenOn) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-zinc-950 p-4">
        <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <BrandLogo variant="payoff" className="justify-center" imgClassName="mx-auto max-h-[5rem]" />
            <div>
              <h1 className="text-lg font-semibold text-zinc-100">Libro paga</h1>
              <p className="mt-1 text-sm text-zinc-500">Accesso istruttori e responsabili. Non serve FitCenter.</p>
            </div>
          </div>
          <form onSubmit={onLogin} className="space-y-4">
            <div>
              <label htmlFor="lp-user" className="block text-xs font-medium text-zinc-400">
                Username Payroll
              </label>
              <input
                id="lp-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className={`mt-1 w-full ${inputCls}`}
                placeholder="es. camillanardi"
              />
            </div>
            <div>
              <label htmlFor="lp-pass" className="block text-xs font-medium text-zinc-400">
                Password
              </label>
              <input
                id="lp-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className={`mt-1 w-full ${inputCls}`}
              />
            </div>
            {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className={`w-full ${btnAmber}`}>
              {loading ? "Accesso in corso…" : "Entra"}
            </button>
          </form>
        </div>
        <PwaInstallHint />
      </div>
    )
  }

  return <LpagaApp onLogout={() => setTokenOn(false)} />
}

function LpagaApp({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient()
  const [mese, setMese] = useState(currentMese)
  const [reparto, setReparto] = useState("")
  const [tab, setTab] = useState<"home" | "turni" | "personale" | "mensilita" | "report">("home")
  const [error, setError] = useState("")
  const meQ = useQuery({ queryKey: ["lpaga-me"], queryFn: () => lpagaApi.me() })
  const me = meQ.data?.user
  const snap = useQuery({
    queryKey: ["lpaga", mese, me?.ruolo === "admin" ? reparto : ""],
    queryFn: () => lpagaApi.get(mese, me?.ruolo === "admin" && reparto ? reparto : undefined),
    enabled: meQ.isSuccess,
  })
  const data = snap.data
  const isUser = me?.ruolo === "user"
  const canTeam = me?.ruolo === "manager" || me?.ruolo === "admin"

  useEffect(() => {
    const msg = `${(meQ.error as Error | undefined)?.message ?? ""} ${(snap.error as Error | undefined)?.message ?? ""}`
    if (/scaduta|Token mancante/i.test(msg)) {
      setLpagaToken(null)
      onLogout()
    }
  }, [meQ.error, snap.error, onLogout])

  async function logout() {
    try {
      await lpagaApi.logout()
    } catch {
      // ignore
    }
    setLpagaToken(null)
    qc.removeQueries({ queryKey: ["lpaga"] })
    onLogout()
  }

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "turni", label: isUser ? "I miei turni" : "Turnazioni" },
    { id: "mensilita", label: "Mensilità" },
    ...(canTeam ? ([{ id: "personale" as const, label: "Personale" }] as const) : []),
    ...(canTeam ? ([{ id: "report" as const, label: "Report" }] as const) : []),
  ]

  return (
    <div className="min-h-svh bg-zinc-950 pt-[env(safe-area-inset-top)] text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <BrandLogo variant="compact" />
          <div>
            <p className="text-sm font-semibold">Libro paga</p>
            <p className="text-xs text-zinc-500">
              {me ? `${me.nominativo} · ${ruoloLabel(me.ruolo)}` : "…"}
              {data?.me?.repartoNome ? ` · ${data.me.repartoNome}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me?.ruolo === "admin" && (
            <select value={reparto} onChange={(e) => setReparto(e.target.value)} className={inputCls} aria-label="Reparto">
              <option value="">Tutti i reparti</option>
              {(data?.reparti ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
            </select>
          )}
          <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className={inputCls} />
          <button type="button" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300" onClick={() => void logout()}>
            Esci
          </button>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
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
        {data && tab === "home" && <Home data={data} me={me} />}
        {data && tab === "turni" && (
          <Turni
            data={data}
            me={me}
            mese={mese}
            onError={setError}
            onDone={() => {
              setError("")
              void qc.invalidateQueries({ queryKey: ["lpaga"] })
            }}
          />
        )}
        {data && tab === "personale" && canTeam && (
          <Personale
            data={data}
            me={me}
            mese={mese}
            onError={setError}
            onDone={() => {
              setError("")
              void qc.invalidateQueries({ queryKey: ["lpaga"] })
            }}
          />
        )}
        {data && tab === "mensilita" && (
          <Mensilita
            data={data}
            mese={mese}
            me={me}
            onError={setError}
            onDone={() => {
              setError("")
              void qc.invalidateQueries({ queryKey: ["lpaga"] })
            }}
          />
        )}
        {data && tab === "report" && canTeam && <LibroPagaReport data={data} />}
      </main>
      <PwaInstallHint />
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

function Home({ data, me }: { data: LpagaPortalSnapshot; me?: LpagaMe }) {
  const h = data.home as typeof data.home & { mioOre?: number; mioImporto?: number; mioTurni?: number }
  const isUser = me?.ruolo === "user"
  return (
    <div className="mt-4 space-y-4">
      {isUser && data.canValidate && (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-200/90">
          Hai la delega per convalidare le mensilità del reparto: apri Mensilità e premi Convalida.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
      <Card title={isUser ? "Le mie ore" : "Ore del mese"}>
        <p className="text-2xl font-semibold">{isUser ? h.mioOre ?? 0 : data.mensilita.reduce((s, r) => s + r.ore, 0)}</p>
      </Card>
      <Card title={isUser ? "Il mio importo" : "Importo del mese"}>
        <p className="text-2xl font-semibold">
          {eur(isUser ? h.mioImporto ?? 0 : data.mensilita.reduce((s, r) => s + r.importo, 0))}
        </p>
      </Card>
      <Card title="Turni">
        <p className="text-2xl font-semibold">{isUser ? h.mioTurni ?? 0 : data.turni.length}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {isUser ? "Solo i tuoi turni" : `${data.personale.length} persone nel reparto`}
        </p>
      </Card>
    </div>
    </div>
  )
}

function Turni({
  data,
  me,
  mese,
  onError,
  onDone,
}: {
  data: LpagaPortalSnapshot
  me?: LpagaMe
  mese: string
  onError: (s: string) => void
  onDone: () => void
}) {
  const isUser = me?.ruolo === "user"
  const canChangeDay = me?.ruolo === "admin" || me?.ruolo === "manager"
  const oggi = todayIso()
  const persone = data.personale.filter((p) => p.attivo)
  const livelli = data.livelliInseribili?.length ? data.livelliInseribili : data.livelli.filter((l) => l.retribuibile)
  const [personaleId, setPersonaleId] = useState(isUser ? me?.id ?? "" : persone[0]?.id ?? "")
  const [livelloId, setLivelloId] = useState(livelli[0]?.id ?? "")
  const [giorno, setGiorno] = useState(oggi)
  const [quantita, setQuantita] = useState("1")
  const [note, setNote] = useState("")
  const [cercaTurni, setCercaTurni] = useState("")
  const [cercaData, setCercaData] = useState("")
  useEffect(() => {
    if (!canChangeDay) setGiorno(todayIso())
  }, [canChangeDay, mese])
  const personeItems = useMemo(
    () =>
      persone
        .map((p) => ({
          id: p.id,
          label: p.nominativo ?? `${p.cognome ?? ""} ${p.nome}`.trim(),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "it")),
    [persone]
  )
  const createMut = useMutation({
    mutationFn: () =>
      lpagaApi.createTurno({
        personaleId: isUser ? me!.id : personaleId,
        livelloId,
        giorno: canChangeDay ? giorno : todayIso(),
        quantita: Number(quantita.replace(",", ".")),
        note,
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => lpagaApi.deleteTurno(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const rows = useMemo(() => {
    const n = cercaTurni.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    return [...data.turni]
      .filter((t) => {
        if (isUser && t.personaleId !== me?.id) return false
        if (cercaData && t.giorno !== cercaData) return false
        if (!n) return true
        const nome = (t.personaleNome ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
        const mans = (t.livelloNome ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
        const dataIt = fmtDateIt(t.giorno)
        return nome.includes(n) || mans.includes(n) || t.giorno.includes(n) || dataIt.includes(cercaTurni.trim())
      })
      .sort((a, b) => b.giorno.localeCompare(a.giorno))
  }, [data.turni, cercaTurni, cercaData, isUser, me?.id])

  return (
    <div className="mt-4 space-y-4">
      <form
        className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        {!isUser && (
          <label className="grid gap-1 text-xs text-zinc-400">
            <span>Dipendente</span>
            <LpagaSearchSelect
              items={personeItems}
              value={personaleId}
              onChange={setPersonaleId}
              placeholder="Cerca dipendente…"
              required
            />
          </label>
        )}
        <label className="grid gap-1 text-xs text-zinc-400">
          <span>Mansione</span>
          <MansioneSearchSelect items={livelli} value={livelloId} onChange={setLivelloId} required />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          <span>Data</span>
          <input
            type="date"
            value={canChangeDay ? giorno : oggi}
            onChange={(e) => canChangeDay && setGiorno(e.target.value)}
            className={inputCls}
            disabled={!canChangeDay}
            min={canChangeDay ? undefined : oggi}
            max={canChangeDay ? undefined : oggi}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          <span>Valore</span>
          <input value={quantita} onChange={(e) => setQuantita(e.target.value)} className={inputCls} required />
        </label>
        <div className="flex items-end">
          <button type="submit" className={`${btnAmber} w-full`} disabled={createMut.isPending}>
            Aggiungi turno
          </button>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note"
          className={`${inputCls} ${isUser ? "lg:col-span-4" : "lg:col-span-5"}`}
        />
        {isUser && (
          <p className="text-xs text-zinc-500 lg:col-span-5">
            Puoi inserire turni solo per oggi ({fmtDateIt(oggi)}), entro mezzanotte.
          </p>
        )}
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-[16rem] flex-1 gap-1 text-xs text-zinc-400">
          <span>Cerca turnazioni</span>
          <input
            value={cercaTurni}
            onChange={(e) => setCercaTurni(e.target.value)}
            placeholder="Dipendente, mansione o data…"
            className={inputCls}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          <span>Filtra data</span>
          <input type="date" value={cercaData} onChange={(e) => setCercaData(e.target.value)} className={inputCls} />
        </label>
        {(cercaTurni || cercaData) && (
          <button
            type="button"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
            onClick={() => {
              setCercaTurni("")
              setCercaData("")
            }}
          >
            Pulisci
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Mansione</th>
              {!isUser && <th className="px-3 py-2">Dipendente</th>}
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
                {!isUser && <td className="px-3 py-2">{t.personaleNome}</td>}
                <td className="px-3 py-2 text-right">{t.quantita}</td>
                <td className="px-3 py-2 text-right">{eur(t.importo)}</td>
                <td className="px-3 py-2 text-zinc-400">{t.note ?? ""}</td>
                <td className="px-3 py-2 text-right">
                  {(!isUser || t.giorno === oggi) && (
                    <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => delMut.mutate(t.id)}>
                      Elimina
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={isUser ? 6 : 7}>
                  Nessun turno in questo mese.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Personale({
  data,
  me,
  mese,
  onError,
  onDone,
}: {
  data: LpagaPortalSnapshot
  me?: LpagaMe
  mese: string
  onError: (s: string) => void
  onDone: () => void
}) {
  const [nome, setNome] = useState("")
  const [cognome, setCognome] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [ruolo, setRuolo] = useState<"user" | "manager">("user")
  const [livelloId, setLivelloId] = useState(me?.livelloId ?? "")
  const [pwdId, setPwdId] = useState<string | null>(null)
  const [pwdNew, setPwdNew] = useState("")
  const [q, setQ] = useState("")
  const [dettaglioId, setDettaglioId] = useState<string | null>(null)
  const createMut = useMutation({
    mutationFn: () =>
      lpagaApi.createPersonale({ nome, cognome, username, password, ruolo, livelloId }),
    onSuccess: () => {
      setNome("")
      setCognome("")
      setUsername("")
      setPassword("")
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const pwdMut = useMutation({
    mutationFn: () => lpagaApi.setPersonalePassword(pwdId!, pwdNew),
    onSuccess: () => {
      setPwdId(null)
      setPwdNew("")
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const reparti = data.livelli.filter((l) => !l.retribuibile)
  const n = q.trim().toLowerCase()
  const personeFiltrate = data.personale.filter(
    (p) =>
      !n ||
      `${p.nominativo ?? ""} ${p.cognome ?? ""} ${p.nome} ${p.username ?? ""} ${p.repartoNome ?? ""}`
        .toLowerCase()
        .includes(n)
  )
  const detPersona = dettaglioId ? data.personale.find((p) => p.id === dettaglioId) : undefined
  const detMens = dettaglioId ? data.mensilita.find((m) => m.personaleId === dettaglioId) : undefined
  const detTurni = dettaglioId
    ? data.turni.filter((t) => t.personaleId === dettaglioId).sort((a, b) => b.giorno.localeCompare(a.giorno))
    : []
  const istruttoriDelega = data.personale
    .filter((p) => p.ruolo === "user" && p.id !== me?.id)
    .map((p) => ({ id: p.id, label: p.nominativo ?? `${p.cognome ?? ""} ${p.nome}`.trim() }))
    .sort((a, b) => a.label.localeCompare(b.label, "it"))
  return (
    <div className="mt-4 space-y-4">
      {(me?.ruolo === "manager" || me?.ruolo === "admin") && (
        <LibroPagaDelegheForm
          persone={istruttoriDelega}
          selected={data.deleghe ?? []}
          onSave={(ids) => lpagaApi.putDeleghe(ids)}
          onError={onError}
        />
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca personale…" className={inputCls} />
      {detPersona && (
        <LibroPagaPersonaleDettaglio
          persona={detPersona}
          mese={mese}
          mensilita={detMens}
          lezioni={detTurni}
          onClose={() => setDettaglioId(null)}
        />
      )}
      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        <input value={cognome} onChange={(e) => setCognome(e.target.value)} placeholder="Cognome" className={inputCls} required />
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" className={inputCls} required />
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className={inputCls} required />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password accesso"
          autoComplete="new-password"
          className={inputCls}
          required
          minLength={6}
        />
        <select value={ruolo} onChange={(e) => setRuolo(e.target.value as "user" | "manager")} className={inputCls}>
          <option value="user">Istruttore</option>
          {me?.ruolo === "admin" && <option value="manager">Responsabile</option>}
        </select>
        <select value={livelloId} onChange={(e) => setLivelloId(e.target.value)} className={inputCls}>
          <option value="">Reparto</option>
          {reparti.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <button type="submit" className={btnAmber} disabled={createMut.isPending}>
          Aggiungi utente
        </button>
      </form>
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
          <button type="button" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300" onClick={() => setPwdId(null)}>
            Annulla
          </button>
        </form>
      )}
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Cognome</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Ruolo</th>
              <th className="px-3 py-2">Reparto</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {personeFiltrate.map((p) => (
              <tr key={p.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{p.cognome ?? "—"}</td>
                <td className="px-3 py-2">{p.nome}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{p.username ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{ruoloLabel(p.ruolo)}</td>
                <td className="px-3 py-2">{p.repartoNome}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    className="mr-2 text-xs text-zinc-300 hover:underline"
                    onClick={() => setDettaglioId(p.id)}
                  >
                    Dettaglio
                  </button>
                  {p.username && (
                    <button
                      type="button"
                      className="text-xs text-amber-300 hover:underline"
                      onClick={() => {
                        setPwdId(p.id)
                        setPwdNew("")
                      }}
                    >
                      Password
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!personeFiltrate.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={6}>
                  Nessuna persona trovata.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Mensilita({
  data,
  mese,
  me,
  onError,
  onDone,
}: {
  data: LpagaPortalSnapshot
  mese: string
  me?: LpagaMe
  onError: (s: string) => void
  onDone: () => void
}) {
  const canValidate = Boolean(data.canValidate) || me?.ruolo === "admin" || me?.ruolo === "manager"
  const [convId, setConvId] = useState<string | null>(null)
  const [meseOpen, setMeseOpen] = useState(false)
  const conv = useLibroPagaConvalida(mese, canValidate ? convId : null, lpagaApi.getConvalida)
  const convMese = useLibroPagaConvalidaMese(mese, meseOpen && canValidate, lpagaApi.getConvalidaMese)
  const row = convId ? data.mensilita.find((r) => r.personaleId === convId) : undefined
  return (
    <div className="mt-4 space-y-4">
      {meseOpen && convMese.isLoading && <p className="text-sm text-zinc-500">Controllo turni del mese…</p>}
      {meseOpen && convMese.isError && <p className="text-sm text-red-400">{(convMese.error as Error).message}</p>}
      {meseOpen && convMese.data && (
        <LibroPagaConvalidaMesePanel
          data={convMese.data}
          onClose={() => setMeseOpen(false)}
          onSaveTurno={(body) => lpagaApi.putConvalidaTurno(body)}
          onConfermaAllineati={() => lpagaApi.postConvalidaMese(mese)}
        />
      )}
      {convId && conv.isLoading && <p className="text-sm text-zinc-500">Caricamento convalida…</p>}
      {convId && conv.isError && <p className="text-sm text-red-400">{(conv.error as Error).message}</p>}
      {conv.data && (
        <LibroPagaConvalidaPanel
          data={conv.data}
          onClose={() => setConvId(null)}
          onSaveTurno={(body) => lpagaApi.putConvalidaTurno(body)}
          onChiudiMese={
            row
              ? () =>
                  lpagaApi.putMensilita({
                    personaleId: row.personaleId,
                    mese,
                    bonifico: row.bonifico,
                    nota: row.nota,
                    chiuso: true,
                  }).then(onDone)
              : undefined
          }
        />
      )}
      <LibroPagaMensilitaTab
        data={data}
        mese={mese}
        canEdit={() => me?.ruolo === "admin" || me?.ruolo === "manager" || Boolean(data.canValidate)}
        hideIban={me?.ruolo === "user"}
        onSave={(body) => lpagaApi.putMensilita(body)}
        onError={onError}
        onDone={onDone}
        onConvalida={
          canValidate
            ? (id) => {
                setMeseOpen(false)
                setConvId(id)
              }
            : undefined
        }
        onConvalidaMese={
          canValidate
            ? () => {
                setConvId(null)
                setMeseOpen(true)
              }
            : undefined
        }
      />
    </div>
  )
}
