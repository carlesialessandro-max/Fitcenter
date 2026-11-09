import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BrandLogo } from "@/components/BrandLogo"
import { CercaFiltroInput } from "@/components/CercaFiltroInput"
import { PwaInstallHint } from "@/components/PwaInstallHint"
import { lpagaApi, setLpagaToken, type LpagaMe, type LpagaPortalSnapshot } from "@/api/lpaga"
import { LibroPagaMensilitaTab, LibroPagaPersonaleDettaglio, GestionaleAnagraficaBlock } from "@/components/LibroPagaMensilita"
import { LibroPagaReport } from "@/components/LibroPagaReport"
import { LibroPagaLivelliTab } from "@/components/LibroPagaLivelli"
import { LibroPagaConvalidaMesePanel, LibroPagaConvalidaPanel, LibroPagaConvalideLista, LibroPagaMeseBloccoBanner, LibroPagaTurniConvalidaElenco, LibroPagaDelegheForm, rootsFiltroTurniConvalide, useLibroPagaConvalida, useLibroPagaConvalidaMese } from "@/components/LibroPagaConvalida"
import { LibroPagaAssegnazioniCampi, isRuoloConVisibilita, livelloAlberoUnionUi } from "@/components/LibroPagaRepartiMulti"
import { LpagaSearchSelect, MansioneSearchSelect } from "@/components/MansioneSearchSelect"
import { LibroPagaTurniTotaliReparto } from "@/components/LibroPagaTurniTotaliReparto"
import { LibroPagaSlot, QualificheCorsiFields, TesserinoTecnicoFields, tesserinoFromPersona, emptyTesserinoTecnico } from "@/components/LibroPagaSlot"
import { ThemeToggle } from "@/components/ThemeToggle"
import { qualificheForDisplay, visitaMedicaFromQualifiche, type QualificaConData } from "@/lib/personale-qualifiche"
import { ReportCollaboratori } from "@/pages/ReportCollaboratori"
import { LibroPagaMioCompenso } from "@/components/LibroPagaMioCompenso"
import { canVedereReportCollaboratoriLpaga } from "@/lib/report-collaboratori-access"
import { cmpNomeCognome, cmpRuoloNomeCognome, displayNomeCognome, normCerca, testoCercaTurno } from "@/lib/personale-sort"
import { isLpagaTeamRuolo, ruoloLabel, RUOLO_LEGENDA } from "@/lib/lpaga-ruolo"
import { calcolaImportoTurno, etichettaValoreTurno, messaggioQuantitaTurno } from "@/lib/libro-paga-quantita"
import { filtraAlberoLivelli, livelloIdsAssegnati, mansioniTurnoProprio } from "@/lib/libro-paga-livelli"
import {
  downloadLibroPagaTurniTemplate,
  parseLibroPagaTurniExcel,
  type ImportTurnoExcelPreview,
} from "@/lib/libro-paga-turni-excel"

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
  const [tab, setTab] = useState<
    | "home"
    | "anagrafica"
    | "area"
    | "livelli"
    | "turni"
    | "personale"
    | "mensilita"
    | "compensi"
    | "convalide"
    | "report"
    | "collaboratori"
  >("home")
  const [q, setQ] = useState("")
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
  const isAdmin = me?.ruolo === "admin"
  const canTeam = isLpagaTeamRuolo(me?.ruolo)
  const canCollab = canVedereReportCollaboratoriLpaga(me)
  const bloccoMut = useMutation({
    mutationFn: (bloccato: boolean) => lpagaApi.putMeseBlocco(mese, bloccato),
    onSuccess: () => {
      setError("")
      void qc.invalidateQueries({ queryKey: ["lpaga"] })
    },
    onError: (e: Error) => setError(e.message),
  })

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
    { id: "area", label: "Area personale" },
    ...(isAdmin ? ([{ id: "livelli" as const, label: "Livelli" }] as const) : []),
    ...(!isUser ? ([{ id: "turni" as const, label: "Turnazioni" }] as const) : []),
    { id: "mensilita", label: "Mensilità" },
    ...(!canCollab ? ([{ id: "compensi" as const, label: "Compensi anno" }] as const) : []),
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
        {data ? (
          <LibroPagaMeseBloccoBanner
            blocco={data.meseBlocco}
            isAdmin={isAdmin}
            canBloccare={canTeam}
            pending={bloccoMut.isPending}
            onBlocca={() => {
              if (window.confirm("Chiudere il mese? Istruttori e responsabili non potranno più inserire o modificare turni.")) {
                bloccoMut.mutate(true)
              }
            }}
            onSblocca={() => {
              if (window.confirm("Sbloccare il mese? Tornerà possibile inserire e modificare i turni.")) {
                bloccoMut.mutate(false)
              }
            }}
          />
        ) : null}
        {snap.isLoading && <p className="mt-4 text-sm text-zinc-500">Caricamento…</p>}
        {snap.isError && <p className="mt-4 text-sm text-red-400">{(snap.error as Error).message}</p>}
        {data && tab === "home" && <Home data={data} me={me} />}
        {data && tab === "livelli" && canTeam && me && (
          <LibroPagaLivelliTab
            data={
              isAdmin
                ? data
                : (() => {
                    const persona = data.personale.find((p) => p.id === me.id) ?? me
                    const allowed = livelloIdsAssegnati(persona, data.livelli)
                    return {
                      ...data,
                      livelli: data.livelli.filter((l) => allowed.has(l.id)),
                      tree: filtraAlberoLivelli(data.tree, allowed),
                    }
                  })()
            }
            q={q}
            setQ={setQ}
            onError={setError}
            onDone={() => {
              setError("")
              void qc.invalidateQueries({ queryKey: ["lpaga"] })
            }}
            createLivello={(body) => lpagaApi.createLivello(body)}
            patchLivello={(id, body) => lpagaApi.patchLivello(id, body)}
            deleteLivello={(id) => lpagaApi.deleteLivello(id)}
            showTreeDefault
            canCreateRoot={isAdmin}
          />
        )}
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
        {data && tab === "area" && me && (
          <AreaPersonale
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
        {data && tab === "turni" && !isUser && (
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
        {tab === "compensi" && !canCollab ? <LibroPagaMioCompenso /> : null}
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
  const [tesserino, setTesserino] = useState(() => tesserinoFromPersona(persona))
  const [password, setPassword] = useState("")
  const [msg, setMsg] = useState("")
  useEffect(() => {
    setEmail(persona?.email ?? "")
    setIban(persona?.iban ?? "")
    setTesserino(tesserinoFromPersona(persona))
  }, [persona])
  const saveMut = useMutation({
    mutationFn: () =>
      lpagaApi.patchPersonale(me.id, {
        email: email.trim(),
        iban: iban.trim(),
        tesserinoTecnico: tesserino,
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
          Puoi aggiornare l’email di accesso, l’IBAN e i dati del tesserino tecnico. I dati anagrafici del gestionale
          (STAFF) sono in sola lettura.
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
        <TesserinoTecnicoFields
          value={tesserino}
          onChange={setTesserino}
          inputCls={inputCls}
          dataNascita={persona.gestionale?.dataNascita}
        />
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
      {io && isUser ? <QualificheCorsiFields value={qualificheForDisplay(io)} readOnly /> : null}
      {isUser && data.canValidate && (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-200/90">
          Hai la delega per convalidare le mensilità del reparto: apri Mensilità e premi Convalida.
        </p>
      )}
      {isUser ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
          Per gli importi di tutto l’anno e la soglia dei 5.000 € apri la scheda Compensi anno. Puoi anche inserire i
          compensi di altre aziende. Vedi solo i tuoi dati.
        </p>
      ) : null}
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

function AreaPersonale({
  data,
  me,
  mese,
  onError,
  onDone,
}: {
  data: LpagaPortalSnapshot
  me: LpagaMe
  mese: string
  onError: (s: string) => void
  onDone: () => void
}) {
  const persona = data.personale.find((p) => p.id === me.id)
  const mens = data.mensilita.find((r) => r.personaleId === me.id)
  const canChangeDay = isLpagaTeamRuolo(me.ruolo)
  const turniBloccati = Boolean(data.meseBlocco?.bloccato) && me.ruolo !== "admin"
  const oggi = todayIso()
  const livelli = mansioniTurnoProprio(
    persona ?? me,
    data.livelliInseribili?.length ? data.livelliInseribili : data.livelli.filter((l) => l.retribuibile),
    data.livelli
  )
  const preferito =
    livelli.find((l) => l.id === me.livelloId) ??
    livelli.find((l) => (me.livelloIds ?? []).includes(l.id)) ??
    livelli[0]
  const [livelloId, setLivelloId] = useState(preferito?.id ?? "")
  const [giorno, setGiorno] = useState(oggi)
  const [quantita, setQuantita] = useState("1")
  const [note, setNote] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  useEffect(() => {
    if (!canChangeDay) setGiorno(todayIso())
  }, [canChangeDay, mese])
  function resetForm() {
    setEditingId(null)
    setNote("")
    setQuantita("1")
    setGiorno(oggi)
    setLivelloId(preferito?.id ?? "")
  }
  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        personaleId: me.id,
        livelloId,
        giorno: canChangeDay ? giorno : oggi,
        quantita: Number(quantita.replace(",", ".")),
        note,
      }
      return editingId ? lpagaApi.patchTurno(editingId, body) : lpagaApi.createTurno(body)
    },
    onSuccess: () => {
      resetForm()
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => lpagaApi.deleteTurno(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const livelloSel = livelli.find((l) => l.id === livelloId)
  const valoreUi = etichettaValoreTurno(livelloSel)
  const quantitaNum = Number(quantita.replace(",", "."))
  const quantitaErr = livelloSel && quantita.trim() ? messaggioQuantitaTurno(livelloSel, quantitaNum) : null
  const importoAnteprima =
    livelloSel && quantitaErr == null && Number.isFinite(quantitaNum) && quantitaNum > 0
      ? calcolaImportoTurno(livelloSel, quantitaNum)
      : null
  const mieiTurni = useMemo(
    () =>
      data.turni
        .filter((t) => t.personaleId === me.id)
        .slice()
        .sort((a, b) => b.giorno.localeCompare(a.giorno)),
    [data.turni, me.id]
  )
  const info: { k: string; v: string }[] = [
    { k: "Cognome", v: persona?.cognome || me.cognome || "" },
    { k: "Nome", v: persona?.nome || me.nome },
    { k: "Username", v: me.username },
    { k: "Ruolo", v: ruoloLabel(me.ruolo) },
    { k: `Tot. progr. ${mese.slice(0, 4)}`, v: eur(mens?.totAnno ?? mens?.importo ?? 0) },
    { k: "Scad. contratto", v: fmtDateIt(persona?.contratto) },
    { k: "Iban", v: persona?.iban || "—" },
  ]
  return (
    <div className="mt-4 max-w-3xl space-y-4">
      <Card title="Informazioni utente">
        <dl className="grid gap-y-1.5 text-sm sm:grid-cols-2 sm:gap-x-8">
          {info.map((r) => (
            <div key={r.k} className="flex justify-between gap-4 sm:justify-start sm:gap-6">
              <dt className="text-zinc-500">{r.k}</dt>
              <dd className="text-zinc-100">{r.v.trim() ? r.v : "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {turniBloccati ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
          Mese chiuso dopo le convalide: non puoi più inserire o modificare turni.
        </p>
      ) : (
      <LibroPagaSlot title={editingId ? "Modifica turno di lavoro" : "Nuovo turno di lavoro"}>
        <p className="mb-3 text-xs text-zinc-500">
          {isLpagaTeamRuolo(me.ruolo)
            ? "Qui inserisci solo i tuoi corsi da istruttore. I turni del team restano in Turnazioni."
            : "I turni che inserisci qui sono i tuoi, senza cercare il nominativo."}
        </p>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (quantitaErr) {
              onError(quantitaErr)
              return
            }
            onError("")
            saveMut.mutate()
          }}
        >
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
              required
            />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400 sm:col-span-2">
            <span>Mansione</span>
            <MansioneSearchSelect items={livelli} value={livelloId} onChange={setLivelloId} required />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            <span>{valoreUi.label}</span>
            <input value={quantita} onChange={(e) => setQuantita(e.target.value)} className={inputCls} inputMode="decimal" required />
            <span className="text-[11px] text-zinc-500">{valoreUi.hint}</span>
            {quantitaErr ? <span className="text-[11px] text-red-400">{quantitaErr}</span> : null}
            {importoAnteprima != null ? (
              <span className="text-[11px] text-zinc-300">Importo {eur(importoAnteprima)}</span>
            ) : null}
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
          {!canChangeDay ? (
            <p className="text-xs text-zinc-500 sm:col-span-2">
              Puoi inserire turni solo per oggi ({fmtDateIt(oggi)}), entro mezzanotte.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {editingId ? (
              <button type="button" className={btnGhost} onClick={resetForm}>
                Annulla
              </button>
            ) : null}
            <button type="submit" className={btnAmber} disabled={saveMut.isPending || Boolean(quantitaErr) || !livelloId}>
              {saveMut.isPending ? "Salvataggio…" : editingId ? "Salva modifiche" : "Salva turno"}
            </button>
          </div>
        </form>
      </LibroPagaSlot>
      )}
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Mansione</th>
              <th className="px-3 py-2 text-right">Valore</th>
              <th className="px-3 py-2 text-right">Importo</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {mieiTurni.map((t) => (
              <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(t.giorno)}</td>
                <td className="px-3 py-2">{t.livelloNome}</td>
                <td className="px-3 py-2 text-right">{t.quantita}</td>
                <td className="px-3 py-2 text-right">{eur(t.importo)}</td>
                <td className="px-3 py-2 text-zinc-400">{t.note ?? ""}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-3">
                    {canChangeDay && !turniBloccati && (
                      <button
                        type="button"
                        className="text-xs text-amber-300 hover:underline"
                        onClick={() => {
                          setEditingId(t.id)
                          setLivelloId(t.livelloId)
                          setGiorno(t.giorno.slice(0, 10))
                          setQuantita(String(t.quantita))
                          setNote(t.note ?? "")
                        }}
                      >
                        Modifica
                      </button>
                    )}
                    {!turniBloccati && (canChangeDay || t.giorno === oggi) && (
                      <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => delMut.mutate(t.id)}>
                        Elimina
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!mieiTurni.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={6}>
                  Nessun turno tuo in questo mese.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
  const canChangeDay = isLpagaTeamRuolo(me?.ruolo)
  const turniBloccati = Boolean(data.meseBlocco?.bloccato) && me?.ruolo !== "admin"
  const oggi = todayIso()
  const persone = data.personale.filter((p) => p.attivo)
  const livelli = data.livelliInseribili?.length ? data.livelliInseribili : data.livelli.filter((l) => l.retribuibile)
  const [personaleId, setPersonaleId] = useState(isUser ? me?.id ?? "" : "")
  const [livelloId, setLivelloId] = useState(livelli[0]?.id ?? "")
  const [giorno, setGiorno] = useState(oggi)
  const [quantita, setQuantita] = useState("1")
  const [note, setNote] = useState("")
  const [cercaTurni, setCercaTurni] = useState("")
  const [cercaData, setCercaData] = useState("")
  const [filtroPersonaleId, setFiltroPersonaleId] = useState("")
  const [nuovoTurno, setNuovoTurno] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ImportTurnoExcelPreview[] | null>(null)
  const [importMessage, setImportMessage] = useState("")
  const [importHasErrors, setImportHasErrors] = useState(false)
  const canImport = isLpagaTeamRuolo(me?.ruolo)
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
  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        personaleId: isUser ? me!.id : personaleId,
        livelloId,
        giorno: canChangeDay ? giorno : todayIso(),
        quantita: Number(quantita.replace(",", ".")),
        note,
      }
      return editingId ? lpagaApi.patchTurno(editingId, body) : lpagaApi.createTurno(body)
    },
    onSuccess: () => {
      setNote("")
      setQuantita("1")
      setEditingId(null)
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
  const importTurniMut = useMutation({
    mutationFn: (righe: ImportTurnoExcelPreview[]) =>
      lpagaApi.importTurniExcel(
        righe.flatMap((row) =>
          !row.errore && !row.duplicato && row.personaleId && row.livelloId
            ? [{
                riga: row.riga,
                personaleId: row.personaleId,
                livelloId: row.livelloId,
                giorno: row.giorno,
                quantita: row.quantita,
                note: row.note,
              }]
            : []
        )
      ),
    onSuccess: (result) => {
      const summary =
        `Importati ${result.inseriti} turni` +
        (result.saltati ? `, ${result.saltati} duplicati saltati` : "") +
        (result.errori.length ? `, ${result.errori.length} righe con errori` : "") +
        "."
      setImportMessage(
        result.errori.length
          ? `${summary} ${result.errori.map((error) => `Riga ${error.riga}: ${error.message}`).join(" ")}`
          : summary
      )
      setImportHasErrors(result.errori.length > 0)
      setImportPreview(null)
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const importValidRows = (importPreview ?? []).filter((row) => !row.errore && !row.duplicato)
  const livelloSel = livelli.find((l) => l.id === livelloId)
  const valoreUi = etichettaValoreTurno(livelloSel)
  const quantitaNum = Number(quantita.replace(",", "."))
  const quantitaErr = livelloSel && quantita.trim() ? messaggioQuantitaTurno(livelloSel, quantitaNum) : null
  const importoAnteprima =
    livelloSel && quantitaErr == null && Number.isFinite(quantitaNum) && quantitaNum > 0
      ? calcolaImportoTurno(livelloSel, quantitaNum)
      : null
  async function onTurniExcel(file: File | null) {
    if (!file) return
    onError("")
    setImportMessage("")
    setImportHasErrors(false)
    try {
      const buffer = await file.arrayBuffer()
      setImportPreview(parseLibroPagaTurniExcel(buffer, data.personale, data.livelliInseribili, data.turni))
    } catch (e) {
      setImportPreview(null)
      onError((e as Error).message || "File Excel non leggibile")
    }
  }
  const filtroItems = useMemo(
    () => [{ id: "", label: "Tutti i nominativi" }, ...personeItems],
    [personeItems]
  )
  const turniNominativo = useMemo(() => {
    if (isUser) return data.turni.filter((t) => t.personaleId === me?.id)
    if (filtroPersonaleId) return data.turni.filter((t) => t.personaleId === filtroPersonaleId)
    return data.turni
  }, [data.turni, filtroPersonaleId, isUser, me?.id])
  const rows = useMemo(() => {
    const n = normCerca(cercaTurni)
    const personeById = new Map(data.personale.map((p) => [p.id, p]))
    return [...turniNominativo]
      .filter((t) => {
        if (cercaData && t.giorno.slice(0, 10) !== cercaData) return false
        if (!n) return true
        const hay = normCerca(testoCercaTurno(t, personeById.get(t.personaleId)))
        return hay.includes(n) || fmtDateIt(t.giorno).includes(cercaTurni.trim())
      })
      .sort((a, b) => b.giorno.localeCompare(a.giorno))
  }, [turniNominativo, data.personale, cercaTurni, cercaData])

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {!nuovoTurno && !turniBloccati && (
          <button type="button" className={btnGhost} onClick={() => setNuovoTurno(true)}>
            + Aggiungi turno di lavoro
          </button>
        )}
        {canImport && !turniBloccati && (
          <>
            <button type="button" className={btnGhost} onClick={downloadLibroPagaTurniTemplate}>
              Modello Excel turni
            </button>
            <label className={`${btnAmber} cursor-pointer ${importTurniMut.isPending ? "pointer-events-none opacity-50" : ""}`}>
              {importTurniMut.isPending ? "Importazioneâ€¦" : "Importa turni da Excel"}
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={importTurniMut.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  e.target.value = ""
                  void onTurniExcel(file)
                }}
              />
            </label>
          </>
        )}
      </div>
      {canImport && !turniBloccati && (
        <>
          <p className="text-xs text-zinc-500">
            Importazione Excel disponibile per amministratori, responsabili e coordinatori; ognuno importa solo per il personale e le mansioni del proprio ambito.
          </p>
          {importMessage && (
            <p className={`text-sm ${importHasErrors ? "text-amber-300" : "text-emerald-300"}`}>{importMessage}</p>
          )}
          {importPreview && (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-zinc-300">
                  Anteprima: {importValidRows.length} da importare, {importPreview.filter((row) => row.duplicato).length} duplicati,{" "}
                  {importPreview.filter((row) => row.errore).length} con errori.
                </p>
                <div className="flex gap-2">
                  <button type="button" className={btnGhost} onClick={() => setImportPreview(null)}>
                    Annulla
                  </button>
                  <button
                    type="button"
                    className={btnAmber}
                    disabled={!importValidRows.length || importTurniMut.isPending}
                    onClick={() => importTurniMut.mutate(importPreview)}
                  >
                    {importTurniMut.isPending ? "Importazioneâ€¦" : `Importa ${importValidRows.length} turni`}
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-auto rounded-lg border border-zinc-800">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                    <tr>
                      <th className="px-2 py-1">Riga</th>
                      <th className="px-2 py-1">Data</th>
                      <th className="px-2 py-1">Collaboratore</th>
                      <th className="px-2 py-1">Mansione</th>
                      <th className="px-2 py-1 text-right">QuantitÃ </th>
                      <th className="px-2 py-1">Note / esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.map((row) => (
                      <tr
                        key={row.riga}
                        className={`border-t border-zinc-800 ${row.errore ? "text-red-300" : row.duplicato ? "text-amber-300" : "text-zinc-200"}`}
                      >
                        <td className="px-2 py-1">{row.riga}</td>
                        <td className="px-2 py-1">{row.giorno ? fmtDateIt(row.giorno) : "â€”"}</td>
                        <td className="px-2 py-1">{row.personale || "â€”"}</td>
                        <td className="px-2 py-1">{row.mansione || "â€”"}</td>
                        <td className="px-2 py-1 text-right">{Number.isFinite(row.quantita) ? row.quantita : "â€”"}</td>
                        <td className="px-2 py-1">{row.errore || (row.duplicato ? "Duplicato: verrÃ  saltato" : row.note || "ok")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {nuovoTurno && !turniBloccati && (
        <LibroPagaSlot title={editingId ? "Modifica turno di lavoro" : "Nuovo turno di lavoro"}>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (quantitaErr) {
                onError(quantitaErr)
                return
              }
              onError("")
              saveMut.mutate()
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
              <span>{valoreUi.label}</span>
              <input value={quantita} onChange={(e) => setQuantita(e.target.value)} className={inputCls} inputMode="decimal" required />
              <span className="text-[11px] text-zinc-500">{valoreUi.hint}</span>
              {quantitaErr ? <span className="text-[11px] text-red-400">{quantitaErr}</span> : null}
              {importoAnteprima != null ? (
                <span className="text-[11px] text-zinc-300">Importo {eur(importoAnteprima)}</span>
              ) : null}
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
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setNuovoTurno(false)
                  setEditingId(null)
                }}
              >
                Annulla
              </button>
              <button type="submit" className={btnAmber} disabled={saveMut.isPending || Boolean(quantitaErr)}>
                {saveMut.isPending ? "Salvataggio…" : editingId ? "Salva modifiche" : "Salva"}
              </button>
            </div>
          </form>
        </LibroPagaSlot>
      )}
      {!isUser && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-[16rem] max-w-md flex-1 gap-1 text-xs text-zinc-400">
              <span>Nominativo</span>
              <LpagaSearchSelect
                items={filtroItems}
                value={filtroPersonaleId}
                onChange={setFiltroPersonaleId}
                placeholder="Tutti i nominativi"
              />
            </label>
          </div>
          <LibroPagaTurniTotaliReparto turni={turniNominativo} mese={mese} />
        </>
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
        {(cercaTurni || cercaData || filtroPersonaleId) && (
          <button
            type="button"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
            onClick={() => {
              setCercaTurni("")
              setCercaData("")
              setFiltroPersonaleId("")
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
                  <div className="flex justify-end gap-3">
                    {canChangeDay && !turniBloccati && (
                      <button
                        type="button"
                        className="text-xs text-amber-300 hover:underline"
                        onClick={() => {
                          setEditingId(t.id)
                          setPersonaleId(t.personaleId)
                          setLivelloId(t.livelloId)
                          setGiorno(t.giorno.slice(0, 10))
                          setQuantita(String(t.quantita))
                          setNote(t.note ?? "")
                          setNuovoTurno(true)
                        }}
                      >
                        Modifica
                      </button>
                    )}
                    {!turniBloccati && (!isUser || t.giorno === oggi) && (
                      <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => delMut.mutate(t.id)}>
                        Elimina
                      </button>
                    )}
                  </div>
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
  const [ruolo, setRuolo] = useState<"user" | "manager" | "coordinator">("user")
  const [livelloIds, setLivelloIds] = useState<string[]>([])
  const [repartoIds, setRepartoIds] = useState<string[]>([])
  const [qualifiche, setQualifiche] = useState<QualificaConData[]>([])
  const [contratto, setContratto] = useState("")
  const [iban, setIban] = useState("")
  const [email, setEmail] = useState("")
  const [tesserino, setTesserino] = useState(() => emptyTesserinoTecnico())
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
        ruolo: me?.ruolo === "manager" || me?.ruolo === "coordinator" ? "user" : ruolo,
        livelloIds,
        livelloId: livelloIds[0] ?? "",
        ...(me?.ruolo === "admin" && isRuoloConVisibilita(ruolo) ? { repartoIds } : {}),
        ...(me?.ruolo === "admin"
          ? { qualifiche, visitaMedica: visitaMedicaFromQualifiche(qualifiche) }
          : {}),
        contratto,
        iban,
        email,
        tesserinoTecnico: tesserino,
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
      setTesserino(emptyTesserinoTecnico())
      setLivelloIds([])
      setRepartoIds([])
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
  const personeFiltrate = useMemo(() => {
    const n = q.trim().toLowerCase()
    const list = n
      ? data.personale.filter((p) =>
          `${p.nominativo ?? ""} ${p.cognome ?? ""} ${p.nome} ${p.username ?? ""} ${p.repartoNome ?? ""} ${p.mansioniNome ?? ""}`
            .toLowerCase()
            .includes(n)
        )
      : data.personale
    return list.slice().sort(cmpRuoloNomeCognome)
  }, [data.personale, q])
  const detPersona = dettaglioId ? data.personale.find((p) => p.id === dettaglioId) : undefined
  const detMens = dettaglioId ? data.mensilita.find((m) => m.personaleId === dettaglioId) : undefined
  const detTurni = dettaglioId
    ? data.turni.filter((t) => t.personaleId === dettaglioId).sort((a, b) => b.giorno.localeCompare(a.giorno))
    : []
  const istruttoriDelega = useMemo(
    () =>
      data.personale
        .filter((p) => p.ruolo === "user" && p.id !== me?.id)
        .sort(cmpNomeCognome)
        .map((p) => ({ id: p.id, label: p.nominativo ?? `${p.cognome ?? ""} ${p.nome}`.trim() })),
    [data.personale, me?.id]
  )
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
      <CercaFiltroInput value={q} onChange={setQ} placeholder="Cerca personale…" className={inputCls} />
      {detPersona && (
        <LibroPagaPersonaleDettaglio
          persona={detPersona}
          mese={mese}
          mensilita={detMens}
          lezioni={detTurni}
          onClose={() => {
            onError("")
            setDettaglioId(null)
          }}
          canEdit={
            me?.ruolo === "admin" ||
            (me?.ruolo === "manager" && detPersona.ruolo !== "admin") ||
            (me?.ruolo === "coordinator" && detPersona.ruolo === "user")
          }
          allowAdminRole={me?.ruolo === "admin"}
          livelli={
            me?.ruolo === "admin"
              ? data.livelli
              : data.livelliAssegnabili?.length
                ? data.livelliAssegnabili
                : []
          }
          alberoLivelli={data.livelli}
          onSavePersonale={(id, body) => lpagaApi.patchPersonale(id, body)}
          onError={onError}
          onDone={onDone}
          canEditTurni={isLpagaTeamRuolo(me?.ruolo) && (me?.ruolo === "admin" || !data.meseBlocco?.bloccato)}
          livelliTurno={data.livelliInseribili?.length ? data.livelliInseribili : data.livelli.filter((l) => l.retribuibile)}
          onCreateTurno={(body) => lpagaApi.createTurno(body)}
          onPatchTurno={(id, body) => lpagaApi.patchTurno(id, body)}
          onDeleteTurno={(id) => lpagaApi.deleteTurno(id)}
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
                <select value={ruolo} onChange={(e) => setRuolo(e.target.value as "user" | "manager" | "coordinator")} className={inputCls}>
                  <option value="user">Istruttore</option>
                  <option value="coordinator">Coordinatore</option>
                  <option value="manager">Responsabile</option>
                </select>
              </label>
            )}
            {me?.ruolo === "admin" && isRuoloConVisibilita(ruolo) ? (
              <p className="text-[11px] leading-snug text-zinc-500 sm:col-span-2">
                Coordinatore e responsabile restano anche istruttori: sotto i reparti che vedono e, a parte, i corsi che insegnano. Non serve un secondo utente.
              </p>
            ) : null}
            <LibroPagaAssegnazioniCampi
              ruolo={me?.ruolo === "admin" ? ruolo : "user"}
              showVisibilita={me?.ruolo === "admin" && isRuoloConVisibilita(ruolo)}
              livelli={
                me?.ruolo === "admin"
                  ? data.livelli
                  : data.livelliAssegnabili?.length
                    ? data.livelliAssegnabili
                    : reparti
              }
              albero={data.livelli}
              livelloIds={livelloIds}
              onLivelloIds={setLivelloIds}
              repartoIds={repartoIds}
              onRepartoIds={setRepartoIds}
            />
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
              Il tesserino tecnico si inserisce qui e lo può aggiornare anche l’istruttore.
            </p>
            <TesserinoTecnicoFields value={tesserino} onChange={setTesserino} inputCls={inputCls} />
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
              <th className="px-3 py-2">Reparti che vede</th>
              <th className="px-3 py-2">Corsi da istruttore</th>
              <th className="px-3 py-2">Visita medica</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {personeFiltrate.flatMap((p, i) => {
              const header =
                i === 0 || p.ruolo !== personeFiltrate[i - 1]?.ruolo ? (
                  <tr key={`ruolo-${p.ruolo}`} className="border-t border-zinc-800 bg-zinc-900/70">
                    <td className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400" colSpan={8}>
                      {ruoloLabel(p.ruolo)}
                    </td>
                  </tr>
                ) : null
              const { nome: nomeVis, cognome: cognomeVis } = displayNomeCognome(p)
              const row = (
                <tr key={p.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2">{nomeVis || "—"}</td>
                  <td className="px-3 py-2">{cognomeVis || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{p.username ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">{ruoloLabel(p.ruolo)}</td>
                  <td className="max-w-[16rem] px-3 py-2 text-xs leading-snug text-zinc-300">
                    {p.ruolo === "manager" || p.ruolo === "coordinator" ? p.repartoNome : "—"}
                  </td>
                  <td className="max-w-[20rem] px-3 py-2 text-xs leading-snug text-zinc-300">{p.mansioniNome ?? "—"}</td>
                  <td className="px-3 py-2">{fmtDateIt(visitaMedicaFromQualifiche(qualificheForDisplay(p)))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="mr-2 text-xs text-zinc-300 hover:underline"
                      onClick={() => {
                        onError("")
                        setDettaglioId(p.id)
                      }}
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
  const onlyMine = me?.ruolo === "manager" || me?.ruolo === "coordinator"
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
    const roots = rootsFiltroTurniConvalide(respSel, selectedScopeIds, { onlyMine })
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
          readOnly={Boolean(data.meseBlocco?.bloccato) && me?.ruolo !== "admin"}
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
          Cruscotto: qui vedi lo stato, senza modificare i turni. Per confermare usa «Controlla calendario» (Ok / Sostituzione / Non svolta).
          Quando tutti i turni del mese sono confermati, il mese si chiude da solo.
        </p>
        <button
          type="button"
          className={btnAmber}
          onClick={() => {
            setFiltri((f) => ({ ...f, scope: "" }))
            setMeseOpen(true)
          }}
        >
          Controlla calendario
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
  const canValidate = Boolean(data.canValidate) || isLpagaTeamRuolo(me?.ruolo)
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
          readOnly={Boolean(data.meseBlocco?.bloccato) && me?.ruolo !== "admin"}
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
          readOnly={Boolean(data.meseBlocco?.bloccato) && me?.ruolo !== "admin"}
          onClose={() => setConvId(null)}
          onSaveTurno={(body) => lpagaApi.putConvalidaTurno(body)}
          onChiudiMese={
            row
              ? () =>
                  lpagaApi.putMensilita({
                    personaleId: row.personaleId,
                    mese,
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
        canEdit={() => isLpagaTeamRuolo(me?.ruolo) || Boolean(data.canValidate)}
        hideIban={me?.ruolo === "user"}
        perimetroReparto={me?.ruolo === "manager" || me?.ruolo === "coordinator"}
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
        canEditTurni={isLpagaTeamRuolo(me?.ruolo) && (me?.ruolo === "admin" || !data.meseBlocco?.bloccato)}
        livelliTurno={data.livelliInseribili?.length ? data.livelliInseribili : data.livelli.filter((l) => l.retribuibile)}
        onCreateTurno={(body) => lpagaApi.createTurno(body)}
        onPatchTurno={(id, body) => lpagaApi.patchTurno(id, body)}
        onDeleteTurno={(id) => lpagaApi.deleteTurno(id)}
        notaImporti={
          me?.ruolo === "user"
            ? " Per gli importi di tutto l’anno e la soglia dei 5.000 € apri Compensi anno."
            : undefined
        }
      />
    </div>
  )
}
