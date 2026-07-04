import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi, type RicevutaUtenteGroup } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import { displayItPhone } from "@/lib/phone"

function fmtEuro(n: number) {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0)
  } catch {
    return `${n || 0}€`
  }
}

function fmtDt(v?: string | null) {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("it-IT")
}

function clienteLabel(r: RicevutaUtenteGroup): string {
  const c = (r.cliente ?? "").trim()
  if (c) return c
  const nome = `${r.cognome ?? ""} ${r.nome ?? ""}`.trim()
  if (nome) return nome
  if (r.senzaNominativo) {
    const desc = r.righe[0]?.descrizione?.trim()
    if (desc) return `Ticket — ${desc}`
    return "Senza nominativo (ticket)"
  }
  return "—"
}

export function Scontrini() {
  const { role } = useAuth()
  const canUse = role === "admin" || role === "operatore" || role === "firme"
  const [windowMode, setWindowMode] = useState<"60" | "day">("day")
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [q, setQ] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [emailOverride, setEmailOverride] = useState("")
  const [phoneOverride, setPhoneOverride] = useState("")
  const [busy, setBusy] = useState<"email" | "sms" | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [sentIds, setSentIds] = useState<Record<string, true>>({})

  const ricevuteQ = useQuery({
    queryKey: ["ricevute-utenti", windowMode, windowMode === "day" ? asOf : ""],
    queryFn: () =>
      dataApi.getRicevuteUtenti({
        asOf: windowMode === "day" ? asOf : undefined,
        windowMinutes: windowMode === "60" ? 60 : undefined,
        limit: 1200,
      }),
    enabled: canUse,
    refetchInterval: windowMode === "60" ? 30_000 : false,
  })

  const ricevute = useMemo(() => {
    const list = ricevuteQ.data?.ricevute ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((r) => {
      const hay = [
        r.numeroRicevuta,
        r.cliente,
        r.cognome,
        r.nome,
        r.email,
        r.sms,
        r.ricevutaId,
        r.tipoRicevuta,
        r.categoriaDescrizione,
        ...r.righe.map((x) => x.descrizione),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [ricevuteQ.data?.ricevute, q])

  const selected = ricevute.find((r) => r.ricevutaId === selectedId) ?? null

  async function onInvia(channel: "email" | "sms") {
    if (!selected) return
    setBusy(channel)
    setErr(null)
    setOk(null)
    try {
      const out = await dataApi.inviaScontrino({
        ricevutaId: selected.ricevutaId,
        channel,
        email: channel === "email" ? emailOverride.trim() || selected.email || undefined : undefined,
        phone: channel === "sms" ? phoneOverride.trim() || selected.sms || undefined : undefined,
      })
      const dest =
        channel === "email"
          ? out.to ?? emailOverride.trim() ?? selected.email
          : out.toMasked ?? displayItPhone(phoneOverride.trim() || selected.sms)
      setOk(
        out.sent
          ? `Scontrino inviato via ${channel === "email" ? "email" : "SMS"} a ${dest}`
          : `Anteprima registrata (servizio non configurato) — controlla i log API`
      )
      setSentIds((prev) => ({ ...prev, [selected.ricevutaId]: true }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
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
          <h1 className="text-2xl font-semibold text-zinc-100">Scontrini</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Tutti gli scontrini da <span className="text-zinc-300">RVW_RicevuteUtenti</span> (abbonamenti, corsi, ticket
            giornalieri anche senza nominativo). Diverso da Firma Cassa, che mostra solo movimenti abbonamento/corsi/campus.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-zinc-400">Cerca</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cliente, n. scontrino, email…"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          />
          <label className="text-xs text-zinc-400">Finestra</label>
          <select
            value={windowMode}
            onChange={(e) => setWindowMode(e.target.value as "60" | "day")}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="60">Ultimi 60 minuti</option>
            <option value="day">Giorno intero</option>
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
        </div>
      </div>

      {ricevuteQ.isLoading && <p className="mt-4 text-sm text-zinc-400">Carico scontrini…</p>}
      {ricevuteQ.error && <p className="mt-4 text-sm text-red-400">{(ricevuteQ.error as Error).message}</p>}
      {ok && <p className="mt-3 text-sm text-emerald-400">{ok}</p>}
      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30">
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="text-sm font-semibold text-zinc-200">Scontrini del periodo</div>
            <div className="mt-1 text-xs text-zinc-500">{ricevute.length} ricevute</div>
          </div>
          <div className="max-h-[70vh] overflow-auto p-2">
            {ricevute.map((r) => {
              const active = r.ricevutaId === selectedId
              const sent = !!sentIds[r.ricevutaId]
              return (
                <button
                  key={r.ricevutaId}
                  type="button"
                  onClick={() => {
                    setSelectedId(r.ricevutaId)
                    setEmailOverride(r.email ?? "")
                    setPhoneOverride(r.sms ?? "")
                    setErr(null)
                    setOk(null)
                  }}
                  className={`mb-2 w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-sky-500/60 bg-sky-500/10"
                      : sent
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-zinc-800 hover:bg-zinc-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-zinc-100">
                      n.{r.numeroRicevuta ?? r.ricevutaId} — {clienteLabel(r)}
                    </div>
                    <div className="text-xs text-zinc-300">{fmtEuro(r.totale)}</div>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {fmtDt(r.dataRicevutaIso)}
                    {r.senzaNominativo ? (
                      <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-amber-200">Senza nominativo</span>
                    ) : null}
                    {r.tipoRicevuta ? <span className="ml-2">{r.tipoRicevuta}</span> : null}
                  </div>
                </button>
              )
            })}
            {!ricevuteQ.isLoading && ricevute.length === 0 && (
              <p className="p-3 text-sm text-zinc-500">Nessuno scontrino trovato.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30">
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="text-sm font-semibold text-zinc-200">Dettaglio e invio</div>
          </div>
          {!selected ? (
            <div className="p-4 text-sm text-zinc-500">Seleziona uno scontrino a sinistra.</div>
          ) : (
            <div className="p-4">
              <div className="rounded border border-zinc-800 bg-zinc-950/30 p-3 text-xs text-zinc-300">
                <div className="text-zinc-500">Intestazione</div>
                <div className="mt-1 text-sm font-semibold text-zinc-100">
                  {selected.azienda.nome ?? "FitCenter"} — n.{selected.numeroRicevuta ?? selected.ricevutaId}
                </div>
                <div className="mt-1">{fmtDt(selected.dataRicevutaIso)}</div>
                <div className="mt-1">Cliente: {clienteLabel(selected)}</div>
                {selected.senzaNominativo ? (
                  <p className="mt-2 text-amber-200/90">
                    Ticket senza anagrafica: inserisci manualmente email o cellulare del destinatario sotto.
                  </p>
                ) : null}
                {selected.tipoPagamento ? <div className="mt-1">Pagamento: {selected.tipoPagamento}</div> : null}
              </div>

              <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/30 p-3">
                <div className="text-xs font-semibold text-zinc-200">Righe</div>
                <div className="mt-2 grid gap-2">
                  {selected.righe.map((riga, idx) => (
                    <div
                      key={riga.rigaId ?? idx}
                      className="flex items-start justify-between gap-3 rounded border border-zinc-800 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="text-zinc-200">{riga.descrizione ?? "—"}</div>
                        {riga.qta > 1 ? (
                          <div className="mt-0.5 text-zinc-500">
                            {riga.qta} × {fmtEuro(riga.prezzoUnitario)}
                          </div>
                        ) : null}
                      </div>
                      <div className="shrink-0 font-medium text-zinc-200">{fmtEuro(riga.totaleRiga)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-between border-t border-zinc-800 pt-2 text-sm font-semibold text-zinc-100">
                  <span>Totale</span>
                  <span>{fmtEuro(selected.totale)}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Email destinatario
                  <input
                    type="email"
                    value={emailOverride}
                    onChange={(e) => setEmailOverride(e.target.value)}
                    placeholder={selected.email ?? "email@…"}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Cellulare (SMS)
                  <input
                    type="tel"
                    value={phoneOverride}
                    onChange={(e) => setPhoneOverride(e.target.value)}
                    placeholder={displayItPhone(selected.sms) || "347…"}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => onInvia("email")}
                  className="rounded bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                >
                  {busy === "email" ? "Invio…" : "Invia via email"}
                </button>
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => onInvia("sms")}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {busy === "sms" ? "Invio…" : "Invia via SMS"}
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Richiede SMTP (email) e SMSHOSTING/Twilio (SMS) configurati nel server API, come per la firma contratti.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
