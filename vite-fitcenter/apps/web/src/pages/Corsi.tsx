import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { prenotazioniApi, type PrenotazioneCorsoRow } from "@/api/prenotazioni"
import { useAuth } from "@/contexts/AuthContext"
import { whatsAppMeUrl } from "@/lib/whatsappPhone"

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

function defaultWhatsAppMessage(g: CorsoGroup): string {
  const orario =
    g.oraInizio && g.oraFine
      ? ` alle ${fmtTimeDot(g.oraInizio)}–${fmtTimeDot(g.oraFine)}`
      : g.oraInizio
        ? ` alle ${fmtTimeDot(g.oraInizio)}`
        : ""
  return `Ciao, ti scrivo per il corso «${g.servizio}» del ${fmtDateIt(g.giorno)}${orario}.`
}

function uniqueValidEmails(part: PrenotazioneCorsoRow[]): string[] {
  const s = new Set<string>()
  const out: string[] = []
  for (const p of part) {
    const e = (p.email ?? "").trim()
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue
    const k = e.toLowerCase()
    if (s.has(k)) continue
    s.add(k)
    out.push(e)
  }
  return out
}

function waLinksForGroup(g: CorsoGroup): { label: string; href: string }[] {
  const msg = defaultWhatsAppMessage(g)
  const seen = new Set<string>()
  const list: { label: string; href: string }[] = []
  for (const p of g.partecipanti) {
    const raw = (p.sms ?? "").trim()
    if (!raw) continue
    const href = whatsAppMeUrl(raw, msg)
    if (!href) continue
    const nome = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || raw
    const key = href.split("?")[0] ?? href
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ label: nome, href })
  }
  return list
}

