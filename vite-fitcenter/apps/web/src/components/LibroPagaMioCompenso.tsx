import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lpagaApi } from "@/api/lpaga"

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
const btnAmber = "rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

const SOGLIA = 5000

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function currentYear(): number {
  try {
    return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric" }).format(new Date()))
  } catch {
    return new Date().getFullYear()
  }
}

export function LibroPagaMioCompenso() {
  const qc = useQueryClient()
  const [anno, setAnno] = useState(currentYear())
  const [azienda, setAzienda] = useState("")
  const [importo, setImporto] = useState("")
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")

  const q = useQuery({
    queryKey: ["lpaga-mio-compenso", anno],
    queryFn: () => lpagaApi.mioCompenso(anno),
  })

  const saveMut = useMutation({
    mutationFn: () => {
      const n = Number(String(importo).replace(/\s/g, "").replace(",", "."))
      if (!azienda.trim()) throw new Error("Indica l’azienda.")
      if (!Number.isFinite(n) || n <= 0) throw new Error("Inserisci un importo valido.")
      return lpagaApi.setMiaAltraAzienda({ anno, azienda: azienda.trim(), importo: Math.round(n * 100) / 100 })
    },
    onSuccess: () => {
      setAzienda("")
      setImporto("")
      setErr("")
      setMsg("Importo altre aziende salvato.")
      void qc.invalidateQueries({ queryKey: ["lpaga-mio-compenso"] })
    },
    onError: (e: Error) => {
      setMsg("")
      setErr(e.message)
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => lpagaApi.deleteMiaAltraAzienda(id),
    onSuccess: () => {
      setErr("")
      setMsg("Voce eliminata.")
      void qc.invalidateQueries({ queryKey: ["lpaga-mio-compenso"] })
    },
    onError: (e: Error) => {
      setMsg("")
      setErr(e.message)
    },
  })

  const data = q.data
  const riga = data?.riga
  const mesi = data?.mesi ?? []
  const totFitcenter = riga?.totFitcenter ?? Math.round(((riga?.tot ?? 0) - (riga?.altreAziende ?? 0)) * 100) / 100
  const totAltre = riga?.altreAziende ?? data?.altreAziende.reduce((s, v) => s + v.importo, 0) ?? 0
  const tot = riga?.tot ?? 0
  const resto = Math.max(0, Math.round((SOGLIA - tot) * 100) / 100)
  const oltre = riga?.oltre5000 ?? Math.max(0, Math.round((tot - SOGLIA) * 100) / 100)
  const pct = Math.min(100, Math.round((tot / SOGLIA) * 1000) / 10)

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">I tuoi compensi {anno}</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Qui vedi solo i tuoi importi dell’anno, come in Collaboratori sportivi. I mesi FitCenter arrivano dal
            commercialista. Aggiungi i compensi di altre aziende per controllare se superi i {eur(SOGLIA)}: oltre quella
            soglia i compensi sportivi dilettantistici vanno tassati. Nessun collega vede questi dati.
          </p>
        </div>
        <label className="grid gap-1 text-xs text-zinc-500">
          Anno
          <input
            type="number"
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value) || currentYear())}
            className={`${inputCls} w-28`}
          />
        </label>
      </div>

      {q.isLoading ? <p className="text-sm text-zinc-500">Caricamento…</p> : null}
      {q.isError ? <p className="text-sm text-red-400">{(q.error as Error).message}</p> : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {data ? (
        <>
          <p className="text-sm text-zinc-300">
            Nominativo: <span className="font-medium text-zinc-100">{data.nominativo}</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="FitCenter">{eur(totFitcenter)}</Card>
            <Card title="Altre aziende">{eur(totAltre)}</Card>
            <Card title="Totale anno">{eur(tot)}</Card>
            <Card title={oltre > 0 ? "Oltre 5.000 €" : "Rimanenza a 5.000 €"} warn={oltre > 0}>
              {oltre > 0 ? eur(oltre) : eur(resto)}
            </Card>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
              <span>Soglia {eur(SOGLIA)}</span>
              <span className={oltre > 0 ? "text-amber-200" : "text-zinc-400"}>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full ${oltre > 0 ? "bg-amber-400" : "bg-emerald-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {oltre > 0
                ? `Hai superato la soglia di ${eur(oltre)}. La parte eccedente va tassata.`
                : `Ti restano ${eur(resto)} prima della soglia di ${eur(SOGLIA)}.`}
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/50 text-zinc-400">
                  {mesi.map((m) => (
                    <th key={m.id} className="px-2 py-2 text-right font-medium">
                      {m.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium" title="Rimanenze degli anni precedenti (inserite da amministrazione)">
                    Rimanenze
                  </th>
                  <th className="px-2 py-2 text-right font-medium">FitCenter</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {mesi.map((m) => {
                    const cell = riga?.mesi[m.id]
                    return (
                      <td key={m.id} className="px-2 py-2 text-right tabular-nums text-zinc-100">
                        {cell?.totale ? eur(cell.totale) : "—"}
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-100">
                    {riga?.rimanenze ? eur(riga.rimanenze) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-zinc-100">{eur(totFitcenter)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            I mesi FitCenter sono in sola lettura: li inserisce amministrazione da PDF/Excel. Se manca un mese, non è
            ancora stato importato.
          </p>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Altre aziende</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Se lavori anche altrove, inserisci qui i compensi dello stesso anno. Servono solo a te (e ad amministrazione)
              per la soglia dei {eur(SOGLIA)}.
            </p>
            {(data.altreAziende ?? []).length ? (
              <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
                {data.altreAziende.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-zinc-200">{v.azienda}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums text-zinc-100">{eur(v.importo)}</span>
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={delMut.isPending}
                        onClick={() => {
                          if (window.confirm(`Eliminare ${v.azienda}?`)) delMut.mutate(v.id)
                        }}
                      >
                        Elimina
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">Nessun importo di altre aziende per questo anno.</p>
            )}
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                saveMut.mutate()
              }}
            >
              <label className="grid gap-1 text-xs text-zinc-500">
                Azienda
                <input
                  value={azienda}
                  onChange={(e) => setAzienda(e.target.value)}
                  placeholder="Nome società"
                  className={`${inputCls} min-w-[12rem]`}
                />
              </label>
              <label className="grid gap-1 text-xs text-zinc-500">
                Importo anno
                <input
                  value={importo}
                  onChange={(e) => setImporto(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                  className={`${inputCls} w-28`}
                />
              </label>
              <button type="submit" className={btnAmber} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvataggio…" : "Aggiungi"}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  )
}

function Card({ title, children, warn }: { title: string; children: ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${warn ? "border-amber-500/40 bg-amber-950/20" : "border-zinc-800 bg-zinc-900/30"}`}>
      <p className="mb-2 text-sm font-medium text-zinc-300">{title}</p>
      <p className={`text-2xl font-semibold ${warn ? "text-amber-200" : "text-zinc-100"}`}>{children}</p>
    </div>
  )
}
