import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BrandLogo } from "@/components/BrandLogo"
import { PwaInstallHint } from "@/components/PwaInstallHint"
import { lpagaApi, setLpagaToken, type LpagaMe, type LpagaPortalSnapshot } from "@/api/lpaga"
import { LibroPagaMensilitaTab, LibroPagaPersonaleDettaglio, GestionaleAnagraficaBlock } from "@/components/LibroPagaMensilita"
import { LibroPagaReport } from "@/components/LibroPagaReport"
import { LibroPagaConvalidaMesePanel, LibroPagaConvalidaPanel, LibroPagaConvalideLista, LibroPagaTurniConvalidaElenco, LibroPagaDelegheForm, rootsFiltroTurniConvalide, useLibroPagaConvalida, useLibroPagaConvalidaMese } from "@/components/LibroPagaConvalida"
import { livelloAlberoUnionUi } from "@/components/LibroPagaRepartiMulti"
import { LpagaSearchSelect, MansioneSearchSelect } from "@/components/MansioneSearchSelect"
import { LibroPagaSlot, QualificheCorsiFields } from "@/components/LibroPagaSlot"
import { ThemeToggle } from "@/components/ThemeToggle"
import { qualificheForDisplay, visitaMedicaFromQualifiche, type QualificaConData } from "@/lib/personale-qualifiche"
import { ReportCollaboratori } from "@/pages/ReportCollaboratori"
import { canVedereReportCollaboratoriLpaga } from "@/lib/report-collaboratori-access"
import { cmpNomeCognome, cmpRuoloNomeCognome } from "@/lib/personale-sort"
import { ruoloLabel, RUOLO_LEGENDA } from "@/lib/lpaga-ruolo"

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
const btnAmber = "rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

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
  const [tab, setTab] = useState<"home" | "anagrafica" | "turni" | "personale" | "mensilita" | "convalide" | "report" | "collaboratori">(
    "home"
  )
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
  const canCollab = canVedereReportCollaboratoriLpaga(me)

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
    { id: "anagrafica", label: "Anagrafica" },
    { id: "turni", label: isUser ? "I miei turni" : "Turnazioni" },
    { id: "mensilita", label: "Mensilità" },
    ...(canTeam ? ([{ id: "convalide" as const, label: "Convalide" }] as const) : []),
    ...(canTeam ? ([{ id: "personale" as const, label: "Personale" }] as const) : []),
    ...(canTeam ? ([{ id: "report" as const, label: "Report" }] as const) : []),
    ...(canCollab ? ([{ id: "collaboratori" as const, label: "Collaboratori sportivi" }] as const) : []),
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
          <ThemeToggle compact />
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
        {data && tab === "anagrafica" && me && (
          <MiaAnagrafica
            data={data}
            me={me}
            onError={setError}
            onDone={() => {
              setError("")
              void qc.invalidateQueries({ queryKey: ["lpaga"] })
              void qc.invalidateQueries({ queryKey: ["lpaga-me"] })
            }}
          />
        )}
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
        {data && tab === "convalide" && canTeam && (
          <ConvalidePortal
            data={data}
            mese={mese}
            me={me}
            onDone={() => {
              setError("")
              void qc.invalidateQueries({ queryKey: ["lpaga"] })
            }}
          />
        )}
        {data && tab === "report" && canTeam && <LibroPagaReport data={data} />}
        {tab === "collaboratori" && canCollab ? <ReportCollaboratori source="lpaga" compact /> : null}
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

