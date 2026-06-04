import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi, type CassaMovimentiUtentiGroup } from "@/api/data"
import { signaturesApi } from "@/api/signatures"
import { useAuth } from "@/contexts/AuthContext"
import { displayItPhone } from "@/lib/phone"

function fmtEuro(n: number) {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0)
  } catch {
    return `${n || 0}€`
  }
}

function cutBeforeTotale(s: string): string {
  const t = (s ?? "").trim()
  if (!t) return ""
  const i = t.toLowerCase().indexOf("totale")
  return i > 0 ? t.slice(0, i).trim() : t
}

function normalizeAsiTessera(v?: string | null): string {
  const s = String(v ?? "").trim()
  if (!s) return ""
  // In alcune viste Custom2 contiene "NUMERO dd/mm/yy" -> prendiamo solo il numero iniziale.
  const m = s.match(/^\d+/)
  return m ? m[0] : s
}

function fmtDt(v?: string | null) {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("it-IT")
}

function fmtDateOnly(v?: string | null) {
  if (!v) return "—"
  // Supporta ISO YYYY-MM-DD oppure ISO datetime
  const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("it-IT")
}

function toDateOnlyIt(v?: string | null): string {
  const out = fmtDateOnly(v)
  return out === "—" ? "" : out
}

function todayIt(): string {
  return new Date().toLocaleDateString("it-IT")
}

const PENDING_FIRMA_KEY = "fitcenter-firma-pending"

type PendingFirma = { token: string; email: string; customerLabel: string; clientKey: string; sms?: string }

