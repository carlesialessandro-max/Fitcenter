import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

export function ConvalideConsulenti() {
  const { role, consulenti } = useAuth()
  const now = new Date()
  const [anno, setAnno] = useState(now.getFullYear())
  const [mese, setMese] = useState(now.getMonth() + 1)
  const [view, setView] = useState<"settimana" | "mese">("settimana")
  const [consulente, setConsulente] = useState(consulenti?.[0] ?? "")

  const { data, isLoading, error } = useQuery({
    queryKey: ["convalidazioni-admin-page", anno, mese, consulente],
    queryFn: () => dataApi.getConvalidazioni(anno, mese, consulente),
    enabled: role === "admin" && !!consulente,
    retry: false,
  })

  const giorni = useMemo(() => (data?.convalidati ?? []).slice().sort((a, b) => a - b), [data?.convalidati])
  const giorniSet = useMemo(() => new Set(giorni), [giorni])
  const giorniNelMese = useMemo(() => new Date(anno, mese, 0).getDate(), [anno, mese])

  const settimane = useMemo(() => {
    const out: Array<{ numero: number; start: number; end: number; count: number; lista: number[] }> = []
    let start = 1
    let numero = 1
    while (start <= giorniNelMese) {
      const end = Math.min(start + 6, giorniNelMese)
      const lista = Array.from({ length: end - start + 1 }, (_, i) => start + i).filter((g) => giorniSet.has(g))
      out.push({ numero, start, end, count: lista.length, lista })
      start = end + 1
      numero += 1
    }
    return out
  }, [giorniNelMese, giorniSet])
  const giorniMeseGrid = useMemo(() => Array.from({ length: giorniNelMese }, (_, i) => i + 1), [giorniNelMese])
  const percentualeConvalida = giorniNelMese > 0 ? Math.round((giorni.length / giorniNelMese) * 100) : 0
  const weekDayLabels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]
  const leadingEmptyCells = useMemo(() => {
    const d = new Date(anno, mese - 1, 1)
    const jsDay = d.getDay() // 0=Dom..6=Sab
    return (jsDay + 6) % 7 // 0=Lun..6=Dom
  }, [anno, mese])

  if (role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Convalide consulenti</h2>
          <p className="mt-2 text-sm text-zinc-500">Pagina disponibile solo per admin.</p>
          <Link to="/" className="mt-4 inline-block text-sm text-amber-400 hover:underline">
            Torna alla dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Convalide Consulenti</h1>
          <p className="text-sm text-zinc-500">Riepilogo convalidazioni per mese e settimana</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Consulente
          <select
            value={consulente}
            onChange={(e) => setConsulente(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {(consulenti ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Anno
          <input
            type="number"
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value))}
            className="w-28 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          Mese
          <select
            value={mese}
            onChange={(e) => setMese(Number(e.target.value))}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"].map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setView("settimana")}
            className={`rounded border px-3 py-2 text-sm ${
              view === "settimana"
                ? "border-amber-500 bg-amber-500/20 text-amber-400"
                : "border-zinc-600 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            Settimana
          </button>
          <button
            type="button"
            onClick={() => setView("mese")}
            className={`rounded border px-3 py-2 text-sm ${
              view === "mese"
                ? "border-amber-500 bg-amber-500/20 text-amber-400"
                : "border-zinc-600 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            Mese
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        {isLoading && <div className="py-8 text-center text-zinc-400">Caricamento...</div>}
        {error && <div className="py-6 text-center text-red-400">{(error as Error).message}</div>}
        {!isLoading && !error && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs text-zinc-500">Convalidati</p>
                <p className="text-2xl font-semibold text-emerald-400">{giorni.length}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs text-zinc-500">Giorni mese</p>
                <p className="text-2xl font-semibold text-zinc-100">{giorniNelMese}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs text-zinc-500">Copertura</p>
                <p className="text-2xl font-semibold text-amber-400">{percentualeConvalida}%</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, percentualeConvalida))}%` }}
              />
            </div>
            {view === "settimana" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {settimane.map((s) => (
                  <div key={s.numero} className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-3">
                    <p className="text-xs text-zinc-500">
                      Settimana {s.numero} ({s.start}-{s.end})
                    </p>
                    <p className="mt-1 text-lg font-semibold text-zinc-100">{s.count} giorni</p>
                    <p className="mt-1 text-xs text-zinc-500">{s.lista.length ? s.lista.join(", ") : "Nessuno"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <div className="mb-2 grid grid-cols-7 gap-2">
                  {weekDayLabels.map((label) => (
                    <div key={label} className="text-center text-xs font-medium text-zinc-500">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: leadingEmptyCells }, (_, i) => (
                    <div key={`empty-${i}`} className="h-10 rounded-md border border-transparent" />
                  ))}
                  {giorniMeseGrid.map((g) => {
                    const active = giorniSet.has(g)
                    return (
                      <div
                        key={g}
                        className={`flex h-10 items-center justify-center rounded-md border text-sm ${
                          active
                            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                            : "border-zinc-800 bg-zinc-900/20 text-zinc-500"
                        }`}
                        title={active ? `Giorno ${g} convalidato` : `Giorno ${g}`}
                      >
                        {g}
                      </div>
                    )
                  })}
                </div>
                <p className="mt-3 text-sm text-zinc-400">
                  {giorni.length ? `Giorni convalidati: ${giorni.join(", ")}` : "Nessun giorno convalidato"}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

