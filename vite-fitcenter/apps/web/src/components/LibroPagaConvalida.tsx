import { useEffect, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { TurnoConvalidaStato, LpagaConvalidaPayload, LpagaConvalidaMesePayload } from "@/api/lpaga"

const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"

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

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Convalida mensilità</h2>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{data.personaleNome}</p>
          <p className="text-xs text-zinc-500">
            Confronta i turni Libro paga con i calendari FitCenter (corsi, scuola nuoto, fitness, bagnini, desk) e
            con gli accessi tornello, se l’istruttore è in anagrafica gestionale. {nDone}/{data.rows.length}{" "}
            controllati.
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

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Convalida tutto il mese</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {riepilogo.nTurni} turni · {riepilogo.nConfermati} già confermati · {riepilogo.nConfermabili} allineati al
            calendario da confermare · {riepilogo.nAnomalie} anomalie.
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
              {auto.isPending ? "Conferma in corso…" : `Conferma i ${riepilogo.nConfermabili} allineati al calendario`}
            </button>
          )}
          <button type="button" className={btnGhost} onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
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
}: {
  persone: { id: string; label: string }[]
  selected: string[]
  onSave: (ids: string[]) => Promise<unknown>
  onError: (s: string) => void
}) {
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
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <h2 className="text-sm font-medium text-zinc-200">Delega convalida mensilità</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Chi scegli può, a fine mese, convalidare le lezioni del tuo reparto (Ok / Sostituzione / Non svolta) al posto
        tuo.
      </p>
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
      <button type="button" className={`${btnAmber} mt-3`} disabled={mut.isPending} onClick={() => mut.mutate()}>
        Salva deleghe
      </button>
    </div>
  )
}
