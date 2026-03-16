import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { chiamateApi, type EsitoChiamata } from "@/api/chiamate"
import { useAuth } from "@/contexts/AuthContext"
import { ChiamaButton } from "@/components/ChiamaButton"
import type { CategoriaAbbonamento } from "@/types/gestionale"

const ESITO_LABELS: Record<EsitoChiamata, string> = {
  risposto: "Risposto",
  non_risposto: "Non risposto",
  occupato: "Occupato",
  altro: "Altro",
}

const CAT_LABELS: Record<CategoriaAbbonamento, string> = {
  palestra: "Palestra",
  piscina: "Piscina",
  spa: "Spa",
  corsi: "Corsi",
  full_premium: "Full Premium",
}
const CAT_COLORS: Record<CategoriaAbbonamento, string> = {
  palestra: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  piscina: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  spa: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  corsi: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  full_premium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
}

/** Parse data (YYYY-MM-DD o DD/MM/YYYY) per confronti */
function parseDataScadenza(s: string): Date {
  if (!s) return new Date(0)
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(t)
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  return new Date(t)
}

/** Esclude tesseramenti (ASI + iscrizione, ecc.): non vanno in lista "in scadenza". Inclusi abbonamenti a 39€. */
function isTesseramento(a: { pianoNome?: string; prezzo?: number }): boolean {
  if (a.prezzo != null && Number(a.prezzo) === 39) return true
  const nome = (a.pianoNome ?? "").toLowerCase()
  return nome.includes("tesserament") || (nome.includes("asi") && nome.includes("isc"))
}

