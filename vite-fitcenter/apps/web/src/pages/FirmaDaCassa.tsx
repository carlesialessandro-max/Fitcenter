import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi, type CassaMovimentiUtentiGroup } from "@/api/data"
import { signaturesApi } from "@/api/signatures"
import { useAuth } from "@/contexts/AuthContext"

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

function fmtDateOnly(v?: string | null) {
  if (!v) return "—"
  // Supporta ISO YYYY-MM-DD oppure ISO datetime
  const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("it-IT")
}

export function FirmaDaCassa() {
  const { role } = useAuth()
  const canUse = role === "admin" || role === "operatore"
  const [windowMode, setWindowMode] = useState<"60" | "day">("60")
  const [selectedKey, setSelectedKey] = useState<string>("")
  const [templateId, setTemplateId] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const movQ = useQuery({
    queryKey: ["cassa-movimenti-utenti", windowMode],
    queryFn: () => dataApi.getCassaMovimentiUtenti({ windowMinutes: windowMode === "60" ? 60 : undefined, limit: 1200 }),
    enabled: canUse,
    refetchInterval: windowMode === "60" ? 30_000 : false,
  })

  const tplQ = useQuery({
    queryKey: ["signature-templates"],
    queryFn: () => signaturesApi.listTemplates(),
    enabled: canUse,
  })

  const groups = movQ.data?.groups ?? []
  const selected: CassaMovimentiUtentiGroup | null = useMemo(
    () => groups.find((g) => g.key === selectedKey) ?? null,
    [groups, selectedKey]
  )

  const templates = tplQ.data ?? []
  const effectiveTemplateId = templateId || templates[0]?.id || ""

  async function onCreateFirma() {
    if (!selected) return
    setErr(null)
    setOk(null)
    const email = (selected.email ?? "").trim()
    if (!email || !email.includes("@")) {
      return setErr("Email mancante o non valida in RVW_CassaMovimentiUtenti. Serve Email per inviare OTP/link firma.")
    }
    if (!effectiveTemplateId) return setErr("Nessun template firme configurato. Crea/abilita un template in pagina Firme.")
    setBusy(true)
    try {
      const customerName = `${selected.cognome ?? ""} ${selected.nome ?? ""}`.trim() || undefined
      const indirizzo = [selected.anagrafica.indirizzoVia, selected.anagrafica.indirizzoNumero].filter(Boolean).join(" ").trim()
      const capCitta = [selected.anagrafica.indirizzoCap, selected.anagrafica.indirizzoCitta].filter(Boolean).join(" ").trim()
      const prefill: Record<string, string> = {
        nome: selected.nome ?? "",
        cognome: selected.cognome ?? "",
        email: selected.email ?? "",
        cellulare: selected.sms ?? "",
        indirizzo,
        cap_citta: capCitta,
        provincia: selected.anagrafica.indirizzoProvincia ?? "",
        data_nascita: selected.anagrafica.dataNascita ?? "",
        luogo_nascita: selected.anagrafica.luogoNascita ?? "",
        codice_fiscale: selected.anagrafica.codiceFiscale ?? "",
        servizi: `Movimenti: ${selected.rows.length} · Totale: ${fmtEuro(selected.totalImporto)}`,
      }
      const out = await signaturesApi.createFromTemplate({ templateId: effectiveTemplateId, customerEmail: email, customerName, prefill })
      const link = `${window.location.origin}/firma/${out.token}`
      setOk(`Richiesta creata. Apro la pagina firma: ${link}`)
      window.open(link, "_blank", "noopener,noreferrer")
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
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
          <h1 className="text-2xl font-semibold text-zinc-100">Firma da Cassa</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Movimenti con importo &gt; 0 da <span className="text-zinc-300">RVW_CassaMovimentiUtenti</span>, raggruppati per cliente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-zinc-400">Finestra</label>
          <select
            value={windowMode}
            onChange={(e) => setWindowMode(e.target.value as "60" | "day")}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="60">Ultimi 60 minuti</option>
            <option value="day">Oggi (tutto il giorno)</option>
          </select>
          <label className="ml-2 text-xs text-zinc-400">Template</label>
          <select
            value={effectiveTemplateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {templates.length === 0 && <option value="">Nessun template</option>}
          </select>
        </div>
      </div>

      {movQ.data && (
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
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setSelectedKey(g.key)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active ? "border-amber-500/60 bg-amber-500/10" : "border-zinc-800 hover:bg-zinc-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-zinc-100">{label}</div>
                    <div className="text-xs text-zinc-300">{fmtEuro(g.totalImporto)}</div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>Email: {g.email ?? "—"}</span>
                    <span>SMS: {g.sms ?? "—"}</span>
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

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCreateFirma}
                  className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                >
                  {busy ? "Creo…" : "Procedi con firma"}
                </button>
                <span className="text-xs text-zinc-500">
                  Crea richiesta da template e apre la pagina pubblica (OTP su email).
                </span>
              </div>

              {ok && <p className="mt-3 text-sm text-emerald-400">{ok}</p>}
              {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

