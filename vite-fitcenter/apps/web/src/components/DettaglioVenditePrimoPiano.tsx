import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { DettaglioMeseResponse } from "@/types/gestionale"
import { useAuth } from "@/contexts/AuthContext"

function fmtEuro(n: number) {
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Blocco vendite: una card con titolo, vendite, budget e barra % */
function CardVendite({
  titolo,
  vendite,
  budget,
  sottotitolo,
}: {
  titolo: string
  vendite: number
  budget: number
  sottotitolo?: string
}) {
  const percentuale = budget > 0 ? Math.min(100, Math.round((vendite / budget) * 1000) / 10) : 0
  const isOk = percentuale >= 100
  const isNeg = vendite < 0

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-lg">
      <p className="text-sm font-medium uppercase tracking-wider text-zinc-500">{titolo}</p>
      {sottotitolo && <p className="mt-0.5 text-xs text-zinc-500">{sottotitolo}</p>}
      <p className={`mt-3 text-3xl font-bold tabular-nums ${isNeg ? "text-red-400" : "text-amber-400"}`}>
        € {fmtEuro(vendite)}
      </p>
      <p className="mt-1 text-sm text-zinc-400">
        su € {fmtEuro(budget)} di budget
      </p>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isNeg ? "bg-red-500/80" : "bg-amber-500/90"}`}
            style={{ width: `${Math.min(100, percentuale)}%` }}
          />
        </div>
        <span
          className={`min-w-[3rem] text-right text-sm font-semibold tabular-nums ${
            isNeg ? "text-red-400" : isOk ? "text-emerald-400" : "text-zinc-300"
          }`}
        >
          {percentuale}%
        </span>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {isNeg ? "Importo negativo (storno/nota di credito)" : isOk ? "Obiettivo raggiunto" : `Mancano € ${fmtEuro(Math.max(0, budget - vendite))} all'obiettivo`}
      </p>
    </div>
  )
}

/** Dashboard vendite in primo piano per consulenti: solo le proprie vendite, layout chiaro. */
export function DettaglioVenditePrimoPiano({
  annoSelezionato,
  meseSelezionato,
  onAnnoChange,
  onMeseChange,
  giornoSelezionato: giornoControlled,
  onGiornoChange,
}: {
  annoSelezionato?: number
  meseSelezionato?: number
  onAnnoChange?: (year: number) => void
  onMeseChange?: (month: number) => void
  giornoSelezionato?: number
  onGiornoChange?: (day: number) => void
} = {}) {
  const { consulenteFilter } = useAuth()
  const now = new Date()
  const anno = annoSelezionato ?? now.getFullYear()
  const mese = meseSelezionato ?? (now.getMonth() + 1)
  const giornoOggi = now.getDate()
  const [giornoInternal, setGiornoInternal] = useState(giornoOggi)
  const [mostraAltroGiorno, setMostraAltroGiorno] = useState(false)

  const giornoSelezionato = giornoControlled ?? giornoInternal
  const setGiornoSelezionato = onGiornoChange ?? setGiornoInternal

  const { data, isLoading, error } = useQuery({
    queryKey: ["dettaglio-mese-primo-piano", anno, mese, giornoSelezionato, consulenteFilter],
    queryFn: () => dataApi.getDettaglioMese(anno, mese, giornoSelezionato, consulenteFilter),
    staleTime: 0,
  })

  const giorniNelMese = new Date(anno, mese, 0).getDate()
  const giornoSafe = Math.min(giornoSelezionato, giorniNelMese)

  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8">
        <div className="flex items-center justify-center gap-2 text-zinc-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500/50 border-t-amber-400" />
          Caricamento vendite...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-500/10 p-4 text-sm text-red-400">
        {(error as Error).message}
      </div>
    )
  }

  const d = data as DettaglioMeseResponse | undefined
  if (!d) return null

  const giornoLabel =
    giornoSafe === giornoOggi
      ? "Oggi"
      : `${giornoSafe}/${mese}/${anno}`

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Le tue vendite</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Riepilogo giorno e mese — solo i tuoi dati
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (mostraAltroGiorno) setGiornoSelezionato(giornoOggi)
            setMostraAltroGiorno((v) => !v)
          }}
          aria-label={mostraAltroGiorno ? "Usa oggi" : "Altro giorno"}
          className="rounded-lg border border-zinc-600 bg-zinc-800/80 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          {mostraAltroGiorno ? "Usa oggi" : "Altro giorno"}
        </button>
      </div>

      {mostraAltroGiorno && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/40 px-4 py-3">
          {onAnnoChange && onMeseChange ? (
            <>
              <label className="text-sm text-zinc-400">Mese:</label>
              <select
                value={mese}
                onChange={(e) => onMeseChange(Number(e.target.value))}
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}/{anno}
                  </option>
                ))}
              </select>
              <label className="text-sm text-zinc-400">Anno:</label>
              <input
                type="number"
                value={anno}
                onChange={(e) => onAnnoChange(Number(e.target.value))}
                className="w-24 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
              />
            </>
          ) : null}
          <label className="text-sm text-zinc-400">Giorno:</label>
          <select
            value={giornoSafe}
            onChange={(e) => setGiornoSelezionato(Number(e.target.value))}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
          >
            {Array.from({ length: giorniNelMese }, (_, i) => i + 1).map((g) => (
              <option key={g} value={g}>
                {g} {mese}/{anno}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <CardVendite
          titolo="Giorno"
          vendite={d.dettaglioGiorno.consuntivo}
          budget={d.dettaglioGiorno.budget}
          sottotitolo={giornoLabel}
        />
        <CardVendite
          titolo="Questo mese"
          vendite={d.dettaglioMese.consuntivo}
          budget={d.dettaglioMese.budget}
          sottotitolo={d.meseLabel}
        />
      </div>
    </section>
  )
}
