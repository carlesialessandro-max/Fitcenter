import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  amministrazioneApi,
  type AmmFerieDaFile,
  type AmmFerieGiorno,
} from "@/api/amministrazione"
import { readBustePagaPdf } from "@/lib/amm-import-buste-pdf"
import { parseAmmMastrino } from "@/lib/amm-mastrino"

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

function oreToGiorni(n: number | null | undefined, unita: "h" | "gg" | null | undefined) {
  if (n == null) return null
  if (unita === "gg") return n
  return Math.round((n / 8) * 100) / 100
}

function isoDay(anno: number, mese: number, giorno: number) {
  return `${anno}-${pad2(mese)}-${pad2(giorno)}`
}

function formatGiorno(iso: string) {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${Number(d)} ${MESI[Number(m) - 1]?.slice(0, 3).toLowerCase() ?? m}`
}

function CalendarioModal({
  nominativo,
  anno,
  tipo,
  giorni,
  pending,
  onClose,
  onToggle,
  onPeriodo,
}: {
  nominativo: string
  anno: number
  tipo: "ferie" | "permessi"
  giorni: AmmFerieGiorno[]
  pending: boolean
  onClose: () => void
  onToggle: (data: string, tipo: "ferie" | "permessi") => void
  onPeriodo: (dal: string, al: string, tipo: "ferie" | "permessi") => void
}) {
  const [mese, setMese] = useState(new Date().getMonth() + 1)
  const [kind, setKind] = useState<"ferie" | "permessi">(tipo)
  const [dal, setDal] = useState("")
  const [al, setAl] = useState("")
  const n = giorniNelMese(anno, mese)
  const startWd = weekday(anno, mese, 1)
  const blanks = (startWd + 6) % 7
  const byDay = new Map(giorni.filter((g) => g.data.startsWith(`${anno}-${pad2(mese)}`)).map((g) => [g.data, g]))
  const segnati = giorni.filter((g) => g.tipo === kind).sort((a, b) => a.data.localeCompare(b.data))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{nominativo}</h3>
            <p className="text-xs text-zinc-500">Segna i giorni di ferie o permessi da fare.</p>
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
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
          <p className="mb-1 font-medium text-zinc-300">
            {kind === "ferie" ? "Ferie" : "Permessi"} usufruiti: {segnati.length} gg
          </p>
          {segnati.length ? (
            <p>{segnati.map((g) => formatGiorno(g.data)).join(", ")}</p>
          ) : (
            <p>Nessun giorno segnato.</p>
          )}
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
  const [cal, setCal] = useState<{ nominativo: string; tipo: "ferie" | "permessi" } | null>(null)

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

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-zinc-500">
        Dalla busta: anno precedente, maturato, goduto, residuo in ore e giorni (residuo / 8), più la previsione al 31
        dicembre. Ferie e permessi da fare si aggiungono dal calendario.
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
                  prec. {gg(p.ferieAnnoPrec)} · mat. {gg(p.ferieMaturate)} · god. {gg(p.ferieGodute)} · res.{" "}
                  {gg(p.ferieResidue)}
                  {p.unita === "h" ? " h" : ""} · {gg(oreToGiorni(p.ferieResidue, p.unita))} gg · 31/12{" "}
                  {gg(p.ferieProiezione)}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {!data.data?.dipendenti.length && !data.isLoading && (
        <p className="text-sm text-zinc-500">
          Nessun dipendente. Importa il PDF buste: arrivano anno prec., maturato, goduto, residuo e previsione 31/12.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-900/80 text-zinc-400">
              <th rowSpan={2} className="sticky left-0 z-10 bg-zinc-900 px-2 py-2 text-left font-medium">
                Nominativo
              </th>
              <th colSpan={6} className="border-l border-zinc-800 px-2 py-1 text-center font-medium">
                Busta
              </th>
              <th colSpan={3} className="border-l border-zinc-800 bg-amber-500/15 px-2 py-1 text-center font-semibold text-amber-200">
                Ferie
              </th>
              <th colSpan={3} className="border-l border-zinc-800 bg-sky-500/15 px-2 py-1 text-center font-semibold text-sky-200">
                Permessi
              </th>
            </tr>
            <tr className="bg-zinc-900/80 text-[11px] text-zinc-500">
              <th className="border-l border-zinc-800 px-2 py-2 text-right font-medium">Anno prec.</th>
              <th className="px-2 py-2 text-right font-medium">Maturato</th>
              <th className="px-2 py-2 text-right font-medium">Goduto</th>
              <th className="px-2 py-2 text-right font-medium">Residuo</th>
              <th className="px-2 py-2 text-right font-medium">Giorni</th>
              <th className="px-2 py-2 text-right font-medium">Prev. 31/12</th>
              <th className="border-l border-zinc-800 bg-amber-500/10 px-2 py-2 text-right font-medium">Usufruite</th>
              <th className="bg-amber-500/10 px-2 py-2 text-right font-medium">Da fare</th>
              <th className="bg-amber-500/10 px-2 py-2 text-center font-medium" />
              <th className="border-l border-zinc-800 bg-sky-500/10 px-2 py-2 text-right font-medium">Usufruiti</th>
              <th className="bg-sky-500/10 px-2 py-2 text-right font-medium">Da fare</th>
              <th className="bg-sky-500/10 px-2 py-2 text-center font-medium" />
            </tr>
          </thead>
          <tbody>
            {persone.map((p) => {
              const giorni = giorniByNome.get(p.nominativo.toLowerCase()) ?? []
              const ferieSegnate = giorni.filter((g) => g.tipo === "ferie")
              const permessiSegnati = giorni.filter((g) => g.tipo === "permessi")
              const ferieDaFare = oreToGiorni(p.ferieDisponibili, p.unita)
              const permessiDaFare = oreToGiorni(p.permessiDisponibili ?? p.permessiResidue, p.unita)
              return (
                <tr key={p.nominativo} className="border-t border-zinc-800">
                  <td className="sticky left-0 z-10 bg-zinc-950 px-2 py-1 font-medium text-zinc-100">{p.nominativo}</td>
                  <td className="border-l border-zinc-800 px-2 py-1 text-right tabular-nums text-zinc-400">
                    {gg(p.ferieAnnoPrec)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{gg(p.ferieMaturate)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-400">{gg(p.ferieGodute)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-200">
                    {gg(p.ferieResidue)}
                    {p.unita === "h" ? <span className="ml-0.5 text-[10px] text-zinc-600">h</span> : null}
                    {p.saldo?.mese ? <span className="ml-1 text-[10px] text-zinc-600">{p.saldo.mese}</span> : null}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-100">
                    {gg(oreToGiorni(p.ferieResidue, p.unita))}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-amber-200">
                    {gg(p.ferieProiezione)}
                    {p.ferieProiezione != null && p.unita === "h" ? (
                      <span className="ml-0.5 text-[10px] text-zinc-600">h</span>
                    ) : null}
                  </td>
                  <td
                    className="border-l border-zinc-800 px-2 py-1 text-right tabular-nums text-zinc-200"
                    title={ferieSegnate.map((g) => formatGiorno(g.data)).join(", ") || undefined}
                  >
                    {ferieSegnate.length ? `${ferieSegnate.length} gg` : "—"}
                  </td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${
                      ferieDaFare != null && ferieDaFare < 0 ? "text-red-400" : "text-zinc-100"
                    }`}
                  >
                    {gg(ferieDaFare)}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      className="rounded bg-amber-500/80 px-1.5 py-0.5 text-[10px] text-zinc-950"
                      onClick={() => setCal({ nominativo: p.nominativo, tipo: "ferie" })}
                    >
                      Aggiungi
                    </button>
                  </td>
                  <td
                    className="border-l border-zinc-800 px-2 py-1 text-right tabular-nums text-zinc-200"
                    title={permessiSegnati.map((g) => formatGiorno(g.data)).join(", ") || undefined}
                  >
                    {permessiSegnati.length ? `${permessiSegnati.length} gg` : "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-100">{gg(permessiDaFare)}</td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      className="rounded bg-sky-500/80 px-1.5 py-0.5 text-[10px] text-zinc-950"
                      onClick={() => setCal({ nominativo: p.nominativo, tipo: "permessi" })}
                    >
                      Aggiungi
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        Anno prec./Maturato/Goduto/Residuo e Prev. 31/12 sono le ore della busta. Giorni = residuo / 8. Usufruite =
        giorni segnati sul calendario. Da fare = residuo meno quei giorni. Passa il mouse su Usufruite per vedere le
        date.
      </p>
      {cal && (
        <CalendarioModal
          key={`${cal.nominativo}-${cal.tipo}`}
          nominativo={cal.nominativo}
          anno={anno}
          tipo={cal.tipo}
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
