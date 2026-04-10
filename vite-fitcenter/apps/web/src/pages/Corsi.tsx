import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { prenotazioniApi, type PrenotazioneCorsoRow } from "@/api/prenotazioni"
import { useAuth } from "@/contexts/AuthContext"

function isoToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function fmtDateIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

function fmtTimeDot(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  return m ? `${m[1]}.${m[2]}` : hhmm
}

type CorsoGroup = {
  key: string
  servizio: string
  giorno: string
  oraInizio?: string
  oraFine?: string
  partecipanti: PrenotazioneCorsoRow[]
}

function firstNonEmptyStr(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim()
  return s ? s : undefined
}

function getCorsoTitolo(r: PrenotazioneCorsoRow): string {
  const raw = (r.raw ?? {}) as any
  return (
    firstNonEmptyStr(r.servizio) ??
    firstNonEmptyStr(raw?.PrenotazioneDescrizione) ??
    firstNonEmptyStr(raw?.ServizioDescrizione) ??
    firstNonEmptyStr(raw?.DescrizioneServizio) ??
    firstNonEmptyStr(raw?.NomeServizio) ??
    firstNonEmptyStr(raw?.AttivitaDescrizione) ??
    firstNonEmptyStr(raw?.DescrizioneAttivita) ??
    firstNonEmptyStr(raw?.CorsoDescrizione) ??
    firstNonEmptyStr(raw?.DescrizioneCorso) ??
    firstNonEmptyStr(raw?.NomeCorso) ??
    firstNonEmptyStr(raw?.Corso) ??
    "—"
  )
}

function groupByCorso(rows: PrenotazioneCorsoRow[]): CorsoGroup[] {
  const map = new Map<string, CorsoGroup>()
  for (const r of rows) {
    const servizio = getCorsoTitolo(r)
    const giorno = (r.giorno ?? "").trim() || "—"
    const oraInizio = (r.oraInizio ?? "").trim() || undefined
    const oraFine = (r.oraFine ?? "").trim() || undefined
    const key = `${servizio}__${giorno}__${oraInizio ?? ""}__${oraFine ?? ""}`
    const g = map.get(key)
    if (!g) {
      map.set(key, { key, servizio, giorno, oraInizio, oraFine, partecipanti: [r] })
    } else {
      g.partecipanti.push(r)
    }
  }
  const list = Array.from(map.values())
  list.sort((a, b) => {
    const s = a.servizio.localeCompare(b.servizio)
    if (s) return s
    const d = a.giorno.localeCompare(b.giorno)
    if (d) return d
    const o = (a.oraInizio ?? "").localeCompare(b.oraInizio ?? "")
    if (o) return o
    return (a.oraFine ?? "").localeCompare(b.oraFine ?? "")
  })
  // ordina partecipanti per "progressivo" se esiste, altrimenti cognome/nome
  for (const g of list) {
    g.partecipanti.sort((x, y) => {
      const px = Number((x.raw as any)?.Progressivo ?? (x.raw as any)?.progressivo)
      const py = Number((y.raw as any)?.Progressivo ?? (y.raw as any)?.progressivo)
      if (Number.isFinite(px) && Number.isFinite(py) && px !== py) return px - py
      const cx = (x.cognome ?? "").localeCompare(y.cognome ?? "")
      if (cx) return cx
      return (x.nome ?? "").localeCompare(y.nome ?? "")
    })
  }
  return list
}