function loadPendingFirma(): PendingFirma | null {
  try {
    const raw = sessionStorage.getItem(PENDING_FIRMA_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingFirma
    return p?.token ? p : null
  } catch {
    return null
  }
}

function savePendingFirma(p: PendingFirma | null) {
  try {
    if (p) sessionStorage.setItem(PENDING_FIRMA_KEY, JSON.stringify(p))
    else sessionStorage.removeItem(PENDING_FIRMA_KEY)
  } catch {
    // ignore
  }
}

export function FirmaDaCassa() {
  const { role } = useAuth()
  const canUse = role === "admin" || role === "operatore" || role === "firme"
  const [windowMode, setWindowMode] = useState<"60" | "day">("day")
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [q, setQ] = useState<string>("")
  const [selectedKey, setSelectedKey] = useState<string>("")
  const [templateId, setTemplateId] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [createdKeys, setCreatedKeys] = useState<Record<string, true>>({})
  const [pendingFirma, setPendingFirmaState] = useState<PendingFirma | null>(() => loadPendingFirma())
  const [assistOtp, setAssistOtp] = useState<string | null>(null)
  const [assistBusy, setAssistBusy] = useState(false)

  const setPendingFirma = (p: PendingFirma | null) => {
    setPendingFirmaState(p)
    savePendingFirma(p)
  }

  const movQ = useQuery({
    queryKey: ["cassa-movimenti-utenti", windowMode, windowMode === "day" ? asOf : ""],
    queryFn: () =>
      dataApi.getCassaMovimentiUtenti({
        asOf: windowMode === "day" ? asOf : undefined,
        windowMinutes: windowMode === "60" ? 60 : undefined,
        limit: 1200,
      }),
    enabled: canUse,
    refetchInterval: windowMode === "60" ? 30_000 : false,
  })

  const tplQ = useQuery({
    queryKey: ["signature-templates"],
    queryFn: () => signaturesApi.listTemplates(),
    enabled: canUse,
  })

  const groupsRaw = movQ.data?.groups ?? []
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groupsRaw
    return groupsRaw.filter((g) => {
      const a = `${g.cognome ?? ""} ${g.nome ?? ""}`.trim().toLowerCase()
      const e = String(g.email ?? "").trim().toLowerCase()
      return a.includes(needle) || e.includes(needle)
    })
  }, [groupsRaw, q])
  const selected: CassaMovimentiUtentiGroup | null = useMemo(
    () => groups.find((g) => g.key === selectedKey) ?? null,
    [groups, selectedKey]
  )

  const selectedRowsForDay = useMemo(() => {
    if (!selected) return []
    if (windowMode !== "day") return selected.rows
    const day = asOf
    return selected.rows.filter((r) => (r.dataOperazioneIso ?? "").slice(0, 10) === day)
  }, [selected, windowMode, asOf])

  useEffect(() => {
    setOk(null)
    setErr(null)
    setAssistOtp(null)
    if (!selectedKey) return
    setPendingFirmaState((prev) => {
      if (!prev || prev.clientKey === selectedKey) return prev
      savePendingFirma(null)
      return null
    })
  }, [selectedKey])

  useEffect(() => {
    setErr(null)
  }, [templateId])

  const templates = tplQ.data ?? []
  const effectiveTemplateId = templateId

  async function onCreateFirma() {
    if (!selected) return
    setErr(null)
    setOk(null)
    const email = (selected.email ?? "").trim()
    if (!email || !email.includes("@")) {
      return setErr("Email mancante o non valida in RVW_CassaMovimentiUtenti. Serve Email per inviare OTP/link firma.")
    }
    if (!effectiveTemplateId) return setErr("Obbligatorio selezionare template di firma.")
    setBusy(true)
    try {
      const customerName = `${selected.cognome ?? ""} ${selected.nome ?? ""}`.trim() || undefined
      const indirizzo = [selected.anagrafica.indirizzoVia, selected.anagrafica.indirizzoNumero].filter(Boolean).join(" ").trim()
      const sumTotale = selectedRowsForDay.reduce((acc, r) => acc + Number(r.iscrizioneTotale ?? 0), 0)
      const sumVersato = selectedRowsForDay.reduce((acc, r) => acc + Number(r.importo ?? 0), 0)
      const asiFromRows = selectedRowsForDay.map((r) => (r as any).asiTesseraCustom2).find((x) => String(x ?? "").trim()) as
        | string
        | null
        | undefined
      const movimentiLines = selectedRowsForDay
        .map((r) => {
          const d = r.dataOperazioneIso ? fmtDt(r.dataOperazioneIso) : ""
          const servizio = (r.tipoServizioDescrizione ?? "—").trim() || "—"
          const causale = cutBeforeTotale(r.causale ?? "")
          const desc = `${causale}${d ? ` (${d})` : ""}`.trim()
          const tot = fmtEuro(Number(r.iscrizioneTotale ?? 0))
          const ver = fmtEuro(Number(r.importo ?? 0))
          // Formato tabellare: 4 colonne (servizio | descrizione | totale | versato)
          return [servizio, desc, tot, ver].join("\t")
        })
        .filter(Boolean)
        .join("\n")
      const prefill: Record<string, string> = {
        nome: selected.nome ?? "",
        cognome: selected.cognome ?? "",
        email: selected.email ?? "",
        cellulare: selected.sms ?? "",
        indirizzo,
        cap: selected.anagrafica.indirizzoCap ?? "",
        citta: selected.anagrafica.indirizzoCitta ?? "",
        provincia: selected.anagrafica.indirizzoProvincia ?? "",
        data_nascita: toDateOnlyIt(selected.anagrafica.dataNascita),
        luogo_nascita: selected.anagrafica.luogoNascita ?? "",
        codice_fiscale: selected.anagrafica.codiceFiscale ?? "",
        data_oggi: todayIt(),
        // Best-effort: se la vista non fornisce ASI/legale rappresentante restano vuoti
        asi_tessera: normalizeAsiTessera(selected.anagrafica.asiTesseraCustom2 ?? asiFromRows),
        // Alcuni template storici usano direttamente l'id colonna invece del campo prefill.
        Custom2: normalizeAsiTessera(selected.anagrafica.asiTesseraCustom2 ?? asiFromRows),
        custom2: normalizeAsiTessera(selected.anagrafica.asiTesseraCustom2 ?? asiFromRows),
        legale_rappresentante: [selected.anagrafica.paganteNome, selected.anagrafica.paganteCodiceFiscale].filter(Boolean).join(" · "),
        movimenti: movimentiLines,
        totale_generale: fmtEuro(sumTotale),
        versato_generale: fmtEuro(sumVersato),
      }
      const out = await signaturesApi.createFromTemplate({
        templateId: effectiveTemplateId,
        customerEmail: email,
        customerName,
        customerGestionaleId: selected.clienteId ?? undefined,
        customerSms: selected.sms ?? undefined,
        prefill,
      })
      const customerLabel = `${selected.cognome ?? ""} ${selected.nome ?? ""}`.trim() || email
      let smsHint = " OTP via email."
      if (out.smsSandbox) {
        smsHint =
          " OTP via email (SMSHOSTING_SANDBOX=true nel .env: nessun SMS reale; rimuovi sandbox e riavvia API)."
      } else if (!out.customerSmsPresent) {
        smsHint = " OTP via email (cellulare assente o non valido in anagrafica)."
      } else if (!out.smsConfigured) {
        smsHint =
          " OTP via email (SMS non attivo sul server: verifica .env Smshosting e riavvio API)."
      } else if (out.linkSmsSent) {
        smsHint =
          " OTP via SMS quando apri la pagina firma e richiedi il codice (il primo SMS contiene solo il link)."
      } else {
        const det = out.linkSmsDetail ? ` (${out.linkSmsDetail})` : ""
        smsHint = ` OTP via email (SMS link non inviato${det}; controlla credito Smshosting o log API).`
      }
      const linkSmsPart = out.smsSandbox
        ? ""
        : out.linkSmsSent && (out.customerSmsE164 || out.customerSmsMasked)
          ? ` e SMS link a ${out.customerSmsE164 ?? out.customerSmsMasked}`
          : out.customerSmsPresent && out.smsConfigured
            ? " (SMS link non inviato)"
            : ""
      setPendingFirma({ token: out.token, email, customerLabel, clientKey: selected.key, sms: selected.sms ?? undefined })
      setAssistOtp(null)
      setOk(
        `Link inviato a ${email}${linkSmsPart}. Il cliente firma dal telefono.${smsHint} Usa il riquadro giallo sotto per mostrare l'OTP in reception.`
      )
      setCreatedKeys((prev) => ({ ...prev, [selected.key]: true }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onAssistOtp() {
    if (!pendingFirma) return
    setAssistBusy(true)
    setErr(null)
    try {
      const out = await signaturesApi.assistOtp(pendingFirma.token)
      setAssistOtp(out.assistOtp)
      setOk(`Codice inviato al cliente${out.smsSent ? " via SMS" : out.mailSent ? " via email" : ""}. Comunica il codice al cliente se non lo riceve.`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setAssistBusy(false)
    }
  }

  if (!canUse) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-300">
          Permessi insufficienti.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Firma contratto</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Movimenti con importo &gt; 0 da <span className="text-zinc-300">RVW_CassaMovimentiUtenti</span>, raggruppati per cliente.
            {windowMode === "60" ? (
              <span className="mt-1 block text-amber-200/80">
                Ultimi 60 minuti: in lista compaiono i clienti con almeno un incasso recente; nel dettaglio vedi tutti gli abbonamenti/corsi
                dello stesso cliente nello stesso giorno (es. più righe in cassa nello stesso momento).
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-zinc-400">Cerca</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, cognome o email…"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          />
          <label className="text-xs text-zinc-400">Finestra</label>
          <select
            value={windowMode}
            onChange={(e) => setWindowMode(e.target.value as "60" | "day")}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="60">Ultimi 60 minuti</option>
            <option value="day">Oggi (tutto il giorno)</option>
          </select>
          {windowMode === "day" ? (
            <>
              <label className="ml-2 text-xs text-zinc-400">Data</label>
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
              />
            </>
          ) : null}
          <label className="ml-2 text-xs text-zinc-400">Template</label>
          <select
            value={effectiveTemplateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="">— Seleziona template —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {templates.length === 0 && <option value="">Nessun template</option>}
          </select>
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800/60"
          >
            {showDebug ? "Nascondi dettagli" : "Mostra dettagli"}
          </button>
        </div>
      </div>

      {showDebug && movQ.data && (
        <p className="mt-2 text-xs text-zinc-500">
          Vista: <span className="text-zinc-300">{movQ.data.view ?? "—"}</span> · dateCol:{" "}
          <span className="text-zinc-300">{movQ.data.dateCol ?? "—"}</span> · importoCol:{" "}
          <span className="text-zinc-300">{movQ.data.importoCol ?? "—"}</span> · causaleCol:{" "}
          <span className="text-zinc-300">{movQ.data.causaleCol ?? "—"}</span> · periodo:{" "}
          <span className="text-zinc-300">{fmtDt(movQ.data.fromIso)}</span> →{" "}
          <span className="text-zinc-300">{fmtDt(movQ.data.toIso)}</span>
        </p>
      )}

      {movQ.isLoading && <p className="mt-4 text-sm text-zinc-400">Carico movimenti…</p>}
      {movQ.error && <p className="mt-4 text-sm text-red-400">{(movQ.error as Error).message}</p>}

      {pendingFirma ? (
        <div className="mt-4 rounded-xl border-2 border-amber-500/50 bg-amber-500/15 p-4 shadow-lg shadow-amber-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-amber-50">Assistenza firma — {pendingFirma.customerLabel}</div>
              <p className="mt-1 text-xs text-amber-100/90">
                Link inviato al cliente ({pendingFirma.email}
                {pendingFirma.sms?.trim() ? ` · ${pendingFirma.sms}` : ""}). Se non riceve l&apos;OTP sul telefono, genera il codice qui e
                leggilo al cliente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPendingFirma(null)
                setAssistOtp(null)
              }}
              className="text-xs text-amber-200/80 hover:text-amber-50"
            >
              Chiudi
            </button>
          </div>
          <button
            type="button"
            disabled={assistBusy}
            onClick={onAssistOtp}
            className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {assistBusy ? "Genero codice…" : "Mostra codice OTP per la reception"}
          </button>
          {assistOtp ? (
            <div className="mt-4 rounded-lg border-2 border-emerald-400/50 bg-emerald-500/15 px-4 py-4 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-100">Codice OTP — leggi al cliente</div>
              <div className="mt-2 font-mono text-4xl font-bold tracking-[0.35em] text-white">{assistOtp}</div>
              <div className="mt-2 text-xs text-emerald-100/90">Valido 10 minuti · inviato anche al cliente (SMS o email)</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {ok && <p className="mt-3 text-sm text-emerald-400">{ok}</p>}
      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30">
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="text-sm font-semibold text-zinc-200">Clienti del periodo</div>
            <div className="mt-1 text-xs text-zinc-500">Seleziona un cliente per vedere i movimenti e avviare la firma.</div>
          </div>
          <div className="max-h-[70vh] overflow-auto p-2">
            {groups.map((g) => {
              const label = `${g.cognome ?? "—"} ${g.nome ?? ""}`.trim()
              const active = g.key === selectedKey
              const created = !!createdKeys[g.key]
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setSelectedKey(g.key)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-amber-500/60 bg-amber-500/10"
                      : created
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-zinc-800 hover:bg-zinc-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-zinc-100">{label}</div>
                    <div className="text-xs text-zinc-300">{fmtEuro(g.totalImporto)}</div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>Email: {g.email ?? "—"}</span>
                    <span>SMS: {displayItPhone(g.sms)}</span>
                    <span>Movimenti: {g.rows.length}</span>
                  </div>
                </button>
              )
            })}
            {!movQ.isLoading && groups.length === 0 && <p className="p-3 text-sm text-zinc-500">Nessun movimento trovato.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30">
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="text-sm font-semibold text-zinc-200">Dettaglio</div>
            <div className="mt-1 text-xs text-zinc-500">Dati per precompilazione + lista movimenti.</div>
          </div>

          {!selected ? (
            <div className="p-4 text-sm text-zinc-500">Seleziona un cliente a sinistra.</div>
          ) : (
            <div className="p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-300">
                  <div className="text-zinc-500">Cliente</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-100">
                    {selected.cognome ?? "—"} {selected.nome ?? ""}
                  </div>
                  <div className="mt-1 text-zinc-400">ID: {selected.clienteId ?? "—"}</div>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-300">
                  <div className="text-zinc-500">Contatti</div>
                  <div className="mt-1">Email: {selected.email ?? "—"}</div>
                  <div className="mt-1">Cellulare (SMS): {selected.sms ?? "—"}</div>
                  <div className="mt-1">Tel1: {selected.anagrafica.telefono1 ?? "—"}</div>
                </div>
              </div>

              <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-300">
                <div className="text-zinc-500">Anagrafica (best-effort)</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>Data nascita: {fmtDateOnly(selected.anagrafica.dataNascita)}</div>
                  <div>Luogo nascita: {selected.anagrafica.luogoNascita ?? "—"}</div>
                  <div>Codice fiscale: {selected.anagrafica.codiceFiscale ?? "—"}</div>
                  <div>ASI Tessera (Custom2): {selected.anagrafica.asiTesseraCustom2 ?? "—"}</div>
                  <div>Indirizzo: {[selected.anagrafica.indirizzoVia, selected.anagrafica.indirizzoNumero].filter(Boolean).join(" ") || "—"}</div>
                  <div>
                    CAP/Città/Prov:{" "}
                    {[selected.anagrafica.indirizzoCap, selected.anagrafica.indirizzoCitta, selected.anagrafica.indirizzoProvincia]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </div>
                  <div>Documento: {selected.anagrafica.documento ?? "—"}</div>
                  <div>Prima iscrizione: {fmtDateOnly(selected.anagrafica.primaIscrizione)}</div>
                </div>
              </div>

              <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/30 p-3">
                <div className="text-xs font-semibold text-zinc-200">Movimenti</div>
                <div className="mt-2 grid gap-2">
                  {selected.rows.map((r, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-3 rounded border border-zinc-800 px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="truncate text-zinc-200">{r.causale ?? "—"}</div>
                        <div className="mt-0.5 text-zinc-500">{fmtDt(r.dataOperazioneIso)}</div>
                      </div>
                      <div className="shrink-0 font-medium text-zinc-200">{fmtEuro(r.importo)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCreateFirma}
                  className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                >
                  {busy ? "Invio…" : "Invia link firma al cliente"}
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Invia link via email (e SMS se c&apos;è il cellulare). Dopo l&apos;invio compare il riquadro giallo in alto per mostrare l&apos;OTP alla reception.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

