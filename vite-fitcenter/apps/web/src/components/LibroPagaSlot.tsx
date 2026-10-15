import type { ReactNode } from "react"
import {
  PERSONALE_QUALIFICHE,
  dataQualifica,
  labelValiditaQualifica,
  parseQualificheUi,
  qualificaScaduta,
  scadenzaQualifica,
  setDataQualifica,
  toggleQualificaConData,
  type PersonaleQualificaId,
  type QualificaConData,
} from "@/lib/personale-qualifiche"

const inputClsDefault =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"

function fmtDateIt(iso: string): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

export function LibroPagaSlot({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
      <h2 className="mb-4 border-b border-zinc-800 pb-2 text-sm font-medium text-zinc-200">{title}</h2>
      {children}
    </div>
  )
}

export function QualificheCorsiFields({
  value,
  onChange,
  inputCls = inputClsDefault,
  readOnly = false,
}: {
  value: QualificaConData[]
  onChange?: (next: QualificaConData[]) => void
  inputCls?: string
  readOnly?: boolean
}) {
  const list = parseQualificheUi(value)
  return (
    <fieldset className="sm:col-span-2 rounded-lg border border-zinc-700/80 bg-zinc-950/40 p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Corsi sicurezza</legend>
      {readOnly ? (
        <p className="mb-2 text-[11px] text-zinc-600">Sola lettura: per modificare i corsi contatta l&apos;amministratore.</p>
      ) : (
        <p className="mb-2 text-[11px] text-zinc-600">
          Indica la data del corso: la scadenza si calcola in automatico in base alla validità indicata.
        </p>
      )}
      <div className="mb-1 hidden gap-2 text-[10px] uppercase tracking-wide text-zinc-600 sm:grid sm:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem]">
        <span>Corso</span>
        <span>Data corso</span>
        <span>Scadenza</span>
      </div>
      <div className="grid gap-3">
        {PERSONALE_QUALIFICHE.map((q) => {
          const qid = q.id as PersonaleQualificaId
          const on = list.some((x) => x.id === q.id)
          const data = dataQualifica(list, q.id)
          const validita = labelValiditaQualifica(qid)
          const scadIso = data ? scadenzaQualifica(data, qid) : null
          const scaduta = data ? qualificaScaduta(data, qid) : false
          if (readOnly) {
            return (
              <div key={q.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem] sm:items-center">
                <span className={`text-sm ${on ? "text-zinc-200" : "text-zinc-500"}`}>
                  {q.label}
                  <span className="ml-1 text-xs text-zinc-500">({validita})</span>
                </span>
                <span className="text-sm text-zinc-300">{on && data ? fmtDateIt(data) : "—"}</span>
                <span className={`text-sm ${on && scadIso ? (scaduta ? "text-red-400" : "text-emerald-400/90") : "text-zinc-500"}`}>
                  {on && scadIso ? fmtDateIt(scadIso) : "—"}
                </span>
              </div>
            )
          }
          return (
            <div key={q.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem] sm:items-center">
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={on}
                  onChange={() => onChange?.(toggleQualificaConData(list, q.id))}
                />
                <span>
                  {q.label}
                  <span className="mt-0.5 block text-xs text-zinc-500">Validità {validita}</span>
                </span>
              </label>
              {on ? (
                <input
                  type="date"
                  value={dataQualifica(list, q.id)}
                  required
                  className={inputCls}
                  title={`Data ${q.label}`}
                  onChange={(e) => onChange?.(setDataQualifica(list, q.id, e.target.value))}
                />
              ) : (
                <span className="hidden text-xs text-zinc-600 sm:block">—</span>
              )}
              {on && scadIso ? (
                <span className={`text-xs sm:text-sm ${scaduta ? "font-medium text-red-400" : "text-emerald-400/90"}`}>
                  {fmtDateIt(scadIso)}
                  {scaduta ? " · scaduto" : ""}
                </span>
              ) : (
                <span className="hidden text-xs text-zinc-600 sm:block">{on ? "—" : ""}</span>
              )}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

export { type QualificaConData }
