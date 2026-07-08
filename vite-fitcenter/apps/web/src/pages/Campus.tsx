import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Navigate } from "react-router-dom"
import { campusDateRangeParts, dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"

type Tab = "elenco" | "settimane"

function eur(n: number): string {
  return `€${Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`
}

function digitsPhone(s: unknown): string {
  return String(s ?? "").replace(/[^\d+]/g, "").replace(/^00/, "+")
}
function waHref(phone: unknown, text?: string): string | null {
  const d = digitsPhone(phone).replace(/^\+/, "")
  if (!d) return null
  const q = text ? `?text=${encodeURIComponent(text)}` : ""
  return `https://wa.me/${d}${q}`
}
function telHref(phone: unknown): string | null {
  const d = digitsPhone(phone)
  if (!d) return null
  return `tel:${d}`
}
function mailHref(email: unknown, subject: string, body: string): string | null {
  const e = String(email ?? "").trim()
  if (!e || !e.includes("@")) return null
  return `mailto:${encodeURIComponent(e)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "")
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function formatPhoneIt(phone: unknown): string {
  const raw = digitsPhone(phone)
  const d = raw.replace(/^\+/, "")
  if (!d) return ""
  if (d.startsWith("39") && d.length >= 11) return `+${d}`
  const local = d.replace(/^0/, "")
  if (local.length >= 9 && local.length <= 10) return `+39${local}`
  return raw.startsWith("+") ? raw : `+${d}`
}

function slugFilePart(s: string): string {
  return s
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob(["\uFEFF" + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportCampusRubricaCsv(
  rows: { b: { cognomeNome?: string; genitore?: string; cellulare?: string } }[],
  opts: { weekLabel: string; groupName: string }
) {
  const header = "Name,Given Name,Family Name,Phone 1 - Type,Phone 1 - Value,Notes"
  const lines = [header]
  for (const x of rows) {
    const b = x.b
    const phone = formatPhoneIt(b.cellulare)
    if (!phone) continue
    const child = String(b.cognomeNome ?? "").trim()
    const genitore = String(b.genitore ?? "").trim()
    const displayName = genitore ? `${genitore} (${child})` : child || phone
    const parts = child.split(/\s+/).filter(Boolean)
    const familyName = parts[0] ?? ""
    const givenName = parts.slice(1).join(" ") || genitore || familyName
    const notes = `Campus ${opts.weekLabel} · Gruppo ${opts.groupName}`
    lines.push([displayName, givenName, familyName, "Mobile", phone, notes].map(csvEscape).join(","))
  }
  if (lines.length <= 1) {
    alert("Nessun cellulare valido da esportare.")
    return
  }
  const fname = `campus-rubrica-${slugFilePart(opts.weekLabel)}-${slugFilePart(opts.groupName)}.csv`
  downloadTextFile(fname, lines.join("\r\n"), "text/csv;charset=utf-8")
}

function CampusWeeksGrouped(props: {
  weekKey: string
  weeks: { key: string; label: string }[]
  list: any[]
  groupFilter: string
  patchCliente: (args: { clienteId: string; liv?: string; allergie?: string; genitore?: string; note?: string; gruppo?: string; consensoWhatsapp?: boolean }) => void
  patchWeek: (args: { clienteId: string; weekKey: string; note?: string }) => void
}) {
  const { weekKey, weeks, list, groupFilter, patchCliente, patchWeek } = props
  const weekLabel = weeks.find((w) => w.key === weekKey)?.label ?? weekKey

  const enriched = useMemo(() => {
    return (list ?? [])
      .map((b) => {
        const weeksForB = new Set<string>()
        b.items?.forEach((it: any) => it.settimane?.forEach((w: string) => weeksForB.add(w)))
        const inWeek = weeksForB.has(weekKey)
        const weekGroup = b.weekNotes?.[weekKey]?.gruppo
        const groupEff = String(weekGroup || b.gruppo || "").trim() || "—"
        const liv = String(b.liv || "").trim() || "—"
        return { b, inWeek, groupEff, liv }
      })
      .filter((x) => x.inWeek)
      .filter((x) => (groupFilter ? x.groupEff === groupFilter : true))
      .sort((a, b) => a.b.cognomeNome.localeCompare(b.b.cognomeNome))
  }, [list, weekKey, groupFilter])

  const byGroup = useMemo(() => {
    const m = new Map<string, any[]>()
    enriched.forEach((x) => {
      const g = x.groupEff
      m.set(g, [...(m.get(g) ?? []), x])
    })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [enriched])

  const totalsAll = useMemo(() => {
    const totVend = enriched.reduce((s, x) => s + Number(x.b.totaleVenduto ?? 0), 0)
    const totPag = enriched.reduce((s, x) => s + Number(x.b.totalePagato ?? 0), 0)
    return { count: enriched.length, venduto: totVend, pagato: totPag }
  }, [enriched])

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/20 p-3">
      <div className="mb-3 text-sm text-zinc-400">
        Settimana selezionata: <span className="text-zinc-200 font-medium">{weekLabel}</span>
        <span className="ml-3 text-zinc-500">
          · Totale bambini: <span className="text-zinc-200 font-medium">{totalsAll.count}</span>
          {" · "}Venduto: <span className="text-amber-300 font-medium">{eur(totalsAll.venduto)}</span>
          {" · "}Pagato: <span className="text-emerald-300 font-medium">{eur(totalsAll.pagato)}</span>
        </span>
      </div>
      {byGroup.length === 0 ? (
        <div className="py-6 text-center text-zinc-500">Nessun bambino per questa settimana.</div>
      ) : (
        <div className="space-y-4">
          {byGroup.map(([groupName, rows]) => {
            const groupTotVend = rows.reduce((s, x) => s + Number(x.b.totaleVenduto ?? 0), 0)
            const groupTotPag = rows.reduce((s, x) => s + Number(x.b.totalePagato ?? 0), 0)
            const byLiv = new Map<string, any[]>()
            rows.forEach((x) => {
              const l = x.liv
              byLiv.set(l, [...(byLiv.get(l) ?? []), x])
            })
            const livBlocks = Array.from(byLiv.entries()).sort((a, b) => a[0].localeCompare(b[0]))
            const groupPhonesWaOk = rows
              .filter((x) => Boolean(x.b.consensoWhatsapp))
              .map((x) => x.b.cellulare)
              .filter((p) => Boolean(waHref(p)))
            const groupPhonesExport = rows.filter((x) => Boolean(formatPhoneIt(x.b.cellulare)))
            return (
              <div key={groupName} className="rounded border border-zinc-800 bg-zinc-950/20 p-3">
                <div className="mb-2 text-sm font-semibold text-amber-300">
                  Gruppo: <span className="text-zinc-100">{groupName}</span>
                  <span className="ml-3 text-xs font-normal text-zinc-500">
                    · bambini: <span className="text-zinc-200">{rows.length}</span>
                    {" · "}venduto: <span className="text-amber-300">{eur(groupTotVend)}</span>
                    {" · "}pagato: <span className="text-emerald-300">{eur(groupTotPag)}</span>
                  </span>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const links = rows
                        .filter((x) => Boolean(x.b.consensoWhatsapp))
                        .map((x) => waHref(x.b.cellulare, `Ciao ${x.b.genitore ?? ""}, ti scrivo per il Campus Sportivi.`))
                        .filter(Boolean) as string[]
                      for (const href of links) {
                        const a = document.createElement("a")
                        a.href = href
                        a.target = "_blank"
                        a.rel = "noreferrer"
                        a.style.position = "fixed"
                        a.style.left = "-9999px"
                        document.body.appendChild(a)
                        a.click()
                        a.remove()
                      }
                    }}
                    disabled={groupPhonesWaOk.length === 0}
                    className="rounded border border-green-700/50 bg-green-950/20 px-3 py-1.5 text-xs font-semibold text-green-200 disabled:opacity-40"
                  >
                    WhatsApp gruppo (consenso sì) · {groupPhonesWaOk.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nums = rows
                        .map((x) => digitsPhone(x.b.cellulare))
                        .filter(Boolean)
                        .join(", ")
                      try {
                        navigator.clipboard.writeText(nums)
                        alert("Numeri copiati")
                      } catch {
                        alert(nums)
                      }
                    }}
                    className="rounded border border-zinc-700 bg-zinc-900/40 px-3 py-1.5 text-xs font-semibold text-zinc-200"
                  >
                    Copia tutti i numeri
                  </button>
                  <button
                    type="button"
                    onClick={() => exportCampusRubricaCsv(rows, { weekLabel, groupName })}
                    disabled={groupPhonesExport.length === 0}
                    className="rounded border border-sky-700/50 bg-sky-950/20 px-3 py-1.5 text-xs font-semibold text-sky-200 disabled:opacity-40"
                    title="CSV per import in Google Contacts / rubrica (WhatsApp Business Desktop)"
                  >
                    Esporta CSV rubrica · {groupPhonesExport.length}
                  </button>
                </div>
                <div className="space-y-3">
                  {livBlocks.map(([liv, items]) => (
                    <div key={liv}>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                        Livello {liv} · {items.length} bambini
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1100px] text-left text-sm">
                          <thead>
                            <tr className="border-b border-zinc-800 text-zinc-500">
                              <th className="py-2 pr-3 font-medium">Cognome e nome</th>
                              <th className="py-2 pr-3 font-medium">Genitore</th>
                              <th className="py-2 pr-3 font-medium text-center whitespace-nowrap">OK WhatsApp</th>
                              <th className="py-2 pr-3 font-medium whitespace-nowrap">Cellulare</th>
                              <th className="py-2 pr-3 font-medium whitespace-nowrap">Azioni</th>
                              <th className="py-2 pr-3 font-medium">LIV</th>
                              <th className="py-2 pr-3 font-medium">Allergie</th>
                              <th className="py-2 pr-3 font-medium">Note</th>
                              <th className="py-2 font-medium">Nota settimana</th>
                            </tr>
                          </thead>
                          <tbody className="text-zinc-200">
                            {items.map((x) => {
                              const b = x.b
                              const weekNoteVal = b.weekNotes?.[weekKey]?.note ?? ""
                              const msg = `Ciao ${b.genitore ?? ""}, ti scrivo per il Campus Sportivi.`
                              const tHref = telHref(b.cellulare)
                              const wHref = waHref(b.cellulare, msg)
                              return (
                                <tr key={b.clienteId} className="border-b border-zinc-900/60 hover:bg-zinc-800/20">
                                  <td className="py-2 pr-3 font-medium">{b.cognomeNome}</td>
                                  <td className="py-2 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={b.genitore ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== (b.genitore ?? "")) patchCliente({ clienteId: b.clienteId, genitore: v })
                                      }}
                                      className="w-40 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2 pr-3 text-center">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(b.consensoWhatsapp)}
                                      onChange={(e) =>
                                        patchCliente({ clienteId: b.clienteId, consensoWhatsapp: e.target.checked })
                                      }
                                    />
                                  </td>
                                  <td className="py-2 pr-3 text-zinc-300 whitespace-nowrap">{b.cellulare ?? "—"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">
                                    <div className="flex flex-wrap items-center gap-1">
                                      {tHref ? (
                                        <a
                                          href={tHref}
                                          className="rounded border border-emerald-600/60 bg-emerald-600/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200"
                                        >
                                          Chiama
                                        </a>
                                      ) : null}
                                      {wHref && b.consensoWhatsapp ? (
                                        <a
                                          href={wHref}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="rounded border border-green-600/60 bg-green-600/10 px-2 py-0.5 text-[11px] font-semibold text-green-200"
                                        >
                                          WA
                                        </a>
                                      ) : (
                                        <span className="text-[10px] text-zinc-600">WA no</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={b.liv ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== (b.liv ?? "")) patchCliente({ clienteId: b.clienteId, liv: v })
                                      }}
                                      className="w-16 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={b.allergie ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== (b.allergie ?? "")) patchCliente({ clienteId: b.clienteId, allergie: v })
                                      }}
                                      className="w-56 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={b.note ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== (b.note ?? "")) patchCliente({ clienteId: b.clienteId, note: v })
                                      }}
                                      className="w-[28rem] rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2">
                                    <input
                                      type="text"
                                      defaultValue={weekNoteVal}
                                      onBlur={(e) => {
                                        const v = e.target.value
                                        if (v !== weekNoteVal) patchWeek({ clienteId: b.clienteId, weekKey, note: v })
                                      }}
                                      className="w-64 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                                      placeholder="Nota settimana..."
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Campus() {
  const { role } = useAuth()
  const queryClient = useQueryClient()
  if (role !== "admin" && role !== "campus" && role !== "operatore" && role !== "firme") return <Navigate to="/" replace />

  const campusRange = campusDateRangeParts()
  const { data, isLoading, error } = useQuery({
    queryKey: ["campus", campusRange.from, campusRange.to],
    queryFn: () => dataApi.getCampus(),
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<Tab>("elenco")
  const [weekKey, setWeekKey] = useState("")
  const [groupFilter, setGroupFilter] = useState("")
  const importRef = useRef<HTMLInputElement | null>(null)

  const patchCliente = useMutation({
    mutationFn: (args: { clienteId: string; gruppo?: string; genitore?: string; consensoWhatsapp?: boolean; liv?: string; allergie?: string; note?: string }) =>
      dataApi.patchCampusCliente(args.clienteId, {
        gruppo: args.gruppo,
        genitore: args.genitore,
        consensoWhatsapp: args.consensoWhatsapp,
        liv: args.liv,
        allergie: args.allergie,
        note: args.note,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campus"] }),
  })
  const patchWeek = useMutation({
    mutationFn: (args: { clienteId: string; weekKey: string; note?: string }) =>
      dataApi.patchCampusWeekNote(args.clienteId, args.weekKey, { note: args.note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campus"] }),
  })

  const importPlanning = useMutation({
    mutationFn: async (file: File) => dataApi.importCampusPlanning(file),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["campus"] })
      alert(`Import completato. Aggiornati: ${r.updated} · Saltati: ${r.skipped}`)
    },
    onError: (e) => {
      alert(`Import fallito: ${(e as Error).message}`)
    },
  })

  const filtered = useMemo(() => {
    const list = data?.bambini ?? []
    if (!search.trim()) return list
    const s = search.trim().toLowerCase()
    return list.filter((c) => (c.cognomeNome || c.clienteNome).toLowerCase().includes(s))
  }, [data?.bambini, search])

  const elencoTotals = useMemo(() => {
    const list = filtered
      .filter((b) => (groupFilter ? (b.gruppo ?? "").trim() === groupFilter : true))
      .filter((b) => {
        if (tab !== "settimane") return true
        if (!weekKey) return true
        const weeksForB = new Set<string>()
        b.items.forEach((it: any) => it.settimane.forEach((w: string) => weeksForB.add(w)))
        return weeksForB.has(weekKey)
      })
    const totVend = list.reduce((s, b) => s + Number(b.totaleVenduto ?? 0), 0)
    const totPag = list.reduce((s, b) => s + Number(b.totalePagato ?? 0), 0)
    // Non sommare max(0, v−p) per bambino: se per qualcuno pagato>venduto, la somma dei «da pagare»
    // non coincide con venduto−pagato (effetto «stamattina» / cifre incoerenti nel riepilogo).
    const totDue = Math.max(0, totVend - totPag)
    return { count: list.length, venduto: totVend, pagato: totPag, daPagare: totDue }
  }, [filtered, groupFilter, tab, weekKey])

  const groups = useMemo(() => {
    const set = new Set<string>()
    ;(data?.bambini ?? []).forEach((b) => {
      const g = (b.gruppo ?? "").trim()
      if (g) set.add(g)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [data?.bambini])

  if (isLoading) return <div className="p-6 text-zinc-400">Caricamento...</div>
  if (error || !data) {
    return (
      <div className="p-6 text-red-400">
        Errore: {(error as Error)?.message ?? "Dati non disponibili"}. Avvia l’API backend.
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Campus sportivi</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Periodo: <span className="text-zinc-300">{data.range.from}</span> →{" "}
            <span className="text-zinc-300">{data.range.to}</span> · filtro:{" "}
            <span className="text-zinc-300">MacroCategoria=Corsi</span> e{" "}
            <span className="text-zinc-300">Categoria=Campus Sportivi</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Cerca nominativo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["campus"] })}
            className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            title="Ricarica elenco"
          >
            Aggiorna
          </button>
          {(role === "admin" || role === "campus") && (
            <>
              <input
                ref={importRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  importPlanning.mutate(f)
                  e.target.value = ""
                }}
              />
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                disabled={importPlanning.isPending}
                className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                title="Importa da Excel (Planning Campus Sportivi)"
              >
                {importPlanning.isPending ? "Import..." : "Import Excel"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("elenco")}
          className={`rounded border px-3 py-1.5 text-sm ${
            tab === "elenco" ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          Elenco bambini
        </button>
        <button
          type="button"
          onClick={() => setTab("settimane")}
          className={`rounded border px-3 py-1.5 text-sm ${
            tab === "settimane" ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          Campus per settimane
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/20 px-4 py-3 text-sm text-zinc-300">
        Totale bambini: <span className="font-semibold text-zinc-100">{elencoTotals.count}</span>
        {" · "}Venduto: <span className="font-semibold text-amber-300">{eur(elencoTotals.venduto)}</span>
        {" · "}Pagato: <span className="font-semibold text-emerald-300">{eur(elencoTotals.pagato)}</span>
        {" · "}Da pagare: <span className="font-semibold text-rose-300">{eur(elencoTotals.daPagare)}</span>
      </div>

      {tab === "settimane" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
          <label className="text-sm text-zinc-400">
            Settimana
            <select
              value={weekKey}
              onChange={(e) => setWeekKey(e.target.value)}
              className="ml-2 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-sm text-zinc-100"
            >
              <option value="">— Seleziona —</option>
              {data.weeks.map((w) => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-zinc-400">
            Gruppo
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="ml-2 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-sm text-zinc-100"
            >
              <option value="">Tutti</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <div className="text-xs text-zinc-500">
            {weekKey ? `Filtro settimana: ${data.weeks.find((w) => w.key === weekKey)?.label ?? weekKey}` : "Seleziona una settimana"}
          </div>
        </div>
      )}

      {tab === "settimane" && weekKey ? (
        <CampusWeeksGrouped
          weekKey={weekKey}
          weeks={data.weeks}
          list={filtered}
          groupFilter={groupFilter}
          patchCliente={(args) => patchCliente.mutate(args)}
          patchWeek={(args) => patchWeek.mutate(args)}
        />
      ) : null}

      {/* Quando lavoro per settimana, non mostro anche l'elenco completo sotto (evita doppio blocco). */}
      {!(tab === "settimane" && weekKey) && (
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/50">
            <tr>
              <th className="px-3 py-3 font-medium text-zinc-400">Cognome e nome</th>
              <th className="px-3 py-3 font-medium text-zinc-400 text-center">Età</th>
              <th className="px-3 py-3 font-medium text-zinc-400 text-center">LIV</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Allergie</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Genitore</th>
              <th className="px-3 py-3 font-medium text-zinc-400 text-center whitespace-nowrap">OK WhatsApp</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Cellulare</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Azioni</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Note</th>
              <th className="px-3 py-3 w-28 font-medium text-zinc-400 text-right whitespace-nowrap">Venduto</th>
              <th className="px-3 py-3 w-28 font-medium text-zinc-400 text-right whitespace-nowrap">Pagato</th>
              <th className="px-3 py-3 font-medium text-zinc-400">Gruppo</th>
              {tab === "settimane" && <th className="px-3 py-3 font-medium text-zinc-400">Nota settimana</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered
              .filter((b) => (groupFilter ? (b.gruppo ?? "").trim() === groupFilter : true))
              .filter((b) => {
                if (tab !== "settimane") return true
                if (!weekKey) return true
                const weeksForB = new Set<string>()
                b.items.forEach((it) => it.settimane.forEach((w) => weeksForB.add(w)))
                return weeksForB.has(weekKey)
              })
              .map((b) => {
                const weekNoteVal = tab === "settimane" && weekKey ? (b.weekNotes?.[weekKey]?.note ?? "") : ""
                const msg = `Ciao ${b.genitore ?? ""}, ti scrivo per il Campus Sportivi.`
                const tHref = telHref(b.cellulare)
                const wHref = waHref(b.cellulare, msg)
                const mHref = mailHref(b.email, "Campus sportivi", msg)
                return (
                  <tr key={b.clienteId} className="hover:bg-zinc-800/20">
                    <td className="px-3 py-3 font-medium text-zinc-200">{b.cognomeNome || b.clienteNome}</td>
                    <td className="px-3 py-3 text-center text-zinc-300">{b.eta ?? "—"}</td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="text"
                        defaultValue={b.liv ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.liv ?? "")) patchCliente.mutate({ clienteId: b.clienteId, liv: v })
                        }}
                        className="w-16 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.allergie ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.allergie ?? "")) patchCliente.mutate({ clienteId: b.clienteId, allergie: v })
                        }}
                        className="w-64 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.genitore ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.genitore ?? "")) patchCliente.mutate({ clienteId: b.clienteId, genitore: v })
                        }}
                        className="w-48 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(b.consensoWhatsapp)}
                        onChange={(e) => patchCliente.mutate({ clienteId: b.clienteId, consensoWhatsapp: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-3 text-zinc-300">{b.cellulare ?? "—"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-2">
                        {tHref ? (
                          <a href={tHref} className="rounded border border-emerald-600/60 bg-emerald-600/10 px-2 py-1 text-xs font-semibold text-emerald-200">
                            Chiama
                          </a>
                        ) : null}
                        {wHref && b.consensoWhatsapp ? (
                          <a href={wHref} target="_blank" rel="noreferrer" className="rounded border border-green-600/60 bg-green-600/10 px-2 py-1 text-xs font-semibold text-green-200">
                            WhatsApp
                          </a>
                        ) : (
                          <span className="text-[11px] text-zinc-600">WhatsApp no</span>
                        )}
                        {mHref ? (
                          <a href={mHref} className="rounded border border-sky-600/60 bg-sky-600/10 px-2 py-1 text-xs font-semibold text-sky-200">
                            Mail
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.note ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.note ?? "")) patchCliente.mutate({ clienteId: b.clienteId, note: v })
                        }}
                        className="w-[28rem] rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-amber-300 tabular-nums whitespace-nowrap">
                      €{Number(b.totaleVenduto ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-emerald-300 tabular-nums whitespace-nowrap">
                      €{Number(b.totalePagato ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        defaultValue={b.gruppo ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value
                          if (v !== (b.gruppo ?? "")) patchCliente.mutate({ clienteId: b.clienteId, gruppo: v })
                        }}
                        className="w-28 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                        placeholder="Gruppo..."
                      />
                    </td>
                    {tab === "settimane" && (
                      <td className="px-3 py-3">
                        {weekKey ? (
                          <input
                            type="text"
                            defaultValue={weekNoteVal}
                            onBlur={(e) => {
                              const v = e.target.value
                              if (v !== weekNoteVal) patchWeek.mutate({ clienteId: b.clienteId, weekKey, note: v })
                            }}
                            className="w-64 rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                            placeholder="Nota settimana..."
                          />
                        ) : (
                          <span className="text-zinc-500">Seleziona una settimana</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={tab === "settimane" ? 11 : 10} className="px-4 py-10 text-center text-zinc-500">
                  Nessun bambino trovato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {(patchCliente.isPending || patchWeek.isPending) && (
        <div className="mt-3 text-xs text-zinc-500">Salvataggio...</div>
      )}
    </div>
  )
}