export function Abbonamenti() {
  const { role, consulenteFilter, consulenteNome } = useAuth()
  const [tab, setTab] = useState<"abbonamenti" | "andamento">("abbonamenti")
  /** Giorni per filtro scadenza: da oggi a 30 o 60 giorni */
  const [giorniScadenza, setGiorniScadenza] = useState<30 | 60>(60)

  const { data: dashboard } = useQuery({
    queryKey: ["dashboard", consulenteFilter],
    queryFn: () => dataApi.getDashboard(consulenteFilter),
  })
  const { data: abbonamenti = [], isLoading, error } = useQuery({
    queryKey: ["data", "abbonamenti", consulenteFilter ?? ""],
    queryFn: () => dataApi.getAbbonamenti(consulenteFilter ?? undefined),
    staleTime: 2 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const { data: clienti = [] } = useQuery({
    queryKey: ["data", "clienti"],
    queryFn: () => dataApi.getClienti(),
  })
  const { data: chiamateCliente = [] } = useQuery({
    queryKey: ["chiamate", "cliente"],
    queryFn: () => chiamateApi.list({ tipo: "cliente" }),
  })

  const telefonoByClienteId = useMemo(() => {
    const map = new Map<string, string>()
    clienti.forEach((c) => map.set(c.id, c.telefono ?? ""))
    return map
  }, [clienti])

  /** Per colonna Stato chiamate: ultima chiamata e conteggio per cliente (come in CRM vendita). API ordina per data desc. */
  const statoChiamateByClienteId = useMemo(() => {
    const byCliente = new Map<
      string,
      { last: { dataOra: string; esito?: EsitoChiamata }; count: number }
    >()
    chiamateCliente.forEach((c) => {
      const id = c.clienteId ?? ""
      if (!id) return
      const cur = byCliente.get(id)
      if (!cur) {
        byCliente.set(id, {
          last: { dataOra: c.dataOra ?? "", esito: c.esito },
          count: 1,
        })
      } else {
        byCliente.set(id, { ...cur, count: cur.count + 1 })
      }
    })
    return byCliente
  }, [chiamateCliente])

  /** Solo abbonamenti della consulente loggata (match normalizzato: stesso nome o uno contiene l'altro) */
  const abbonamentiScope = useMemo(() => {
    if (role === "admin") return abbonamenti
    const target = (consulenteNome ?? "").toLowerCase().trim()
    if (!target) return abbonamenti
    return abbonamenti.filter((a) => {
      const row = (a.consulenteNome ?? "").toLowerCase().trim()
      return row === target || row.includes(target) || target.includes(row)
    })
  }, [abbonamenti, role, consulenteNome])

  /** Solo abbonamenti attivi che scadono da oggi a N giorni (30 o 60), esclusi quelli già rinnovati, ordinati per DataFine. Rinnovato calcolato qui per evitare dipendenze instabili. */
  const listaAbbonamenti = useMemo(() => {
    const oggi = new Date()
    oggi.setHours(0, 0, 0, 0)
    const traNGiorni = new Date(oggi)
    traNGiorni.setDate(traNGiorni.getDate() + giorniScadenza)

    const isRinnovato = (a: (typeof abbonamentiScope)[0]): boolean => {
      const fineA = parseDataScadenza(a.dataFine).getTime()
      if (!fineA || Number.isNaN(fineA)) return false
      const clienteId = String(a.clienteId ?? "").trim()
      if (!clienteId) return false
      // Rinnovo anche lo stesso giorno della scadenza: dataInizio >= dataFine
      return abbonamentiScope.some(
        (b) =>
          b.id !== a.id &&
          String(b.clienteId ?? "").trim() === clienteId &&
          parseDataScadenza(b.dataInizio ?? "").getTime() >= fineA
      )
    }

    return abbonamentiScope
      .filter((a) => {
        if (a.stato !== "attivo") return false
        if (a.isTesseramento === true || isTesseramento(a)) return false
        if (a.rinnovato === true || isRinnovato(a)) return false
        const fine = parseDataScadenza(a.dataFine)
        if (Number.isNaN(fine.getTime())) return false
        fine.setHours(0, 0, 0, 0)
        return fine >= oggi && fine <= traNGiorni
      })
      .sort((a, b) => parseDataScadenza(a.dataFine).getTime() - parseDataScadenza(b.dataFine).getTime())
  }, [abbonamentiScope, giorniScadenza])

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Abbonamenti & Vendite</h1>
          <p className="text-sm text-zinc-400">Gestione abbonamenti, vendite e budget</p>
        </div>
        {role === "admin" && (
          <a href="/" className="rounded-md border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">
            Imposta budget (Dashboard)
          </a>
        )}
      </div>

      {/* KPI */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Abbonamenti attivi</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-400">
            {dashboard?.abbonamentiAttivi ?? abbonamenti.filter((a) => a.stato === "attivo").length}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Entrate mese corrente</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">
            €{(dashboard?.entrateMese ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm text-zinc-400">Budget mese</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            €{(dashboard?.budgetMese ?? 6000).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {dashboard?.percentualeBudget ?? 0}% raggiunto
          </p>
        </div>
      </div>

      {/* Tab: Abbonamenti e Andamento Vendite (no Catalogo Piani) */}
      <div className="mt-6 flex gap-2 border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("abbonamenti")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "abbonamenti" ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Abbonamenti
        </button>
        <button
          type="button"
          onClick={() => setTab("andamento")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "andamento" ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Andamento Vendite
        </button>
      </div>

      {tab === "abbonamenti" && (
      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-400">Abbonamenti in scadenza (DataFine)</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Solo attivi, da oggi a {giorniScadenza} giorni, ordinati per data scadenza
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGiorniScadenza(30)}
              className={`rounded border px-3 py-1.5 text-sm ${giorniScadenza === 30 ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-zinc-600 text-zinc-400 hover:bg-zinc-800"}`}
            >
              Entro 30 giorni
            </button>
            <button
              type="button"
              onClick={() => setGiorniScadenza(60)}
              className={`rounded border px-3 py-1.5 text-sm ${giorniScadenza === 60 ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-zinc-600 text-zinc-400 hover:bg-zinc-800"}`}
            >
              Entro 60 giorni
            </button>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          {isLoading && (
            <div className="flex justify-center py-12 text-zinc-400">Caricamento...</div>
          )}
          {error && (
            <div className="py-8 text-center text-red-400">{(error as Error).message}</div>
          )}
          {!isLoading && !error && listaAbbonamenti.length === 0 && (
            <p className="text-sm text-zinc-500">Nessun abbonamento in scadenza nei prossimi {giorniScadenza} giorni.</p>
          )}
          {!isLoading && !error && listaAbbonamenti.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Cliente</th>
                  <th className="pb-2 pr-4 font-medium">Abbonamento</th>
                  <th className="pb-2 pr-4 font-medium">Categoria</th>
                  <th className="pb-2 pr-4 font-medium">Prezzo</th>
                  <th className="pb-2 pr-4 font-medium">Scadenza</th>
                  <th className="pb-2 pr-4 font-medium">Consulente</th>
                  <th className="pb-2 pr-4 font-medium">Stato chiamate</th>
                  <th className="pb-2 font-medium">Azioni</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {listaAbbonamenti.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2 pr-4 font-medium text-zinc-200">{a.clienteNome}</td>
                    <td className="py-2 pr-4">{a.abbonamentoDescrizione ?? a.pianoNome}</td>
                    <td className="py-2 pr-4">
                      {a.categoriaAbbonamentoDescrizione ? (
                        <span className="inline-flex rounded border border-zinc-600 bg-zinc-800/50 px-2 py-0.5 text-xs text-zinc-300">
                          {a.categoriaAbbonamentoDescrizione}
                        </span>
                      ) : a.macroCategoriaDescrizione ? (
                        <span className="inline-flex rounded border border-zinc-600 bg-zinc-800/50 px-2 py-0.5 text-xs text-zinc-300">
                          {a.macroCategoriaDescrizione}
                        </span>
                      ) : (
                        <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${CAT_COLORS[a.categoria]}`}>
                          {CAT_LABELS[a.categoria]}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">€{a.prezzo.toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 pr-4 text-amber-400">{new Date(a.dataFine).toLocaleDateString("it-IT")}</td>
                    <td className="py-2 pr-4 text-zinc-400">{a.consulenteNome ?? "—"}</td>
                    <td className="py-2 pr-4 text-zinc-400">
                      {(() => {
                        const sc = statoChiamateByClienteId.get(a.clienteId)
                        if (!sc) return <span className="text-zinc-500">—</span>
                        const esitoLabel = sc.last.esito ? ESITO_LABELS[sc.last.esito] : "—"
                        const dataShort = sc.last.dataOra
                          ? new Date(sc.last.dataOra).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })
                          : ""
                        return (
                          <span className="inline-flex flex-col text-xs">
                            <span>{esitoLabel}</span>
                            {dataShort && <span className="text-zinc-500">{dataShort} · {sc.count} chiamat{sc.count === 1 ? "a" : "e"}</span>}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {telefonoByClienteId.get(a.clienteId) ? (
                          <ChiamaButton
                            telefono={telefonoByClienteId.get(a.clienteId)!}
                            nomeContatto={a.clienteNome}
                            tipo="cliente"
                            clienteId={a.clienteId}
                          />
                        ) : (
                          <span className="text-xs text-zinc-500">—</span>
                        )}
                        <Link
                          to={`/abbonamenti/dettaglio/${a.id}`}
                          className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          title="Stato e note (come CRM)"
                        >
                          Dettaglio
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      )}

      {tab === "andamento" && (
        <div className="mt-4 rounded-lg border border-zinc-800 p-6 text-center text-zinc-500">
          Andamento vendite (grafico in sviluppo)
        </div>
      )}
    </div>
  )
}