export function Corsi() {
  const { role } = useAuth()
  const [giorno, setGiorno] = useState(() => isoToday())
  const [search, setSearch] = useState("")

  const enabled = role === "admin" || role === "corsi"

  const { data, isLoading, error } = useQuery({
    queryKey: ["prenotazioni-corsi", giorno],
    queryFn: () => prenotazioniApi.listPrenotazioni(giorno),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const rows = data?.rows ?? []
  const gruppi = useMemo(() => groupByCorso(rows), [rows])
  const gruppiFiltrati = useMemo(() => {
    const q = search.trim().toLocaleLowerCase()
    if (!q) return gruppi
    return gruppi.filter((g) => g.servizio.toLocaleLowerCase().includes(q))
  }, [gruppi, search])
  const totalePartecipanti = useMemo(
    () => gruppi.reduce((s, g) => s + g.partecipanti.length, 0),
    [gruppi]
  )
  const meta = data?.meta

  if (!enabled) {
    return (
      <div className="p-6 text-red-400">
        Permessi insufficienti.
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Corsi</h1>
          <p className="mt-1 text-sm text-zinc-400">Elenco corsi del giorno con partecipanti.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Giorno
            <input
              type="date"
              value={giorno}
              onChange={(e) => setGiorno(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100 shadow-sm focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Cerca corso
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Es. pilates"
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100 shadow-sm placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/40 to-zinc-950/20 p-5 shadow-lg">
        {isLoading ? (
          <p className="text-sm text-zinc-500">Caricamento...</p>
        ) : error ? (
          <p className="text-sm text-red-400">Errore: {(error as Error).message}</p>
        ) : gruppi.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">Nessuna prenotazione per il giorno selezionato.</p>
            {meta?.view && (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-400">
                <div><span className="text-zinc-500">view</span>: {meta.view}</div>
                <div><span className="text-zinc-500">dateCol</span>: {meta.dateCol ?? "(non trovata)"}</div>
                <div><span className="text-zinc-500">count</span>: {meta.count ?? 0}</div>
                {"dayCount" in (meta ?? {}) && (
                  <div><span className="text-zinc-500">dayCount</span>: {String(meta.dayCount ?? "(n/a)")}</div>
                )}
                {"dayCountExpr" in (meta ?? {}) && (
                  <div><span className="text-zinc-500">dayCountExpr</span>: {String(meta.dayCountExpr ?? "(n/a)")}</div>
                )}
                {"connected" in (meta ?? {}) && (
                  <div><span className="text-zinc-500">connected</span>: {String(meta.connected)}</div>
                )}
                {meta.sqlError && (
                  <div><span className="text-zinc-500">sqlError</span>: {meta.sqlError ?? "(errore non disponibile)"}</div>
                )}
                {meta.queryError && (
                  <div><span className="text-zinc-500">queryError</span>: {meta.queryError}</div>
                )}
                {meta.sql && (
                  <>
                    <div><span className="text-zinc-500">sql.server</span>: {meta.sql.server ?? "(n/a)"}</div>
                    <div><span className="text-zinc-500">sql.database</span>: {meta.sql.database ?? "(n/a)"}</div>
                  </>
                )}
                {meta.cs && (
                  <>
                    <div><span className="text-zinc-500">cs.server</span>: {meta.cs.server ?? "(n/a)"}</div>
                    <div><span className="text-zinc-500">cs.database</span>: {meta.cs.database ?? "(n/a)"}</div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-zinc-400">
                Totale partecipanti: <span className="font-semibold text-amber-400">{totalePartecipanti}</span>
              </div>
              <div className="text-xs text-zinc-500">
                Corsi: <span className="font-medium text-zinc-300">{gruppiFiltrati.length}</span>
                {search.trim() ? (
                  <span className="text-zinc-600"> (filtrati)</span>
                ) : null}
              </div>
            </div>

            {gruppiFiltrati.map((g) => (
              <div key={g.key} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4">
                  <div>
                    <div className="text-sm font-semibold tracking-tight text-zinc-100">
                      {g.servizio}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      gio {fmtDateIt(g.giorno)}
                      {g.oraInizio ? ` · ${fmtTimeDot(g.oraInizio)}` : ""}
                      {g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-300">
                    {g.partecipanti.length} partecipanti
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/40">
                        <th className="px-5 py-3 font-medium text-zinc-400">#</th>
                        <th className="px-5 py-3 font-medium text-zinc-400">Cognome e Nome</th>
                        <th className="px-5 py-3 font-medium text-zinc-400">Prenotato il</th>
                        <th className="px-5 py-3 font-medium text-zinc-400">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.partecipanti.map((p, idx) => {
                        const prog = (p.raw as any)?.Progressivo ?? (p.raw as any)?.progressivo ?? (idx + 1)
                        const nome = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || "—"
                        const pren = p.prenotatoIl
                          ? new Date(p.prenotatoIl).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                          : ""
                        return (
                          <tr key={idx} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20">
                            <td className="px-5 py-3 text-zinc-300">{String(prog)}</td>
                            <td className="px-5 py-3 font-medium text-zinc-100">{nome}</td>
                            <td className="px-5 py-3 text-zinc-300">{pren || "—"}</td>
                            <td className="px-5 py-3 text-zinc-300">{p.note ?? ""}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

