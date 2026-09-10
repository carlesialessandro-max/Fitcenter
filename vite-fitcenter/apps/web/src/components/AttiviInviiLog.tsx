import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { AbbAttiviInvioEsito } from "@/types/gestionale"

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

function esitoLabel(e: AbbAttiviInvioEsito): string {
  if (e === "sent") return "Inviato"
  if (e === "failed") return "Fallito"
  return "Saltato"
}

function esitoClass(e: AbbAttiviInvioEsito): string {
  if (e === "sent") return "text-emerald-300"
  if (e === "failed") return "text-red-300"
  return "text-zinc-500"
}

export function AttiviInviiLog() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["abbonamenti-attivi-invii"],
    queryFn: () => dataApi.getAbbonamentiAttiviInvii(40),
    staleTime: 15_000,
  })

  const invii = data?.invii ?? []
  const selected = invii.find((x) => x.id === openId) ?? null
  const ql = q.trim().toLowerCase()
  const recipients = useMemo(() => {
    const rows = selected?.recipients ?? []
    if (!ql) return rows
    return rows.filter((r) => {
      const hay = `${r.nome} ${r.dest ?? ""} ${r.esito}`.toLowerCase()
      return hay.includes(ql)
    })
  }, [selected, ql])

  return (
    <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Storico invii email / SMS</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Ogni comunicazione inviata da questa pagina: esito SMTP/SMS e elenco destinatari.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          {isFetching ? "Aggiorno…" : "Aggiorna"}
        </button>
      </div>

      {isLoading ? <p className="px-4 py-6 text-sm text-zinc-500">Caricamento log…</p> : null}
      {error ? (
        <p className="px-4 py-4 text-sm text-red-300">{(error as Error).message}</p>
      ) : null}
      {!isLoading && invii.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">
          Nessun invio registrato. Dalla prossima email/SMS comparirà qui (gli invii precedenti non sono nel log).
        </p>
      ) : null}

      <ul className="divide-y divide-zinc-800/80">
        {invii.map((row) => {
          const active = row.id === openId
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  setOpenId(active ? null : row.id)
                  setQ("")
                }}
                className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-800/40"
              >
                <div className="min-w-0">
                  <p className="text-sm text-zinc-100">
                    {row.channel === "email" ? row.subject || "(senza oggetto)" : "SMS"}
                    <span className="ml-2 text-xs text-zinc-500">{fmtAt(row.at)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {row.channel === "email" ? "Email" : "SMS"} · {row.user} · inviati {row.sent}
                    {row.failed ? ` · falliti ${row.failed}` : ""}
                    {row.skipped ? ` · saltati ${row.skipped}` : ""}
                  </p>
                </div>
                <span className="text-xs text-amber-400">{active ? "Chiudi" : "Dettaglio"}</span>
              </button>
              {active ? (
                <div className="border-t border-zinc-800/80 bg-zinc-950/40 px-4 py-3">
                  <p className="whitespace-pre-wrap text-sm text-zinc-300">{row.text}</p>
                  {row.errors.length > 0 ? (
                    <p className="mt-2 text-xs text-red-300">{row.errors.join(" · ")}</p>
                  ) : null}
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Cerca nome o email…"
                    className="mt-3 w-full max-w-sm rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                  />
                  <div className="mt-2 max-h-64 overflow-auto rounded-md border border-zinc-800">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                        <tr>
                          <th className="px-2 py-1.5 font-medium">Cliente</th>
                          <th className="px-2 py-1.5 font-medium">Destinatario</th>
                          <th className="px-2 py-1.5 font-medium">Esito</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipients.map((r) => (
                          <tr key={`${r.clienteId}-${r.dest ?? "x"}`} className="border-t border-zinc-800/70">
                            <td className="px-2 py-1.5 text-zinc-100">{r.nome}</td>
                            <td className="px-2 py-1.5 text-zinc-400">{r.dest ?? "—"}</td>
                            <td className={`px-2 py-1.5 ${esitoClass(r.esito)}`}>{esitoLabel(r.esito)}</td>
                          </tr>
                        ))}
                        {recipients.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-2 py-4 text-center text-zinc-500">
                              Nessun destinatario con questo filtro.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
