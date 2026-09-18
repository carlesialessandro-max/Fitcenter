import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lezioniPrivateApi, type LpLezioneFlat, type LpRichiesta, type VascaId } from "@/api/lezioniPrivate"
import { useAuth } from "@/contexts/AuthContext"
import { fmtDateIt, isoToday, monthRangeFromDay } from "@/pages/Corsi"
import { weekMondaySunday } from "@/lib/tabella-oraria"

type Tab = "richieste" | "calendario" | "istruttori"
type Periodo = "giorno" | "settimana" | "mese"

const DOW_IT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"]
const VASCA_LABEL: Record<VascaId, string> = { v25: "25 m (1 corsia)", ludica: "Ludica 18 m" }

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function LezioniPrivate() {
  const { role, user } = useAuth()
  const enabled =
    role === "admin" || role === "scuola_nuoto" || role === "istruttore" || role === "operatore" || role === "firme"
  const canDesk = role === "admin" || role === "scuola_nuoto" || role === "operatore" || role === "firme"
  const canRoster = role === "admin" || role === "scuola_nuoto"
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>("richieste")
  const [day, setDay] = useState(() => isoToday())
  const [periodo, setPeriodo] = useState<Periodo>("giorno")
  const [prendiId, setPrendiId] = useState<string | null>(null)
  const [packId, setPackId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ["lezioni-private"],
    queryFn: () => lezioniPrivateApi.getAll(),
    enabled,
    staleTime: 8_000,
  })

  const week = useMemo(() => weekMondaySunday(day), [day])
  const month = useMemo(() => monthRangeFromDay(day), [day])
  const calRange = periodo === "giorno" ? { from: day, to: day } : periodo === "settimana" ? { from: week.from, to: week.to } : { from: month.from, to: month.to }

  const occQ = useQuery({
    queryKey: ["lezioni-private-occ", calRange.from, calRange.to],
    queryFn: () => lezioniPrivateApi.occupazione(calRange.from, calRange.to),
    enabled,
    staleTime: 8_000,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["lezioni-private"] })
    void qc.invalidateQueries({ queryKey: ["lezioni-private-occ"] })
  }

  if (!enabled) return <div className="p-6 text-red-400">Permessi insufficienti.</div>

  const instructors = q.data?.instructors ?? []
  const richieste = q.data?.richieste ?? []
  const lezioni = q.data?.lezioni ?? []
  const ore = occQ.data?.ore ?? q.data?.ore ?? []
  const booked = occQ.data?.booked ?? []

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Lezioni private acqua</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Come il foglio richieste: nuova richiesta → WhatsApp agli istruttori. Chi prende in carico sceglie vasca e
            corsia libera (prova, poi pacchetto 5 o 10).
          </p>
        </div>
        <div className="flex rounded-lg border border-zinc-700 bg-zinc-900/50 p-0.5">
          {(
            [
              ["richieste", "Richieste"],
              ["calendario", "Calendario vasche"],
              ["istruttori", "Istruttori / regole"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:bg-zinc-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {q.isError ? <p className="mt-3 text-sm text-red-400">{String((q.error as Error).message)}</p> : null}

      {tab === "richieste" ? (
        <RichiesteTab
          canDesk={canDesk}
          instructors={instructors}
          richieste={richieste}
          lezioni={lezioni}
          userNome={user?.nome ?? ""}
          prendiId={prendiId}
          setPrendiId={setPrendiId}
          packId={packId}
          setPackId={setPackId}
          onDone={invalidate}
        />
      ) : null}

      {tab === "calendario" ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex rounded-lg border border-zinc-700 bg-zinc-900/50 p-0.5">
              {(
                [
                  ["giorno", "Giorno"],
                  ["settimana", "Settimana"],
                  ["mese", "Mese"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPeriodo(id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${periodo === id ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:bg-zinc-800"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {periodo === "mese" ? (
              <input
                type="month"
                value={day.slice(0, 7)}
                onChange={(e) => e.target.value && setDay(`${e.target.value}-01`)}
                className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
              />
            ) : (
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
              />
            )}
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Vasca 25 m: 1 corsia · Ludica 18 m: fino a 2 corsie. Le regole per giorno si impostano in Istruttori / regole.
          </p>
          {periodo === "mese" ? (
            <MeseGrid byDay={occQ.data?.byDay ?? {}} from={month.from} to={month.to} />
          ) : (
            <DayWeekGrid
              days={periodo === "giorno" ? [day] : week.days}
              ore={ore}
              regole={occQ.data?.regole ?? q.data?.regole ?? {}}
              booked={booked}
              onCancel={(id, chi) => {
                void lezioniPrivateApi.patchLezione(id, chi).then(invalidate)
              }}
            />
          )}
        </div>
      ) : null}

      {tab === "istruttori" ? (
        <IstruttoriTab canRoster={canRoster} instructors={instructors} regole={q.data?.regole ?? {}} onDone={invalidate} />
      ) : null}
    </div>
  )
}

function RichiesteTab({
  canDesk,
  instructors,
  richieste,
  lezioni,
  userNome,
  prendiId,
  setPrendiId,
  packId,
  setPackId,
  onDone,
}: {
  canDesk: boolean
  instructors: { id: string; nome: string; telefono: string; attivo: boolean }[]
  richieste: LpRichiesta[]
  lezioni: LpLezioneFlat[]
  userNome: string
  prendiId: string | null
  setPrendiId: (id: string | null) => void
  packId: string | null
  setPackId: (id: string | null) => void
  onDone: () => void
}) {
  const [form, setForm] = useState({
    clienteNome: "",
    eta: "",
    telefono: "",
    tutore: "",
    quando: "",
    prefIstruttore: "",
    note: "",
  })
  const createM = useMutation({
    mutationFn: () => lezioniPrivateApi.createRichiesta(form),
    onSuccess: () => {
      setForm({ clienteNome: "", eta: "", telefono: "", tutore: "", quando: "", prefIstruttore: "", note: "" })
      onDone()
    },
  })

  return (
    <div className="mt-5 grid gap-6">
      {canDesk ? (
        <form
          className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            createM.mutate()
          }}
        >
          <h2 className="text-sm font-semibold text-zinc-200">Nuova richiesta</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["clienteNome", "Cognome e nome *"],
                ["eta", "Età"],
                ["telefono", "Telefono *"],
                ["tutore", "Tutore"],
                ["quando", "Quando (disponibilità)"],
                ["prefIstruttore", "Preferenza istruttore"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="grid gap-1 text-sm text-zinc-400">
                {label}
                <input
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
                />
              </label>
            ))}
            <label className="grid gap-1 text-sm text-zinc-400 sm:col-span-2">
              Note
              <input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={createM.isPending}
            className="mt-3 rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/30"
          >
            {createM.isPending ? "Invio…" : "Registra e avvisa istruttori su WhatsApp"}
          </button>
          {createM.isError ? <p className="mt-2 text-sm text-red-400">{String((createM.error as Error).message)}</p> : null}
          {createM.isSuccess && createM.data.wa.skipped ? (
            <p className="mt-2 text-sm text-amber-300">{createM.data.wa.skipped}</p>
          ) : null}
          {createM.isSuccess && !createM.data.wa.skipped ? (
            <p className="mt-2 text-sm text-emerald-300">WhatsApp inviato a {createM.data.wa.sent} istruttori.</p>
          ) : null}
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/50 text-zinc-400">
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Chi registra</th>
              <th className="px-3 py-2 font-medium">Cognome e nome</th>
              <th className="px-3 py-2 font-medium">Età</th>
              <th className="px-3 py-2 font-medium">Telefono</th>
              <th className="px-3 py-2 font-medium">Tutore</th>
              <th className="px-3 py-2 font-medium">Quando</th>
              <th className="px-3 py-2 font-medium">Pref. istr.</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2 font-medium">Istruttore</th>
              <th className="px-3 py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {richieste.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-zinc-500">
                  Nessuna richiesta.
                </td>
              </tr>
            ) : null}
            {richieste.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/60 align-top">
                <td className="px-3 py-2 text-zinc-300">{fmtDateIt(r.createdAt.slice(0, 10))}</td>
                <td className="px-3 py-2 text-zinc-400">{r.createdBy}</td>
                <td className="px-3 py-2 font-medium text-zinc-100">{r.clienteNome}</td>
                <td className="px-3 py-2 text-zinc-300">{r.eta ?? ""}</td>
                <td className="px-3 py-2 text-zinc-300">{r.telefono}</td>
                <td className="px-3 py-2 text-zinc-400">{r.tutore ?? ""}</td>
                <td className="px-3 py-2 text-zinc-300">{r.quando ?? ""}</td>
                <td className="px-3 py-2 text-zinc-400">{r.prefIstruttore ?? ""}</td>
                <td className="px-3 py-2 text-zinc-400">{r.note ?? ""}</td>
                <td className="px-3 py-2 text-amber-200">{r.istruttoreNome ?? r.status}</td>
                <td className="px-3 py-2">
                  {r.status === "aperta" ? (
                    <button type="button" className="text-sm text-[#46A6D9] underline" onClick={() => setPrendiId(r.id)}>
                      Prendi in carico
                    </button>
                  ) : r.status === "assegnata" ? (
                    <button type="button" className="text-sm text-amber-300 underline" onClick={() => setPackId(r.id)}>
                      Pacchetto 5/10
                    </button>
                  ) : null}
                  {r.waSkipped ? <div className="mt-1 text-[11px] text-amber-400/80">{r.waSkipped}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prendiId && richieste.find((x) => x.id === prendiId) ? (
        <PrendiModal
          richiesta={richieste.find((x) => x.id === prendiId)!}
          instructors={instructors}
          userNome={userNome}
          onClose={() => setPrendiId(null)}
          onDone={() => {
            setPrendiId(null)
            onDone()
          }}
        />
      ) : null}
      {packId && richieste.find((x) => x.id === packId) ? (
        <PackModal
          richiesta={richieste.find((x) => x.id === packId)!}
          prova={lezioni.find((l) => l.richiestaId === packId && l.tipo === "prova")}
          onClose={() => setPackId(null)}
          onDone={() => {
            setPackId(null)
            onDone()
          }}
        />
      ) : null}
    </div>
  )
}

function PrendiModal({
  richiesta,
  instructors,
  userNome,
  onClose,
  onDone,
}: {
  richiesta: LpRichiesta
  instructors: { id: string; nome: string; attivo: boolean }[]
  userNome: string
  onClose: () => void
  onDone: () => void
}) {
  const match = instructors.find((i) => i.attivo && i.nome.trim().toLowerCase() === userNome.trim().toLowerCase())
  const [istruttoreId, setIstruttoreId] = useState(match?.id ?? instructors.find((i) => i.attivo)?.id ?? "")
  const [giorno, setGiorno] = useState(isoToday())
  const [ora, setOra] = useState("18:30")
  const [vasca, setVasca] = useState<VascaId>("ludica")
  const [corsia, setCorsia] = useState(1)
  const m = useMutation({
    mutationFn: () => lezioniPrivateApi.prendi(richiesta.id, { istruttoreId, giorno, ora, vasca, corsia, durataMin: 30 }),
    onSuccess: onDone,
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
        <h3 className="font-semibold text-zinc-100">Prova in vasca · {richiesta.clienteNome}</h3>
        <p className="mt-1 text-xs text-zinc-500">Segna la prima lezione (prova) su una corsia libera.</p>
        <label className="mt-3 grid gap-1 text-sm text-zinc-400">
          Istruttore
          <select value={istruttoreId} onChange={(e) => setIstruttoreId(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100">
            <option value="">—</option>
            {instructors.filter((i) => i.attivo).map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
          <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select value={vasca} onChange={(e) => setVasca(e.target.value as VascaId)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100">
            <option value="v25">Vasca 25 m</option>
            <option value="ludica">Vasca ludica 18 m</option>
          </select>
          <select value={corsia} onChange={(e) => setCorsia(Number(e.target.value))} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100">
            <option value={1}>Corsia 1</option>
            {vasca === "ludica" ? <option value={2}>Corsia 2</option> : null}
          </select>
        </div>
        {m.isError ? <p className="mt-2 text-sm text-red-400">{String((m.error as Error).message)}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-400">
            Annulla
          </button>
          <button type="button" disabled={m.isPending} onClick={() => m.mutate()} className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
            Conferma prova
          </button>
        </div>
      </div>
    </div>
  )
}

function PackModal({
  richiesta,
  prova,
  onClose,
  onDone,
}: {
  richiesta: LpRichiesta
  prova?: LpLezioneFlat
  onClose: () => void
  onDone: () => void
}) {
  const [tipo, setTipo] = useState<"5" | "10">("5")
  const [start, setStart] = useState(prova ? addDaysIso(prova.giorno, 7) : isoToday())
  const [ora, setOra] = useState(prova?.ora ?? "18:30")
  const [vasca, setVasca] = useState<VascaId>(prova?.vasca ?? "ludica")
  const [corsia, setCorsia] = useState(prova?.corsia ?? 1)
  const n = tipo === "10" ? 10 : 5
  const lezioni = useMemo(() => {
    const out: Array<{ giorno: string; ora: string; vasca: VascaId; corsia: number }> = []
    for (let i = 0; i < n; i++) out.push({ giorno: addDaysIso(start, i * 7), ora, vasca, corsia })
    return out
  }, [n, start, ora, vasca, corsia])
  const m = useMutation({
    mutationFn: () => lezioniPrivateApi.pacchetto({ richiestaId: richiesta.id, tipo, lezioni }),
    onSuccess: onDone,
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
        <h3 className="font-semibold text-zinc-100">Pacchetto · {richiesta.clienteNome}</h3>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setTipo("5")} className={`rounded-md px-3 py-1.5 text-sm ${tipo === "5" ? "bg-amber-500/20 text-amber-200" : "text-zinc-400"}`}>
            5 lezioni
          </button>
          <button type="button" onClick={() => setTipo("10")} className={`rounded-md px-3 py-1.5 text-sm ${tipo === "10" ? "bg-amber-500/20 text-amber-200" : "text-zinc-400"}`}>
            10 lezioni
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-zinc-500">
            Prima data (poi ogni 7 giorni)
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
          </label>
          <label className="grid gap-1 text-xs text-zinc-500">
            Ora
            <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
          </label>
          <select value={vasca} onChange={(e) => setVasca(e.target.value as VascaId)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100">
            <option value="v25">Vasca 25 m</option>
            <option value="ludica">Vasca ludica 18 m</option>
          </select>
          <select value={corsia} onChange={(e) => setCorsia(Number(e.target.value))} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100">
            <option value={1}>Corsia 1</option>
            {vasca === "ludica" ? <option value={2}>Corsia 2</option> : null}
          </select>
        </div>
        <ul className="mt-3 max-h-40 overflow-auto text-sm text-zinc-400">
          {lezioni.map((l) => (
            <li key={l.giorno}>
              {fmtDateIt(l.giorno)} {l.ora} · {VASCA_LABEL[l.vasca]} corsia {l.corsia}
            </li>
          ))}
        </ul>
        {m.isError ? <p className="mt-2 text-sm text-red-400">{String((m.error as Error).message)}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-400">
            Chiudi
          </button>
          <button type="button" disabled={m.isPending} onClick={() => m.mutate()} className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
            Prenota pacchetto
          </button>
        </div>
      </div>
    </div>
  )
}

function DayWeekGrid({
  days,
  ore,
  regole,
  booked,
  onCancel,
}: {
  days: string[]
  ore: string[]
  regole: Record<string, { v25: number; ludica: number }>
  booked: LpLezioneFlat[]
  onCancel: (id: string, chi: "annullata_istruttore" | "annullata_cliente") => void
}) {
  function cap(giorno: string, vasca: VascaId): number {
    const dow = new Date(`${giorno}T12:00:00`).getDay()
    const row = regole[String(dow)] ?? { v25: 1, ludica: 2 }
    return vasca === "v25" ? row.v25 : row.ludica
  }
  function cell(giorno: string, ora: string, vasca: VascaId, corsia: number) {
    return booked.find((l) => l.giorno === giorno && l.vasca === vasca && l.corsia === corsia && l.ora <= ora && ora < addMin(l.ora, l.durataMin))
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
      <table className="min-w-full border-collapse text-center text-xs">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-950/50">
            <th className="px-2 py-2 text-left text-zinc-400">Ora</th>
            {days.map((d) => (
              <th key={d} colSpan={3} className="px-2 py-2 text-zinc-200">
                {DOW_IT[new Date(`${d}T12:00:00`).getDay()]} {fmtDateIt(d)}
              </th>
            ))}
          </tr>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th />
            {days.map((d) => (
              <FragmentCols key={d} cap25={cap(d, "v25")} capL={cap(d, "ludica")} />
            ))}
          </tr>
        </thead>
        <tbody>
          {ore.map((ora) => (
            <tr key={ora} className="border-b border-zinc-800/40">
              <td className="whitespace-nowrap px-2 py-1 text-left text-zinc-400">{ora}</td>
              {days.flatMap((d) => {
                const cells: ReactNode[] = []
                if (cap(d, "v25") >= 1) cells.push(<LaneCell key={`${d}-25`} hit={cell(d, ora, "v25", 1)} onCancel={onCancel} />)
                if (cap(d, "ludica") >= 1) cells.push(<LaneCell key={`${d}-l1`} hit={cell(d, ora, "ludica", 1)} onCancel={onCancel} />)
                if (cap(d, "ludica") >= 2) cells.push(<LaneCell key={`${d}-l2`} hit={cell(d, ora, "ludica", 2)} onCancel={onCancel} />)
                while (cells.length < 3) cells.push(<td key={`${d}-e${cells.length}`} className="bg-zinc-950/40" />)
                return cells
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FragmentCols({ cap25, capL }: { cap25: number; capL: number }) {
  return (
    <>
      <th className="px-1 py-1">{cap25 ? "25m C1" : "—"}</th>
      <th className="px-1 py-1">{capL >= 1 ? "Lud C1" : "—"}</th>
      <th className="px-1 py-1">{capL >= 2 ? "Lud C2" : "—"}</th>
    </>
  )
}

function addMin(ora: string, min: number): string {
  const [h, m] = ora.split(":").map(Number)
  const t = h * 60 + m + min
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

function LaneCell({
  hit,
  onCancel,
}: {
  hit?: LpLezioneFlat
  onCancel: (id: string, chi: "annullata_istruttore" | "annullata_cliente") => void
}) {
  if (!hit) return <td className="px-1 py-1 text-emerald-700/80">libero</td>
  return (
    <td className="px-1 py-1">
      <div className="rounded bg-amber-500/15 px-1 py-0.5 text-[11px] text-amber-100">
        {hit.clienteNome}
        <div className="text-[10px] text-zinc-400">
          {hit.istruttoreNome} · {hit.tipo}
        </div>
        <div className="mt-0.5 flex justify-center gap-1">
          <button type="button" className="text-[10px] text-red-300" onClick={() => onCancel(hit.lezioneId, "annullata_istruttore")}>
            ann. istr.
          </button>
          <button type="button" className="text-[10px] text-red-300" onClick={() => onCancel(hit.lezioneId, "annullata_cliente")}>
            ann. cliente
          </button>
        </div>
      </div>
    </td>
  )
}

function MeseGrid({
  byDay,
  from,
  to,
}: {
  byDay: Record<string, { totali: number; occupati: number }>
  from: string
  to: string
}) {
  const days: string[] = []
  const cur = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cur.getTime() <= end.getTime()) {
    days.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`)
    cur.setDate(cur.getDate() + 1)
  }
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((d) => {
        const x = byDay[d]
        const liberi = x ? Math.max(0, x.totali - x.occupati) : 0
        return (
          <div key={d} className="rounded-xl border border-zinc-800 px-3 py-2">
            <div className="text-xs text-zinc-500">{fmtDateIt(d)}</div>
            <div className={`mt-1 text-lg font-semibold ${liberi === 0 ? "text-red-300" : "text-emerald-200"}`}>{liberi}</div>
            <div className="text-[11px] text-zinc-500">posti liberi / {x?.totali ?? 0}</div>
          </div>
        )
      })}
    </div>
  )
}

function IstruttoriTab({
  canRoster,
  instructors,
  regole,
  onDone,
}: {
  canRoster: boolean
  instructors: { id: string; nome: string; telefono: string; attivo: boolean }[]
  regole: Record<string, { v25: number; ludica: number }>
  onDone: () => void
}) {
  const [nome, setNome] = useState("")
  const [tel, setTel] = useState("")
  const [localRegole, setLocalRegole] = useState(regole)
  useEffect(() => setLocalRegole(regole), [regole])
  const addM = useMutation({
    mutationFn: () => lezioniPrivateApi.addIstruttore(nome, tel),
    onSuccess: () => {
      setNome("")
      setTel("")
      onDone()
    },
  })
  const saveR = useMutation({
    mutationFn: () => lezioniPrivateApi.putRegole(localRegole),
    onSuccess: onDone,
  })
  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-zinc-800 p-4">
        <h2 className="font-semibold text-zinc-100">Istruttori (WhatsApp)</h2>
        <p className="mt-1 text-sm text-zinc-500">Passami l’elenco: intanto puoi inserirli qui. Senza numeri l’avviso non parte.</p>
        {canRoster ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
            <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="Cellulare" className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
            <button type="button" disabled={addM.isPending} onClick={() => addM.mutate()} className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
              Aggiungi
            </button>
          </div>
        ) : null}
        <ul className="mt-4 space-y-2">
          {instructors.length === 0 ? <li className="text-sm text-zinc-500">Elenco vuoto.</li> : null}
          {instructors.map((i) => (
            <li key={i.id} className="flex items-center justify-between text-sm text-zinc-200">
              <span>
                {i.nome} <span className="text-zinc-500">{i.telefono || "senza tel."}</span>
              </span>
              {canRoster ? (
                <button
                  type="button"
                  className="text-xs text-zinc-500 underline"
                  onClick={() => void lezioniPrivateApi.patchIstruttore(i.id, { attivo: !i.attivo }).then(onDone)}
                >
                  {i.attivo ? "disattiva" : "attiva"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-zinc-800 p-4">
        <h2 className="font-semibold text-zinc-100">Corsie per giorno</h2>
        <p className="mt-1 text-sm text-zinc-500">Default: 25 m = 1 corsia, ludica = 2. Quando hai le regole precise le aggiorniamo qui (0 = chiuso).</p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-zinc-500">
              <th className="py-1 text-left">Giorno</th>
              <th className="py-1">25 m</th>
              <th className="py-1">Ludica</th>
            </tr>
          </thead>
          <tbody>
            {DOW_IT.map((label, d) => {
              const row = localRegole[String(d)] ?? { v25: 1, ludica: 2 }
              return (
                <tr key={d}>
                  <td className="py-1 text-zinc-300">{label}</td>
                  <td className="py-1 text-center">
                    <input
                      type="number"
                      min={0}
                      max={1}
                      value={row.v25}
                      disabled={!canRoster}
                      onChange={(e) => setLocalRegole((r) => ({ ...r, [String(d)]: { ...row, v25: Number(e.target.value) } }))}
                      className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-zinc-100"
                    />
                  </td>
                  <td className="py-1 text-center">
                    <input
                      type="number"
                      min={0}
                      max={2}
                      value={row.ludica}
                      disabled={!canRoster}
                      onChange={(e) => setLocalRegole((r) => ({ ...r, [String(d)]: { ...row, ludica: Number(e.target.value) } }))}
                      className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-zinc-100"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {canRoster ? (
          <button type="button" disabled={saveR.isPending} onClick={() => saveR.mutate()} className="mt-3 rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
            Salva regole
          </button>
        ) : null}
      </div>
    </div>
  )
}
