import { useEffect, useMemo, useState } from "react"
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

function toIsoDay(val: unknown): string | undefined {
  if (val == null) return undefined
  const d = val instanceof Date ? val : new Date(val as any)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
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
  const byBase = new Map<string, CorsoGroup[]>() // servizio+giorno -> gruppi (per agganciare attese senza orario)
  for (const r of rows) {
    const servizio = getCorsoTitolo(r)
    const giorno = (r.giorno ?? "").trim() || "—"
    const oraInizio = (r.oraInizio ?? "").trim() || undefined
    const oraFine = (r.oraFine ?? "").trim() || undefined
    const isWait = !!r.inAttesa
    const waitNoTime = isWait && (!oraInizio || oraInizio === "00:00")

    // Se è in attesa e non ha un orario affidabile, prova ad agganciarla al corso del giorno con stesso servizio.
    if (waitNoTime) {
      const baseKey = `${servizio}__${giorno}`
      const candidates = byBase.get(baseKey) ?? []
      if (candidates.length > 0) {
        // Se ci sono più gruppi (stesso corso, più orari), aggancia al primo in ordine di ora.
        const pick = [...candidates].sort((a, b) => (a.oraInizio ?? "").localeCompare(b.oraInizio ?? ""))[0]!
        pick.partecipanti.push(r)
        continue
      }
    }

    const key = `${servizio}__${giorno}__${oraInizio ?? ""}__${oraFine ?? ""}`
    const g = map.get(key)
    if (!g) {
      const created = { key, servizio, giorno, oraInizio, oraFine, partecipanti: [r] }
      map.set(key, created)
      const baseKey = `${servizio}__${giorno}`
      byBase.set(baseKey, [...(byBase.get(baseKey) ?? []), created])
    } else {
      g.partecipanti.push(r)
    }
  }
  const list = Array.from(map.values())
  list.sort((a, b) => {
    // Ordine richiesto: data + orario (non alfabetico per corso)
    const d = a.giorno.localeCompare(b.giorno)
    if (d) return d
    const o = (a.oraInizio ?? "").localeCompare(b.oraInizio ?? "")
    if (o) return o
    const f = (a.oraFine ?? "").localeCompare(b.oraFine ?? "")
    if (f) return f
    return a.servizio.localeCompare(b.servizio)
  })
  for (const g of list) {
    g.partecipanti.sort((x, y) => {
      const px = Number((x.raw as any)?.Progressivo ?? (x.raw as any)?.progressivo)
      const py = Number((y.raw as any)?.Progressivo ?? (y.raw as any)?.progressivo)
      if (Number.isFinite(px) && Number.isFinite(py) && px !== py) return px - py
      // Metti in attesa dopo i prenotati, a parità di progressivo.
      const wx = x.inAttesa ? 1 : 0
      const wy = y.inAttesa ? 1 : 0
      if (wx !== wy) return wx - wy
      const cx = (x.cognome ?? "").localeCompare(y.cognome ?? "")
      if (cx) return cx
      return (x.nome ?? "").localeCompare(y.nome ?? "")
    })
  }
  return list
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

function participantStableKey(p: PrenotazioneCorsoRow, idx: number): string {
  const raw = (p.raw ?? {}) as any
  const id =
    firstNonEmptyStr(raw?.IDCliente) ??
    firstNonEmptyStr(raw?.ClienteId) ??
    firstNonEmptyStr(raw?.IdCliente) ??
    firstNonEmptyStr(raw?.IDUtente) ??
    firstNonEmptyStr(raw?.UtenteId) ??
    firstNonEmptyStr(raw?.IdUtente) ??
    firstNonEmptyStr(raw?.IDAnagrafica) ??
    firstNonEmptyStr(raw?.AnagraficaId) ??
    firstNonEmptyStr(raw?.IDSocio) ??
    firstNonEmptyStr(raw?.SocioId)
  if (id) return `id:${id}`
  const nome = `${p.cognome ?? ""}|${p.nome ?? ""}`.trim()
  const em = (p.email ?? "").trim().toLowerCase()
  const sms = (p.sms ?? "").trim().replace(/\s+/g, "")
  return `fallback:${nome}|${em}|${sms}|${idx}`
}

function hasAccessToday(p: PrenotazioneCorsoRow, giornoIso: string): boolean {
  const d = toIsoDay(p.dataUltimoAcesso) ?? toIsoDay((p.raw as any)?.DataUltimoAcesso)
  return !!d && d === giornoIso
}

function hasWhatsAppableContacts(g: CorsoGroup): boolean {
  for (const p of g.partecipanti) {
    const raw = (p.sms ?? "").trim()
    if (raw && whatsAppMeUrl(raw, ".")) return true
  }
  return false
}

/** Link WhatsApp per ogni cellulare distinto, usando il testo scelto nel modale. */
function waLinksForGroup(g: CorsoGroup, message: string): { label: string; href: string }[] {
  const seen = new Set<string>()
  const list: { label: string; href: string }[] = []
  for (const p of g.partecipanti) {
    const raw = (p.sms ?? "").trim()
    if (!raw) continue
    const href = whatsAppMeUrl(raw, message)
    if (!href) continue
    const nome = `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || raw
    const key = href.split("?")[0] ?? href
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ label: nome, href })
  }
  return list
}

function defaultMessageBody(g: CorsoGroup): string {
  return `Gentile socio,\n\nTi ricordiamo la lezione «${g.servizio}» in data ${fmtDateIt(g.giorno)}${g.oraInizio ? ` alle ${fmtTimeDot(g.oraInizio)}` : ""}${g.oraFine ? `–${fmtTimeDot(g.oraFine)}` : ""}.\n\nSportivi saluti.`
}

export function Corsi() {
  const queryClient = useQueryClient()
  const { role } = useAuth()
  const [giorno, setGiorno] = useState(() => isoToday())
  const [search, setSearch] = useState("")
  const [messaggiGroup, setMessaggiGroup] = useState<CorsoGroup | null>(null)
  const [messaggiChannel, setMessaggiChannel] = useState<"email" | "whatsapp">("email")
  const [messaggiSubject, setMessaggiSubject] = useState("")
  const [messaggiBody, setMessaggiBody] = useState("")
  const [appello, setAppello] = useState<Record<string, true>>({})
  const [waCursor, setWaCursor] = useState(0)

  const enabled = role === "admin" || role === "corsi" || role === "istruttore"
  const canSendMessages = role === "admin" || role === "corsi"

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
      if (!messaggiGroup) throw new Error("Nessun corso selezionato")
      if (!canSendMessages) throw new Error("Permessi insufficienti")
      return prenotazioniApi.notifyEmail({
        giorno,
        groupKey: messaggiGroup.key,
        subject: messaggiSubject.trim(),
        text: messaggiBody.trim(),
      })
    },
    onSuccess: () => {
      setMessaggiGroup(null)
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`fitcenter-corsi-appello:${giorno}`)
      if (!raw) return setAppello({})
      const parsed = JSON.parse(raw) as Record<string, true>
      setAppello(parsed && typeof parsed === "object" ? parsed : {})
    } catch {
      setAppello({})
    }
  }, [giorno])

  function isAppelloChecked(groupKey: string, p: PrenotazioneCorsoRow, idx: number): boolean {
    const k = `${groupKey}::${participantStableKey(p, idx)}`
    return !!appello[k]
  }

  function toggleAppello(groupKey: string, p: PrenotazioneCorsoRow, idx: number): void {
    const k = `${groupKey}::${participantStableKey(p, idx)}`
    setAppello((prev) => {
      const next = { ...prev }
      if (next[k]) delete next[k]
      else next[k] = true
      try {
        localStorage.setItem(`fitcenter-corsi-appello:${giorno}`, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  function openMessaggi(g: CorsoGroup) {
    if (!canSendMessages) return
    setMessaggiGroup(g)
    const ne = uniqueValidEmails(g.partecipanti).length
    setMessaggiChannel(ne > 0 ? "email" : "whatsapp")
    setMessaggiSubject(`Lezione: ${g.servizio}`)
    setMessaggiBody(defaultMessageBody(g))
    setWaCursor(0)
  }

  if (!enabled) {
    return (
      <div className="p-6 text-red-400">
        Permessi insufficienti.
      </div>
    )
  }

  const modalEmails = messaggiGroup ? uniqueValidEmails(messaggiGroup.partecipanti) : []
  const modalWaLinks = messaggiGroup ? waLinksForGroup(messaggiGroup, messaggiBody) : []
  const canOpenNext = modalWaLinks.length > 0 && waCursor >= 0 && waCursor < modalWaLinks.length

  function openWaAt(i: number): void {
    const href = modalWaLinks[i]?.href
    if (!href) return
    window.open(href, "_blank", "noreferrer")
  }

  function openWaNext(): void {
    if (!canOpenNext) return
    openWaAt(waCursor)
    setWaCursor((x) => Math.min(modalWaLinks.length, x + 1))
  }

  async function openWaAll(): Promise<void> {
    if (modalWaLinks.length === 0) return
    for (let i = 0; i < modalWaLinks.length; i += 1) {
      openWaAt(i)
      // piccola pausa per ridurre blocchi popup
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 350))
    }
    setWaCursor(modalWaLinks.length)
  }

  return (
    <div className="p-4 sm:p-6">
      {messaggiGroup ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="messaggi-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMessaggiGroup(null)
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="messaggi-dialog-title" className="text-lg font-semibold text-zinc-100">
              Messaggi
            </h2>
            <p className="mt-1 text-sm text-zinc-300">{messaggiGroup.servizio}</p>
            <p className="text-xs text-zinc-500">
              {fmtDateIt(messaggiGroup.giorno)}
              {messaggiGroup.oraInizio ? ` · ${fmtTimeDot(messaggiGroup.oraInizio)}` : ""}
              {messaggiGroup.oraFine ? `–${fmtTimeDot(messaggiGroup.oraFine)}` : ""}
            </p>

            <div className="mt-4 flex rounded-lg border border-zinc-700 p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  messaggiChannel === "email"
                    ? "bg-amber-600/90 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => setMessaggiChannel("email")}
              >
                Email
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  messaggiChannel === "whatsapp"
                    ? "bg-emerald-700/90 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => setMessaggiChannel("whatsapp")}
              >
                WhatsApp
              </button>
            </div>

            {messaggiChannel === "email" ? (
              <label className="mt-4 grid gap-1 text-sm text-zinc-400">
                <span>Oggetto</span>
                <input
                  value={messaggiSubject}
                  onChange={(e) => setMessaggiSubject(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-zinc-100"
                />
              </label>
            ) : null}

            <label className="mt-4 grid gap-1 text-sm text-zinc-400">
              <span>Messaggio</span>
              <textarea
                value={messaggiBody}
                onChange={(e) => setMessaggiBody(e.target.value)}
                rows={8}
                className="resize-y rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-100"
              />
            </label>

            {messaggiChannel === "email" ? (
              <p className="mt-2 text-xs text-zinc-500">
                Destinatari email:{" "}
                <span className="font-medium text-zinc-300">{modalEmails.length}</span>
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-zinc-500">
                  Apri WhatsApp sul telefono e invia il messaggio a ciascun contatto (numero da colonna SMS).
                </p>
                {modalWaLinks.length === 0 ? (
                  <p className="rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-500">
                    Nessun numero cellulare disponibile per questo corso.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                      <div className="text-xs text-zinc-400">
                        Contatti: <span className="font-medium text-zinc-200">{modalWaLinks.length}</span>
                        {" · "}
                        Prossimo:{" "}
                        <span className="font-medium text-emerald-300">{Math.min(waCursor + 1, modalWaLinks.length)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openWaNext()}
                          disabled={!canOpenNext}
                          className="touch-manipulation rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
                        >
                          Apri prossimo
                        </button>
                        <button
                          type="button"
                          onClick={() => void openWaAll()}
                          className="touch-manipulation rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800/60"
                        >
                          Apri tutti
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                    {modalWaLinks.map((w) => (
                      <a
                        key={w.href}
                        href={w.href}
                        target="_blank"
                        rel="noreferrer"
                        className="touch-manipulation inline-flex min-h-[44px] items-center justify-center rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-900/40"
                      >
                        Apri WhatsApp · {w.label}
                      </a>
                    ))}
                  </div>
                  </div>
                )}
              </div>
            )}

            {messaggiChannel === "email" && notifyMutation.isError ? (
              <p className="mt-2 text-sm text-red-400">{(notifyMutation.error as Error).message}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
              <button
                type="button"
                className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                onClick={() => setMessaggiGroup(null)}
              >
                Chiudi
              </button>
              {messaggiChannel === "email" ? (
                <button
                  type="button"
                  disabled={
                    notifyMutation.isPending ||
                    !messaggiSubject.trim() ||
                    !messaggiBody.trim() ||
                    modalEmails.length === 0
                  }
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-500 disabled:opacity-40"
                  onClick={() => notifyMutation.mutate()}
                >
                  {notifyMutation.isPending ? "Invio…" : "Invia email"}
                </button>
              ) : null}
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
              const canMessaggi =
                canSendMessages && (uniqueValidEmails(g.partecipanti).length > 0 || hasWhatsAppableContacts(g))
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
                        className="touch-manipulation rounded-lg border border-zinc-600 bg-zinc-800/60 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!canMessaggi}
                        title={
                          canMessaggi
                            ? "Invia messaggio ai prenotati (email o WhatsApp)"
                            : canSendMessages
                              ? "Nessun indirizzo email né numero cellulare per questo corso"
                              : "Solo lettura: non puoi inviare messaggi"
                        }
                        onClick={() => openMessaggi(g)}
                      >
                        Messaggi
                      </button>
                    </div>
                  </div>

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
                        const okAccesso = hasAccessToday(p, g.giorno)
                        const okAppello = isAppelloChecked(g.key, p, idx)
                        const presente = okAccesso || okAppello
                        return (
                          <div key={idx} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-zinc-100">
                                  {String(prog)}. {nome}
                                  {p.inAttesa ? (
                                    <span className="ml-2 inline-flex items-center rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                                      ATTESA
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 text-xs text-zinc-400">
                                  Prenotato: <span className="text-zinc-300">{pren || "—"}</span>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  title={
                                    okAccesso
                                      ? "Presente (accesso effettuato oggi)"
                                      : presente
                                        ? "Presente (appello)"
                                        : "Segna presente (appello)"
                                  }
                                  aria-pressed={presente}
                                  disabled={okAccesso}
                                  onClick={() => toggleAppello(g.key, p, idx)}
                                  className={`touch-manipulation h-5 w-5 rounded border transition-colors ${
                                    presente
                                      ? "border-emerald-400/60 bg-emerald-500/30"
                                      : "border-zinc-600 bg-zinc-900/40 hover:bg-zinc-800/50"
                                  } ${okAccesso ? "cursor-not-allowed opacity-90" : ""}`}
                                />
                              </div>
                            </div>
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

                  <div className="hidden overflow-x-auto sm:block">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-950/40">
                          <th className="px-5 py-3 font-medium text-zinc-400">#</th>
                          <th className="px-5 py-3 font-medium text-zinc-400">Presente</th>
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
                            ? new Date(p.prenotatoIl).toLocaleString("it-IT", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : ""
                          const okAccesso = hasAccessToday(p, g.giorno)
                          const okAppello = isAppelloChecked(g.key, p, idx)
                          const presente = okAccesso || okAppello
                          return (
                            <tr key={idx} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20">
                              <td className="px-5 py-3 text-zinc-300">{String(prog)}</td>
                              <td className="px-5 py-3">
                                <button
                                  type="button"
                                  title={
                                    okAccesso
                                      ? "Presente (accesso effettuato oggi)"
                                      : presente
                                        ? "Presente (appello)"
                                        : "Segna presente (appello)"
                                  }
                                  aria-pressed={presente}
                                  disabled={okAccesso}
                                  onClick={() => toggleAppello(g.key, p, idx)}
                                  className={`touch-manipulation h-5 w-5 rounded border transition-colors ${
                                    presente
                                      ? "border-emerald-400/60 bg-emerald-500/30"
                                      : "border-zinc-600 bg-zinc-900/40 hover:bg-zinc-800/50"
                                  } ${okAccesso ? "cursor-not-allowed opacity-90" : ""}`}
                                />
                              </td>
                              <td className="px-5 py-3 font-medium text-zinc-100">
                                {nome}
                                {p.inAttesa ? (
                                  <span className="ml-2 inline-flex items-center rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-300">
                                    ATTESA
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-5 py-3 text-zinc-300">{pren || "—"}</td>
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