function MiaAnagrafica({
  data,
  me,
  onError,
  onDone,
}: {
  data: LpagaPortalSnapshot
  me: LpagaMe
  onError: (s: string) => void
  onDone: () => void
}) {
  const persona = data.personale.find((p) => p.id === me.id)
  const [email, setEmail] = useState(persona?.email ?? "")
  const [iban, setIban] = useState(persona?.iban ?? "")
  const [password, setPassword] = useState("")
  const [msg, setMsg] = useState("")
  useEffect(() => {
    setEmail(persona?.email ?? "")
    setIban(persona?.iban ?? "")
  }, [persona?.email, persona?.iban])
  const saveMut = useMutation({
    mutationFn: () =>
      lpagaApi.patchPersonale(me.id, {
        email: email.trim(),
        iban: iban.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
      }),
    onSuccess: () => {
      setPassword("")
      setMsg("Anagrafica aggiornata.")
      onDone()
    },
    onError: (e: Error) => {
      setMsg("")
      onError(e.message)
    },
  })
  if (!persona) {
    return <p className="mt-4 text-sm text-zinc-500">Anagrafica non disponibile.</p>
  }
  return (
    <div className="mt-4 max-w-4xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">La mia anagrafica</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Puoi aggiornare l’email di accesso e l’IBAN. I dati anagrafici del gestionale (STAFF) sono in sola lettura.
        </p>
      </div>
      <GestionaleAnagraficaBlock persona={persona} />
      <QualificheCorsiFields value={qualificheForDisplay(persona)} readOnly />
      <form
        className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          saveMut.mutate()
        }}
      >
        <p className="text-sm text-zinc-300">
          {persona.nominativo ?? `${persona.cognome ?? ""} ${persona.nome}`.trim()}
          {persona.repartoNome ? <span className="text-zinc-500"> · {persona.repartoNome}</span> : null}
        </p>
        <label className="grid gap-1 text-xs text-zinc-500">
          Email di accesso libro paga
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            autoComplete="email"
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          IBAN
          <input value={iban} onChange={(e) => setIban(e.target.value)} className={inputCls} autoComplete="off" />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Nuova password (vuoto = invariata)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            autoComplete="new-password"
            minLength={6}
          />
        </label>
        {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
        <div>
          <button type="submit" className={btnAmber} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Salvataggio…" : "Salva"}
          </button>
        </div>
      </form>
    </div>
  )
}

