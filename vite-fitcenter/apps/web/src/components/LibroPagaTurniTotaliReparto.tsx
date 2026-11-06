import { useMemo } from "react"

type TurnoTotale = {
  livelloId: string
  livelloNome: string
  giorno?: string
  quantita: number
  importo: number
}

const MESI_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
]

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function fmtMeseIt(ym: string): string {
  const m = Number(ym.slice(5, 7))
  const y = ym.slice(0, 4)
  if (!y || m < 1 || m > 12) return ym
  return `${MESI_IT[m - 1]} ${y}`
}

export function aggregaTurniPerReparto(turni: TurnoTotale[], mese: string) {
  const map = new Map<string, { livelloId: string; livelloNome: string; valore: number; importo: number }>()
  for (const t of turni) {
    const id = t.livelloId || t.livelloNome || "—"
    const prev = map.get(id)
    if (prev) {
      prev.valore += t.quantita
      prev.importo += t.importo
    } else {
      map.set(id, {
        livelloId: id,
        livelloNome: t.livelloNome || "—",
        valore: t.quantita,
        importo: t.importo,
      })
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, valore: round2(r.valore), importo: round2(r.importo), mese }))
    .sort((a, b) => a.livelloNome.localeCompare(b.livelloNome, "it"))
}

export function LibroPagaTurniTotaliReparto({
  turni,
  mese,
}: {
  turni: TurnoTotale[]
  mese: string
}) {
  const rows = useMemo(() => aggregaTurniPerReparto(turni, mese), [turni, mese])
  const totValore = round2(rows.reduce((s, r) => s + r.valore, 0))
  const totImporto = round2(rows.reduce((s, r) => s + r.importo, 0))
  if (!rows.length) return null
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-800">
      <div className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <h3 className="text-sm font-medium text-zinc-200">Totali mensili per reparto</h3>
        <p className="text-[11px] text-zinc-500">Somma dei turni del mese, raggruppati per mansione.</p>
      </div>
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2">Data</th>
            <th className="px-3 py-2">Reparto</th>
            <th className="px-3 py-2 text-right">Valore</th>
            <th className="px-3 py-2 text-right">Importo (€)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.livelloId} className="border-t border-zinc-800 text-zinc-200">
              <td className="px-3 py-2 whitespace-nowrap capitalize">{fmtMeseIt(r.mese)}</td>
              <td className="px-3 py-2">{r.livelloNome}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.valore}</td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(r.importo)}</td>
            </tr>
          ))}
          <tr className="border-t border-zinc-700 bg-zinc-900/50 font-medium text-zinc-100">
            <td className="px-3 py-2" colSpan={2}>
              Totale
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{totValore}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(totImporto)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
