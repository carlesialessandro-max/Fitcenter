import { useEffect, useMemo, useState } from "react"
import { Fragment } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lezioniPrivateApi, type LpIstruttore, type LpLezioneFlat, type LpRichiesta, type LpSlot, type VascaId } from "@/api/lezioniPrivate"
import { useAuth } from "@/contexts/AuthContext"
import { fmtDateIt, isoToday, monthRangeFromDay } from "@/pages/Corsi"
import { weekMondaySunday } from "@/lib/tabella-oraria"
import { LP_VASCHE_LEGENDA, slotAperto } from "@/lib/lp-vasche-orari"

type Tab = "richieste" | "calendario" | "istruttori"
type Periodo = "giorno" | "settimana" | "mese"

const DOW_IT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"]
const VASCA_LABEL: Record<VascaId, string> = { v25: "25 m (1 corsia)", ludica: "Ludica 18 m" }

function fmtPrefIstr(p?: string): string {
  const t = (p ?? "").toLowerCase()
  if (!t) return "indifferente"
  if (/special|disabil/.test(t)) return "special"
  if (/femmin|donna|istruttrice/.test(t)) return "donna"
  if (/maschi|uomo/.test(t) && !/femmin/.test(t)) return "uomo"
  return p ?? ""
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function tabFromPath(pathname: string): Tab {
  if (pathname.includes("/calendario")) return "calendario"
  if (pathname.includes("/istruttori")) return "istruttori"
  return "richieste"
}

type LpTipoPrenota = "prova" | "5" | "10"

function TipoButtons({ value, onChange }: { value: LpTipoPrenota; onChange: (v: LpTipoPrenota) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(
        [
          ["prova", "Prova"],
          ["5", "Pacchetto 5"],
          ["10", "Pacchetto 10"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`rounded-md px-3 py-1.5 text-sm ${value === id ? "bg-amber-500/20 text-amber-200" : "border border-zinc-700 text-zinc-400"}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function LezioniPrivate() {
  const { role, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const tab = tabFromPath(location.pathname)
  const enabled =
    role === "admin" || role === "scuola_nuoto" || role === "istruttore" || role === "operatore" || role === "firme"
  const canDesk = role === "admin" || role === "scuola_nuoto" || role === "operatore" || role === "firme"
  const canRoster = role === "admin" || role === "scuola_nuoto"
  const qc = useQueryClient()
  const [day, setDay] = useState(() => isoToday())
  const [periodo, setPeriodo] = useState<Periodo>("giorno")
  const [prendiId, setPrendiId] = useState<string | null>(null)
  const [packId, setPackId] = useState<string | null>(null)
  const [bookSlot, setBookSlot] = useState<LpSlot | null>(null)
  const [detailLezione, setDetailLezione] = useState<LpLezioneFlat | null>(null)

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
            WhatsApp agli istruttori (uomo, donna o Special). Prenota prova o pacchetto in vasca. Puoi spostare una data
            o tutte quelle del pacchetto senza cancellare la richiesta.
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
              onClick={() =>
                navigate(id === "richieste" ? "/lezioni-private/richieste" : `/lezioni-private/${id}`)
              }
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
          onSpostaDate={(id) => {
            const l = lezioni.find((x) => x.richiestaId === id && x.stato === "prenotata")
            if (l) setDetailLezione(l)
          }}
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
            Solo gli orari aperti sono prenotabili. 25 m: 1 persona, lun–ven 8:00–14:30 e 18:30–22:00 (sabato chiusa).
            Ludica: fino a 4 persone (2 per corsia); mar/ven 7:30–8:15 solo 2 (1 per corsia).
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full text-left text-xs text-zinc-400">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="px-3 py-1.5 font-medium">Giorni</th>
                  <th className="px-3 py-1.5 font-medium">Vasca</th>
                  <th className="px-3 py-1.5 font-medium">Orari</th>
                  <th className="px-3 py-1.5 font-medium">Posti</th>
                </tr>
              </thead>
              <tbody>
                {LP_VASCHE_LEGENDA.map((r) => (
                  <tr key={`${r.giorni}-${r.vasca}`} className="border-b border-zinc-800/50">
                    <td className="px-3 py-1.5 text-zinc-300">{r.giorni}</td>
                    <td className="px-3 py-1.5">{r.vasca}</td>
                    <td className="px-3 py-1.5">{r.orari}</td>
                    <td className="px-3 py-1.5">{r.posti}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {periodo === "mese" ? (
            <MeseGrid byDay={occQ.data?.byDay ?? {}} from={month.from} to={month.to} />
          ) : (
            <DayWeekGrid
              days={periodo === "giorno" ? [day] : week.days}
              ore={ore}
              booked={booked}
              onBook={setBookSlot}
              onOpen={setDetailLezione}
              onTogli={(id) => {
                void lezioniPrivateApi.patchLezione(id, { stato: "tolta" }).then(invalidate)
              }}
            />
          )}
          {bookSlot ? (
            <BookSlotModal
              slot={bookSlot}
              instructors={instructors}
              richieste={richieste.filter((r) => r.status !== "annullata")}
              userNome={user?.nome ?? ""}
              onClose={() => setBookSlot(null)}
              onDone={() => {
                setBookSlot(null)
                invalidate()
              }}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "istruttori" ? (
        <IstruttoriTab canRoster={canRoster} instructors={instructors} onDone={invalidate} />
      ) : null}

      {detailLezione ? (
        <LezioneDetailModal
          lezione={detailLezione}
          pacchettoLezioni={lezioni.filter(
            (l) => l.pacchettoId === detailLezione.pacchettoId && l.stato === "prenotata",
          )}
          onClose={() => setDetailLezione(null)}
          onDone={() => {
            setDetailLezione(null)
            invalidate()
          }}
        />
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
  onSpostaDate,
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
  onSpostaDate: (richiestaId: string) => void
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
    createdBy: userNome,
  })
  useEffect(() => {
    setForm((f) => (f.createdBy.trim() ? f : { ...f, createdBy: userNome }))
  }, [userNome])
  const createM = useMutation({
    mutationFn: () => lezioniPrivateApi.createRichiesta(form),
    onSuccess: () => {
      setForm({
        clienteNome: "",
        eta: "",
        telefono: "",
        tutore: "",
        quando: "",
        prefIstruttore: "",
        note: "",
        createdBy: userNome,
      })
      onDone()
    },
  })
  const delM = useMutation({
    mutationFn: (id: string) => lezioniPrivateApi.deleteRichiesta(id),
    onSuccess: onDone,
  })
  const waM = useMutation({
    mutationFn: (id: string) => lezioniPrivateApi.riavvisa(id),
    onSuccess: onDone,
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
          <p className="mt-1 text-xs text-zinc-500">
            WhatsApp al cliente sempre; agli istruttori uomo, donna, Special (flag in tabella) o tutti se indifferente.
            Poi scegli prova o pacchetto 5/10 sul calendario. Togliere una data dal calendario non cancella la richiesta.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid gap-1 text-sm text-zinc-400">
              Chi compila il modulo *
              <input
                required
                value={form.createdBy}
                onChange={(e) => setForm((f) => ({ ...f, createdBy: e.target.value }))}
                placeholder="Nome di chi registra"
                className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
              />
            </label>
            {(
              [
                ["clienteNome", "Cognome e nome *"],
                ["eta", "Età"],
                ["telefono", "Telefono *"],
                ["tutore", "Tutore"],
                ["quando", "Quando (disponibilità)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="grid gap-1 text-sm text-zinc-400">
                {label}
                <input
                  required={k === "clienteNome" || k === "telefono"}
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
                />
              </label>
            ))}
            <label className="grid gap-1 text-sm text-zinc-400">
              Preferenza istruttore
              <select
                value={form.prefIstruttore}
                onChange={(e) => setForm((f) => ({ ...f, prefIstruttore: e.target.value }))}
                className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
              >
                <option value="">Indifferente (tutti)</option>
                <option value="maschio">Istruttore uomo</option>
                <option value="femmina">Istruttrice donna</option>
                <option value="special">Special (ragazzi disabili)</option>
              </select>
            </label>
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
            {createM.isPending ? "Invio…" : "Registra e avvisa gli istruttori su WhatsApp"}
          </button>
          {createM.isError ? <p className="mt-2 text-sm text-red-400">{String((createM.error as Error).message)}</p> : null}
          {createM.isSuccess && createM.data.wa.skipped ? (
            <p className="mt-2 text-sm text-amber-300">{createM.data.wa.skipped}</p>
          ) : null}
          {createM.isSuccess && !createM.data.wa.skipped && createM.data.wa.sent > 0 ? (
            <p className="mt-2 text-sm text-emerald-300">
              WhatsApp inviato a {createM.data.wa.sent} numeri
              {createM.data.wa.destinations?.length ? `: ${createM.data.wa.destinations.join(", ")}` : "."}
            </p>
          ) : null}
          {createM.data?.wa.errors?.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-red-400">
              {createM.data.wa.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          ) : null}
        </form>
      ) : null}

      {waM.isError ? <p className="text-sm text-red-400">{String((waM.error as Error).message)}</p> : null}
      {waM.isSuccess && waM.data.wa.skipped ? <p className="text-sm text-amber-300">{waM.data.wa.skipped}</p> : null}
      {waM.isSuccess && !waM.data.wa.skipped ? (
        <p className="text-sm text-emerald-300">
          WhatsApp reinviato a {waM.data.wa.sent} numeri
          {waM.data.wa.destinations?.length ? `: ${waM.data.wa.destinations.join(", ")}` : "."}
        </p>
      ) : null}
      {waM.data?.wa.errors?.length ? (
        <ul className="list-disc pl-5 text-sm text-red-400">
          {waM.data.wa.errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
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
                <td className="px-3 py-2 text-zinc-400">{fmtPrefIstr(r.prefIstruttore)}</td>
                <td className="px-3 py-2 text-zinc-400">{r.note ?? ""}</td>
                <td className="px-3 py-2 text-amber-200">
                  {r.istruttoreNome ?? r.status}
                  {lezioni.filter((l) => l.richiestaId === r.id && (l.stato === "prenotata" || l.stato === "svolta")).length ? (
                    <div className="mt-1 text-[11px] font-normal text-zinc-500">
                      {lezioni
                        .filter((l) => l.richiestaId === r.id && (l.stato === "prenotata" || l.stato === "svolta"))
                        .map((l) => `${fmtDateIt(l.giorno)} ${l.ora}`)
                        .join(" · ")}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    {r.status !== "annullata" ? (
                      <button type="button" className="text-sm text-[#46A6D9] underline" onClick={() => setPrendiId(r.id)}>
                        {r.status === "aperta" ? "Prenota in vasca" : "Aggiungi data"}
                      </button>
                    ) : null}
                    {r.status === "assegnata" ? (
                      <button type="button" className="text-sm text-amber-300 underline" onClick={() => setPackId(r.id)}>
                        Pacchetto 5/10
                      </button>
                    ) : null}
                    {lezioni.some((l) => l.richiestaId === r.id && l.stato === "prenotata") ? (
                      <button type="button" className="text-sm text-amber-200 underline" onClick={() => onSpostaDate(r.id)}>
                        Sposta date
                      </button>
                    ) : null}
                    {canDesk ? (
                      <>
                        <button
                          type="button"
                          className="text-sm text-[#46A6D9] underline"
                          disabled={waM.isPending}
                          onClick={() => waM.mutate(r.id)}
                        >
                          Reinvia WhatsApp istruttori
                        </button>
                        <button
                          type="button"
                          className="text-sm text-red-400 underline"
                          disabled={delM.isPending}
                          onClick={() => {
                            if (!window.confirm(`Eliminare la richiesta di ${r.clienteNome}?`)) return
                            delM.mutate(r.id)
                          }}
                        >
                          Elimina
                        </button>
                      </>
                    ) : null}
                    {r.waDestinations?.length ? (
                      <div className="text-[11px] text-zinc-500">WA: {r.waDestinations.join(", ")}</div>
                    ) : null}
                    {r.waSkipped ? <div className="text-[11px] text-amber-400/80">{r.waSkipped}</div> : null}
                  </div>
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
  const [tipo, setTipo] = useState<LpTipoPrenota>("prova")
  const [ripeti, setRipeti] = useState(true)
  const m = useMutation({
    mutationFn: () =>
      lezioniPrivateApi.prendi(richiesta.id, {
        istruttoreId,
        giorno,
        ora,
        vasca,
        corsia,
        durataMin: 30,
        tipo,
        ripetiSettimanale: tipo === "prova" ? false : ripeti,
      }),
    onSuccess: onDone,
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
        <h3 className="font-semibold text-zinc-100">Prenota in vasca · {richiesta.clienteNome}</h3>
        <p className="mt-1 text-xs text-zinc-500">Scegli prova o pacchetto e una corsia libera. La richiesta non viene cancellata.</p>
        <div className="mt-3">
          <TipoButtons value={tipo} onChange={setTipo} />
        </div>
        {tipo !== "prova" ? (
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" checked={ripeti} onChange={(e) => setRipeti(e.target.checked)} />
            Ripeti ogni settimana ({tipo} date)
          </label>
        ) : null}
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
            Conferma
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

function BookSlotModal({
  slot,
  instructors,
  richieste,
  userNome,
  onClose,
  onDone,
}: {
  slot: LpSlot
  instructors: LpIstruttore[]
  richieste: LpRichiesta[]
  userNome: string
  onClose: () => void
  onDone: () => void
}) {
  const match = instructors.find((i) => i.attivo && i.nome.trim().toLowerCase() === userNome.trim().toLowerCase())
  const [istruttoreId, setIstruttoreId] = useState(match?.id ?? instructors.find((i) => i.attivo)?.id ?? "")
  const [clienteNome, setClienteNome] = useState("")
  const [telefono, setTelefono] = useState("")
  const [eta, setEta] = useState("")
  const [tipo, setTipo] = useState<LpTipoPrenota>("prova")
  const [ripeti, setRipeti] = useState(true)
  const [richiestaId, setRichiestaId] = useState("")
  const m = useMutation({
    mutationFn: () =>
      lezioniPrivateApi.prenota({
        clienteNome,
        telefono,
        istruttoreId,
        giorno: slot.giorno,
        ora: slot.ora,
        vasca: slot.vasca,
        corsia: slot.corsia,
        durataMin: 30,
        eta,
        createdBy: userNome,
        tipo,
        ripetiSettimanale: tipo === "prova" ? false : ripeti,
        richiestaId: richiestaId || undefined,
      }),
    onSuccess: onDone,
  })
  const existing = richiestaId ? richieste.find((r) => r.id === richiestaId) : null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
        <h3 className="font-semibold text-zinc-100">Prenota orario</h3>
        <p className="mt-1 text-xs text-zinc-500">
          {fmtDateIt(slot.giorno)} {slot.ora} · {VASCA_LABEL[slot.vasca]} · corsia {slot.corsia}
        </p>
        <div className="mt-3">
          <TipoButtons value={tipo} onChange={setTipo} />
        </div>
        {tipo !== "prova" ? (
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" checked={ripeti} onChange={(e) => setRipeti(e.target.checked)} />
            Ripeti ogni settimana ({tipo} date)
          </label>
        ) : null}
        {richieste.length ? (
          <label className="mt-3 grid gap-1 text-sm text-zinc-400">
            Richiesta esistente
            <select
              value={richiestaId}
              onChange={(e) => {
                const id = e.target.value
                setRichiestaId(id)
                const r = richieste.find((x) => x.id === id)
                if (r) {
                  setClienteNome(r.clienteNome)
                  setTelefono(r.telefono)
                  if (r.istruttoreId) setIstruttoreId(r.istruttoreId)
                }
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
            >
              <option value="">Nuova (compilare sotto)</option>
              {richieste.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.clienteNome}
                  {r.istruttoreNome ? ` · ${r.istruttoreNome}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!existing ? (
          <>
            <label className="mt-3 grid gap-1 text-sm text-zinc-400">
              Nominativo *
              <input value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-sm text-zinc-400">
                Telefono *
                <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
              </label>
              <label className="grid gap-1 text-sm text-zinc-400">
                Età
                <input value={eta} onChange={(e) => setEta(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
              </label>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-zinc-300">
            Aggiunge la data a <span className="font-medium text-zinc-100">{existing.clienteNome}</span> (la richiesta resta).
          </p>
        )}
        <label className="mt-2 grid gap-1 text-sm text-zinc-400">
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
        {m.isError ? <p className="mt-2 text-sm text-red-400">{String((m.error as Error).message)}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-400">
            Annulla
          </button>
          <button
            type="button"
            disabled={m.isPending || !istruttoreId || (!richiestaId && (!clienteNome.trim() || !telefono.trim()))}
            onClick={() => m.mutate()}
            className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200"
          >
            Prenota
          </button>
        </div>
      </div>
    </div>
  )
}

function LezioneDetailModal({
  lezione,
  pacchettoLezioni,
  onClose,
  onDone,
}: {
  lezione: LpLezioneFlat
  pacchettoLezioni: LpLezioneFlat[]
  onClose: () => void
  onDone: () => void
}) {
  const datePacchetto = pacchettoLezioni.length ? pacchettoLezioni : [lezione]
  const [selezionate, setSelezionate] = useState<Set<string>>(() => new Set([lezione.lezioneId]))
  const [giorno, setGiorno] = useState(lezione.giorno)
  const [ora, setOra] = useState(lezione.ora)
  const [vasca, setVasca] = useState<VascaId>(lezione.vasca)
  const [corsia, setCorsia] = useState(lezione.corsia)
  const nSel = selezionate.size
  const moveM = useMutation({
    mutationFn: () => {
      const ids = [...selezionate]
      if (ids.length <= 1 && ids[0] === lezione.lezioneId) {
        return lezioniPrivateApi.patchLezione(lezione.lezioneId, { giorno, ora, vasca, corsia })
      }
      return lezioniPrivateApi.spostaPacchetto(lezione.pacchettoId, {
        lezioneIds: ids,
        lezioneAncoraId: lezione.lezioneId,
        giornoAncora: giorno,
        ora,
        vasca,
        corsia,
      })
    },
    onSuccess: onDone,
  })
  const togliM = useMutation({
    mutationFn: () => lezioniPrivateApi.patchLezione(lezione.lezioneId, { stato: "tolta" }),
    onSuccess: onDone,
  })
  const tutte = datePacchetto.length > 1 && datePacchetto.every((l) => selezionate.has(l.lezioneId))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
        <h3 className="font-semibold text-zinc-100">Lezione in vasca</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Sposta una data, più date o tutto il pacchetto. Togliere una data non elimina la richiesta.
        </p>
        <dl className="mt-3 grid gap-2 text-sm">
          <div>
            <dt className="text-zinc-500">Nominativo</dt>
            <dd className="text-zinc-100">{lezione.clienteNome}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Istruttore</dt>
            <dd className="text-amber-200">{lezione.istruttoreNome}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Tipo</dt>
            <dd className="text-zinc-200">{lezione.tipo === "prova" ? "Prova" : `Pacchetto ${lezione.tipo}`}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Telefono genitore</dt>
            <dd className="text-zinc-200">{lezione.telefono}</dd>
          </div>
        </dl>
        {datePacchetto.length > 1 ? (
          <div className="mt-3 rounded-lg border border-zinc-800 p-2">
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs text-[#46A6D9] underline"
                onClick={() => setSelezionate(new Set(datePacchetto.map((l) => l.lezioneId)))}
              >
                Tutte le date
              </button>
              <button type="button" className="text-xs text-zinc-400 underline" onClick={() => setSelezionate(new Set([lezione.lezioneId]))}>
                Solo questa
              </button>
            </div>
            <ul className="max-h-36 space-y-1 overflow-auto text-sm">
              {datePacchetto
                .slice()
                .sort((a, b) => a.giorno.localeCompare(b.giorno) || a.ora.localeCompare(b.ora))
                .map((l) => (
                  <li key={l.lezioneId}>
                    <label className="flex items-center gap-2 text-zinc-300">
                      <input
                        type="checkbox"
                        checked={selezionate.has(l.lezioneId)}
                        onChange={() => {
                          setSelezionate((prev) => {
                            const next = new Set(prev)
                            if (next.has(l.lezioneId)) next.delete(l.lezioneId)
                            else next.add(l.lezioneId)
                            if (next.size === 0) next.add(lezione.lezioneId)
                            return next
                          })
                        }}
                      />
                      {fmtDateIt(l.giorno)} {l.ora}
                      {l.lezioneId === lezione.lezioneId ? <span className="text-[10px] text-zinc-500">questa</span> : null}
                    </label>
                  </li>
                ))}
            </ul>
            <p className="mt-1 text-[11px] text-zinc-500">
              {tutte ? "Sposti tutto il pacchetto" : nSel === 1 ? "Sposti una sola data" : `Sposti ${nSel} date`}
              : la prima selezionata va alla nuova data, le altre dello stesso numero di giorni.
            </p>
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-zinc-500">
            {nSel > 1 ? "Nuova data della prima selezionata" : "Data"}
            <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
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
        {moveM.isError ? <p className="mt-2 text-sm text-red-400">{String((moveM.error as Error).message)}</p> : null}
        {togliM.isError ? <p className="mt-2 text-sm text-red-400">{String((togliM.error as Error).message)}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={togliM.isPending}
            onClick={() => {
              if (!window.confirm("Togliere questa data dal calendario? La richiesta non viene eliminata.")) return
              togliM.mutate()
            }}
            className="rounded-lg px-3 py-2 text-sm text-red-300"
          >
            Togli data
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-400">
            Chiudi
          </button>
          <button
            type="button"
            disabled={moveM.isPending || nSel < 1}
            onClick={() => moveM.mutate()}
            className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200"
          >
            {nSel > 1 ? `Sposta ${nSel} date` : "Sposta"}
          </button>
        </div>
      </div>
    </div>
  )
}

function DayWeekGrid({
  days,
  ore,
  booked,
  onBook,
  onOpen,
  onTogli,
}: {
  days: string[]
  ore: string[]
  booked: LpLezioneFlat[]
  onBook: (slot: LpSlot) => void
  onOpen: (lezione: LpLezioneFlat) => void
  onTogli: (id: string) => void
}) {
  function hits(giorno: string, ora: string, vasca: VascaId, corsia: number) {
    return booked.filter(
      (l) => l.giorno === giorno && l.vasca === vasca && l.corsia === corsia && l.ora <= ora && ora < addMin(l.ora, l.durataMin),
    )
  }
  const lanes: Array<{ vasca: VascaId; corsia: number; label: string }> = [
    { vasca: "v25", corsia: 1, label: "25m C1" },
    { vasca: "ludica", corsia: 1, label: "Lud C1" },
    { vasca: "ludica", corsia: 2, label: "Lud C2" },
  ]
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
              <Fragment key={`${d}-h`}>
                {lanes.map((ln) => (
                  <th key={`${d}-${ln.label}`} className="px-1 py-1">
                    {ln.label}
                  </th>
                ))}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {ore.map((ora) => (
            <tr key={ora} className="border-b border-zinc-800/40">
              <td className="whitespace-nowrap px-2 py-1 text-left text-zinc-400">{ora}</td>
              {days.flatMap((d) =>
                lanes.map((ln) => {
                  const fascia = slotAperto(d, ora, ln.vasca, ln.corsia)
                  return (
                    <LaneCell
                      key={`${d}-${ln.vasca}-${ln.corsia}`}
                      hits={hits(d, ora, ln.vasca, ln.corsia)}
                      cap={fascia?.capCorsia ?? 0}
                      aperto={!!fascia}
                      slot={{ giorno: d, ora, vasca: ln.vasca, corsia: ln.corsia }}
                      onBook={onBook}
                      onOpen={onOpen}
                      onTogli={onTogli}
                    />
                  )
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function addMin(ora: string, min: number): string {
  const [h, m] = ora.split(":").map(Number)
  const t = h * 60 + m + min
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

function LaneCell({
  hits,
  cap,
  aperto,
  slot,
  onBook,
  onOpen,
  onTogli,
}: {
  hits: LpLezioneFlat[]
  cap: number
  aperto: boolean
  slot: LpSlot
  onBook: (slot: LpSlot) => void
  onOpen: (lezione: LpLezioneFlat) => void
  onTogli: (id: string) => void
}) {
  if (!aperto) {
    return (
      <td className="bg-zinc-950/50 px-1 py-1 text-[10px] text-zinc-600">chiuso</td>
    )
  }
  const liberi = Math.max(0, cap - hits.length)
  return (
    <td className="px-1 py-1 align-top">
      {hits.map((hit) => (
        <div key={hit.lezioneId} className="mb-0.5">
          <button
            type="button"
            onClick={() => onOpen(hit)}
            className="w-full rounded bg-amber-500/15 px-1 py-0.5 text-left text-[11px] text-amber-100 hover:bg-amber-500/25"
          >
            <div className="font-medium">{hit.clienteNome}</div>
            <div className="text-[10px] text-zinc-400">
              {hit.istruttoreNome} · {hit.tipo === "prova" ? "prova" : `pacc. ${hit.tipo}`}
            </div>
          </button>
          <button
            type="button"
            className="mt-0.5 text-[10px] text-red-300"
            onClick={(e) => {
              e.stopPropagation()
              if (!window.confirm("Togliere questa data dal calendario? La richiesta resta.")) return
              onTogli(hit.lezioneId)
            }}
          >
            togli data
          </button>
        </div>
      ))}
      {liberi > 0 ? (
        <button
          type="button"
          onClick={() => onBook(slot)}
          className="w-full rounded px-1 py-1 text-emerald-600/90 hover:bg-emerald-500/10"
        >
          {hits.length === 0 ? `libero${cap > 1 ? ` ${cap}` : ""}` : `+${liberi} posto`}
        </button>
      ) : hits.length === 0 ? (
        <span className="text-zinc-600">—</span>
      ) : null}
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
  onDone,
}: {
  canRoster: boolean
  instructors: LpIstruttore[]
  onDone: () => void
}) {
  const [nome, setNome] = useState("")
  const [tel, setTel] = useState("")
  const addM = useMutation({
    mutationFn: () => lezioniPrivateApi.addIstruttore(nome, tel),
    onSuccess: () => {
      setNome("")
      setTel("")
      onDone()
    },
  })
  const uomini = instructors.filter((i) => i.sesso === "M")
  const donne = instructors.filter((i) => i.sesso === "F")
  const altri = instructors.filter((i) => i.sesso !== "M" && i.sesso !== "F")
  const special = instructors.filter((i) => i.special)

  function riga(i: LpIstruttore) {
    return (
      <li key={i.id} className="flex items-center justify-between gap-2 text-sm text-zinc-200">
        <span>
          {i.nome} <span className="text-zinc-500">{i.telefono || "senza tel."}</span>
          {i.special ? <span className="ml-2 text-xs text-violet-300">special</span> : null}
          {!i.attivo ? <span className="ml-2 text-xs text-zinc-600">disattivo</span> : null}
        </span>
        {canRoster ? (
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className={`text-xs ${i.sesso === "M" ? "text-sky-300" : "text-zinc-500 underline"}`}
              onClick={() => void lezioniPrivateApi.patchIstruttore(i.id, { sesso: "M" }).then(onDone)}
            >
              uomo
            </button>
            <button
              type="button"
              className={`text-xs ${i.sesso === "F" ? "text-pink-300" : "text-zinc-500 underline"}`}
              onClick={() => void lezioniPrivateApi.patchIstruttore(i.id, { sesso: "F" }).then(onDone)}
            >
              donna
            </button>
            <button
              type="button"
              className={`text-xs ${i.special ? "text-violet-300" : "text-zinc-500 underline"}`}
              onClick={() => void lezioniPrivateApi.patchIstruttore(i.id, { special: !i.special }).then(onDone)}
            >
              {i.special ? "special sì" : "special no"}
            </button>
            <button
              type="button"
              className="text-xs text-zinc-500 underline"
              onClick={() => void lezioniPrivateApi.patchIstruttore(i.id, { attivo: !i.attivo }).then(onDone)}
            >
              {i.attivo ? "disattiva" : "attiva"}
            </button>
            <button
              type="button"
              className="text-xs text-red-400 underline"
              onClick={() => {
                if (!window.confirm(`Eliminare ${i.nome} dall'elenco istruttori?`)) return
                void lezioniPrivateApi.deleteIstruttore(i.id).then(onDone)
              }}
            >
              Elimina
            </button>
          </span>
        ) : null}
      </li>
    )
  }

  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-zinc-800 p-4">
        <h2 className="font-semibold text-zinc-100">Istruttori (WhatsApp)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Uomo/donna dal nome; Special è un flag a parte per i ragazzi disabili. Le richieste Special avvisano solo chi
          ha il flag attivo.
        </p>
        {canRoster ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
            <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="Cellulare" className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100" />
            <button type="button" disabled={addM.isPending} onClick={() => addM.mutate()} className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
              Aggiungi
            </button>
          </div>
        ) : null}
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300">Uomini ({uomini.length})</h3>
            <ul className="mt-2 space-y-2">{uomini.length ? uomini.map(riga) : <li className="text-sm text-zinc-500">Nessuno.</li>}</ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-pink-300">Donne ({donne.length})</h3>
            <ul className="mt-2 space-y-2">{donne.length ? donne.map(riga) : <li className="text-sm text-zinc-500">Nessuna.</li>}</ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300">Special ({special.length})</h3>
            <ul className="mt-2 space-y-2">{special.length ? special.map(riga) : <li className="text-sm text-zinc-500">Nessuno abilitato.</li>}</ul>
          </div>
          {altri.length ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-300">Da confermare ({altri.length})</h3>
              <ul className="mt-2 space-y-2">{altri.map(riga)}</ul>
            </div>
          ) : null}
        </div>
      </div>
      <div className="rounded-2xl border border-zinc-800 p-4">
        <h2 className="font-semibold text-zinc-100">Orari vasche (ufficiali)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Il calendario prenota solo in queste fasce. 25 m sabato chiusa. Ludica giovedì chiusa. Mar/ven in ludica solo
          7:30–8:15, 1 persona per corsia.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-zinc-500">
              <th className="py-1 text-left">Giorni</th>
              <th className="py-1 text-left">Vasca</th>
              <th className="py-1 text-left">Orari</th>
              <th className="py-1 text-left">Posti</th>
            </tr>
          </thead>
          <tbody>
            {LP_VASCHE_LEGENDA.map((r) => (
              <tr key={`${r.giorni}-${r.vasca}`} className="text-zinc-300">
                <td className="py-1.5">{r.giorni}</td>
                <td className="py-1.5">{r.vasca}</td>
                <td className="py-1.5 text-zinc-400">{r.orari}</td>
                <td className="py-1.5 text-zinc-400">{r.posti}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
