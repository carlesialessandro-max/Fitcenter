import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { whatsappApi, type WhatsappLogEvent } from "@/api/whatsapp"
import { useAuth } from "@/contexts/AuthContext"
import { WhatsappThread } from "@/components/WhatsappThread"
import {
  conversationChannel,
  customerPhoneOf,
  eventMatchesChannel,
} from "@/lib/whatsappConversation"

const CONV_KINDS = new Set(["message_in", "message_out", "booking", "lead_request"])

type ChannelFilter = "all" | "lead" | "lezioni_private"

function channelBadge(ch: ReturnType<typeof conversationChannel>): { label: string; className: string } {
  if (ch === "lezioni_private") {
    return { label: "Lezione privata", className: "border-violet-800/60 bg-violet-950/40 text-violet-200" }
  }
  if (ch === "misto") {
    return { label: "Lead + lezione privata", className: "border-zinc-600 bg-zinc-800/80 text-zinc-300" }
  }
  return { label: "Lead", className: "border-sky-800/60 bg-sky-950/40 text-sky-200" }
}

export function WhatsappLog() {
  const { role } = useAuth()
  const isAdmin = role === "admin"
  const queryClient = useQueryClient()
  const [phone, setPhone] = useState("")
  const [channel, setChannel] = useState<ChannelFilter>("all")
  const [q, setQ] = useState("")
  const [applied, setApplied] = useState({ phone: "", q: "" })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["whatsapp", "events"] })

  const purgeTests = useMutation({
    mutationFn: () => whatsappApi.purgeTests(),
    onSuccess: (r) => {
      invalidate()
      alert(r.removed ? `Eliminate ${r.removed} righe di prova.` : "Nessuna chat di prova trovata.")
    },
    onError: (e) => alert((e as Error).message),
  })

  const deletePhone = useMutation({
    mutationFn: (p: string) => whatsappApi.deleteByPhone(p),
    onSuccess: (r) => {
      invalidate()
      if (!r.removed) alert("Nessun messaggio da cancellare.")
    },
    onError: (e) => alert((e as Error).message),
  })

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

  const convEvents = useMemo(() => {
    return (data?.events ?? []).filter((e) => CONV_KINDS.has(e.kind))
  }, [data?.events])

  const grouped = useMemo(() => {
    const map = new Map<string, WhatsappLogEvent[]>()
    for (const e of convEvents) {
      const key = customerPhoneOf(e)
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    return Array.from(map.entries()).map(([phoneKey, rows]) => ({
      phoneKey,
      rows,
      channel: conversationChannel(rows),
    }))
  }, [convEvents])

  const counts = useMemo(() => {
    let lead = 0
    let lp = 0
    for (const g of grouped) {
      if (g.channel === "lead" || g.channel === "misto") lead += 1
      if (g.channel === "lezioni_private" || g.channel === "misto") lp += 1
    }
    return { lead, lp, all: grouped.length }
  }, [grouped])

  const byPhone = useMemo(() => {
    return grouped
      .filter((g) => {
        if (channel === "all") return true
        if (channel === "lead") return g.channel === "lead" || g.channel === "misto"
        return g.channel === "lezioni_private" || g.channel === "misto"
      })
      .map((g) => ({
        ...g,
        rows: g.rows.filter((e) => eventMatchesChannel(e, channel)),
      }))
      .sort((a, b) => (b.rows[0]?.at ?? "").localeCompare(a.rows[0]?.at ?? ""))
  }, [grouped, channel])

  const tabBtn = (id: ChannelFilter, label: string, n: number) => {
    const on = channel === id
    return (
      <button
        type="button"
        onClick={() => setChannel(id)}
        className={`rounded-md border px-3 py-1.5 text-sm ${
          on
            ? "border-amber-600/80 bg-amber-600/20 text-amber-100"
            : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        {label}
        <span className={`ml-1.5 text-xs ${on ? "text-amber-200/80" : "text-zinc-500"}`}>{n}</span>
      </button>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Log WhatsApp</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Scegli Lead o Lezioni private. A sinistra la richiesta del cliente, a destra la risposta
            del bot.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/crm"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            CRM
          </Link>
          {isAdmin ? (
            <button
              type="button"
              disabled={purgeTests.isPending}
              onClick={() => {
                if (confirm("Cancellare le conversazioni di prova dal log?")) purgeTests.mutate()
              }}
              className="rounded-md border border-red-900/60 px-3 py-1.5 text-sm text-red-200 hover:bg-red-950/40"
            >
              {purgeTests.isPending ? "Elimino…" : "Elimina prove"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            {isFetching ? "Aggiorno…" : "Aggiorna"}
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {tabBtn("lead", "Lead", counts.lead)}
        {tabBtn("lezioni_private", "Lezioni private", counts.lp)}
        {tabBtn("all", "Tutti", counts.all)}
      </div>

      <form
        className="mt-4 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied({ phone: phone.trim(), q: q.trim() })
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
          Cerca
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="mercoledì, Irene…"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-amber-600/90 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-500"
          >
            Filtra
          </button>
          <span className="ml-3 text-xs text-zinc-500">
            {byPhone.length} chat · {byPhone.reduce((n, g) => n + g.rows.length, 0)} messaggi
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
            Nessuna conversazione in questo elenco.
          </div>
        ) : null}
        {byPhone.map((g) => {
          const badge = channelBadge(g.channel)
          return (
            <section key={g.phoneKey} className="rounded-lg border border-zinc-800 bg-zinc-900/30">
              <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium text-zinc-200">+39 {g.phoneKey}</h2>
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    disabled={deletePhone.isPending}
                    onClick={() => {
                      if (confirm(`Cancellare tutti i messaggi di +39 ${g.phoneKey} dal log?`)) {
                        deletePhone.mutate(g.phoneKey)
                      }
                    }}
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    Elimina chat
                  </button>
                ) : null}
              </header>
              <WhatsappThread events={g.rows} />
            </section>
          )
        })}
      </div>
    </div>
  )
}
