import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { whatsappApi, type WhatsappLogEvent } from "@/api/whatsapp"

function fmtAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return iso
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "message_in":
      return "Cliente → Bot"
    case "message_out":
      return "Bot → Cliente"
    case "booking":
      return "Prenotazione"
    case "status":
      return "Stato consegna"
    default:
      return kind
  }
}

function kindClass(kind: string, status?: string): string {
  if (status === "error" || (kind === "other" && (status === "error" || String(status ?? "").includes("error")))) {
    return "border-red-800/60 bg-red-950/30 text-red-200"
  }
  if (kind === "message_in") return "border-sky-800/50 bg-sky-950/20 text-sky-100"
  if (kind === "message_out") return "border-emerald-800/50 bg-emerald-950/20 text-emerald-100"
  if (kind === "booking") return "border-amber-800/50 bg-amber-950/20 text-amber-100"
  return "border-zinc-700 bg-zinc-900/40 text-zinc-200"
}

function phoneOf(e: WhatsappLogEvent): string {
  return (e.from || e.to || "—").replace(/^39/, "")
}

export function WhatsappLog() {
  const [phone, setPhone] = useState("")
  const [kind, setKind] = useState("all")
  const [q, setQ] = useState("")
  const [applied, setApplied] = useState({ phone: "", kind: "all", q: "" })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["whatsapp", "events", applied],
    queryFn: () =>
      whatsappApi.listEvents({
        limit: 400,
        phone: applied.phone || undefined,
        kind: applied.kind !== "all" ? applied.kind : undefined,
        q: applied.q || undefined,
      }),
    refetchInterval: 15_000,
  })

  const events = data?.events ?? []
  const selected = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId]
  )

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
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Log WhatsApp</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Conversazioni bot ↔ clienti (ingressi, risposte automatiche, prenotazioni ed errori).
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
        className="mt-5 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-4"
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
            <option value="message_in">Cliente → Bot</option>
            <option value="message_out">Bot → Cliente</option>
            <option value="booking">Prenotazione</option>
            <option value="status">Stato consegna</option>
            <option value="other">Altro / errori</option>
          </select>
        </label>
        <label className="block text-sm text-zinc-400 sm:col-span-2">
          Cerca nel testo
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="booking_error, mercoledì, richiamatemi…"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        <div className="sm:col-span-4">
          <button
            type="submit"
            className="rounded-md bg-amber-600/90 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-500"
          >
            Filtra
          </button>
          <span className="ml-3 text-xs text-zinc-500">
            {data ? `${events.length} mostrati / ${data.total} filtrati` : null}
          </span>
        </div>
      </form>

      {isLoading ? <div className="mt-6 text-sm text-zinc-500">Caricamento…</div> : null}
      {error ? (
        <div className="mt-6 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {byPhone.length === 0 && !isLoading ? (
            <div className="rounded-md border border-zinc-800 px-4 py-6 text-sm text-zinc-500">
              Nessun evento. Dopo deploy, i messaggi in/out del bot compariranno qui.
            </div>
          ) : null}
          {byPhone.map(([phoneKey, rows]) => (
            <section key={phoneKey} className="rounded-lg border border-zinc-800 bg-zinc-900/30">
              <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <h2 className="text-sm font-medium text-zinc-200">+39 {phoneKey}</h2>
                <span className="text-xs text-zinc-500">{rows.length} eventi</span>
              </header>
              <ul className="divide-y divide-zinc-800/80">
                {rows.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      className={`flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-zinc-800/40 ${
                        selectedId === e.id ? "bg-zinc-800/50" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-zinc-500">{fmtAt(e.at)}</span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[11px] ${kindClass(e.kind, e.status)}`}
                        >
                          {kindLabel(e.kind)}
                          {e.status === "error" ? " · ERRORE" : e.status && e.status !== "sent" && e.status !== "ok" ? ` · ${e.status}` : ""}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-zinc-200">{e.text || "—"}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <aside className="h-fit rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 lg:sticky lg:top-4">
          <h3 className="text-sm font-medium text-zinc-300">Dettaglio</h3>
          {!selected ? (
            <p className="mt-2 text-xs text-zinc-500">Seleziona un evento per vedere il payload grezzo.</p>
          ) : (
            <div className="mt-2 space-y-2 text-xs text-zinc-400">
              <div>
                <span className="text-zinc-500">ID</span>
                <div className="break-all text-zinc-300">{selected.id}</div>
              </div>
              {selected.waMessageId ? (
                <div>
                  <span className="text-zinc-500">WA message id</span>
                  <div className="break-all text-zinc-300">{selected.waMessageId}</div>
                </div>
              ) : null}
              <div>
                <span className="text-zinc-500">Raw</span>
                <pre className="mt-1 max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] text-zinc-300">
                  {JSON.stringify(selected.raw ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
