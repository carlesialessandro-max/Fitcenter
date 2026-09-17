import { Fragment, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { prenotazioniApi } from "@/api/prenotazioni"
import { corsiGestioneApi } from "@/api/corsiGestione"
import { TabellaOrariaSettimana } from "@/components/TabellaOrariaSettimana"
import { useAuth } from "@/contexts/AuthContext"
import { oreCoperteLezione, weekMondaySunday } from "@/lib/tabella-oraria"
import {
  buildAccessIndexForDay,
  corsoAmbitoOf,
  fmtDateIt,
  groupByCorso,
  isPresentByAccess,
  isWalkInRow,
  isoToday,
  mergeWalkInsIntoGruppi,
  monthRangeFromDay,
  participantForLessonAccess,
  participantStableKey,
  type CorsoAmbito,
} from "@/pages/Corsi"

type Periodo = "giorno" | "settimana" | "mese"
type Vista = "corso" | "tipologia" | "oraria"

type DayAgg = {
  giorno: string
  prenotati: number
  presenti: number
  assenti: number
  manuali: number
}

type AggRow = {
  key: string
  label: string
  ambito: "fitness" | "h2o" | "misto"
  prenotati: number
  presenti: number
  assenti: number
  manuali: number
  giorni: DayAgg[]
}

function toIsoUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function weekRangeFromDay(dayIso: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayIso)
  if (!m) return { from: dayIso, to: dayIso }
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0))
  const dow = dt.getUTCDay()
  const mondayOff = dow === 0 ? -6 : 1 - dow
  const mon = new Date(dt)
  mon.setUTCDate(dt.getUTCDate() + mondayOff)
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)
  const today = isoToday()
  let to = toIsoUtc(sun)
  if (to > today) to = today
  return { from: toIsoUtc(mon), to }
}

function pct(num: number, den: number): string {
  if (den <= 0) return "—"
  return `${Math.round((num / den) * 100)}%`
}

function emptyAgg(key: string, label: string, ambito: AggRow["ambito"]): AggRow {
  return { key, label, ambito, prenotati: 0, presenti: 0, assenti: 0, manuali: 0, giorni: [] }
}

function presenceRate(r: Pick<AggRow, "prenotati" | "presenti" | "manuali">): number {
  const den = r.prenotati + r.manuali
  return den <= 0 ? 1 : r.presenti / den
}

function mediaPresentiGiorno(r: AggRow): number | null {
  if (!r.giorni.length) return null
  return r.presenti / r.giorni.length
}

function isPochePresenze(r: AggRow): boolean {
  const media = mediaPresentiGiorno(r)
  if (media != null && media < 4) return true
  return presenceRate(r) < 0.5 && r.prenotati + r.manuali > 0
}

