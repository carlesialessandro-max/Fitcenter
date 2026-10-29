import { useEffect, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { TurnoConvalidaStato, LpagaConvalidaPayload, LpagaConvalidaMesePayload } from "@/api/lpaga"

const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"

const CALENDARI_SPLIT: { id: string; label: string }[] = [
  { id: "corsi", label: "Corsi fitness" },
  { id: "scuola-nuoto", label: "Scuola nuoto" },
  { id: "sala-fitness", label: "Sala pesi" },
  { id: "piscina", label: "Bagnini" },
  { id: "reception", label: "Desk" },
]

function segmentoDaComparto(comparto?: string): string {
  if (comparto === "scuola_nuoto") return "scuola-nuoto"
  if (comparto === "sala_fitness") return "sala-fitness"
  if (comparto === "piscina") return "piscina"
  if (comparto === "reception") return "reception"
  if (comparto === "corsi") return "corsi"
  return "corsi"
}

function CalendarioSplitFrame({
  segmento,
  date,
  onSegmento,
  onClose,
}: {
  segmento: string
  date?: string
  onSegmento: (id: string) => void
  onClose: () => void
}) {
  const src = `/calendario/${segmento}?embed=1${date ? `&date=${encodeURIComponent(date)}` : ""}`
  return (
    <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 xl:sticky xl:top-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 p-2">
        <select
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          value={segmento}
          onChange={(e) => onSegmento(e.target.value)}
        >
          {CALENDARI_SPLIT.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <a className="text-xs text-amber-300 hover:underline" href={`/calendario/${segmento}`} target="_blank" rel="noreferrer">
          Apri in pagina
        </a>
        <button type="button" className={`${btnGhost} ml-auto`} onClick={onClose}>
          Chiudi split
        </button>
      </div>
      <iframe title="Calendario FitCenter" src={src} className="min-h-[70vh] w-full flex-1 bg-zinc-950" />
    </div>
  )
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function statoLabel(s: string): string {
  if (s === "ok") return "Confermato"
  if (s === "sostituzione") return "Sostituzione"
  if (s === "non_svolta") return "Non svolta"
  return "Da verificare"
}

function statoCls(s: string): string {
  if (s === "ok") return "text-emerald-300"
  if (s === "sostituzione") return "text-amber-300"
  if (s === "non_svolta") return "text-red-400"
  return "text-zinc-400"
}

export type ConvalidaRow = {
  turnoId: string
  personaleId?: string
  giorno: string
  livelloNome: string
  personaleNome: string
  quantita: number
  importo: number
  note?: string
  proposto: TurnoConvalidaStato
  match?: { comparto: string; date: string; start: string; title: string; staff: string; note?: string }
  calendariAttesi?: string[]
  sostitutiPossibili: { comparto: string; date: string; start: string; title: string; staff: string }[]
  salvato?: { stato: TurnoConvalidaStato; nota?: string; sostitutoNome?: string }
  tornello?: { disponibile: boolean; ok: boolean; orario?: string }
}

export type ConvalidaPayload = LpagaConvalidaPayload

export function LibroPagaConvalidaPanel({
  data,
  onClose,
  onSaveTurno,
  onChiudiMese,
  showCalendariFitCenter,
}: {
  data: ConvalidaPayload
  onClose: () => void
  onSaveTurno: (body: {
    turnoId: string
    stato: TurnoConvalidaStato
    nota?: string
    sostitutoNome?: string
  }) => Promise<unknown>
  onChiudiMese?: () => Promise<unknown>
  showCalendariFitCenter?: boolean
}) {
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: onSaveTurno,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lpaga-convalida"] }),
  })
  const chiudi = useMutation({
    mutationFn: () => onChiudiMese?.() ?? Promise.resolve(),
    onSuccess: onClose,
  })
  const nDone = data.rows.filter((r) => r.salvato && r.salvato.stato !== "da_verificare").length
  const [split, setSplit] = useState(false)
  const primaRiga = data.rows.find((r) => r.match?.comparto || (r.calendariAttesi?.length ?? 0) > 0)
  const [segmento, setSegmento] = useState(() =>
    segmentoDaComparto(primaRiga?.match?.comparto ?? primaRiga?.calendariAttesi?.[0])
  )
  const dataSplit = data.rows[0]?.giorno

  return (
    <div className={split ? "xl:grid xl:grid-cols-2 xl:items-start xl:gap-3" : ""}>
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Convalida mensilità</h2>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{data.personaleNome}</p>
          <p className="text-xs text-zinc-500">
            Prima controlla il calendario, poi conferma. Confronta i turni Libro paga con i calendari FitCenter
            (corsi, scuola nuoto, fitness, bagnini, desk). Tornello: basta la prima entrata in struttura quel giorno.
            {" "}
            {nDone}/{data.rows.length} controllati.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onChiudiMese && (
            <button type="button" className={btnAmber} disabled={chiudi.isPending} onClick={() => {
              if (confirm("Chiudere la mensilità? Dopo la chiusura resta visibile, le correzioni si fanno da Modifica.")) chiudi.mutate()
            }}>
              Chiudi mese
            </button>
          )}
          <button type="button" className={btnGhost} onClick={() => setSplit((v) => !v)}>
            {split ? "Chiudi calendario" : "Apri calendario"}
          </button>
          <button type="button" className={btnGhost} onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Se l’istruttore in calendario è diverso da chi ha inserito il turno, usa Sostituzione (e aggiorna il
        calendario). Fogli orari:{" "}
        <a className="text-amber-300 underline" href={data.fogli.bagnini} target="_blank" rel="noreferrer">
          Bagnini
        </a>
        {" · "}
        <a className="text-amber-300 underline" href={data.fogli.desk} target="_blank" rel="noreferrer">
          Desk
        </a>
        {showCalendariFitCenter && (
          <>
            {" · Calendari FitCenter: "}
            <a className="text-amber-300 underline" href="/calendario/corsi">
              Corsi fitness
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/scuola-nuoto">
              Scuola nuoto
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/sala-fitness">
              Sala pesi
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/piscina">
              Bagnini
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/reception">
              Desk
            </a>
          </>
        )}
      </p>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-950/60 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Mansione / valore</th>
                <th className="px-3 py-2">Calendario</th>
                <th className="px-3 py-2">Tornello</th>
                <th className="px-3 py-2">Stato</th>
                <th className="px-3 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const stato = r.salvato?.stato ?? r.proposto
                const sub = r.sostitutiPossibili[0]
                return (
                  <tr key={r.turnoId} className="border-t border-zinc-800 align-top text-zinc-200">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(r.giorno)}</td>
                    <td className="px-3 py-2">
                      <div>{r.livelloNome}</div>
                      <div className="text-xs text-zinc-500">
                        {r.quantita}
                        {r.note ? ` · ${r.note}` : ""}
                      </div>
                    </td>
                  <td className="px-3 py-2 text-xs text-zinc-400">
                    {r.match ? (
                      <span>
                        {r.match.title} · {r.match.start} · {r.match.staff} (
                        {r.match.comparto === "sala_fitness"
                          ? "sala pesi"
                          : r.match.comparto === "scuola_nuoto"
                            ? "scuola nuoto"
                            : r.match.comparto === "corsi"
                              ? "corsi"
                              : r.match.comparto === "piscina"
                                ? "bagnini"
                                : r.match.comparto === "reception"
                                  ? "desk"
                                  : r.match.comparto}
                        )
                      </span>
                    ) : sub ? (
                      <span className="text-amber-300">
                        Possibile sostituzione: {sub.staff} — {sub.title} {sub.start}
                      </span>
                    ) : (
                      <span>
                        Nessuna copertura in{" "}
                        {(r.calendariAttesi ?? [])
                          .map((c) =>
                            c === "sala_fitness"
                              ? "Sala pesi"
                              : c === "scuola_nuoto"
                                ? "Scuola nuoto"
                                : c === "corsi"
                                  ? "Corsi fitness"
                                  : c === "piscina"
                                    ? "Bagnini"
                                    : c === "reception"
                                      ? "Desk"
                                      : c
                          )
                          .join(", ") || "calendario FitCenter"}{" "}
                        per questa data
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{testoTornello(r.tornello)}</td>
                  <td className={`px-3 py-2 text-xs ${statoCls(stato)}`}>{statoLabel(stato)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => mut.mutate({ turnoId: r.turnoId, stato: "ok" })}
                      >
                        Ok
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() =>
                          mut.mutate({
                            turnoId: r.turnoId,
                            stato: "sostituzione",
                            sostitutoNome: sub?.staff ?? r.salvato?.sostitutoNome,
                            nota: sub ? `${sub.title} ${sub.start}` : undefined,
                          })
                        }
                      >
                        Sostituzione
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => mut.mutate({ turnoId: r.turnoId, stato: "non_svolta" })}
                      >
                        Non svolta
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!data.rows.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={6}>
                  Nessun turno in questo mese.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    {split ? (
      <CalendarioSplitFrame
        segmento={segmento}
        date={dataSplit}
        onSegmento={setSegmento}
        onClose={() => setSplit(false)}
      />
    ) : null}
    </div>
  )
}