export function Corsi() {
  const queryClient = useQueryClient()
  const { role } = useAuth()
  const [giorno, setGiorno] = useState(() => isoToday())
  const [search, setSearch] = useState("")
  const [notifyGroup, setNotifyGroup] = useState<CorsoGroup | null>(null)
  const [notifySubject, setNotifySubject] = useState("")
  const [notifyText, setNotifyText] = useState("")

  const enabled = role === "admin" || role === "corsi"

  const { data, isLoading, error } = useQuery({
    queryKey: ["prenotazioni-corsi", giorno],
    queryFn: () => prenotazioniApi.listPrenotazioni(giorno),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const notifyMutation = useMutation({
    mutationFn: async () => {
      if (!notifyGroup) throw new Error("Nessun corso selezionato")
      return prenotazioniApi.notifyEmail({
        giorno,
        groupKey: notifyGroup.key,
        subject: notifySubject.trim(),
        text: notifyText.trim(),
      })
    },
    onSuccess: () => {
      setNotifyGroup(null)
      void queryClient.invalidateQueries({ queryKey: ["prenotazioni-corsi", giorno] })
    },
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
    <div className="p-4 sm:p-6">
      {notifyGroup ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notify-email-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNotifyGroup(null)
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
            <h2 id="notify-email-title" className="text-lg font-semibold text-zinc-100">
              Email ai prenotati
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {notifyGroup.servizio} · {fmtDateIt(notifyGroup.giorno)}
              {notifyGroup.oraInizio ? ` · ${fmtTimeDot(notifyGroup.oraInizio)}` : ""}
              {notifyGroup.oraFine ? `–${fmtTimeDot(notifyGroup.oraFine)}` : ""}
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              Destinatari unici:{" "}
              <span className="font-medium text-amber-300">{uniqueValidEmails(notifyGroup.partecipanti).length}</span>
            </p>
            <label className="mt-4 grid gap-1 text-sm text-zinc-400">
              <span>Oggetto</span>
              <input
                value={notifySubject}
                onChange={(e) => setNotifySubject(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-zinc-100"
              />
            </label>
            <label className="mt-3 grid gap-1 text-sm text-zinc-400">
              <span>Messaggio</span>
              <textarea
                value={notifyText}
                onChange={(e) => setNotifyText(e.target.value)}
                rows={8}
                className="resize-y rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-100"
              />
            </label>
            {notifyMutation.isError ? (
              <p className="mt-2 text-sm text-red-400">{(notifyMutation.error as Error).message}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                onClick={() => setNotifyGroup(null)}
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={
                  notifyMutation.isPending ||
                  !notifySubject.trim() ||
                  !notifyText.trim() ||
                  uniqueValidEmails(notifyGroup.partecipanti).length === 0
                }
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-500 disabled:opacity-40"
                onClick={() => notifyMutation.mutate()}
              >
                {notifyMutation.isPending ? "Invio…" : "Invia email"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Corsi</h1>
          <p className="mt-1 text-sm text-zinc-400">Elenco corsi del giorno con partecipanti.</p>
        </div>
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 sm:items-end">
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Giorno</span>
            <input
              type="date"
              value={giorno}
              onChange={(e) => setGiorno(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100 shadow-sm focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            />
          </label>
          <label className="grid gap-1 text-sm text-zinc-400">
            <span>Cerca corso</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Es. pilates"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100 shadow-sm placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30 sm:w-56"
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

            {gruppiFiltrati.map((g) => {
              const nEmail = uniqueValidEmails(g.partecipanti).length
              const waLinks = waLinksForGroup(g)
              const waMsg = defaultWhatsAppMessage(g)
              return (
              <div key={g.key} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold tracking-tight text-zinc-100">
                      {g.servizio}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      gio {fmtDateIt(g.giorno)}
                      {g.oraInizio ? ` · ${fmtTimeDot(g.oraInizio)}` : ""}
                      {g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-300">
                      {g.partecipanti.length} partecipanti
                    </div>
                    <button
                      type="button"
                      className="touch-manipulation rounded-lg border border-zinc-600 bg-zinc-800/50 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={nEmail === 0}
                      title={"Invia email a tutti i prenotati (SMTP sul server)"}
                      onClick={() => {
                        setNotifyGroup(g)
                        setNotifySubject(`Lezione: ${g.servizio}`)
                        setNotifyText(
                          `Gentile socio,\n\nTi ricordiamo la lezione «${g.servizio}» in data ${fmtDateIt(g.giorno)}${g.oraInizio ? ` alle ${fmtTimeDot(g.oraInizio)}` : ""}${g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}.\n\nSportivi saluti.`
                        )
                      }}
                    >
                      Email ({nEmail})
                    </button>
                    {waLinks.length > 0 ? (
                      <span className="text-xs text-zinc-500">
                        WhatsApp:{" "}
                        <span className="font-medium text-emerald-400/90">{waLinks.length}</span>
                      </span>
                    ) : null}
                  </div>
                </div>

                {waLinks.length > 0 ? (
                  <div className="flex flex-wrap gap-2 border-b border-zinc-800/60 px-4 py-3 sm:px-5">
                    {waLinks.map((w) => (
                      <a
                        key={w.href}
                        href={w.href}
                        target="_blank"
                        rel="noreferrer"
                        className="touch-manipulation inline-flex min-h-[44px] items-center rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40"
                      >
                        WhatsApp · {w.label}
                      </a>
                    ))}
                  </div>
                ) : null}

                {/* Mobile: lista compatta (senza tabella) */}
                <div className="block sm:hidden">
                  <div className="divide-y divide-zinc-800/60">
                    {g.partecipanti.map((p, idx) => {
                      const prog = (p.raw as any)?.Progressivo ?? (p.raw as any)?.progressivo ?? (idx + 1)
                      const nome = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || "—"
                      const pren = p.prenotatoIl
                        ? new Date(p.prenotatoIl).toLocaleString("it-IT", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""
                      const note = (p.note ?? "").trim()
                      const em = (p.email ?? "").trim()
                      const sms = (p.sms ?? "").trim()
                      const pWa = sms ? whatsAppMeUrl(sms, waMsg) : null
                      return (
                        <div key={idx} className="px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-zinc-100">
                                {String(prog)}. {nome}
                              </div>
                              <div className="mt-0.5 text-xs text-zinc-400">
                                Prenotato: <span className="text-zinc-300">{pren || "—"}</span>
                              </div>
                            </div>
                          </div>
                          {em || pWa || sms ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              {em ? (
                                <a
                                  href={`mailto:${encodeURIComponent(em)}`}
                                  className="rounded border border-zinc-600 px-2 py-1.5 font-medium text-sky-300 touch-manipulation min-h-[40px] inline-flex items-center"
                                >
                                  Email
                                </a>
                              ) : null}
                              {pWa ? (
                                <a
                                  href={pWa}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded border border-emerald-700/50 px-2 py-1.5 font-medium text-emerald-300 touch-manipulation min-h-[40px] inline-flex items-center"
                                >
                                  WhatsApp
                                </a>
                              ) : sms ? (
                                <span className="text-zinc-500 py-1">{sms}</span>
                              ) : null}
                            </div>
                          ) : null}
                          {note ? (
                            <div className="mt-2 text-xs text-zinc-300">
                              <span className="text-zinc-500">Note: </span>
                              {note}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Desktop: tabella */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/40">
                        <th className="px-5 py-3 font-medium text-zinc-400">#</th>
                        <th className="px-5 py-3 font-medium text-zinc-400">Cognome e Nome</th>
                        <th className="px-5 py-3 font-medium text-zinc-400">Prenotato il</th>
                        <th className="px-5 py-3 font-medium text-zinc-400">Email</th>
                        <th className="px-5 py-3 font-medium text-zinc-400">SMS / WhatsApp</th>
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
                        const em = (p.email ?? "").trim()
                        const sms = (p.sms ?? "").trim()
                        const pWa = sms ? whatsAppMeUrl(sms, waMsg) : null
                        return (
                          <tr key={idx} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20">
                            <td className="px-5 py-3 text-zinc-300">{String(prog)}</td>
                            <td className="px-5 py-3 font-medium text-zinc-100">{nome}</td>
                            <td className="px-5 py-3 text-zinc-300">{pren || "—"}</td>
                            <td className="px-5 py-3 text-zinc-300">
                              {em ? (
                                <a className="text-sky-300 hover:underline" href={`mailto:${encodeURIComponent(em)}`}>
                                  {em}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-5 py-3 text-zinc-300">
                              {pWa ? (
                                <a className="text-emerald-400 hover:underline" href={pWa} target="_blank" rel="noreferrer">
                                  {sms}
                                </a>
                              ) : (
                                sms || "—"
                              )}
                            </td>
                            <td className="px-5 py-3 text-zinc-300">{p.note ?? ""}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

