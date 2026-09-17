import { avgNums, DOW_IT, fmtAvg, ORE_TABELLA } from "@/lib/tabella-oraria"

type Props = {
  days: string[]
  values: Record<string, Record<string, number | null | undefined>>
  editable?: boolean
  disabled?: boolean
  onChange?: (giorno: string, ora: string, value: number | null) => void
}

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}` : iso
}

export function TabellaOrariaSettimana({ days, values, editable, disabled, onChange }: Props) {
  const cols = days.slice(0, 7)
  const medOra = ORE_TABELLA.map((ora) => avgNums(cols.map((d) => values[d]?.[ora] ?? null)))
  const medGiorno = cols.map((d) => avgNums(ORE_TABELLA.map((ora) => values[d]?.[ora] ?? null)))

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/30 print:border-zinc-300 print:bg-white">
      <table className="min-w-full border-collapse text-center text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-950/50 print:bg-white">
            <th className="px-3 py-2 text-left font-medium text-zinc-400 print:text-zinc-700"> </th>
            {cols.map((d, i) => (
              <th key={d} className="px-2 py-2 font-semibold text-zinc-200 print:text-zinc-900">
                <div>{DOW_IT[i] ?? ""}</div>
                <div className="text-[11px] font-normal text-zinc-500">{fmtDay(d)}</div>
              </th>
            ))}
            <th className="px-2 py-2 font-semibold text-zinc-300">MED ORA</th>
          </tr>
        </thead>
        <tbody>
          {ORE_TABELLA.map((ora, ri) => (
            <tr key={ora} className="border-b border-zinc-800/50 last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-zinc-300">{ora}</td>
              {cols.map((d) => {
                const v = values[d]?.[ora]
                const filled = v != null && Number.isFinite(v)
                return (
                  <td key={`${d}-${ora}`} className="px-1 py-1">
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        max={500}
                        inputMode="numeric"
                        disabled={disabled}
                        value={filled ? String(v) : ""}
                        placeholder="—"
                        onChange={(e) => {
                          const raw = e.target.value.trim()
                          if (raw === "") onChange?.(d, ora, null)
                          else {
                            const n = Number(raw)
                            if (Number.isFinite(n) && n >= 0) onChange?.(d, ora, Math.round(n))
                          }
                        }}
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-center text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50"
                      />
                    ) : (
                      <span className={filled ? "text-zinc-100" : "text-zinc-600"}>{filled ? v : ""}</span>
                    )}
                  </td>
                )
              })}
              <td className="px-2 py-1.5 font-medium text-zinc-300">{fmtAvg(medOra[ri] ?? null)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-950/60 font-semibold">
            <td className="px-3 py-2 text-left text-zinc-200">MED GIORNO</td>
            {medGiorno.map((v, i) => (
              <td key={cols[i]} className="px-2 py-2 text-zinc-200">
                {fmtAvg(v)}
              </td>
            ))}
            <td className="px-2 py-2 text-zinc-400">{fmtAvg(avgNums(medOra))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