function labelComparto(c: string): string {
  if (c === "sala_fitness") return "sala pesi"
  if (c === "scuola_nuoto") return "scuola nuoto"
  if (c === "corsi") return "corsi"
  if (c === "piscina") return "bagnini"
  if (c === "reception") return "desk"
  return c
}

function testoTornello(t?: { disponibile: boolean; ok: boolean; orario?: string }): ReactNode {
  if (!t || !t.disponibile) return <span className="text-zinc-500">n/d</span>
  if (t.ok) {
    return <span className="text-emerald-300">Ingresso{t.orario ? ` ${t.orario}` : ""}</span>
  }
  return <span className="text-amber-300">Nessun accesso</span>
}

function testoCalendario(r: ConvalidaRow): ReactNode {
  const sub = r.sostitutiPossibili[0]
  if (r.match) {
    return (
      <span>
        {r.match.title} · {r.match.start} · {r.match.staff} ({labelComparto(r.match.comparto)})
      </span>
    )
  }
  if (sub) {
    return (
      <span className="text-amber-300">
        Possibile sostituzione: {sub.staff} — {sub.title} {sub.start}
      </span>
    )
  }
  const attesi = (r.calendariAttesi ?? [])
    .map((c) => {
      if (c === "sala_fitness") return "Sala pesi"
      if (c === "scuola_nuoto") return "Scuola nuoto"
      if (c === "corsi") return "Corsi fitness"
      if (c === "piscina") return "Bagnini"
      if (c === "reception") return "Desk"
      return c
    })
    .join(", ")
  return <span>Nessuna copertura in {attesi || "calendario FitCenter"} per questa data</span>
}

