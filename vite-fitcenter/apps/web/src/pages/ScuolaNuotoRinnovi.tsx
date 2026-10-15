import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { ScuolaNuotoRinnoviResponse } from "@/types/gestionale"
import { SCUOLA_NUOTO_CORSI_SCADENZA } from "@/lib/scuola-nuoto-rinnovi"
import { groupRinnoviByBambino, type RinnovoCorsoGruppo } from "@/lib/scuola-nuoto-rinnovi-group"

type Channel = "email" | "sms"
type Tab = "acquaticita" | "scuola_nuoto"

function toggleSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function RinnoviTable({
  groups,
  selected,
  onToggle,
  onToggleAll,
}: {
  groups: RinnovoCorsoGruppo[]
  selected: Set<string>
  onToggle: (clienteId: string) => void
  onToggleAll: (ids: string[], on: boolean) => void
}) {
  const allIds = groups.map((g) => g.clienteId)
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id))
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-900/80 text-left text-xs text-zinc-500">
          <tr>
            <th className="px-3 py-2">
              <input
                type="checkbox"
                checked={allOn}
                onChange={(e) => onToggleAll(allIds, e.target.checked)}
                className="accent-amber-500"
              />
            </th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Abbonamenti (giorni / corsi)</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Cellulare</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800 text-zinc-200">
          {groups.map((g) => (
            <tr key={g.clienteId} className="hover:bg-zinc-900/40">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(g.clienteId)}
                  onChange={() => onToggle(g.clienteId)}
                  className="accent-amber-500"
                />
              </td>
              <td className="px-3 py-2">{g.nome}</td>
              <td className="px-3 py-2 text-zinc-400">
                {g.piani.length > 1 ? (
                  <ul className="list-inside list-disc text-xs">
                    {g.piani.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  g.piani[0] ?? "—"
                )}
              </td>
              <td className="px-3 py-2 text-xs text-zinc-400">{g.email ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-zinc-400">{g.telefono ?? "—"}</td>
            </tr>
          ))}
          {!groups.length && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                Nessun abbonamento in scadenza per questo corso.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ScuolaNuotoRinnovi() {
  const [dataFine, setDataFine] = useState<string>(SCUOLA_NUOTO_CORSI_SCADENZA[0]!.dataFine)
  const [tab, setTab] = useState<Tab>("acquaticita")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openInvia, setOpenInvia] = useState(false)
  const [channel, setChannel] = useState<Channel>("email")
  const [subject, setSubject] = useState("Rinnovo corso — H2O Sport FitCenter")
  const [text, setText] = useState("")
  const [confirm, setConfirm] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ["scuola-nuoto-rinnovi", dataFine],
    queryFn: () => dataApi.getScuolaNuotoRinnovi(dataFine),
  })
  const d: ScuolaNuotoRinnoviResponse | undefined = q.data

  const tabRows = useMemo(() => {
    if (!d) return []
    return tab === "acquaticita" ? d.acquaticita : d.scuolaNuoto
  }, [d, tab])

  const tabGroups = useMemo(() => groupRinnoviByBambino(tabRows), [tabRows])

  useEffect(() => {
    setSelected(new Set(tabGroups.map((g) => g.clienteId)))
    setConfirm(false)
  }, [dataFine, tab, tabGroups.length, tabGroups[0]?.clienteId])

  const sendM = useMutation({
    mutationFn: () =>
      dataApi.postScuolaNuotoRinnoviInvia({
        dataFine,
        clienteIds: Array.from(selected),
        channel,
        subject: channel === "email" ? subject.trim() : undefined,
        text: text.trim(),
        confirm: true,
      }),
    onSuccess: (res) => {
      setResultMsg(`Inviati ${res.sent}${res.failed ? `, ${res.failed} errori` : ""}${res.skipped ? `, ${res.skipped} saltati` : ""}.`)
      setConfirm(false)
    },
  })

  const selectedGroups = tabGroups.filter((g) => selected.has(g.clienteId))
  const reachable =
    channel === "email" ? selectedGroups.filter((g) => g.email) : selectedGroups.filter((g) => g.telefono)

  const canSend =
    confirm &&
    text.trim().length > 0 &&
    (channel !== "email" || subject.trim().length > 0) &&
    reachable.length > 0 &&
    reachable.length <= 800 &&
    !sendM.isPending

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Rinnovi corsi bambini</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Scuola nuoto e acquaticità: un bambino con più giorni (es. lunedì e venerdì) compare una sola volta; l&apos;email
            di rinnovo parte una volta per famiglia.
          </p>
        </div>
        <Link to="/scuola-nuoto" className="text-sm text-amber-400 hover:underline">
          ← Scuola nuoto
        </Link>
      </div>

      <label className="grid max-w-md gap-1 text-xs text-zinc-500">
        Fine corso (scadenza abbonamento)
        <select
          value={dataFine}
          onChange={(e) => setDataFine(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        >
          {SCUOLA_NUOTO_CORSI_SCADENZA.map((c) => (
            <option key={c.id} value={c.dataFine}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {q.isLoading && <p className="text-sm text-zinc-500">Caricamento elenco…</p>}
      {q.isError && <p className="text-sm text-red-400">{(q.error as Error).message}</p>}

      {d && (
        <>
          <p className="text-sm text-zinc-400">
            {d.totaleBambini ?? d.totale} bambini · {d.totale} abbonamenti in scadenza · {d.conEmail} con email ·{" "}
            {d.conTelefono} con cellulare
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("acquaticita")}
              className={`rounded-full px-3 py-1 text-sm ${tab === "acquaticita" ? "bg-cyan-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
            >
              Acquaticità ({d.statsAcquaticita?.bambini ?? d.acquaticita.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("scuola_nuoto")}
              className={`rounded-full px-3 py-1 text-sm ${tab === "scuola_nuoto" ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
            >
              Scuola nuoto ({d.statsScuolaNuoto?.bambini ?? d.scuolaNuoto.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenInvia(true)
                setResultMsg(null)
                sendM.reset()
              }}
              className="ml-auto rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
            >
              Invia email / SMS
            </button>
          </div>

          <RinnoviTable
            groups={tabGroups}
            selected={selected}
            onToggle={(id) => setSelected((s) => toggleSet(s, id))}
            onToggleAll={(ids, on) =>
              setSelected((s) => {
                const next = new Set(s)
                for (const id of ids) {
                  if (on) next.add(id)
                  else next.delete(id)
                }
                return next
              })
            }
          />
        </>
      )}

      {openInvia && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center"
          onClick={() => setOpenInvia(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-100">Messaggio rinnovo corso</h2>
              <p className="text-xs text-zinc-500">
                {selectedGroups.length} bambini selezionati in {tab === "acquaticita" ? "Acquaticità" : "Scuola nuoto"} · fine{" "}
                {SCUOLA_NUOTO_CORSI_SCADENZA.find((c) => c.dataFine === dataFine)?.label}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setChannel("email")}
                  className={`rounded-full px-3 py-1 text-sm ${channel === "email" ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                >
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => setChannel("sms")}
                  className={`rounded-full px-3 py-1 text-sm ${channel === "sms" ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                >
                  SMS
                </button>
              </div>
              {channel === "email" && (
                <label className="grid gap-1 text-xs text-zinc-500">
                  Oggetto
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  />
                </label>
              )}
              <label className="grid gap-1 text-xs text-zinc-500">
                Testo
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  placeholder="Testo email o SMS…"
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 accent-amber-500" />
                Confermo l&apos;invio {channel === "email" ? "email" : "SMS"} a {reachable.length} bambini (
                {selectedGroups.length - reachable.length} senza contatto esclusi). Un solo messaggio per bambino anche con più
                abbonamenti.
              </label>
              {reachable.length > 800 && (
                <p className="text-sm text-red-400">Troppi destinatari ({reachable.length}). Max 800: restringi la selezione.</p>
              )}
              {sendM.isError && <p className="text-sm text-red-400">{(sendM.error as Error).message}</p>}
              {resultMsg && <p className="text-sm text-emerald-400">{resultMsg}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
              <button type="button" className="text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setOpenInvia(false)}>
                Chiudi
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => sendM.mutate()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
              >
                {sendM.isPending ? "Invio…" : channel === "email" ? "Invia email" : "Invia SMS"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
