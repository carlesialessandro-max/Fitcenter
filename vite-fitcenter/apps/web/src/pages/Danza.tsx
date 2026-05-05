import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { useAuth } from "@/contexts/AuthContext"

function digitsPhone(s: string): string {
  return String(s ?? "").replace(/[^\d+]/g, "").replace(/^00/, "+")
}
function telHref(s: string): string | null {
  const d = digitsPhone(s)
  if (!d || d.length < 6) return null
  return `tel:${d.replace(/^\+/, "")}`
}
function mailHref(email: string, subject?: string, body?: string): string | null {
  const e = String(email ?? "").trim()
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  const qs: string[] = []
  if (subject) qs.push(`subject=${encodeURIComponent(subject)}`)
  if (body) qs.push(`body=${encodeURIComponent(body)}`)
  return `mailto:${encodeURIComponent(e)}${qs.length ? `?${qs.join("&")}` : ""}`
}
function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}
function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

type DanzaItem = {
  idIscrizione: string
  clienteId: string
  clienteNome: string
  email: string | null
  telefono: string | null
  abbonamento: string | null
  categoria: string
  microcategoria: string
  scadenza: string | null
  totale: number
  pagato: number
  daPagare: number
}
type DanzaMicro = {
  microcategoria: string
  totaleIscritti: number
  totaleEuro: number
  pagatoEuro: number
  daPagareEuro: number
  items: DanzaItem[]
}
type DanzaCategoria = {
  categoria: string
  totaleIscritti: number
  totaleEuro: number
  pagatoEuro: number
  daPagareEuro: number
  microcategorie: DanzaMicro[]
}
type DanzaTotali = { totaleIscritti: number; totaleEuro: number; pagatoEuro: number; daPagareEuro: number }
type DanzaResponse = {
  asOf: string
  /** Totali su TUTTE le categorie (abbonamenti attivi oggi). */
  totaliGenerali: DanzaTotali
  /** Breakdown totali per categoria su TUTTE le categorie. */
  categorieGenerali: Array<{ categoria: string } & DanzaTotali>
  /** Dettaglio danza (drilldown). */
  categorie: DanzaCategoria[]
}