export function LibroPagaConvalidaMesePanel({
  data,
  onClose,
  onSaveTurno,
  onConfermaAllineati,
  showCalendariFitCenter,
  onFiltriChange,
}: {
  data: LpagaConvalidaMesePayload
  onClose: () => void
  onSaveTurno: (body: {
    turnoId: string
    stato: TurnoConvalidaStato
    nota?: string
    sostitutoNome?: string
  }) => Promise<unknown>
  onConfermaAllineati: () => Promise<LpagaConvalidaMesePayload>
  showCalendariFitCenter?: boolean
  onFiltriChange?: (f: { scope: string; from: string; to: string }) => void
}) {
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: onSaveTurno,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lpaga-convalida-mese"] })
      void qc.invalidateQueries({ queryKey: ["lpaga-convalida"] })
      void qc.invalidateQueries({ queryKey: ["lpaga"] })
      void qc.invalidateQueries({ queryKey: ["libro-paga"] })
    },
  })
  const auto = useMutation({
    mutationFn: onConfermaAllineati,
    onSuccess: (payload) => {
      qc.setQueriesData({ queryKey: ["lpaga-convalida-mese"] }, payload)
      void qc.invalidateQueries({ queryKey: ["lpaga"] })
      void qc.invalidateQueries({ queryKey: ["libro-paga"] })
    },
  })
  const riepilogo = data
  const [split, setSplit] = useState(false)
  const primaAnomalia = riepilogo.anomalie?.[0]
  const [segmento, setSegmento] = useState(() =>
    segmentoDaComparto(primaAnomalia?.match?.comparto ?? primaAnomalia?.calendariAttesi?.[0])
  )
  const dataSplit = riepilogo.from || primaAnomalia?.giorno

  return (
    <div className={split ? "xl:grid xl:grid-cols-2 xl:items-start xl:gap-3" : ""}>
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Controllo calendario</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Prima confronta i turni con i calendari FitCenter, poi conferma quelli allineati.
            {riepilogo.nTurni} turni · {riepilogo.nConfermati} già confermati · {riepilogo.nConfermabili} allineati da
            confermare · {riepilogo.nAnomalie} anomalie. Puoi filtrare per reparto (es. corsi terra / acqua) e per
            settimana.
          </p>
          {((riepilogo.confermatiOra ?? auto.data?.confermatiOra) ?? 0) > 0 && (
            <p className="mt-1 text-xs text-emerald-300">
              Confermati ora {riepilogo.confermatiOra ?? auto.data?.confermatiOra} turni allineati al calendario.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {riepilogo.nConfermabili > 0 && (
            <button
              type="button"
              className={btnAmber}
              disabled={auto.isPending}
              onClick={() => auto.mutate()}
            >
              {auto.isPending ? "Conferma in corso…" : `Conferma i ${riepilogo.nConfermabili} allineati`}
            </button>
          )}
          <button type="button" className={btnGhost} onClick={() => setSplit((v) => !v)}>
            {split ? "Chiudi calendario" : "Apri calendario"}
          </button>
          <button type="button" className={btnGhost} onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
      {(onFiltriChange && ((riepilogo.scopeOpzioni?.length ?? 0) > 0 || (riepilogo.settimane?.length ?? 0) > 0)) ? (
        <div className="flex flex-wrap gap-2">
          {(riepilogo.scopeOpzioni?.length ?? 0) > 0 && (
            <label className="grid gap-1 text-xs text-zinc-400">
              Reparto / mansioni
              <select
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                value={riepilogo.scopeId ?? ""}
                onChange={(e) =>
                  onFiltriChange({
                    scope: e.target.value,
                    from: riepilogo.from ?? "",
                    to: riepilogo.to ?? "",
                  })
                }
              >
                <option value="">Tutti i miei ambiti</option>
                {riepilogo.scopeOpzioni!.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(riepilogo.settimane?.length ?? 0) > 0 && (
            <label className="grid gap-1 text-xs text-zinc-400">
              Periodo
              <select
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                value={riepilogo.from && riepilogo.to ? `${riepilogo.from}|${riepilogo.to}` : ""}
                onChange={(e) => {
                  const [from, to] = e.target.value ? e.target.value.split("|") : ["", ""]
                  onFiltriChange({ scope: riepilogo.scopeId ?? "", from, to })
                }}
              >
                <option value="">Tutto il mese</option>
                {riepilogo.settimane!.map((s) => (
                  <option key={s.id} value={`${s.from}|${s.to}`}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : null}
      <p className="text-xs text-zinc-500">
        I turni allineati al calendario si confermano in un click. Le anomalie (sostituzione, assenza in calendario)
        restano da controllare sotto. Fogli orari:{" "}
        <a className="text-amber-300 underline" href={riepilogo.fogli.bagnini} target="_blank" rel="noreferrer">
          Bagnini
        </a>
        {" · "}
        <a className="text-amber-300 underline" href={riepilogo.fogli.desk} target="_blank" rel="noreferrer">
          Desk
        </a>
        {showCalendariFitCenter && (
          <>
            {" · Calendari FitCenter: "}
            <a className="text-amber-300 underline" href="/calendario/corsi">
              Corsi fitness
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/scuola-nuoto">
              Scuola nuoto
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/sala-fitness">
              Sala pesi
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/piscina">
              Bagnini
            </a>
            {" · "}
            <a className="text-amber-300 underline" href="/calendario/reception">
              Desk
            </a>
          </>
        )}
      </p>
      {riepilogo.nAnomalie === 0 ? (
        <p className="text-sm text-emerald-300">Nessuna anomalia: tutti i turni risultano allineati o già confermati.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Nominativo</th>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Mansione / valore</th>
                <th className="px-3 py-2">Calendario</th>
                <th className="px-3 py-2">Tornello</th>
                <th className="px-3 py-2">Stato</th>
                <th className="px-3 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {riepilogo.anomalie.map((r) => {
                const stato = r.salvato?.stato ?? r.proposto
                const sub = r.sostitutiPossibili[0]
                return (
                  <tr key={r.turnoId} className="border-t border-zinc-800 align-top text-zinc-200">
                    <td className="px-3 py-2">{r.personaleNome}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(r.giorno)}</td>
                    <td className="px-3 py-2">
                      <div>{r.livelloNome}</div>
                      <div className="text-xs text-zinc-500">
                        {r.quantita}
                        {r.note ? ` · ${r.note}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-400">{testoCalendario(r)}</td>
                    <td className="px-3 py-2 text-xs">{testoTornello(r.tornello)}</td>
                    <td className={`px-3 py-2 text-xs ${statoCls(stato)}`}>{statoLabel(stato)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => mut.mutate({ turnoId: r.turnoId, stato: "ok" })}
                        >
                          Ok
                        </button>
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() =>
                            mut.mutate({
                              turnoId: r.turnoId,
                              stato: "sostituzione",
                              sostitutoNome: sub?.staff ?? r.salvato?.sostitutoNome,
                              nota: sub ? `${sub.title} ${sub.start}` : undefined,
                            })
                          }
                        >
                          Sostituzione
                        </button>
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => mut.mutate({ turnoId: r.turnoId, stato: "non_svolta" })}
                        >
                          Non svolta
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    {split ? (
      <CalendarioSplitFrame
        segmento={segmento}
        date={dataSplit}
        onSegmento={setSegmento}
        onClose={() => setSplit(false)}
      />
    ) : null}
    </div>
  )
}

export type ConvalidaScopeRow = {
  id: string
  nome: string
  nTurni: number
  nConfermati: number
  nDaFare: number
}

export type ConvalidaResponsabileRow = {
  personaleId: string
  nominativo: string
  reparto: string
  nTurni?: number
  nConfermati?: number
  nDaFare?: number
  ultima: string | null
  ultimaDa?: string | null
  scopes?: ConvalidaScopeRow[]
}

function convalidaPct(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

function ConvalidaProgressBar({
  done,
  total,
  className = "",
}: {
  done: number
  total: number
  className?: string
}) {
  const pct = convalidaPct(done, total)
  const bar = pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-400" : "bg-zinc-700"
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <div className={`h-full rounded-full transition-[width] ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function fmtStampBreve(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
}

function ScopeConvalidaCard({
  scope,
  selected,
  onToggle,
  onApri,
}: {
  scope: ConvalidaScopeRow
  selected?: boolean
  onToggle?: () => void
  onApri?: (scopeId: string) => void
}) {
  const nFatte = Math.max(0, scope.nTurni - scope.nDaFare)
  const ok = scope.nTurni > 0 && scope.nDaFare === 0
  const ring = selected
    ? "ring-1 ring-amber-400/80 border-amber-500/60 bg-amber-950/25"
    : ok
      ? "border-emerald-900/50 bg-emerald-950/20 hover:border-emerald-700/70"
      : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-600"
  return (
    <div className={`flex flex-col rounded-xl border p-3 transition ${ring}`}>
      <button type="button" onClick={onToggle} className="flex flex-col text-left">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug text-zinc-100">{scope.nome}</p>
          {ok ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              Fatto
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-200">
              {scope.nDaFare} da fare
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs tabular-nums text-zinc-500">
          {nFatte} fatte · {scope.nDaFare} da fare · {scope.nTurni} turni
        </p>
        <ConvalidaProgressBar className="mt-2" done={nFatte} total={scope.nTurni} />
        <p className="mt-2 text-[11px] text-zinc-500">
          {selected ? "Selezionato per l’elenco turni" : "Clicca per filtrare l’elenco turni"}
        </p>
      </button>
      {onApri ? (
        <button
          type="button"
          className="mt-2 self-start text-[11px] font-medium text-amber-300 hover:underline"
          onClick={() => onApri(scope.id)}
        >
          Controlla calendario
        </button>
      ) : null}
    </div>
  )
}

/** Lista responsabili: click per i sottoreparti (fatte / da fare). Il responsabile vede solo i propri. */
export function LibroPagaConvalideLista({
  responsabili,
  onlyMine,
  aperto,
  onApertoChange,
  selectedScopeIds,
  onSelectedScopeIdsChange,
  onApriScope,
}: {
  responsabili: ConvalidaResponsabileRow[]
  onlyMine?: boolean
  aperto?: string | null
  onApertoChange?: (id: string | null) => void
  selectedScopeIds?: string[]
  onSelectedScopeIdsChange?: (ids: string[]) => void
  onApriScope?: (scopeId: string) => void
}) {
  const [apertoInterno, setApertoInterno] = useState<string | null>(
    onlyMine && responsabili[0] ? responsabili[0].personaleId : null
  )
  const apertoId = onApertoChange ? (aperto ?? null) : apertoInterno
  const sel = selectedScopeIds ?? []

  function setApertoId(id: string | null) {
    if (onApertoChange) onApertoChange(id)
    else setApertoInterno(id)
    onSelectedScopeIdsChange?.([])
  }

  function toggleScope(id: string) {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
    onSelectedScopeIdsChange?.(next)
  }

  if (!responsabili.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
        Nessun responsabile con turni nel periodo.
      </p>
    )
  }

  const lista = onlyMine ? responsabili.slice(0, 1) : responsabili

  return (
    <div className="space-y-2">
      {lista.map((c) => {
        const nTurni = c.nTurni ?? 0
        const nDaFare = c.nDaFare ?? 0
        const nConf = c.nConfermati ?? 0
        const nFatte = Math.max(0, nTurni - nDaFare)
        const ok = nTurni > 0 && nDaFare === 0
        const scopes = (c.scopes ?? []).filter((s) => s.nTurni > 0)
        const isOpen = onlyMine || apertoId === c.personaleId
        const pct = convalidaPct(nFatte, nTurni)
        return (
          <div
            key={c.personaleId}
            className={
              isOpen
                ? "overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/50"
                : "overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40"
            }
          >
            {onlyMine ? (
              <div className="border-b border-zinc-800 px-4 py-3">
                <p className="text-sm font-medium text-zinc-100">{c.nominativo}</p>
                <p className="text-xs text-zinc-500">{c.reparto || "Reparti assegnati"}</p>
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900/70"
                onClick={() => setApertoId(apertoId === c.personaleId ? null : c.personaleId)}
                aria-expanded={isOpen}
              >
                <span
                  className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-400" : nDaFare ? "bg-amber-400" : "bg-zinc-600"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-100">{c.nominativo}</span>
                  <span className="block truncate text-xs text-zinc-500">{c.reparto || "—"}</span>
                </span>
                <span className="hidden min-w-[9rem] sm:block">
                  {nTurni > 0 ? (
                    <>
                      <span className="mb-1 flex justify-between text-[11px] tabular-nums text-zinc-500">
                        <span>
                          {nFatte}/{nTurni}
                        </span>
                        <span>{pct}%</span>
                      </span>
                      <ConvalidaProgressBar done={nFatte} total={nTurni} />
                    </>
                  ) : (
                    <span className="text-xs text-zinc-600">Nessun turno</span>
                  )}
                </span>
                <span
                  className={
                    ok
                      ? "shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300"
                      : nDaFare
                        ? "shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-200"
                        : "shrink-0 rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-400"
                  }
                >
                  {nTurni === 0 ? "—" : ok ? "Completo" : `${nDaFare} da fare`}
                </span>
                <span className={`shrink-0 text-zinc-500 transition ${isOpen ? "rotate-90" : ""}`}>›</span>
              </button>
            )}
            {isOpen ? (
              <div className="space-y-3 border-t border-zinc-800 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
                    <span>
                      Confermati <span className="tabular-nums text-emerald-300">{nConf}</span>
                    </span>
                    <span>
                      Da fare <span className="tabular-nums text-amber-300">{nDaFare}</span>
                    </span>
                    <span>
                      Turni <span className="tabular-nums text-zinc-300">{nTurni}</span>
                    </span>
                    {c.ultima ? (
                      <span>
                        Ultima {fmtStampBreve(c.ultima)}
                        {c.ultimaDa ? ` · ${c.ultimaDa}` : ""}
                      </span>
                    ) : null}
                  </div>
                  {sel.length > 0 ? (
                    <button
                      type="button"
                      className="text-[11px] text-amber-300 hover:underline"
                      onClick={() => onSelectedScopeIdsChange?.([])}
                    >
                      Mostra tutto il reparto
                    </button>
                  ) : (
                    <span className="text-[11px] text-zinc-500">Elenco turni: tutto il reparto</span>
                  )}
                </div>
                {scopes.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {scopes.map((s) => (
                      <ScopeConvalidaCard
                        key={s.id}
                        scope={s}
                        selected={sel.includes(s.id)}
                        onToggle={() => toggleScope(s.id)}
                        onApri={onApriScope}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">Nessun sottoreparto con turni in questo periodo.</p>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function rootsFiltroTurniConvalide(
  responsabile: ConvalidaResponsabileRow | undefined,
  selectedScopeIds: string[]
): string[] | null {
  if (!responsabile) return null
  if (selectedScopeIds.length) return selectedScopeIds
  const ids = (responsabile.scopes ?? []).filter((s) => s.nTurni > 0).map((s) => s.id)
  return ids.length ? ids : []
}

export function LibroPagaTurniConvalidaElenco({
  turni,
  title,
  hint,
}: {
  turni: {
    id: string
    giorno: string
    livelloNome: string
    personaleNome: string
    convalidaStato?: string | null
    convalidaDa?: string | null
  }[]
  title: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-zinc-500">{hint}</p> : null}
        </div>
        <p className="text-xs tabular-nums text-zinc-500">{turni.length} turni</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Mansione</th>
              <th className="px-3 py-2">Dipendente</th>
              <th className="px-3 py-2">Convalida</th>
              <th className="px-3 py-2">Da</th>
            </tr>
          </thead>
          <tbody>
            {turni.map((t) => {
              const s = t.convalidaStato ?? ""
              const label =
                s === "ok"
                  ? "Confermato"
                  : s === "sostituzione"
                    ? "Sostituzione"
                    : s === "non_svolta"
                      ? "Non svolta"
                      : s === "da_verificare"
                        ? "Da verificare"
                        : "Da fare"
              return (
                <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2">{fmtDateIt(t.giorno)}</td>
                  <td className="px-3 py-2">{t.livelloNome}</td>
                  <td className="px-3 py-2">{t.personaleNome}</td>
                  <td className="px-3 py-2 text-zinc-300">{label}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{t.convalidaDa ?? "—"}</td>
                </tr>
              )
            })}
            {!turni.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={5}>
                  Nessun turno per la selezione.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function useLibroPagaConvalidaMese(
  mese: string,
  enabled: boolean,
  fetcher: (mese: string) => Promise<LpagaConvalidaMesePayload>,
  scope?: string
) {
  return useQuery({
    queryKey: ["lpaga-convalida-mese", mese, scope ?? ""],
    queryFn: () => fetcher(mese),
    enabled,
  })
}

export function useLibroPagaConvalida(
  mese: string,
  personaleId: string | null,
  fetcher: (mese: string, personaleId: string) => Promise<ConvalidaPayload>
) {
  return useQuery({
    queryKey: ["lpaga-convalida", mese, personaleId],
    queryFn: () => fetcher(mese, personaleId!),
    enabled: Boolean(personaleId),
  })
}

export function LibroPagaDelegheForm({
  persone,
  selected,
  onSave,
  onError,
  extra,
}: {
  persone: { id: string; label: string }[]
  selected: string[]
  onSave: (ids: string[]) => Promise<unknown>
  onError: (s: string) => void
  extra?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [ids, setIds] = useState(selected)
  useEffect(() => {
    setIds(selected)
  }, [selected])
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: () => onSave(ids),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lpaga"] })
      void qc.invalidateQueries({ queryKey: ["lpaga-deleghe"] })
    },
    onError: (e: Error) => onError(e.message),
  })
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
          Assegna deleghe
        </button>
        {selected.length > 0 && (
          <span className="text-xs text-zinc-500">
            {selected.length} {selected.length === 1 ? "delega già assegnata" : "deleghe già assegnate"}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
      <h2 className="mb-4 border-b border-zinc-800 pb-2 text-sm font-medium text-zinc-200">Assegna deleghe</h2>
      <p className="text-xs text-zinc-500">
        Chi scegli può, a fine mese, convalidare le lezioni del tuo reparto (Ok / Sostituzione / Non svolta) al posto
        tuo.
      </p>
      {extra ? <div className="mt-3">{extra}</div> : null}
      <div className="mt-3 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
        {persone.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={(e) =>
                setIds((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))
              }
            />
            {p.label}
          </label>
        ))}
        {!persone.length && <p className="text-xs text-zinc-500">Nessun istruttore nel reparto.</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            setIds(selected)
            setOpen(false)
          }}
        >
          Annulla
        </button>
        <button type="button" className={btnAmber} disabled={mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? "Salvataggio…" : "Salva"}
        </button>
      </div>
    </div>
  )
}