function Home({ data, me }: { data: LpagaPortalSnapshot; me?: LpagaMe }) {
  const h = data.home as typeof data.home & { mioOre?: number; mioImporto?: number; mioTurni?: number }
  const isUser = me?.ruolo === "user"
  const io = me ? data.personale.find((p) => p.id === me.id) : undefined
  return (
    <div className="mt-4 space-y-4">
      {io ? <QualificheCorsiFields value={qualificheForDisplay(io)} readOnly /> : null}
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
  const [nuovoTurno, setNuovoTurno] = useState(false)
  useEffect(() => {
    if (!canChangeDay) setGiorno(todayIso())
  }, [canChangeDay, mese])
  const personeItems = useMemo(
    () =>
      persone
        .slice()
        .sort(cmpNomeCognome)
        .map((p) => ({
          id: p.id,
          label: p.nominativo ?? `${p.cognome ?? ""} ${p.nome}`.trim(),
        })),
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
    onSuccess: () => {
      setNote("")
      setQuantita("1")
      setNuovoTurno(false)
      onDone()
    },
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
            {!isUser && (
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
            )}
            <label className="grid gap-1 text-xs text-zinc-400 sm:col-span-2">
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
            {isUser && (
              <p className="text-xs text-zinc-500 sm:col-span-2">
                Puoi inserire turni solo per oggi ({fmtDateIt(oggi)}), entro mezzanotte.
              </p>
            )}
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
  const [qualifiche, setQualifiche] = useState<QualificaConData[]>([])
  const [contratto, setContratto] = useState("")
  const [iban, setIban] = useState("")
  const [email, setEmail] = useState("")
  const [nuovoOpen, setNuovoOpen] = useState(false)
  const [pwdId, setPwdId] = useState<string | null>(null)
  const [pwdNew, setPwdNew] = useState("")
  const [q, setQ] = useState("")
  const [dettaglioId, setDettaglioId] = useState<string | null>(null)
  const createMut = useMutation({
    mutationFn: () =>
      lpagaApi.createPersonale({
        nome,
        cognome,
        username,
        password,
        ruolo: me?.ruolo === "manager" ? "user" : ruolo,
        livelloId: livelloId || (me?.ruolo === "manager" ? reparti[0]?.id : undefined) || me?.livelloId,
        ...(me?.ruolo === "admin"
          ? { qualifiche, visitaMedica: visitaMedicaFromQualifiche(qualifiche) }
          : {}),
        contratto,
        iban,
        email,
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
      setNuovoOpen(false)
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
  const delMut = useMutation({
    mutationFn: (id: string) => lpagaApi.deletePersonale(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const reparti =
    data.livelliAssegnabili?.length
      ? data.livelliAssegnabili
      : me?.ruolo === "admin"
        ? data.livelli.filter((l) => !l.retribuibile)
        : data.livelli.filter((l) => !l.retribuibile && l.id === me?.livelloId)
  const n = q.trim().toLowerCase()
  const personeFiltrate = data.personale
    .filter(
      (p) =>
        !n ||
        `${p.nominativo ?? ""} ${p.cognome ?? ""} ${p.nome} ${p.username ?? ""} ${p.repartoNome ?? ""}`
          .toLowerCase()
          .includes(n)
    )
    .sort(cmpRuoloNomeCognome)
  const detPersona = dettaglioId ? data.personale.find((p) => p.id === dettaglioId) : undefined
  const detMens = dettaglioId ? data.mensilita.find((m) => m.personaleId === dettaglioId) : undefined
  const detTurni = dettaglioId
    ? data.turni.filter((t) => t.personaleId === dettaglioId).sort((a, b) => b.giorno.localeCompare(a.giorno))
    : []
  const istruttoriDelega = data.personale
    .filter((p) => p.ruolo === "user" && p.id !== me?.id)
    .sort(cmpNomeCognome)
    .map((p) => ({ id: p.id, label: p.nominativo ?? `${p.cognome ?? ""} ${p.nome}`.trim() }))
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
          canEdit={me?.ruolo === "admin" || (me?.ruolo === "manager" && detPersona.ruolo !== "admin")}
          allowAdminRole={me?.ruolo === "admin"}
          livelli={data.livelli}
          onSavePersonale={(id, body) => lpagaApi.patchPersonale(id, body)}
          onError={onError}
          onDone={onDone}
        />
      )}
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
            {me?.ruolo === "admin" && (
              <label className="grid gap-1 text-xs text-zinc-500">
                Ruolo
                <select value={ruolo} onChange={(e) => setRuolo(e.target.value as "user" | "manager")} className={inputCls}>
                  <option value="user">Istruttore</option>
                  <option value="manager">Responsabile</option>
                </select>
              </label>
            )}
            <label className="grid gap-1 text-xs text-zinc-500">
              Reparto
              <select
                value={livelloId || (me?.ruolo === "manager" ? (reparti[0]?.id ?? "") : "")}
                onChange={(e) => setLivelloId(e.target.value)}
                className={inputCls}
                required={me?.ruolo === "admin"}
                disabled={me?.ruolo === "manager" && reparti.length <= 1}
              >
                {me?.ruolo === "admin" && <option value="">—</option>}
                {reparti.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.dominio && l.dominio !== l.nome ? `${l.dominio} · ${l.nome}` : l.nome}
                  </option>
                ))}
              </select>
            </label>
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
              Tesseramento ASI, certificato medico e anagrafica STAFF arrivano dal gestionale e non si modificano qui.
            </p>
            {me?.ruolo === "admin" ? (
              <QualificheCorsiFields value={qualifiche} onChange={setQualifiche} inputCls={inputCls} />
            ) : null}
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
          <button type="button" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300" onClick={() => setPwdId(null)}>
            Annulla
          </button>
        </form>
      )}
      <p className="text-xs text-zinc-500">{RUOLO_LEGENDA}</p>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Cognome</th>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Ruolo</th>
              <th className="px-3 py-2">Reparto</th>
              <th className="px-3 py-2">Visita medica</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {personeFiltrate.flatMap((p, i) => {
              const header =
                i === 0 || p.ruolo !== personeFiltrate[i - 1]?.ruolo ? (
                  <tr key={`ruolo-${p.ruolo}`} className="border-t border-zinc-800 bg-zinc-900/70">
                    <td className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400" colSpan={7}>
                      {ruoloLabel(p.ruolo)}
                    </td>
                  </tr>
                ) : null
              const row = (
                <tr key={p.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2">{p.nome}</td>
                  <td className="px-3 py-2">{p.cognome ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{p.username ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">{ruoloLabel(p.ruolo)}</td>
                  <td className="px-3 py-2">{p.repartoNome}</td>
                  <td className="px-3 py-2">{fmtDateIt(visitaMedicaFromQualifiche(qualificheForDisplay(p)))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="mr-2 text-xs text-zinc-300 hover:underline"
                      onClick={() => setDettaglioId(p.id)}
                    >
                      {me?.ruolo === "admin" || p.ruolo !== "admin" ? "Modifica" : "Dettaglio"}
                    </button>
                    {p.username && (me?.ruolo === "admin" || p.ruolo !== "admin") && (
                      <button
                        type="button"
                        className="mr-2 text-xs text-amber-300 hover:underline"
                        onClick={() => {
                          setPwdId(p.id)
                          setPwdNew("")
                        }}
                      >
                        Password
                      </button>
                    )}
                    {me?.ruolo === "admin" && p.id !== me.id ? (
                      <button
                        type="button"
                        className="text-xs text-red-400 hover:underline disabled:opacity-50"
                        disabled={delMut.isPending}
                        onClick={() => {
                          const nome = p.nominativo ?? `${p.cognome ?? ""} ${p.nome}`.trim()
                          if (!window.confirm(`Eliminare ${nome} dal libro paga? Vengono cancellati anche i suoi turni.`)) return
                          delMut.mutate(p.id)
                        }}
                      >
                        Elimina
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
              return header ? [header, row] : [row]
            })}
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

function ConvalidePortal({
  data,
  mese,
  me,
  onDone,
}: {
  data: LpagaPortalSnapshot
  mese: string
  me?: LpagaMe
  onDone: () => void
}) {
  const riep = data.convalideRiepilogo
  const responsabili = riep?.responsabili ?? data.convalide
  const onlyMine = me?.ruolo === "manager"
  const [meseOpen, setMeseOpen] = useState(false)
  const [filtri, setFiltri] = useState({ scope: "", from: "", to: "" })
  const [aperto, setAperto] = useState<string | null>(onlyMine ? responsabili[0]?.personaleId ?? null : null)
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>([])
  const convMese = useLibroPagaConvalidaMese(
    mese,
    meseOpen,
    (m) =>
      lpagaApi.getConvalidaMese(m, {
        scope: filtri.scope || undefined,
        from: filtri.from || undefined,
        to: filtri.to || undefined,
      }),
    `${filtri.scope}|${filtri.from}|${filtri.to}`
  )
  const nTurni = riep?.nTurni ?? data.turni.length
  const nConf = riep?.nConfermati ?? 0
  const nDaFare = riep?.nDaFare ?? 0
  const respSel = responsabili.find((r) => r.personaleId === aperto) ?? (onlyMine ? responsabili[0] : undefined)
  const turniVista = useMemo(() => {
    const roots = rootsFiltroTurniConvalide(respSel, selectedScopeIds)
    if (roots === null) return data.turni
    if (!roots.length) return onlyMine ? data.turni : []
    const ids = livelloAlberoUnionUi(data.livelli, roots)
    return data.turni.filter((t) => ids.has(t.livelloId))
  }, [data.turni, data.livelli, respSel, selectedScopeIds, onlyMine])
  const elencoHint = !respSel
    ? "Tutti i turni visibili. Clicca un responsabile, poi i sottoreparti per filtrare."
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
          onClose={() => setMeseOpen(false)}
          onSaveTurno={(body) => lpagaApi.putConvalidaTurno(body).then(onDone)}
          onConfermaAllineati={() =>
            lpagaApi
              .postConvalidaMese(mese, {
                scope: filtri.scope || undefined,
                from: filtri.from || undefined,
                to: filtri.to || undefined,
              })
              .then((r) => {
                onDone()
                return r
              })
          }
          onFiltriChange={(f) => setFiltri(f)}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-zinc-400">
          {onlyMine
            ? "Seleziona i sottoreparti per filtrare i turni in fondo. «Convalida questo ambito» apre il controllo."
            : "Clicca un responsabile per tutto il suo reparto, poi i sottoreparti per filtrare i turni."}
        </p>
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Turni">
          <p className="text-2xl font-semibold">{nTurni}</p>
        </Card>
        <Card title="Confermati">
          <p className="text-2xl font-semibold text-emerald-300">{nConf}</p>
        </Card>
        <Card title="Da fare">
          <p className="text-2xl font-semibold text-amber-300">{nDaFare}</p>
        </Card>
      </div>
      <Card title={onlyMine ? "I tuoi reparti" : "Responsabili"}>
        <LibroPagaConvalideLista
          responsabili={responsabili}
          onlyMine={onlyMine}
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
      <LibroPagaTurniConvalidaElenco turni={turniVista} title="Turni del mese" hint={elencoHint} />
    </div>
  )
}

function Mensilita({
  data,
  mese,
  me,
  onError,
  onDone,
  openConvalidaMese,
}: {
  data: LpagaPortalSnapshot
  mese: string
  me?: LpagaMe
  onError: (s: string) => void
  onDone: () => void
  openConvalidaMese?: boolean
}) {
  const canValidate = Boolean(data.canValidate) || me?.ruolo === "admin" || me?.ruolo === "manager"
  const [convId, setConvId] = useState<string | null>(null)
  const [meseOpen, setMeseOpen] = useState(Boolean(openConvalidaMese))
  const [filtri, setFiltri] = useState({ scope: "", from: "", to: "" })
  const conv = useLibroPagaConvalida(mese, canValidate ? convId : null, lpagaApi.getConvalida)
  const convMese = useLibroPagaConvalidaMese(
    mese,
    meseOpen && canValidate,
    (m) => lpagaApi.getConvalidaMese(m, { scope: filtri.scope || undefined, from: filtri.from || undefined, to: filtri.to || undefined }),
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
          onClose={() => setMeseOpen(false)}
          onSaveTurno={(body) => lpagaApi.putConvalidaTurno(body)}
          onConfermaAllineati={() =>
            lpagaApi.postConvalidaMese(mese, {
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
