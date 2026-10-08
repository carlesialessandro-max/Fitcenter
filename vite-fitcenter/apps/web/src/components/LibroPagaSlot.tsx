import type { ReactNode } from "react"
import {
  PERSONALE_QUALIFICHE,
  dataQualifica,
  parseQualificheUi,
  setDataQualifica,
  toggleQualificaConData,
  type QualificaConData,
} from "@/lib/personale-qualifiche"

const inputClsDefault =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"

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
}: {
  value: QualificaConData[]
  onChange: (next: QualificaConData[]) => void
  inputCls?: string
}) {
  const list = parseQualificheUi(value)
  return (
    <fieldset className="sm:col-span-2 rounded-lg border border-zinc-700/80 bg-zinc-950/40 p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Corsi sicurezza</legend>
      <div className="grid gap-3">
        {PERSONALE_QUALIFICHE.map((q) => {
          const on = list.some((x) => x.id === q.id)
          return (
            <div key={q.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_10.5rem] sm:items-center">
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(toggleQualificaConData(list, q.id))}
                />
                {q.label}
              </label>
              {on ? (
                <input
                  type="date"
                  value={dataQualifica(list, q.id)}
                  required
                  className={inputCls}
                  title={`Data ${q.label}`}
                  onChange={(e) => onChange(setDataQualifica(list, q.id, e.target.value))}
                />
              ) : (
                <span className="hidden text-xs text-zinc-600 sm:block">data corso</span>
              )}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

export { type QualificaConData }
