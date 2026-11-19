import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  amministrazioneApi,
  type AmmFerieDaFile,
  type AmmFerieGiorno,
  type AmmFeriePersona,
} from "@/api/amministrazione"
import { useAuth } from "@/contexts/AuthContext"
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

function sumNum(rows: AmmFeriePersona[], pick: (p: AmmFeriePersona) => number | null | undefined) {
  let n = 0
  let any = false
  for (const p of rows) {
    const v = pick(p)
    if (v == null) continue
    any = true
    n += v
  }
  return any ? Math.round(n * 100) / 100 : null
}

function meseBustaDefault(oggi = new Date()) {
  return oggi.getMonth() === 0 ? 12 : oggi.getMonth()
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
            <p className="text-xs text-zinc-500">Segna i giorni di ferie o permessi durante l’anno.</p>
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
            {kind === "ferie" ? "Ferie" : "Permessi"} segnati: {segnati.length} gg
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

function useFerieAnno(anno: number, scope: "admin" | "me" = "admin") {
  const qc = useQueryClient()
  const [error, setError] = useState("")
  const [msg, setMsg] = useState("")
  const data = useQuery({
    queryKey: ["amm-ferie", scope, anno],
    queryFn: () => (scope === "me" ? amministrazioneApi.mieFerie(anno) : amministrazioneApi.dipendentiFerie(anno)),
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
    mutationFn: (body: { nominativo: string; dal: string; al: string; tipo: "ferie" | "permessi" }) =>
      amministrazioneApi.addFeriePeriodo(body),
    onSuccess: (r) => {
      setMsg(`Segnati ${r.inserite} giorni.`)
      setError("")
      void qc.invalidateQueries({ queryKey: ["amm-ferie"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const giorniByNome = useMemo(() => {
    const map = new Map<string, AmmFerieGiorno[]>()
    for (const g of data.data?.giorni ?? []) {
      const list = map.get(g.nominativo.toLowerCase()) ?? []
      list.push(g)
      map.set(g.nominativo.toLowerCase(), list)
    }
    return map
  }, [data.data?.giorni])
  return { data, error, setError, msg, setMsg, toggleMut, periodoMut, giorniByNome }
}

function OreBustaTable({
  titolo,
  persone,
  giorniByNome,
  tipo,
}: {
  titolo: string
  persone: AmmFeriePersona[]
  giorniByNome: Map<string, AmmFerieGiorno[]>
  tipo: "ferie" | "permessi"
}) {
  const isFerie = tipo === "ferie"
  const tot = {
    prec: sumNum(persone, (p) => (isFerie ? p.ferieAnnoPrec : p.permessiAnnoPrec)),
    mat: sumNum(persone, (p) => (isFerie ? p.ferieMaturate : p.permessiMaturate)),
    god: sumNum(persone, (p) => (isFerie ? p.ferieGodute : p.permessiGodute)),
    res: sumNum(persone, (p) => (isFerie ? p.ferieResidue : p.permessiResidue)),
    pro: sumNum(persone, (p) => (isFerie ? p.ferieProiezione : p.permessiProiezione)),
  }
  const totGiorni = sumNum(persone, (p) => oreToGiorni(isFerie ? p.ferieResidue : p.permessiResidue, p.unita))
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <p className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-300">
        {titolo}
      </p>
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-900/80 text-zinc-400">
            <th className="sticky left-0 z-10 bg-zinc-900 px-2 py-2 text-left font-medium">Nominativo</th>
            <th className="px-2 py-2 text-right font-medium">Arretrate</th>
            <th className="px-2 py-2 text-right font-medium">Maturate</th>
            <th className="px-2 py-2 text-right font-medium">Godute</th>
            <th className="px-2 py-2 text-right font-medium">Residuo</th>
            <th className="px-2 py-2 text-right font-medium">Proiez. 31/12</th>
            <th className="px-2 py-2 text-right font-medium">Giorni</th>
            {isFerie ? (
              <>
                <th className="px-2 py-2 text-right font-medium">Usufruite</th>
                <th className="px-2 py-2 text-right font-medium">Da fare</th>
              </>
            ) : (
              <>
                <th className="px-2 py-2 text-right font-medium">Usufruiti</th>
                <th className="px-2 py-2 text-right font-medium">Da fare</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {persone.map((p) => {
            const segnati = (giorniByNome.get(p.nominativo.toLowerCase()) ?? []).filter((g) => g.tipo === tipo)
            const residue = isFerie ? p.ferieResidue : p.permessiResidue
            const daFare = oreToGiorni(isFerie ? p.ferieDisponibili : p.permessiDisponibili, p.unita)
            return (
              <tr key={`${tipo}-${p.nominativo}`} className="border-t border-zinc-800">
                <td className="sticky left-0 z-10 bg-zinc-950 px-2 py-1 font-medium text-zinc-100">{p.nominativo}</td>
                <td className="px-2 py-1 text-right tabular-nums text-zinc-400">
                  {gg(isFerie ? p.ferieAnnoPrec : p.permessiAnnoPrec)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-zinc-400">
                  {gg(isFerie ? p.ferieMaturate : p.permessiMaturate)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-zinc-400">
                  {gg(isFerie ? p.ferieGodute : p.permessiGodute)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-zinc-200">
                  {gg(residue)}
                  {p.unita === "h" ? <span className="ml-0.5 text-[10px] text-zinc-600">h</span> : null}
                  {p.saldo?.mese ? <span className="ml-1 text-[10px] text-zinc-600">{p.saldo.mese}</span> : null}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-amber-200">
                  {gg(isFerie ? p.ferieProiezione : p.permessiProiezione)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-zinc-100">{gg(oreToGiorni(residue, p.unita))}</td>
                <td
                  className="px-2 py-1 text-right tabular-nums text-zinc-200"
                  title={segnati.map((g) => formatGiorno(g.data)).join(", ") || undefined}
                >
                  {segnati.length ? `${segnati.length} gg` : "—"}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    daFare != null && daFare < 0 ? "text-red-400" : "text-zinc-100"
                  }`}
                >
                  {gg(daFare)}
                </td>
              </tr>
            )
          })}
        </tbody>
        {persone.length ? (
          <tfoot>
            <tr className="border-t border-zinc-700 bg-zinc-900/80 font-medium text-zinc-100">
              <td className="sticky left-0 z-10 bg-zinc-900 px-2 py-1.5">Totale</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{gg(tot.prec)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{gg(tot.mat)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{gg(tot.god)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{gg(tot.res)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-amber-200">{gg(tot.pro)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{gg(totGiorni)}</td>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5" />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}

export function DipendentiFerieTab() {
  const qc = useQueryClient()
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [meseImportNum, setMeseImportNum] = useState(() => meseBustaDefault(oggi))
  const [q, setQ] = useState("")
  const [pdfBusy, setPdfBusy] = useState(false)
  const [feriePreview, setFeriePreview] = useState<AmmFerieDaFile[] | null>(null)
  const { data, error, setError, msg, setMsg, giorniByNome } = useFerieAnno(anno)
  const meta = useQuery({ queryKey: ["amm-meta"], queryFn: amministrazioneApi.meta })
  const attivi = (meta.data?.reparti ?? []).filter((r) => r.attivo)
  const meseImport = `${anno}-${pad2(meseImportNum)}`

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

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-zinc-500">
        Totali dalla busta (anche se il cedolino è a ottobre): Residuo = alla data della busta, Proiezione = al 31/12.
        I permessi sono la somma di Permessi + ROL + ex festività + flessibilità + banca ore. L’inserimento dei giorni
        lo fa il dipendente dal proprio login.
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
            <p className="text-xs text-zinc-400">Ferie e permessi da busta per {feriePreview.length} nominativi</p>
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
                {importFerieMut.isPending ? "Caricamento…" : "Importa buste"}
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto text-xs">
            {feriePreview.map((p, index) => (
              <p key={`${p.nominativo}-${index}`} className="flex justify-between gap-4 text-zinc-300">
                <span>{p.nominativo}</span>
                <span className="tabular-nums text-zinc-400">
                  ferie res. {gg(p.ferieResidue)}
                  {p.ferieProiezione != null ? ` · 31/12 ${gg(p.ferieProiezione)}` : ""}
                  {p.permessiResidue != null ? ` · perm. ${gg(p.permessiResidue)}` : ""}
                  {p.permessiProiezione != null ? ` · perm. 31/12 ${gg(p.permessiProiezione)}` : ""}
                  {p.unita === "h" ? " h" : ""}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {!data.data?.dipendenti.length && !data.isLoading && (
        <p className="text-sm text-zinc-500">Nessun dipendente. Importa il PDF buste per i residui ferie.</p>
      )}

      <OreBustaTable
        titolo="Ferie"
        persone={persone}
        giorniByNome={giorniByNome}
        tipo="ferie"
      />
      <OreBustaTable
        titolo="Permessi (ROL, ex festività, flessibilità, banca ore)"
        persone={persone}
        giorniByNome={giorniByNome}
        tipo="permessi"
      />
      <p className="text-xs text-zinc-500">
        Ore dalla busta. Residuo = alla data del cedolino (es. 31/10). Proiezione = al 31/12. Giorni = residuo / 8.
        Usufruite = giorni segnati dal dipendente dopo quella busta. Da fare = residuo meno quei giorni.
      </p>
    </div>
  )
}

export function MieFeriePage() {
  const { user } = useAuth()
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [cal, setCal] = useState<"ferie" | "permessi" | null>(null)
  const { data, error, msg, toggleMut, periodoMut } = useFerieAnno(anno, "me")
  const nominativo = (user?.consulenteNome || user?.nome || "").trim()
  const persona: AmmFeriePersona | undefined = (data.data?.dipendenti ?? []).find(
    (p) => p.nominativo.trim().toLocaleLowerCase("it") === nominativo.toLocaleLowerCase("it"),
  )
  const giorni = (data.data?.giorni ?? []).filter(
    (g) => g.nominativo.trim().toLocaleLowerCase("it") === nominativo.toLocaleLowerCase("it"),
  )
  const ferieSegnate = giorni.filter((g) => g.tipo === "ferie")
  const permessiSegnati = giorni.filter((g) => g.tipo === "permessi")
  const nome = nominativo
  const ferieDaFare = oreToGiorni(persona?.ferieDisponibili, persona?.unita)
  const permessiDaFare = oreToGiorni(persona?.permessiDisponibili ?? persona?.permessiResidue, persona?.unita)

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Le mie ferie</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Vedi solo il tuo nominativo. Puoi inserire ferie e permessi durante l’anno.
      </p>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
      {!nominativo && (
        <p className="mt-4 text-sm text-red-400">Il tuo utente non ha un nominativo. Chiedi all’amministrazione.</p>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-500">
          Anno
          <input
            type="number"
            className={inputCls}
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value) || anno)}
          />
        </label>
      </div>
      {nome ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="text-lg font-semibold text-zinc-100">{nome}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              <div>
                <dt className="text-xs text-zinc-500">Anno prec.</dt>
                <dd className="tabular-nums text-zinc-200">{gg(persona?.ferieAnnoPrec)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Maturato</dt>
                <dd className="tabular-nums text-zinc-200">{gg(persona?.ferieMaturate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Goduto</dt>
                <dd className="tabular-nums text-zinc-200">{gg(persona?.ferieGodute)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Residuo</dt>
                <dd className="tabular-nums text-zinc-200">
                  {gg(persona?.ferieResidue)}
                  {persona?.unita === "h" ? <span className="ml-0.5 text-[10px] text-zinc-600">h</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Giorni</dt>
                <dd className="tabular-nums text-zinc-100">{gg(oreToGiorni(persona?.ferieResidue, persona?.unita))}</dd>
              </div>
            </dl>
            {persona?.permessiResidue != null || persona?.permessiAnnoPrec != null ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-zinc-500">Permessi arretrati</dt>
                  <dd className="tabular-nums text-zinc-200">{gg(persona?.permessiAnnoPrec)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Permessi maturati</dt>
                  <dd className="tabular-nums text-zinc-200">{gg(persona?.permessiMaturate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Permessi goduti</dt>
                  <dd className="tabular-nums text-zinc-200">{gg(persona?.permessiGodute)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Permessi residuo</dt>
                  <dd className="tabular-nums text-zinc-200">{gg(persona?.permessiResidue)}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-amber-200">Ferie</h2>
                <button type="button" className={btnAmber} onClick={() => setCal("ferie")}>
                  Aggiungi
                </button>
              </div>
              <p className="mt-3 text-sm text-zinc-300">
                Usufruite: <span className="tabular-nums font-medium">{ferieSegnate.length} gg</span>
              </p>
              <p className="text-sm text-zinc-300">
                Da fare: <span className="tabular-nums font-medium">{gg(ferieDaFare)}</span>
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {ferieSegnate.length ? ferieSegnate.map((g) => formatGiorno(g.data)).join(", ") : "Nessun giorno segnato."}
              </p>
            </div>
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-sky-200">Permessi</h2>
                <button
                  type="button"
                  className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-sky-400"
                  onClick={() => setCal("permessi")}
                >
                  Aggiungi
                </button>
              </div>
              <p className="mt-3 text-sm text-zinc-300">
                Usufruiti: <span className="tabular-nums font-medium">{permessiSegnati.length} gg</span>
              </p>
              <p className="text-sm text-zinc-300">
                Da fare: <span className="tabular-nums font-medium">{gg(permessiDaFare)}</span>
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {permessiSegnati.length
                  ? permessiSegnati.map((g) => formatGiorno(g.data)).join(", ")
                  : "Nessun giorno segnato."}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {cal && nome ? (
        <CalendarioModal
          key={cal}
          nominativo={nome}
          anno={anno}
          tipo={cal}
          giorni={giorni}
          pending={toggleMut.isPending || periodoMut.isPending}
          onClose={() => setCal(null)}
          onToggle={(data, tipo) => toggleMut.mutate({ nominativo: nome, data, tipo })}
          onPeriodo={(dal, al, tipo) => periodoMut.mutate({ nominativo: nome, dal, al, tipo })}
        />
      ) : null}
    </div>
  )
}
