import { useMemo } from "react"
import type { CalendarioComparto, CalendarioIstruttore, CalendarioMergedEventDto } from "@/api/calendario"
import {
  computeTurnazioni,
  formatHoursDecimal,
  formatHoursMinutes,
  type TurnazioniPeriodSummary,
} from "@/lib/calendario-turnazioni"

const H2_BLUE = "#46A6D9"

function PeriodHeader({ summary }: { summary: TurnazioniPeriodSummary }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 pb-2">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">{summary.label}</h3>
        <p className="text-[11px] text-zinc-500">
          {summary.from} → {summary.to} · {summary.totalSlots} turni
        </p>
      </div>
      <div className="text-right">
        <p className="text-lg font-semibold tabular-nums" style={{ color: H2_BLUE }}>
          {formatHoursMinutes(summary.totalMinutes)}
        </p>
        <p className="text-[11px] text-zinc-500">{formatHoursDecimal(summary.totalMinutes)} totali</p>
      </div>
    </div>
  )
}

function PeriodBlock({ summary }: { summary: TurnazioniPeriodSummary }) {
  return (
    <section className="space-y-2">
      <PeriodHeader summary={summary} />
      {summary.rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nessuno slot nel periodo.</p>
      ) : (
        <PeriodTable summary={summary} />
      )}
    </section>
  )
}

function PeriodTable({ summary }: { summary: TurnazioniPeriodSummary }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full min-w-[280px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-500">
            <th className="px-3 py-2 font-medium">Staff / istruttore</th>
            <th className="px-3 py-2 text-right font-medium">Turni</th>
            <th className="px-3 py-2 text-right font-medium">Ore</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((r) => (
            <tr key={r.key} className="border-b border-zinc-800/60 last:border-0">
              <td className="px-3 py-2 text-zinc-200">{r.label}</td>
              <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{r.slotCount}</td>
              <td className="px-3 py-2 text-right tabular-nums text-zinc-100">
                {formatHoursMinutes(r.minutes)}
                <span className="ml-1 text-[10px] text-zinc-500">({formatHoursDecimal(r.minutes)})</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-900/60 font-medium">
            <td className="px-3 py-2 text-zinc-300">Totale</td>
            <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{summary.totalSlots}</td>
            <td className="px-3 py-2 text-right tabular-nums" style={{ color: H2_BLUE }}>
              {formatHoursMinutes(summary.totalMinutes)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function CalendarioTurnazioniModal({
  open,
  onClose,
  compartoLabel,
  cursor,
  events,
  instructors,
  comparto,
}: {
  open: boolean
  onClose: () => void
  compartoLabel: string
  cursor: Date
  events: CalendarioMergedEventDto[]
  instructors: CalendarioIstruttore[]
  comparto: CalendarioComparto
}) {
  const data = useMemo(
    () => (open ? computeTurnazioni(cursor, events, instructors, comparto) : null),
    [open, cursor, events, instructors, comparto]
  )

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center"
    >
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label="Chiudi" />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">Turnazioni · {compartoLabel}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Ore stimate dagli slot del planning (settimana tipo ripetuta sui giorni del periodo). Durata da fascia oraria nel titolo o default per reparto.
          </p>
        </div>
        <div className="space-y-6 overflow-y-auto px-5 py-4">
          {data ? (
            <>
              <PeriodBlock summary={data.week} />
              <PeriodBlock summary={data.month} />
            </>
          ) : (
            <p className="text-sm text-zinc-500">Caricamento…</p>
          )}
        </div>
        <div className="border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