export function CorsiPresenze() {
  const { role } = useAuth()
  const enabled = role === "admin" || role === "corsi" || role === "istruttore"
  const [day, setDay] = useState(() => isoToday())
  const [periodo, setPeriodo] = useState<Periodo>("giorno")
  const [ambito, setAmbito] = useState<CorsoAmbito>("tutti")
  const [vista, setVista] = useState<Vista>("corso")
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const week = useMemo(() => weekMondaySunday(day), [day])

  const range = useMemo(() => {
    if (vista === "oraria") return { from: week.from, to: week.to }
    if (periodo === "giorno") return { from: day, to: day }
    if (periodo === "settimana") return weekRangeFromDay(day)
    return monthRangeFromDay(day)
  }, [day, periodo, vista, week.from, week.to])

  const prenQ = useQuery({
    queryKey: ["prenotazioni-corsi-range", range.from, range.to],
    queryFn: () => prenotazioniApi.listPrenotazioniRange({ from: range.from, to: range.to }),
    enabled,
    staleTime: 30_000,
    retry: false,
  })
  const accessiQ = useQuery({
    queryKey: ["accessi-utenti-range", range.from, range.to],
    queryFn: () => prenotazioniApi.listAccessiRange({ from: range.from, to: range.to }),
    enabled,
    staleTime: 30_000,
    retry: false,
  })
  const gestioneQ = useQuery({
    queryKey: ["corsi-gestione-range", range.from, range.to],
    queryFn: () => corsiGestioneApi.getByRange(range.from, range.to),
    enabled,
    staleTime: 15_000,
    retry: false,
  })

  const report = useMemo(() => {
    const rows = prenQ.data?.rows ?? []
    const byDay = new Map<string, typeof rows>()
    for (const r of rows) {
      const d = String(r.giorno ?? "").slice(0, 10)
      if (!d) continue
      const list = byDay.get(d) ?? []
      list.push(r)
      byDay.set(d, list)
    }
    const days: string[] = []
    const cur = new Date(`${range.from}T12:00:00`)
    const end = new Date(`${range.to}T12:00:00`)
    while (cur.getTime() <= end.getTime()) {
      const y = cur.getFullYear()
      const mo = String(cur.getMonth() + 1).padStart(2, "0")
      const dd = String(cur.getDate()).padStart(2, "0")
      days.push(`${y}-${mo}-${dd}`)
      cur.setDate(cur.getDate() + 1)
    }

    const byCorso = new Map<string, AggRow>()
    const byTipo = {
      fitness: emptyAgg("fitness", "Fitness", "fitness"),
      h2o: emptyAgg("h2o", "H2O", "h2o"),
    }

    for (const giorno of days) {
      const accessIdx = buildAccessIndexForDay(accessiQ.data?.rows ?? [], giorno)
      const groups = mergeWalkInsIntoGruppi(
        groupByCorso(byDay.get(giorno) ?? []),
        gestioneQ.data?.walkInsByDay?.[giorno],
      )
      const appello = gestioneQ.data?.appelloByDay?.[giorno] ?? {}
      for (const g of groups) {
        if (g.key.includes("__WAITLIST")) continue
        const attivi = g.partecipanti.filter((p) => !p.inAttesa)
        if (!attivi.length) continue
        const amb = corsoAmbitoOf(g)
        if (ambito !== "tutti" && amb !== ambito) continue
        const corsoKey = g.servizio.trim().toLocaleLowerCase()
        const corso = byCorso.get(corsoKey) ?? emptyAgg(corsoKey, g.servizio, amb)
        if (corso.ambito !== amb) corso.ambito = "misto"
        const tipo = byTipo[amb]
        let daySlot = corso.giorni.find((d) => d.giorno === giorno)
        if (!daySlot) {
          daySlot = { giorno, prenotati: 0, presenti: 0, assenti: 0, manuali: 0 }
          corso.giorni.push(daySlot)
        }
        let counted = 0
        g.partecipanti.forEach((p, idx) => {
          if (p.inAttesa) return
          const walkIn = isWalkInRow(p)
          const k = `${g.key}::${participantStableKey(p, idx)}`
          const pWithTimes = participantForLessonAccess(g, p, giorno)
          const fromAccess = isPresentByAccess(accessIdx, pWithTimes, giorno).present
          const ov = Object.prototype.hasOwnProperty.call(appello, k) ? !!appello[k] : undefined
          const presente = walkIn ? true : (ov ?? fromAccess)
          counted += 1
          if (walkIn) {
            corso.manuali += 1
            corso.presenti += 1
            daySlot.manuali += 1
            daySlot.presenti += 1
            tipo.manuali += 1
            tipo.presenti += 1
            return
          }
          corso.prenotati += 1
          daySlot.prenotati += 1
          tipo.prenotati += 1
          if (presente) {
            corso.presenti += 1
            daySlot.presenti += 1
            tipo.presenti += 1
          } else {
            corso.assenti += 1
            daySlot.assenti += 1
            tipo.assenti += 1
          }
        })
        if (counted > 0) {
          if (daySlot.prenotati + daySlot.manuali === 0) {
            corso.giorni = corso.giorni.filter((d) => d !== daySlot)
          } else {
            byCorso.set(corsoKey, corso)
          }
        } else {
          corso.giorni = corso.giorni.filter((d) => d !== daySlot)
        }
      }
    }

    const corsi = [...byCorso.values()]
      .filter((r) => r.prenotati + r.manuali > 0)
      .map((r) => ({ ...r, giorni: [...r.giorni].sort((a, b) => a.giorno.localeCompare(b.giorno)) }))
      .sort((a, b) => {
        if (periodo !== "giorno") {
          const la = isPochePresenze(a) ? 0 : 1
          const lb = isPochePresenze(b) ? 0 : 1
          if (la !== lb) return la - lb
          const ma = mediaPresentiGiorno(a) ?? 99
          const mb = mediaPresentiGiorno(b) ?? 99
          if (ma !== mb) return ma - mb
          const ra = presenceRate(a)
          const rb = presenceRate(b)
          if (ra !== rb) return ra - rb
        }
        return a.label.localeCompare(b.label, "it")
      })
    const totale = emptyAgg("totale", "Totale", ambito === "h2o" ? "h2o" : ambito === "fitness" ? "fitness" : "misto")
    for (const r of corsi) {
      totale.prenotati += r.prenotati
      totale.presenti += r.presenti
      totale.assenti += r.assenti
      totale.manuali += r.manuali
    }
    return { corsi, tipi: [byTipo.fitness, byTipo.h2o], totale }
  }, [prenQ.data, accessiQ.data, gestioneQ.data, range.from, range.to, ambito, periodo])

  const orariaValues = useMemo(() => {
    const rows = prenQ.data?.rows ?? []
    const byDay = new Map<string, typeof rows>()
    for (const r of rows) {
      const d = String(r.giorno ?? "").slice(0, 10)
      if (!d) continue
      const list = byDay.get(d) ?? []
      list.push(r)
      byDay.set(d, list)
    }
    const out: Record<string, Record<string, number | null>> = {}
    for (const giorno of week.days) {
      const cells: Record<string, number | null> = {}
      const accessIdx = buildAccessIndexForDay(accessiQ.data?.rows ?? [], giorno)
      const groups = mergeWalkInsIntoGruppi(
        groupByCorso(byDay.get(giorno) ?? []),
        gestioneQ.data?.walkInsByDay?.[giorno],
      )
      const appello = gestioneQ.data?.appelloByDay?.[giorno] ?? {}
      for (const g of groups) {
        if (g.key.includes("__WAITLIST")) continue
        const amb = corsoAmbitoOf(g)
        if (ambito !== "tutti" && amb !== ambito) continue
        const attivi = g.partecipanti.filter((p) => !p.inAttesa)
        if (!attivi.length) continue
        const hours = oreCoperteLezione(g.oraInizio, g.oraFine)
        if (!hours.length) continue
        for (const ora of hours) {
          if (cells[ora] == null) cells[ora] = 0
        }
        g.partecipanti.forEach((p, idx) => {
          if (p.inAttesa) return
          const walkIn = isWalkInRow(p)
          const k = `${g.key}::${participantStableKey(p, idx)}`
          const pWithTimes = participantForLessonAccess(g, p, giorno)
          const fromAccess = isPresentByAccess(accessIdx, pWithTimes, giorno).present
          const ov = Object.prototype.hasOwnProperty.call(appello, k) ? !!appello[k] : undefined
          const presente = walkIn ? true : (ov ?? fromAccess)
          if (!presente) return
          for (const ora of hours) cells[ora] = (cells[ora] ?? 0) + 1
        })
      }
      out[giorno] = cells
    }
    return out
  }, [prenQ.data, accessiQ.data, gestioneQ.data, week.days, ambito])

  const tableRows = vista === "tipologia" ? report.tipi.filter((r) => r.prenotati + r.manuali > 0 || ambito === "tutti") : report.corsi

  if (!enabled) {
    return <div className="p-6 text-red-400">Permessi insufficienti.</div>
  }

  const loading = prenQ.isLoading || accessiQ.isLoading || gestioneQ.isLoading
  const err = prenQ.error || accessiQ.error || gestioneQ.error
  const canDrill = vista === "corso" && periodo !== "giorno"

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Presenze corsi</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Solo corsi con iscritti nel periodo. In settimana e mese i corsi con poche presenze stanno in cima: clicca per
            vedere la frequenza giorno per giorno.
          </p>
          <p className="mt-2 flex flex-wrap gap-3">
            <Link to="/corsi" className="text-sm font-medium text-[#46A6D9] underline-offset-2 hover:underline">
              Torna a Corsi
            </Link>
            {role === "admin" || role === "corsi" ? (
              <Link to="/corsi/nuoto-libero" className="text-sm font-medium text-amber-300 underline-offset-2 hover:underline">
                Nuoto libero
              </Link>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {vista !== "oraria" ? (
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Periodo</span>
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
                  onClick={() => {
                    setPeriodo(id)
                    setExpandedKey(null)
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    periodo === id ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          ) : null}
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>{vista !== "oraria" && periodo === "mese" ? "Mese" : "Giorno"}</span>
            {vista !== "oraria" && periodo === "mese" ? (
              <input
                type="month"
                value={day.slice(0, 7)}
                onChange={(e) => {
                  const v = e.target.value
                  if (/^\d{4}-\d{2}$/.test(v)) {
                    setDay(`${v}-01`)
                    setExpandedKey(null)
                  }
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
              />
            ) : (
              <input
                type="date"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value)
                  setExpandedKey(null)
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
              />
            )}
          </label>
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Ambito</span>
            <div className="flex rounded-lg border border-zinc-700 bg-zinc-900/50 p-0.5">
              {(
                [
                  ["tutti", "Tutti"],
                  ["fitness", "Fitness"],
                  ["h2o", "H2O"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAmbito(id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    ambito === id ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Vista</span>
            <div className="flex rounded-lg border border-zinc-700 bg-zinc-900/50 p-0.5">
              {(
                [
                  ["corso", "Per corso"],
                  ["tipologia", "Per tipologia"],
                  ["oraria", "Oraria"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setVista(id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    vista === id ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-zinc-600 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
          >
            Stampa
          </button>
        </div>
      </div>

      <p className="mt-4 text-sm text-zinc-400 print:text-zinc-700">
        {vista === "oraria"
          ? `Tabella oraria · ${fmtDateIt(week.from)} – ${fmtDateIt(week.to)}`
          : `Dal ${fmtDateIt(range.from)} al ${fmtDateIt(range.to)}`}
        {ambito !== "tutti" ? ` · ${ambito === "h2o" ? "H2O" : "Fitness"}` : ""}
      </p>

      {vista !== "oraria" ? (
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Kpi label="Prenotati" value={report.totale.prenotati} />
        <Kpi label="Presenti" value={report.totale.presenti} tone="emerald" />
        <Kpi label="Assenti" value={report.totale.assenti} />
        <Kpi label="Ingressi manuali" value={report.totale.manuali} tone="amber" />
      </div>
      ) : null}

      {err ? (
        <p className="mt-4 text-sm text-red-400">{String((err as Error).message ?? err)}</p>
      ) : null}
      {loading ? <p className="mt-4 text-sm text-zinc-500">Caricamento…</p> : null}

      {vista === "oraria" ? (
        <div className="mt-5">
          <TabellaOrariaSettimana days={week.days} values={orariaValues} />
          <p className="mt-3 text-xs text-zinc-500 print:hidden">
            Cella vuota = nessun corso in quella fascia. Zero = lezione in orario ma nessuno presente. Per il nuoto libero
            senza prenotazione usare la pagina dedicata.
          </p>
        </div>
      ) : (
      <div className="mt-5 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/30 print:border-zinc-300">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/50 print:bg-white">
              <th className="px-4 py-3 font-medium text-zinc-400">{vista === "corso" ? "Corso" : "Tipologia"}</th>
              {vista === "corso" ? <th className="px-4 py-3 font-medium text-zinc-400">Ambito</th> : null}
              {canDrill ? <th className="px-4 py-3 font-medium text-zinc-400">Media/giorno</th> : null}
              <th className="px-4 py-3 font-medium text-zinc-400">Prenotati</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Presenti</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Assenti</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Manuali</th>
              <th className="px-4 py-3 font-medium text-zinc-400">% presenza</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 && !loading ? (
              <tr>
                <td colSpan={canDrill ? 8 : 7} className="px-4 py-6 text-zinc-500">
                  Nessun corso con iscritti nel periodo.
                </td>
              </tr>
            ) : null}
            {tableRows.map((r) => {
              const poche = isPochePresenze(r)
              const media = mediaPresentiGiorno(r)
              const open = canDrill && expandedKey === r.key
              return (
                <Fragment key={r.key}>
                  <tr
                    className={`border-b border-zinc-800/60 last:border-0 ${
                      poche ? "bg-amber-500/10" : ""
                    } ${canDrill ? "cursor-pointer hover:bg-zinc-800/50" : ""}`}
                    onClick={
                      canDrill
                        ? () => setExpandedKey((prev) => (prev === r.key ? null : r.key))
                        : undefined
                    }
                  >
                    <td className="px-4 py-2.5 font-medium text-zinc-100 print:text-zinc-900">
                      {canDrill ? <span className="mr-2 text-zinc-500">{open ? "▾" : "▸"}</span> : null}
                      {r.label}
                      {poche ? (
                        <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                          poche presenze
                        </span>
                      ) : null}
                    </td>
                    {vista === "corso" ? (
                      <td className="px-4 py-2.5 text-zinc-400">{r.ambito === "h2o" ? "H2O" : r.ambito === "misto" ? "Misto" : "Fitness"}</td>
                    ) : null}
                    {canDrill ? (
                      <td className={`px-4 py-2.5 ${poche ? "text-amber-200" : "text-zinc-200"}`}>
                        {media == null ? "—" : String(Math.round(media * 10) / 10).replace(".", ",")}
                      </td>
                    ) : null}
                    <td className="px-4 py-2.5 text-zinc-200">{r.prenotati}</td>
                    <td className="px-4 py-2.5 text-emerald-200 print:text-zinc-800">{r.presenti}</td>
                    <td className="px-4 py-2.5 text-zinc-300">{r.assenti}</td>
                    <td className="px-4 py-2.5 text-amber-200 print:text-zinc-800">{r.manuali}</td>
                    <td className="px-4 py-2.5 text-zinc-200">{pct(r.presenti, r.prenotati + r.manuali)}</td>
                  </tr>
                  {open ? (
                    <tr className="border-b border-zinc-800/60 bg-zinc-950/60">
                      <td colSpan={canDrill ? 8 : 7} className="px-4 py-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Frequenza giorno per giorno · {r.label}
                        </p>
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="text-zinc-500">
                              <th className="py-1 pr-3 font-medium">Giorno</th>
                              <th className="py-1 pr-3 font-medium">Prenotati</th>
                              <th className="py-1 pr-3 font-medium">Presenti</th>
                              <th className="py-1 pr-3 font-medium">Assenti</th>
                              <th className="py-1 pr-3 font-medium">Manuali</th>
                              <th className="py-1 font-medium">% presenza</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.giorni.map((d) => {
                              const pocheGiorno = d.presenti < 4 && d.prenotati + d.manuali > 0
                              return (
                                <tr key={d.giorno} className={pocheGiorno ? "text-amber-200" : "text-zinc-200"}>
                                  <td className="py-1 pr-3">{fmtDateIt(d.giorno)}</td>
                                  <td className="py-1 pr-3">{d.prenotati}</td>
                                  <td className="py-1 pr-3">{d.presenti}</td>
                                  <td className="py-1 pr-3">{d.assenti}</td>
                                  <td className="py-1 pr-3">{d.manuali}</td>
                                  <td className="py-1">{pct(d.presenti, d.prenotati + d.manuali)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
          {tableRows.length > 0 ? (
            <tfoot>
              <tr className="bg-zinc-950/60 font-semibold print:bg-zinc-100">
                <td className="px-4 py-3 text-zinc-100">Totale</td>
                {vista === "corso" ? <td className="px-4 py-3 text-zinc-400">—</td> : null}
                {canDrill ? <td className="px-4 py-3 text-zinc-400">—</td> : null}
                <td className="px-4 py-3 text-zinc-100">{report.totale.prenotati}</td>
                <td className="px-4 py-3 text-emerald-200">{report.totale.presenti}</td>
                <td className="px-4 py-3 text-zinc-100">{report.totale.assenti}</td>
                <td className="px-4 py-3 text-amber-200">{report.totale.manuali}</td>
                <td className="px-4 py-3 text-zinc-100">
                  {pct(report.totale.presenti, report.totale.prenotati + report.totale.manuali)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" }) {
  const cls =
    tone === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "amber"
        ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
        : "border-zinc-800 bg-zinc-950/40 text-zinc-100"
  return (
    <div className={`rounded-2xl border px-4 py-3 print:border-zinc-300 ${cls}`}>
      <div className="text-xs font-medium text-zinc-400 print:text-zinc-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}
