import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { LibroPagaSnapshot } from "@/api/libroPaga"

const COLORS = ["#46A6D9", "#F59E0B", "#34D399", "#A78BFA", "#F87171", "#FBBF24", "#60A5FA", "#C084FC"]
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-300">{title}</h2>
      {children}
    </div>
  )
}

function downloadCsv(filename: string, rows: string[][]) {
  const bom = "\uFEFF"
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n")
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type Vista = "riepilogo" | "dipendenti" | "mansioni" | "giorni" | "grafici"

export function LibroPagaReport({ data }: { data: LibroPagaSnapshot }) {
  const [vista, setVista] = useState<Vista>("riepilogo")
  const totImporto = data.mensilita.reduce((s, r) => s + r.importo, 0)
  const totOre = data.mensilita.reduce((s, r) => s + r.ore, 0)
  const totBonifico = data.mensilita.reduce((s, r) => s + r.bonifico, 0)

  const perMansione = useMemo(() => {
    const map = new Map<string, { nome: string; n: number; ore: number; importo: number }>()
    for (const t of data.turni) {
      const cur = map.get(t.livelloId) ?? { nome: t.livelloNome, n: 0, ore: 0, importo: 0 }
      cur.n += 1
      cur.ore += t.quantita
      cur.importo += t.importo
      map.set(t.livelloId, cur)
    }
    return [...map.values()].sort((a, b) => b.importo - a.importo)
  }, [data.turni])

  const perGiorno = useMemo(() => {
    const map = new Map<string, { giorno: string; n: number; ore: number; importo: number }>()
    for (const t of data.turni) {
      const cur = map.get(t.giorno) ?? { giorno: t.giorno, n: 0, ore: 0, importo: 0 }
      cur.n += 1
      cur.ore += t.quantita
      cur.importo += t.importo
      map.set(t.giorno, cur)
    }
    return [...map.values()].sort((a, b) => a.giorno.localeCompare(b.giorno))
  }, [data.turni])

  const dipendenti = useMemo(
    () => [...data.mensilita].sort((a, b) => b.importo - a.importo),
    [data.mensilita]
  )

  const mesi = data.home.costiMesi.map((c) => ({
    ...c,
    label: c.mese.slice(5) + "/" + c.mese.slice(2, 4),
  }))

  const viste: { id: Vista; label: string }[] = [
    { id: "riepilogo", label: "Riepilogo" },
    { id: "dipendenti", label: "Per dipendente" },
    { id: "mansioni", label: "Per mansione" },
    { id: "giorni", label: "Per data" },
    { id: "grafici", label: "Grafici" },
  ]

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {viste.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVista(v.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                vista === v.id ? "bg-amber-500/20 text-amber-200" : "border border-zinc-700 text-zinc-400"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnGhost}
            onClick={() =>
              downloadCsv(`mensilita-${data.mese}.csv`, [
                ["Nominativo", "Ore", "Importo", "Bonifico", "Turni", "Note"],
                ...dipendenti.map((r) => [
                  r.personaleNome,
                  String(r.ore),
                  String(r.importo).replace(".", ","),
                  String(r.bonifico).replace(".", ","),
                  String(r.nTurni),
                  r.nota,
                ]),
              ])
            }
          >
            CSV mensilità
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() =>
              downloadCsv(`turni-${data.mese}.csv`, [
                ["Data", "Mansione", "Dipendente", "Valore", "Importo", "Note"],
                ...data.turni.map((t) => [
                  fmtDateIt(t.giorno),
                  t.livelloNome,
                  t.personaleNome,
                  String(t.quantita).replace(".", ","),
                  String(t.importo).replace(".", ","),
                  t.note ?? "",
                ]),
              ])
            }
          >
            CSV turni
          </button>
        </div>
      </div>

      {vista === "riepilogo" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Persone">
            <p className="text-2xl font-semibold">{data.mensilita.length}</p>
            <p className="mt-1 text-xs text-zinc-500">{data.personale.length} in anagrafica visibile</p>
          </Card>
          <Card title="Turni">
            <p className="text-2xl font-semibold">{data.turni.length}</p>
            <p className="mt-1 text-xs text-zinc-500">{totOre.toFixed(2)} ore/valore</p>
          </Card>
          <Card title="Importo mese">
            <p className="text-2xl font-semibold">{eur(totImporto)}</p>
          </Card>
          <Card title="Bonifici">
            <p className="text-2xl font-semibold">{eur(totBonifico)}</p>
          </Card>
        </div>
      )}

      {vista === "dipendenti" && (
        <Card title="Costo per dipendente">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Nominativo</th>
                  <th className="px-3 py-2 text-right">Turni</th>
                  <th className="px-3 py-2 text-right">Valore</th>
                  <th className="px-3 py-2 text-right">Importo</th>
                  <th className="px-3 py-2 text-right">Bonifico</th>
                </tr>
              </thead>
              <tbody>
                {dipendenti.map((r) => (
                  <tr key={r.personaleId} className="border-t border-zinc-800 text-zinc-200">
                    <td className="px-3 py-2">{r.personaleNome}</td>
                    <td className="px-3 py-2 text-right">{r.nTurni}</td>
                    <td className="px-3 py-2 text-right">{r.ore}</td>
                    <td className="px-3 py-2 text-right">{eur(r.importo)}</td>
                    <td className="px-3 py-2 text-right">{eur(r.bonifico)}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-700 font-medium text-zinc-100">
                  <td className="px-3 py-2">Totale</td>
                  <td className="px-3 py-2 text-right">{data.turni.length}</td>
                  <td className="px-3 py-2 text-right">{totOre.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{eur(totImporto)}</td>
                  <td className="px-3 py-2 text-right">{eur(totBonifico)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {vista === "mansioni" && (
        <Card title="Costo per mansione">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Mansione</th>
                  <th className="px-3 py-2 text-right">Turni</th>
                  <th className="px-3 py-2 text-right">Valore</th>
                  <th className="px-3 py-2 text-right">Importo</th>
                </tr>
              </thead>
              <tbody>
                {perMansione.map((r) => (
                  <tr key={r.nome} className="border-t border-zinc-800 text-zinc-200">
                    <td className="px-3 py-2">{r.nome}</td>
                    <td className="px-3 py-2 text-right">{r.n}</td>
                    <td className="px-3 py-2 text-right">{Math.round(r.ore * 100) / 100}</td>
                    <td className="px-3 py-2 text-right">{eur(r.importo)}</td>
                  </tr>
                ))}
                {!perMansione.length && (
                  <tr>
                    <td className="px-3 py-6 text-zinc-500" colSpan={4}>
                      Nessun turno in questo mese.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {vista === "giorni" && (
        <Card title="Costo per data">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2 text-right">Turni</th>
                  <th className="px-3 py-2 text-right">Valore</th>
                  <th className="px-3 py-2 text-right">Importo</th>
                </tr>
              </thead>
              <tbody>
                {perGiorno.map((r) => (
                  <tr key={r.giorno} className="border-t border-zinc-800 text-zinc-200">
                    <td className="px-3 py-2">{fmtDateIt(r.giorno)}</td>
                    <td className="px-3 py-2 text-right">{r.n}</td>
                    <td className="px-3 py-2 text-right">{Math.round(r.ore * 100) / 100}</td>
                    <td className="px-3 py-2 text-right">{eur(r.importo)}</td>
                  </tr>
                ))}
                {!perGiorno.length && (
                  <tr>
                    <td className="px-3 py-6 text-zinc-500" colSpan={4}>
                      Nessun turno in questo mese.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {vista === "grafici" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {mesi.length > 0 && (
            <Card title="Andamento costo dipendenti">
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={mesi}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
                    <YAxis stroke="#71717a" fontSize={11} />
                    <Tooltip formatter={(v: number) => eur(v)} />
                    <Line type="monotone" dataKey="totale" stroke="#46A6D9" dot={false} name="Costo" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {mesi.length > 0 && (
            <Card title="Costo per reparto">
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={mesi}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
                    <YAxis stroke="#71717a" fontSize={11} />
                    <Tooltip formatter={(v: number) => eur(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="piscina" stroke="#46A6D9" dot={false} name="piscina" />
                    <Line type="monotone" dataKey="palestra" stroke="#F87171" dot={false} name="fitness" />
                    <Line type="monotone" dataKey="ristorante" stroke="#34D399" dot={false} name="aqua" />
                    <Line type="monotone" dataKey="miscellanea" stroke="#FBBF24" dot={false} name="miscellanea" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {data.home.donut.some((d) => d.value) && (
            <Card title="Costo mese corrente">
              <div className="h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.home.donut} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80}>
                      {data.home.donut.map((d, i) => (
                        <Cell key={d.label} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => eur(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {perMansione.length > 0 && (
            <Card title="Riparto mansioni (mese)">
              <div className="h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={perMansione.slice(0, 8).map((r) => ({ label: r.nome, value: Math.round(r.importo * 100) / 100 }))}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={50}
                      outerRadius={80}
                    >
                      {perMansione.slice(0, 8).map((d, i) => (
                        <Cell key={d.nome} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => eur(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {data.home.miscDonut.length > 0 && (
            <Card title="Miscellanea">
              <div className="h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.home.miscDonut} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80}>
                      {data.home.miscDonut.map((d, i) => (
                        <Cell key={d.label} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => eur(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {!mesi.length && !perMansione.length && (
            <p className="text-sm text-zinc-500">Nessun dato grafico per il periodo selezionato.</p>
          )}
        </div>
      )}
      <p className="text-xs text-zinc-500">
        I report usano il mese e il reparto selezionati in alto. Responsabile: solo il proprio reparto.
      </p>
    </div>
  )
}
