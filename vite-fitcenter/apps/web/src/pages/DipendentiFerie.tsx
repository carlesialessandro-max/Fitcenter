import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  amministrazioneApi,
  type AmmFerieDaFile,
  type AmmFerieGiorno,
  type AmmFeriePersona,
} from "@/api/amministrazione"
import { readBustePagaPdf } from "@/lib/amm-import-buste-pdf"
import { parseAmmMastrino } from "@/lib/amm-mastrino"

const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
const MESI_SHORT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]

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

function oreToGiorni(n: number | null | undefined, unita: "h" | "gg" | null | undefined) {
  if (n == null) return null
  if (unita === "gg") return n
  return Math.round((n / 8) * 100) / 100
}

function isoDay(anno: number, mese: number, giorno: number) {
  return `${anno}-${pad2(mese)}-${pad2(giorno)}`
}

function CalendarioModal({
  nominativo,
  anno,
  tipo,
  meseIniziale,
  giorni,
  pending,
  onClose,
  onToggle,
  onPeriodo,
}: {
  nominativo: string
  anno: number
  tipo: "ferie" | "permessi"
  meseIniziale?: number
  giorni: AmmFerieGiorno[]
  pending: boolean
  onClose: () => void
  onToggle: (data: string, tipo: "ferie" | "permessi") => void
  onPeriodo: (dal: string, al: string, tipo: "ferie" | "permessi") => void
}) {
  const [mese, setMese] = useState(meseIniziale && meseIniziale >= 1 && meseIniziale <= 12 ? meseIniziale : new Date().getMonth() + 1)
  const [kind, setKind] = useState<"ferie" | "permessi">(tipo)
  const [dal, setDal] = useState("")
  const [al, setAl] = useState("")
  const n = giorniNelMese(anno, mese)
  const startWd = weekday(anno, mese, 1)
  const blanks = (startWd + 6) % 7
  const byDay = new Map(giorni.filter((g) => g.data.startsWith(`${anno}-${pad2(mese)}`)).map((g) => [g.data, g]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{nominativo}</h3>
            <p className="text-xs text-zinc-500">Clicca i giorni oppure indica un periodo.</p>
          </div>
          <button type="button" className={btnGhost} onClick={onClose}>
            Chiudi
          </button>
        </div>
        <div className="mb-3 flex gap-1">
          <button type="button" className={kind === "ferie" ? btnAmber : btnGhost} onClick={() => setKind("ferie")}>
            Ferie
          </button>
          <button type="button" className={kind === "permessi" ? btnAmber : btnGhost} onClick={() => setKind("permessi")}>
            Permessi
          </button>
        </div>
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className={btnGhost} onClick={() => setMese((m) => (m === 1 ? 12 : m - 1))}>
            ←
          </button>
          <p className="text-sm font-medium text-zinc-200">
            {MESI[mese - 1]} {anno}
          </p>
          <button type="button" className={btnGhost} onClick={() => setMese((m) => (m === 12 ? 1 : m + 1))}>
            →
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-zinc-500">
          {["L", "M", "M", "G", "V", "S", "D"].map((d) => (
            <div key={d}>{d}</div>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <div key={`b${i}`} />
          ))}
          {Array.from({ length: n }, (_, i) => {
            const day = i + 1
            const iso = isoDay(anno, mese, day)
            const hit = byDay.get(iso)
            const wd = weekday(anno, mese, day)
            return (
              <button
                key={iso}
                type="button"
                disabled={pending}
                title={iso}
                className={`h-8 rounded-md text-xs ${
                  hit?.tipo === "ferie"
                    ? "bg-amber-500 text-zinc-950"
                    : hit?.tipo === "permessi"
                      ? "bg-sky-500 text-zinc-950"
                      : wd === 0
                        ? "bg-zinc-900 text-zinc-600"
                        : "bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800"
                }`}
                onClick={() => onToggle(iso, hit?.tipo ?? kind)}
              >
                {day}
              </button>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-3">
          <label className="grid gap-1 text-[10px] text-zinc-500">
            Dal
            <input type="date" className={inputCls} value={dal} onChange={(e) => setDal(e.target.value)} />
          </label>
          <label className="grid gap-1 text-[10px] text-zinc-500">
            Al
            <input type="date" className={inputCls} value={al} onChange={(e) => setAl(e.target.value)} />
          </label>
          <button
            type="button"
            className={btnAmber}
            disabled={pending || !dal || !al}
            onClick={() => onPeriodo(dal, al, kind)}
          >
            Segna periodo
          </button>
        </div>
      </div>
    </div>
  )
}

export function DipendentiFerieTab() {
  const qc = useQueryClient()
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [meseImportNum, setMeseImportNum] = useState(oggi.getMonth() + 1)
  const [q, setQ] = useState("")
  const [msg, setMsg] = useState("")
  const [error, setError] = useState("")
  const [pdfBusy, setPdfBusy] = useState(false)
  const [feriePreview, setFeriePreview] = useState<AmmFerieDaFile[] | null>(null)
  const [cal, setCal] = useState<{ nominativo: string; tipo: "ferie" | "permessi"; mese?: number } | null>(null)

  const data = useQuery({
    queryKey: ["amm-ferie", anno],
    queryFn: () => amministrazioneApi.dipendentiFerie(anno),
  })
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const attivi = (meta.data?.reparti ?? []).filter((r) => r.attivo)
  const meseImport = `${anno}-${pad2(meseImportNum)}`

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
    mutationFn: (body: { nominativo: string; dal: string; al: string; tipo: "ferie" | "permessi" }) =>
      amministrazioneApi.addFeriePeriodo(body),
    onSuccess: (r) => {
      setMsg(`Segnati ${r.inserite} giorni.`)
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-ferie"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const importFerieMut = useMutation({
    mutationFn: (ferie: AmmFerieDaFile[]) => amministrazioneApi.importFerie(meseImport, ferie),
    onSuccess: (r) => {
      setFeriePreview(null)
      setMsg(`Ferie aggiornate per ${r.inserite} dipendenti.`)
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-ferie"] })
    },
    onError: (e: Error) => setError(e.message),
  })

  async function onBustePdf(file: File | null) {
    if (!file) return
    setError("")
    setMsg("")
    setFeriePreview(null)
    setPdfBusy(true)
    try {
      const parsed = await readBustePagaPdf(file, meseImport, setMsg, { ferie: true })
      if (!parsed.ferie.length) {
        throw new Error(
          "Nel PDF non ci sono residui ferie. Serve il prospetto ferie o le buste con il riquadro ferie/permessi, non il totale stipendio.",
        )
      }
      setFeriePreview(parsed.ferie)
      setMsg("")
    } catch (e) {
      setError((e as Error).message || "PDF non leggibile")
    } finally {
      setPdfBusy(false)
    }
  }

  async function onMastrino(file: File | null) {
    if (!file) return
    setError("")
    setMsg("")
    setFeriePreview(null)
    try {
      const buf = await file.arrayBuffer()
      const rows = parseAmmMastrino(buf, attivi, { requireTotale: false })
      const ferie: AmmFerieDaFile[] = rows
        .filter((p) => !p.errore && p.ferieResidue != null)
        .map((p) => ({
          nominativo: p.nominativo,
          mese: p.mese,
          ferieResidue: p.ferieResidue!,
          ferieGodute: p.ferieGodute,
          permessiResidue: p.permessiResidue,
        }))
      if (!ferie.length) {
        throw new Error("Nel mastrino non ci sono colonne di residuo ferie.")
      }
      setFeriePreview(ferie)
    } catch (e) {
      setError((e as Error).message || "Excel non leggibile")
    }
  }

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

  const giorniIndex = useMemo(() => {
    const map = new Map<string, AmmFerieGiorno>()
    for (const g of data.data?.giorni ?? []) {
      map.set(`${g.nominativo.toLowerCase()}|${g.data}`, g)
    }
    return map
  }, [data.data?.giorni])

  function hitOf(p: AmmFeriePersona, mese: number, day: number) {
    const last = giorniNelMese(anno, mese)
    if (day > last) return undefined
    return giorniIndex.get(`${p.nominativo.toLowerCase()}|${isoDay(anno, mese, day)}`)
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-zinc-500">
        Agenda annuale: residuo anno precedente e previsione al 31 dicembre per ferie e permessi. Per aggiungere giorni
        si apre il calendario.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
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
          Mese busta
          <select className={inputCls} value={meseImportNum} onChange={(e) => setMeseImportNum(Number(e.target.value))}>
            {MESI.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${btnAmber} cursor-pointer ${pdfBusy ? "opacity-50" : ""}`}>
          {pdfBusy ? "Lettura PDF…" : "Importa buste paga"}
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            disabled={pdfBusy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ""
              void onBustePdf(f)
            }}
          />
        </label>
        <label className={`${btnGhost} cursor-pointer`}>
          Importa mastrino
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ""
              void onMastrino(f)
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          Cerca
          <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nominativo" />
        </label>
      </div>
      {feriePreview && (
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-400">Residui ferie per {feriePreview.length} nominativi</p>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => setFeriePreview(null)}>
                Annulla
              </button>
              <button
                type="button"
                className={btnAmber}
                disabled={importFerieMut.isPending}
                onClick={() => importFerieMut.mutate(feriePreview)}
              >
                {importFerieMut.isPending ? "Caricamento…" : "Importa ferie"}
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto text-xs">
            {feriePreview.map((p, index) => (
              <p key={`${p.nominativo}-${index}`} className="flex justify-between gap-4 text-zinc-300">
                <span>{p.nominativo}</span>
                <span className="tabular-nums text-zinc-400">
                  ferie prec. {gg(p.ferieAnnoPrec)} · 31/12 {gg(p.ferieProiezione)} · perm. prec. {gg(p.permessiAnnoPrec)}{" "}
                  · 31/12 {gg(p.permessiProiezione)}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {!data.data?.dipendenti.length && !data.isLoading && (
        <p className="text-sm text-zinc-500">
          Nessun dipendente. Importa il PDF buste: arrivano residuo anno precedente e previsione al 31 dicembre.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-zinc-900/80 text-zinc-400">
              <th rowSpan={2} className="sticky left-0 z-10 bg-zinc-900 px-2 py-2 text-left font-medium">
                Dipendente
              </th>
              <th colSpan={3} className="border-l border-zinc-800 bg-amber-500/15 px-2 py-1 text-center font-semibold text-amber-200">
                Ferie
              </th>
              <th colSpan={2} className="border-l border-zinc-800 bg-sky-500/15 px-2 py-1 text-center font-semibold text-sky-200">
                Permessi
              </th>
              {MESI_SHORT.map((m) => (
                <th key={m} colSpan={31} className="border-l border-zinc-800 px-0 py-1 text-center font-medium">
                  {m}
                </th>
              ))}
            </tr>
            <tr className="bg-zinc-900/80 text-[10px] text-zinc-500">
              <th className="border-l border-zinc-800 bg-amber-500/10 px-1 py-1 text-right">Residuo anno prec.</th>
              <th className="bg-amber-500/10 px-1 py-1 text-right">Proiezione 31/12</th>
              <th className="bg-amber-500/10 px-1 py-1 text-right">gg</th>
              <th className="border-l border-zinc-800 bg-sky-500/10 px-1 py-1 text-right">Residuo anno prec.</th>
              <th className="bg-sky-500/10 px-1 py-1 text-right">Proiezione 31/12</th>
              {MESI_SHORT.map((m) =>
                Array.from({ length: 31 }, (_, i) => (
                  <th key={`${m}-${i + 1}`} className="w-4 px-0 py-1 text-center font-normal">
                    {i + 1}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {persone.map((p) => (
              <tr key={p.nominativo} className="border-t border-zinc-800">
                <td className="sticky left-0 z-10 bg-zinc-950 px-2 py-1 font-medium text-zinc-100">
                  <div className="flex items-center justify-between gap-2">
                    <span>{p.nominativo}</span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className="rounded bg-amber-500/80 px-1.5 py-0.5 text-[10px] text-zinc-950"
                        onClick={() => setCal({ nominativo: p.nominativo, tipo: "ferie" })}
                      >
                        Ferie
                      </button>
                      <button
                        type="button"
                        className="rounded bg-sky-500/80 px-1.5 py-0.5 text-[10px] text-zinc-950"
                        onClick={() => setCal({ nominativo: p.nominativo, tipo: "permessi" })}
                      >
                        Permessi
                      </button>
                    </span>
                  </div>
                </td>
                <td className="border-l border-zinc-800 px-1 py-1 text-right tabular-nums text-zinc-300">
                  {gg(p.ferieAnnoPrec)}
                </td>
                <td className="px-1 py-1 text-right tabular-nums text-amber-200">{gg(p.ferieProiezione)}</td>
                <td className="px-1 py-1 text-right tabular-nums text-zinc-100">
                  {gg(oreToGiorni(p.ferieProiezione ?? p.ferieResidue, p.unita))}
                </td>
                <td className="border-l border-zinc-800 px-1 py-1 text-right tabular-nums text-zinc-300">
                  {gg(p.permessiAnnoPrec)}
                </td>
                <td className="px-1 py-1 text-right tabular-nums text-sky-200">{gg(p.permessiProiezione)}</td>
                {Array.from({ length: 12 }, (_, mi) => {
                  const mese = mi + 1
                  const last = giorniNelMese(anno, mese)
                  return Array.from({ length: 31 }, (_, di) => {
                    const day = di + 1
                    if (day > last) {
                      return <td key={`${p.nominativo}-${mese}-${day}`} className="bg-zinc-950" />
                    }
                    const hit = hitOf(p, mese, day)
                    const iso = isoDay(anno, mese, day)
                    const wd = weekday(anno, mese, day)
                    return (
                      <td key={`${p.nominativo}-${mese}-${day}`} className="p-0">
                        <button
                          type="button"
                          title={`${p.nominativo} ${iso}`}
                          className={`block h-5 w-4 text-[9px] ${
                            hit?.tipo === "ferie"
                              ? "bg-amber-500/80 text-zinc-950"
                              : hit?.tipo === "permessi"
                                ? "bg-sky-500/70 text-zinc-950"
                                : wd === 0
                                  ? "bg-zinc-900/80 text-zinc-700"
                                  : "text-zinc-800 hover:bg-zinc-800"
                          }`}
                          onClick={() => setCal({ nominativo: p.nominativo, tipo: hit?.tipo ?? "ferie", mese })}
                        >
                          {hit ? (hit.tipo === "permessi" ? "P" : "F") : ""}
                        </button>
                      </td>
                    )
                  })
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        Ferie e permessi: residuo anno precedente e previsione al 31 dicembre dalla busta. I pulsanti aprono il
        calendario per inserire i giorni.
      </p>
      {cal && (
        <CalendarioModal
          key={`${cal.nominativo}-${cal.tipo}-${cal.mese ?? "now"}`}
          nominativo={cal.nominativo}
          anno={anno}
          tipo={cal.tipo}
          meseIniziale={cal.mese}
          giorni={giorniByNome.get(cal.nominativo.toLowerCase()) ?? []}
          pending={toggleMut.isPending || periodoMut.isPending}
          onClose={() => setCal(null)}
          onToggle={(data, tipo) => toggleMut.mutate({ nominativo: cal.nominativo, data, tipo })}
          onPeriodo={(dal, al, tipo) => periodoMut.mutate({ nominativo: cal.nominativo, dal, al, tipo })}
        />
      )}
    </div>
  )
}
