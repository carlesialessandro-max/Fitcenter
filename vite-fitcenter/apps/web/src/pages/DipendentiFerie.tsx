import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { amministrazioneApi, type AmmFerieGiorno, type AmmFeriePersona } from "@/api/amministrazione"

const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function giorniNelMese(anno: number, mese: number) {
  return new Date(anno, mese, 0).getDate()
}

function weekday(anno: number, mese: number, giorno: number) {
  return new Date(anno, mese - 1, giorno).getDay()
}

function gg(n: number | null | undefined) {
  if (n == null) return "—"
  return n.toLocaleString("it-IT", { maximumFractionDigits: 2 })
}

export function DipendentiFerieTab() {
  const qc = useQueryClient()
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [mese, setMese] = useState(oggi.getMonth() + 1)
  const [tipo, setTipo] = useState<"ferie" | "permessi">("ferie")
  const [sel, setSel] = useState("")
  const [dal, setDal] = useState("")
  const [al, setAl] = useState("")
  const [q, setQ] = useState("")
  const [msg, setMsg] = useState("")
  const [error, setError] = useState("")

  const data = useQuery({
    queryKey: ["amm-ferie", anno],
    queryFn: () => amministrazioneApi.dipendentiFerie(anno),
  })

  const toggleMut = useMutation({
    mutationFn: (body: { nominativo: string; data: string; tipo: "ferie" | "permessi" }) =>
      amministrazioneApi.toggleFerieGiorno(body),
    onSuccess: () => {
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-ferie"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const periodoMut = useMutation({
    mutationFn: () =>
      amministrazioneApi.addFeriePeriodo({ nominativo: sel, dal, al, tipo }),
    onSuccess: (r) => {
      setMsg(`Segnati ${r.inserite} giorni.`)
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-ferie"] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const nGiorni = giorniNelMese(anno, mese)
  const prefix = `${anno}-${pad2(mese)}`
  const persone = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("it")
    return (data.data?.dipendenti ?? []).filter((p) => !t || p.nominativo.toLocaleLowerCase("it").includes(t))
  }, [data.data?.dipendenti, q])

  const giorniByNome = useMemo(() => {
    const map = new Map<string, AmmFerieGiorno[]>()
    for (const g of data.data?.giorni ?? []) {
      const list = map.get(g.nominativo.toLowerCase()) ?? []
      list.push(g)
      map.set(g.nominativo.toLowerCase(), list)
    }
    return map
  }, [data.data?.giorni])

  function giornoDi(p: AmmFeriePersona, day: number) {
    const iso = `${prefix}-${pad2(day)}`
    return (giorniByNome.get(p.nominativo.toLowerCase()) ?? []).find((g) => g.data === iso)
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-zinc-500">
        I residui ferie e permessi arrivano dal file importato in <span className="text-zinc-300">Stipendi</span>{" "}
        (PDF paghe o mastrino). Qui segni i giorni di assenza: si scalano dal residuo della busta.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Anno
          <input
            type="number"
            className={inputCls}
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value) || anno)}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Mese
          <select className={inputCls} value={mese} onChange={(e) => setMese(Number(e.target.value))}>
            {MESI.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Cerca
          <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nominativo" />
        </label>
        <div className="flex gap-1">
          <button type="button" className={tipo === "ferie" ? btnAmber : btnGhost} onClick={() => setTipo("ferie")}>
            Ferie
          </button>
          <button type="button" className={tipo === "permessi" ? btnAmber : btnGhost} onClick={() => setTipo("permessi")}>
            Permessi
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Dipendente
          <select className={inputCls} value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Scegli…</option>
            {(data.data?.dipendenti ?? []).map((p) => (
              <option key={p.nominativo} value={p.nominativo}>
                {p.nominativo}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Dal
          <input type="date" className={inputCls} value={dal} onChange={(e) => setDal(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Al
          <input type="date" className={inputCls} value={al} onChange={(e) => setAl(e.target.value)} />
        </label>
        <button
          type="button"
          className={btnAmber}
          disabled={!sel || !dal || !al || periodoMut.isPending}
          onClick={() => periodoMut.mutate()}
        >
          Segna periodo
        </button>
        <p className="text-xs text-zinc-500">Oppure clicca un giorno in tabella per aggiungere o togliere.</p>
      </div>

      {!data.data?.dipendenti.length && !data.isLoading && (
        <p className="text-sm text-zinc-500">
          Nessun dipendente. Importa il PDF paghe o il mastrino in Stipendi: i nominativi e i residui ferie arrivano da
          lì.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-900/80 text-zinc-400">
              <th className="sticky left-0 z-10 bg-zinc-900 px-2 py-2 text-left font-medium">Nominativo</th>
              <th className="px-2 py-2 text-right font-medium">Residuo busta</th>
              <th className="px-2 py-2 text-right font-medium">Disp.</th>
              {Array.from({ length: nGiorni }, (_, i) => {
                const d = i + 1
                const wd = weekday(anno, mese, d)
                return (
                  <th
                    key={d}
                    className={`w-7 px-0 py-2 text-center font-normal ${wd === 0 ? "text-zinc-600" : ""}`}
                  >
                    {d}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {persone.map((p) => (
              <tr key={p.nominativo} className="border-t border-zinc-800">
                <td className="sticky left-0 z-10 bg-zinc-950 px-2 py-1 font-medium text-zinc-100">{p.nominativo}</td>
                <td className="px-2 py-1 text-right tabular-nums text-zinc-400">
                  {gg(p.ferieResidue)}
                  {p.saldo?.mese ? <span className="ml-1 text-[10px] text-zinc-600">{p.saldo.mese}</span> : null}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    p.ferieDisponibili != null && p.ferieDisponibili < 0 ? "text-red-400" : "text-zinc-200"
                  }`}
                >
                  {gg(p.ferieDisponibili)}
                </td>
                {Array.from({ length: nGiorni }, (_, i) => {
                  const d = i + 1
                  const hit = giornoDi(p, d)
                  const iso = `${prefix}-${pad2(d)}`
                  const wd = weekday(anno, mese, d)
                  return (
                    <td key={d} className="p-0">
                      <button
                        type="button"
                        title={`${p.nominativo} ${iso}`}
                        className={`block h-7 w-7 text-[10px] ${
                          hit?.tipo === "ferie"
                            ? "bg-amber-500/80 text-zinc-950"
                            : hit?.tipo === "permessi"
                              ? "bg-sky-500/70 text-zinc-950"
                              : wd === 0
                                ? "bg-zinc-900/80 text-zinc-700"
                                : "text-zinc-700 hover:bg-zinc-800"
                        }`}
                        onClick={() => toggleMut.mutate({ nominativo: p.nominativo, data: iso, tipo: hit?.tipo ?? tipo })}
                      >
                        {hit ? (hit.tipo === "permessi" ? "P" : "F") : ""}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        <span className="mr-2 inline-block h-3 w-3 rounded-sm bg-amber-500/80" /> Ferie
        <span className="ml-3 mr-2 inline-block h-3 w-3 rounded-sm bg-sky-500/70" /> Permessi. Residuo busta = ultimo
        import PDF/mastrino; Disponibili = residuo meno i giorni segnati dopo quel mese.
      </p>
    </div>
  )
}
