import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { AbbAttiviInvio, AbbAttiviInvioEsito } from "@/types/gestionale"

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
  if (e === "sent") return "Inviato da FitCenter"
  if (e === "failed") return "Invio fallito"
  return "Non inviato (niente contatto)"
}

function esitoClass(e: AbbAttiviInvioEsito): string {
  if (e === "sent") return "text-emerald-300"
  if (e === "failed") return "text-red-300"
  return "text-zinc-500"
}

type Hit = {
  invio: AbbAttiviInvio
  nome: string
  dest: string | null
  esito: AbbAttiviInvioEsito
}

export function AttiviInviiLog() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["abbonamenti-attivi-invii"],
    queryFn: () => dataApi.getAbbonamentiAttiviInvii(80),
    staleTime: 10_000,
  })

  const invii = data?.invii ?? []
  const ql = q.trim().toLowerCase()
  const hits = useMemo((): Hit[] => {
    if (ql.length < 2) return []
    const out: Hit[] = []
    for (const invio of invii) {
      for (const r of invio.recipients ?? []) {
        const hay = `${r.nome} ${r.dest ?? ""}`.toLowerCase()
        if (!hay.includes(ql)) continue
        out.push({ invio, nome: r.nome, dest: r.dest, esito: r.esito })
      }
    }
    return out
  }, [invii, ql])

  const selected = invii.find((x) => x.id === openId) ?? null

  return (
    <section id="log-invii" className="mt-6 rounded-xl border border-amber-900/40 bg-zinc-900/40">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-base font-semibold text-zinc-100">Log invii — il cliente dice che non ha ricevuto?</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Cerca cognome o email. «Inviato da FitCenter» = SMTP ha accettato la mail (può comunque finire in spam).
          Gli invii fatti prima di questo log non ci sono.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca cliente: Grazini, carlesi@…"
            className="w-full max-w-md rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {isFetching ? "Aggiorno…" : "Aggiorna"}
          </button>
        </div>
      </div>

      {isLoading ? <p className="px-4 py-6 text-sm text-zinc-500">Caricamento log…</p> : null}
      {error ? (
        <p className="px-4 py-4 text-sm text-red-300">
          Log non disponibile ({(error as Error).message}). Serve aggiornare API e riavviare FitCenterAPI.
        </p>
      ) : null}

      {ql.length >= 2 ? (
        <div className="px-4 py-3">
          <p className="text-xs text-zinc-500">{hits.length} risultati per «{q.trim()}»</p>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Quando</th>
                  <th className="px-2 py-1.5 font-medium">Cliente</th>
                  <th className="px-2 py-1.5 font-medium">Indirizzo</th>
                  <th className="px-2 py-1.5 font-medium">Esito</th>
                  <th className="px-2 py-1.5 font-medium">Oggetto</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h, i) => (
                  <tr key={`${h.invio.id}-${h.nome}-${i}`} className="border-t border-zinc-800/70">
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-zinc-400">{fmtAt(h.invio.at)}</td>
                    <td className="px-2 py-1.5 text-zinc-100">{h.nome}</td>
                    <td className="px-2 py-1.5 text-xs text-zinc-400">{h.dest ?? "—"}</td>
                    <td className={`px-2 py-1.5 text-xs ${esitoClass(h.esito)}`}>{esitoLabel(h.esito)}</td>
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-xs text-zinc-500">
                      {h.invio.channel === "email" ? h.invio.subject || "email" : "SMS"}
                    </td>
                  </tr>
                ))}
                {hits.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-zinc-500">
                      Nessun invio trovato per questo nome. O non era nel destinatario, o l&apos;invio è precedente al log.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {!isLoading && invii.length === 0 && !error ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              Ancora nessun invio in questo log. Dopo la prossima email da «Invia email / SMS» comparirà qui.
            </p>
          ) : null}
          <ul className="divide-y divide-zinc-800/80">
            {invii.map((row) => {
              const active = row.id === openId
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(active ? null : row.id)}
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
                    <span className="text-xs text-amber-400">{active ? "Chiudi elenco" : "Apri elenco"}</span>
                  </button>
                  {active && selected ? (
                    <div className="max-h-72 overflow-auto border-t border-zinc-800/80 bg-zinc-950/40">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Cliente</th>
                            <th className="px-3 py-1.5 font-medium">Destinatario</th>
                            <th className="px-3 py-1.5 font-medium">Esito</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selected.recipients ?? []).map((r) => (
                            <tr key={`${r.clienteId}-${r.dest ?? "x"}`} className="border-t border-zinc-800/70">
                              <td className="px-3 py-1.5 text-zinc-100">{r.nome}</td>
                              <td className="px-3 py-1.5 text-zinc-400">{r.dest ?? "—"}</td>
                              <td className={`px-3 py-1.5 ${esitoClass(r.esito)}`}>{esitoLabel(r.esito)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