export function Danza() {
  const { role } = useAuth()
  const [q, setQ] = useState("")
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [openMicro, setOpenMicro] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ["danza-attivi-oggi"],
    queryFn: () => api.get<DanzaResponse>("/data/danza/attivi-oggi"),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const needle = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    const cats = query.data?.categorie ?? []
    if (!needle) return cats
    return cats
      .map((c) => ({
        ...c,
        microcategorie: c.microcategorie
          .map((m) => ({
            ...m,
            items: m.items.filter((it) =>
              `${it.clienteNome} ${it.email ?? ""} ${it.telefono ?? ""} ${it.abbonamento ?? ""}`.toLowerCase().includes(needle)
            ),
          }))
          .filter((m) => m.items.length > 0),
      }))
      .filter((c) => c.microcategorie.length > 0)
  }, [query.data, needle])

  const totVisible = useMemo(() => {
    const cats = filtered ?? []
    return {
      totaleIscritti: cats.reduce((s, c) => s + (c.totaleIscritti || 0), 0),
      totaleEuro: cats.reduce((s, c) => s + (c.totaleEuro || 0), 0),
      pagatoEuro: cats.reduce((s, c) => s + (c.pagatoEuro || 0), 0),
      daPagareEuro: cats.reduce((s, c) => s + (c.daPagareEuro || 0), 0),
    }
  }, [filtered])

  if (role !== "admin" && role !== "danza") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Danza</h2>
          <p className="mt-2 text-sm text-zinc-500">Permessi insufficienti.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Danza</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Abbonamenti attivi alla data di oggi ({query.data?.asOf ?? "—"}).
          </p>
        </div>
        <label className="grid gap-1 text-sm text-zinc-400">
          <span className="text-xs">Cerca</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome / email / abbonamento…"
            className="w-72 rounded-lg border border-zinc-700 bg-zinc-950/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </label>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
        {query.isLoading ? (
          <p className="text-sm text-zinc-500">Caricamento…</p>
        ) : query.isError ? (
          <p className="text-sm text-red-300">Errore: {String((query.error as any)?.message ?? "—")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-zinc-500">Nessun abbonamento attivo trovato.</p>
        ) : (
          <div className="space-y-3">
            {/* Totali in cima, nello stesso stile delle card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20">
              <div className="px-4 py-3">
                <div className="truncate text-sm font-semibold text-zinc-200">Totali generali</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  Iscritti: <span className="text-zinc-200">{totVisible.totaleIscritti}</span>
                  <span className="mx-2 text-zinc-700">·</span>
                  Totale: <span className="text-zinc-200">{eur(totVisible.totaleEuro)}</span>
                  <span className="mx-2 text-zinc-700">·</span>
                  Pagato: <span className="text-zinc-200">{eur(totVisible.pagatoEuro)}</span>
                  <span className="mx-2 text-zinc-700">·</span>
                  Da pagare: <span className="text-zinc-200">{eur(totVisible.daPagareEuro)}</span>
                </div>
              </div>
            </div>

            {filtered.map((c) => {
              const isOpen = openCat === c.categoria
              return (
                <div key={c.categoria} className="rounded-xl border border-amber-500/20 bg-zinc-950/20">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    onClick={() => setOpenCat(isOpen ? null : c.categoria)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-amber-200">{c.categoria}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        Iscritti: <span className="text-zinc-200">{c.totaleIscritti}</span>
                        <span className="mx-2 text-zinc-700">·</span>
                        Totale: <span className="text-zinc-200">{eur(c.totaleEuro)}</span>
                        <span className="mx-2 text-zinc-700">·</span>
                        Pagato: <span className="text-zinc-200">{eur(c.pagatoEuro)}</span>
                        <span className="mx-2 text-zinc-700">·</span>
                        Da pagare: <span className="text-zinc-200">{eur(c.daPagareEuro)}</span>
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-zinc-400">{isOpen ? "Chiudi" : "Apri"}</div>
                  </button>

                  {isOpen ? (
                    <div className="space-y-2 border-t border-zinc-800 p-3">
                      {c.microcategorie.map((m) => {
                        const microKey = `${c.categoria}::${m.microcategoria}`
                        const microOpen = openMicro === microKey
                        return (
                          <div key={microKey} className="rounded-lg border border-fuchsia-500/20 bg-zinc-950/20">
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                              onClick={() => setOpenMicro(microOpen ? null : microKey)}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-fuchsia-200">{m.microcategoria}</div>
                                <div className="mt-0.5 text-xs text-zinc-500">
                                  Iscritti: <span className="text-zinc-200">{m.totaleIscritti}</span>
                                  <span className="mx-2 text-zinc-700">·</span>
                                  Totale: <span className="text-zinc-200">{eur(m.totaleEuro)}</span>
                                  <span className="mx-2 text-zinc-700">·</span>
                                  Pagato: <span className="text-zinc-200">{eur(m.pagatoEuro)}</span>
                                  <span className="mx-2 text-zinc-700">·</span>
                                  Da pagare: <span className="text-zinc-200">{eur(m.daPagareEuro)}</span>
                                </div>
                              </div>
                              <div className="text-xs font-semibold text-zinc-400">{microOpen ? "Chiudi" : "Apri"}</div>
                            </button>

                            {microOpen ? (
                              <div className="overflow-x-auto border-t border-zinc-800/60">
                                <table className="min-w-full text-left text-sm">
                                  <thead>
                                    <tr className="bg-zinc-950/40 text-xs text-zinc-400">
                                      <th className="px-4 py-2">Cliente</th>
                                      <th className="px-4 py-2">Email</th>
                                      <th className="px-4 py-2">SMS</th>
                                      <th className="px-4 py-2">Abbonamento</th>
                                      <th className="px-4 py-2">Scadenza</th>
                                      <th className="px-4 py-2">Totale</th>
                                      <th className="px-4 py-2">Pagato</th>
                                      <th className="px-4 py-2">Da pagare</th>
                                      <th className="px-4 py-2">Azioni</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {m.items.map((it) => {
                                      const tel = it.telefono ? telHref(it.telefono) : null
                                      const mail = it.email ? mailHref(it.email, "FitCenter Danza") : null
                                      return (
                                        <tr key={`${it.idIscrizione}-${it.clienteId}`} className="border-t border-zinc-800/60">
                                          <td className="px-4 py-2 font-medium text-zinc-100">{it.clienteNome || "—"}</td>
                                          <td className="px-4 py-2 font-mono text-xs text-zinc-300">{it.email || "—"}</td>
                                          <td className="px-4 py-2 font-mono text-xs text-zinc-300">{it.telefono || "—"}</td>
                                          <td className="px-4 py-2 text-zinc-300">{it.abbonamento || "—"}</td>
                                          <td className="px-4 py-2 font-mono text-xs text-zinc-300">{fmtDateIt(it.scadenza)}</td>
                                          <td className="px-4 py-2 text-zinc-200">{eur(it.totale)}</td>
                                          <td className="px-4 py-2 text-zinc-200">{eur(it.pagato)}</td>
                                          <td className="px-4 py-2 text-zinc-200">{eur(it.daPagare)}</td>
                                          <td className="px-4 py-2">
                                            <div className="flex flex-wrap gap-2">
                                              <a
                                                href={tel ?? "#"}
                                                onClick={(e) => {
                                                  if (!tel) e.preventDefault()
                                                }}
                                                className={`rounded border px-2 py-1 text-xs ${
                                                  tel
                                                    ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200 hover:bg-emerald-900/25"
                                                    : "border-zinc-800 text-zinc-600"
                                                }`}
                                                title={it.telefono ?? "SMS non disponibile"}
                                              >
                                                Telefona
                                              </a>
                                              <a
                                                href={mail ?? "#"}
                                                onClick={(e) => {
                                                  if (!mail) e.preventDefault()
                                                }}
                                                className={`rounded border px-2 py-1 text-xs ${
                                                  mail
                                                    ? "border-sky-700/50 bg-sky-950/20 text-sky-200 hover:bg-sky-900/25"
                                                    : "border-zinc-800 text-zinc-600"
                                                }`}
                                                title={it.email ?? "Email non disponibile"}
                                              >
                                                Mail
                                              </a>
                                            </div>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

