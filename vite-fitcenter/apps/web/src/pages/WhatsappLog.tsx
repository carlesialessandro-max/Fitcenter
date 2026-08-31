import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { whatsappApi, type WhatsappLogEvent } from "@/api/whatsapp"

/** Solo conversazione utile: richiesta / risposta / appuntamento. */
const CONV_KINDS = new Set(["message_in", "message_out", "booking"])

function fmtAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "message_in":
      return "Richiesta"
    case "message_out":
      return "Risposta"
    case "booking":
      return "Appuntamento"
    default:
      return kind
  }
}

function kindClass(kind: string, status?: string): string {
  if (status === "error" || status === "cancelled") {
    return "border-red-800/60 bg-red-950/30 text-red-200"
  }
  if (kind === "message_in") return "border-sky-800/50 bg-sky-950/25 text-sky-100"
  if (kind === "message_out") return "border-emerald-800/50 bg-emerald-950/25 text-emerald-100"
  if (kind === "booking") return "border-amber-800/50 bg-amber-950/25 text-amber-100"
  return "border-zinc-700 bg-zinc-900/40 text-zinc-200"
}

function displayText(e: WhatsappLogEvent): string {
  const t = String(e.text ?? "").trim()
  if (!t) return "—"
  // Template Meta: template:lead_benvenuto_adulti [Nome]
  const m = t.match(/^template:([^\s\[]+)\s*(?:\[(.*)\])?$/i)
  if (m) {
    const name = m[2]?.trim()
    return name ? `Messaggio di benvenuto (template) · ${name}` : `Messaggio di benvenuto (${m[1]})`
  }
  if (e.kind === "booking") {
    if (e.status === "cancelled" || /^annullat/i.test(t)) return t.replace(/^annullato/i, "Annullato")
    if (e.status === "ok" || /^prenotato/i.test(t)) return t.replace(/^prenotato/i, "Prenotato")
  }
  return t
}

function phoneOf(e: WhatsappLogEvent): string {
  return (e.from || e.to || "—").replace(/^39/, "")
}

function statusSuffix(e: WhatsappLogEvent): string {
  if (e.status === "error") return " · errore"
  if (e.status === "cancelled") return " · annullato"
  if (e.status === "none") return " · non trovato"
  return ""
}

export function WhatsappLog() {
  const [phone, setPhone] = useState("")
  const [kind, setKind] = useState("all")
  const [q, setQ] = useState("")
  const [applied, setApplied] = useState({ phone: "", kind: "all", q: "" })

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["whatsapp", "events", applied.phone, applied.q],
    queryFn: () =>
      whatsappApi.listEvents({
        limit: 500,
        phone: applied.phone || undefined,
        q: applied.q || undefined,
      }),
    refetchInterval: 15_000,
  })

  const events = useMemo(() => {
    const raw = data?.events ?? []
    let rows = raw.filter((e) => CONV_KINDS.has(e.kind))
    if (applied.kind !== "all") {
      rows = rows.filter((e) => e.kind === applied.kind)
    }
    return rows
  }, [data?.events, applied.kind])

  const byPhone = useMemo(() => {
    const map = new Map<string, WhatsappLogEvent[]>()
    for (const e of events) {
      const key = phoneOf(e)
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    return Array.from(map.entries()).sort((a, b) => {
      const atA = a[1][0]?.at ?? ""
      const atB = b[1][0]?.at ?? ""
      return atB.localeCompare(atA)
    })
  }, [events])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Log WhatsApp</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Solo richiesta, risposta del bot e esito appuntamento.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/crm"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            CRM
          </Link>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            {isFetching ? "Aggiorno…" : "Aggiorna"}
          </button>
        </div>
      </div>

      <form
        className="mt-5 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied({ phone: phone.trim(), kind, q: q.trim() })
        }}
      >
        <label className="block text-sm text-zinc-400">
          Telefono
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="335…"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        <label className="block text-sm text-zinc-400">
          Tipo
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="all">Tutti</option>
            <option value="message_in">Richiesta</option>
            <option value="message_out">Risposta</option>
            <option value="booking">Appuntamento</option>
          </select>
        </label>
        <label className="block text-sm text-zinc-400">
          Cerca
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="mercoledì, Irene…"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        <div className="sm:col-span-3">
          <button
            type="submit"
            className="rounded-md bg-amber-600/90 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-500"
          >
            Filtra
          </button>
          <span className="ml-3 text-xs text-zinc-500">
            {events.length} messaggi
          </span>
        </div>
      </form>

      {isLoading ? <div className="mt-6 text-sm text-zinc-500">Caricamento…</div> : null}
      {error ? (
        <div className="mt-6 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {byPhone.length === 0 && !isLoading ? (
          <div className="rounded-md border border-zinc-800 px-4 py-6 text-sm text-zinc-500">
            Nessuna conversazione da mostrare.
          </div>
        ) : null}
        {byPhone.map(([phoneKey, rows]) => (
          <section key={phoneKey} className="rounded-lg border border-zinc-800 bg-zinc-900/30">
            <header className="border-b border-zinc-800 px-3 py-2">
              <h2 className="text-sm font-medium text-zinc-200">+39 {phoneKey}</h2>
            </header>
            <ul className="divide-y divide-zinc-800/80">
              {[...rows].reverse().map((e) => (
                <li key={e.id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">{fmtAt(e.at)}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${kindClass(e.kind, e.status)}`}>
                      {kindLabel(e.kind)}
                      {statusSuffix(e)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-100">{displayText(e)}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
