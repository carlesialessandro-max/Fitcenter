import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  if (e === "sent") return "Inviato (server ha accettato)"
  if (e === "failed") return "NON inviato — server ha rifiutato"
  return "NON inviato — niente contatto valido"
}

function esitoClass(e: AbbAttiviInvioEsito): string {
  if (e === "sent") return "text-emerald-300"
  if (e === "failed") return "text-red-300"
  return "text-amber-300"
}

function esitoRank(e: AbbAttiviInvioEsito): number {
  if (e === "failed") return 0
  if (e === "skipped") return 1
  return 2
}

type Hit = {
  invio: AbbAttiviInvio
  nome: string
  dest: string | null
  esito: AbbAttiviInvioEsito
  nota?: string
}

export function AttiviInviiLog({ onClose }: { onClose?: () => void }) {
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [soloProblemi, setSoloProblemi] = useState(false)
  const [blEmail, setBlEmail] = useState("")
  const [blNote, setBlNote] = useState("")
  const [bounceText, setBounceText] = useState("")
  const [importMsg, setImportMsg] = useState("")
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["abbonamenti-attivi-invii"],
    queryFn: () => dataApi.getAbbonamentiAttiviInvii(80),
    staleTime: 10_000,
  })
  const blacklistQ = useQuery({
    queryKey: ["mail-blacklist"],
    queryFn: () => dataApi.getMailBlacklist(),
    staleTime: 10_000,
  })

  const delOne = useMutation({
    mutationFn: (id: string) => dataApi.deleteAbbonamentiAttiviInvio(id),
    onSuccess: (_res, id) => {
      setOpenId((cur) => (cur === id ? null : cur))
      void queryClient.invalidateQueries({ queryKey: ["abbonamenti-attivi-invii"] })
    },
  })

  const delAll = useMutation({
    mutationFn: () => dataApi.deleteAbbonamentiAttiviInvii(),
    onSuccess: () => {
      setOpenId(null)
      setQ("")
      void queryClient.invalidateQueries({ queryKey: ["abbonamenti-attivi-invii"] })
    },
  })

  const addBl = useMutation({
    mutationFn: (body: { email: string; note?: string; source?: "admin" | "reply" }) => dataApi.postMailBlacklist(body),
    onSuccess: () => {
      setBlEmail("")
      setBlNote("")
      void queryClient.invalidateQueries({ queryKey: ["mail-blacklist"] })
    },
  })

  const delBl = useMutation({
    mutationFn: (email: string) => dataApi.deleteMailBlacklist(email),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mail-blacklist"] })
    },
  })

  const importBl = useMutation({
    mutationFn: (body: { text?: string; fromMailbox?: boolean; fromLog?: boolean }) =>
      dataApi.importMailBlacklist(body),
    onSuccess: (r) => {
      setBounceText("")
      setImportMsg(
        `Blacklist: ${r.added} nuovi${r.skipped ? `, ${r.skipped} già presenti` : ""}${
          r.messages ? ` da ${r.messages} bounce in casella` : ""
        }.`,
      )
      void queryClient.invalidateQueries({ queryKey: ["mail-blacklist"] })
    },
  })

  const invii = data?.invii ?? []
  const ql = q.trim().toLowerCase()
  const hits = useMemo((): Hit[] => {
    if (ql.length < 2) return []
    const out: Hit[] = []
    for (const invio of invii) {
      for (const r of invio.recipients ?? []) {
        const hay = `${r.nome} ${r.dest ?? ""} ${r.nota ?? ""}`.toLowerCase()
        if (!hay.includes(ql)) continue
        if (soloProblemi && r.esito === "sent") continue
        out.push({ invio, nome: r.nome, dest: r.dest, esito: r.esito, nota: r.nota })
      }
    }
    out.sort((a, b) => esitoRank(a.esito) - esitoRank(b.esito))
    return out
  }, [invii, ql, soloProblemi])

  const selected = invii.find((x) => x.id === openId) ?? null
  const busy = delOne.isPending || delAll.isPending || addBl.isPending || delBl.isPending || importBl.isPending
  const blacklist = blacklistQ.data?.rows ?? []
  const blackSet = useMemo(() => new Set(blacklist.map((r) => r.email.toLowerCase())), [blacklist])

  function confirmDeleteOne(id: string, label: string) {
    if (!window.confirm(`Eliminare questo invio dal log?\n${label}`)) return
    delOne.mutate(id)
  }

  function confirmDeleteAll() {
    if (!window.confirm("Svuotare tutto il log invii? Non si può recuperare.")) return
    delAll.mutate()
  }

  function addToBlacklist(email: string, source: "admin" | "reply" = "admin", note?: string) {
    const dest = email.trim()
    if (!dest) return
    if (!window.confirm(`Mettere in blacklist ${dest}?\nNon riceverà più le mail di Attivi / Scaduti.`)) return
    addBl.mutate({
      email: dest,
      source,
      note: note ?? (source === "reply" ? "Ha risposto Annulla iscrizione" : blNote.trim() || undefined),
    })
  }

  return (
    <section id="log-invii" className="mt-6 rounded-xl border border-amber-900/40 bg-zinc-900/40">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Log invii — il cliente dice che non ha ricevuto?</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Cerca cognome o email. Se manca l&apos;indirizzo o il server lo rifiuta, qui compare in giallo/rosso con il motivo.
              Se l&apos;email è sbagliata ma sembra valida, il server di solito accetta comunque: risulta inviata (può finire in spam o non esistere).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {invii.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={confirmDeleteAll}
                className="rounded-md border border-red-900/70 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-40"
              >
                {delAll.isPending ? "Svuoto…" : "Svuota log"}
              </button>
            ) : null}
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Chiudi
              </button>
            ) : null}
          </div>
        </div>
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
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={soloProblemi}
              onChange={(e) => setSoloProblemi(e.target.checked)}
            />
            Solo problemi (non inviati / rifiutati)
          </label>
        </div>
        {delOne.isError || delAll.isError || addBl.isError || delBl.isError ? (
          <p className="mt-2 text-xs text-red-300">
            {(delOne.error as Error | undefined)?.message ??
              (delAll.error as Error | undefined)?.message ??
              (addBl.error as Error | undefined)?.message ??
              (delBl.error as Error | undefined)?.message}
          </p>
        ) : null}
      </div>

      <div className="border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-100">Blacklist — Annulla iscrizione</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Chi clicca Annulla iscrizione entra da solo. In blacklist vanno solo le caselle inesistenti, non gli indirizzi
          validi. <span className="text-zinc-400">Bounce</span>: Gmail/Libero hanno accettato e poi rimandato «questa
          casella non esiste» (550) — usa il bottone giallo. <span className="text-zinc-400">NON inviati</span>: il nostro
          server non ha consegnato; può essere casella morta oppure un intoppo (server lento, casella piena). Il bottone
          del log prende solo le caselle inesistenti; gli indirizzi validi restano fuori. I prossimi invii saltano chi è
          in lista.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  "Leggere le bounce dalla casella info@h2sport.it (ultimi 21 giorni) e mettere in blacklist solo le caselle inesistenti?",
                )
              )
                return
              setImportMsg("")
              importBl.mutate({ fromMailbox: true })
            }}
            className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {importBl.isPending ? "Importo…" : "Importa bounce dalla casella"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  "Mettere in blacklist solo le caselle inesistenti del log (550 / rifiuto indirizzo)? Gli indirizzi validi NON inviati per errore del server restano fuori.",
                )
              )
                return
              setImportMsg("")
              importBl.mutate({ fromLog: true })
            }}
            className="rounded-md border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            Blacklist solo caselle inesistenti dal log
          </button>
        </div>
        {importMsg ? <p className="mt-2 text-xs text-emerald-400">{importMsg}</p> : null}
        {importBl.error ? (
          <p className="mt-2 text-xs text-red-400">{(importBl.error as Error).message}</p>
        ) : null}
        <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500">
          Oppure incolla qui il testo delle bounce (anche tante insieme)
          <textarea
            value={bounceText}
            onChange={(e) => setBounceText(e.target.value)}
            rows={4}
            placeholder="pacini.le@gmail.com … 550 5.1.1 does not exist"
            className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </label>
        <button
          type="button"
          disabled={busy || !bounceText.trim()}
          onClick={() => {
            setImportMsg("")
            importBl.mutate({ text: bounceText })
          }}
          className="mt-2 rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          Importa dal testo
        </button>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addToBlacklist(blEmail, "reply", blNote.trim() || "Ha risposto Annulla iscrizione")
          }}
        >
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-zinc-500">
            Email (risposta / manuale)
            <input
              type="email"
              value={blEmail}
              onChange={(e) => setBlEmail(e.target.value)}
              placeholder="cliente@email.it"
              className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
              required
            />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs text-zinc-500">
            Nota
            <input
              value={blNote}
              onChange={(e) => setBlNote(e.target.value)}
              placeholder="Ha risposto annulla iscrizione"
              className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !blEmail.trim()}
            className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
          >
            {addBl.isPending ? "Aggiungo…" : "Metti in blacklist"}
          </button>
        </form>
        {blacklistQ.isLoading ? <p className="mt-2 text-xs text-zinc-500">Caricamento blacklist…</p> : null}
        {blacklist.length ? (
          <div className="mt-3 max-h-48 overflow-auto rounded-md border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Email</th>
                  <th className="px-2 py-1.5 font-medium">Quando</th>
                  <th className="px-2 py-1.5 font-medium">Origine</th>
                  <th className="px-2 py-1.5 font-medium">Nota</th>
                  <th className="px-2 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {blacklist.map((r) => (
                  <tr key={r.email} className="border-t border-zinc-800/70">
                    <td className="px-2 py-1.5 text-zinc-100">{r.email}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-zinc-400">{fmtAt(r.at)}</td>
                    <td className="px-2 py-1.5 text-zinc-400">
                      {r.source === "link"
                        ? "Link in calce"
                        : r.source === "reply"
                          ? "Risposta"
                          : r.source === "bounce"
                            ? "Bounce"
                            : r.user || "Admin"}
                    </td>
                    <td className="px-2 py-1.5 text-zinc-500">{r.note ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Togliere ${r.email} dalla blacklist? Potrà di nuovo ricevere le mail.`)) return
                          delBl.mutate(r.email)
                        }}
                        className="text-amber-400 hover:underline disabled:opacity-40"
                      >
                        Riabilita
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !blacklistQ.isLoading ? (
          <p className="mt-2 text-xs text-zinc-500">Nessuno in blacklist.</p>
        ) : null}
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
                  <th className="px-2 py-1.5 font-medium">Motivo</th>
                  <th className="px-2 py-1.5 font-medium">Oggetto</th>
                  <th className="px-2 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {hits.map((h, i) => (
                  <tr key={`${h.invio.id}-${h.nome}-${i}`} className="border-t border-zinc-800/70">
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-zinc-400">{fmtAt(h.invio.at)}</td>
                    <td className="px-2 py-1.5 text-zinc-100">{h.nome}</td>
                    <td className="px-2 py-1.5 text-xs text-zinc-400">
                      {h.dest ?? "—"}
                      {h.dest && !blackSet.has(h.dest.toLowerCase()) ? (
                        <button
                          type="button"
                          className="ml-2 text-[11px] text-zinc-500 hover:text-amber-400 hover:underline"
                          onClick={() => addToBlacklist(h.dest!, "admin")}
                        >
                          Blacklist
                        </button>
                      ) : null}
                    </td>
                    <td className={`px-2 py-1.5 text-xs ${esitoClass(h.esito)}`}>{esitoLabel(h.esito)}</td>
                    <td className="max-w-[240px] px-2 py-1.5 text-xs text-zinc-400">{h.nota ?? "—"}</td>
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-xs text-zinc-500">
                      {h.invio.channel === "email" ? h.invio.subject || "email" : "SMS"}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          confirmDeleteOne(
                            h.invio.id,
                            `${fmtAt(h.invio.at)} · ${h.invio.channel === "email" ? h.invio.subject || "email" : "SMS"}`,
                          )
                        }
                        className="text-xs text-red-400 hover:underline disabled:opacity-40"
                      >
                        Elimina invio
                      </button>
                    </td>
                  </tr>
                ))}
                {hits.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-zinc-500">
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
                  <div className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpenId(active ? null : row.id)}
                      className="min-w-0 flex-1 text-left hover:opacity-90"
                    >
                      <p className="text-sm text-zinc-100">
                        {row.channel === "email" ? row.subject || "(senza oggetto)" : "SMS"}
                        <span className="ml-2 text-xs text-zinc-500">{fmtAt(row.at)}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {row.channel === "email" ? "Email" : "SMS"} · {row.user} · inviati {row.sent}
                        {row.failed ? ` · rifiutati ${row.failed}` : ""}
                        {row.skipped ? ` · senza contatto ${row.skipped}` : ""}
                        {row.imageName ? ` · grafica ${row.imageName}` : ""}
                      </p>
                    </button>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setOpenId(active ? null : row.id)}
                        className="text-xs text-amber-400"
                      >
                        {active ? "Chiudi elenco" : "Apri elenco"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          confirmDeleteOne(
                            row.id,
                            `${fmtAt(row.at)} · ${row.channel === "email" ? row.subject || "email" : "SMS"}`,
                          )
                        }
                        className="text-xs text-red-400 hover:underline disabled:opacity-40"
                      >
                        Elimina
                      </button>
                    </div>
                  </div>
                  {active && selected ? (
                    <div className="max-h-72 overflow-auto border-t border-zinc-800/80 bg-zinc-950/40">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Cliente</th>
                            <th className="px-3 py-1.5 font-medium">Destinatario</th>
                            <th className="px-3 py-1.5 font-medium">Esito</th>
                            <th className="px-3 py-1.5 font-medium">Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {([...selected.recipients ?? []]
                            .filter((r) => !soloProblemi || r.esito !== "sent")
                            .sort((a, b) => esitoRank(a.esito) - esitoRank(b.esito))
                          ).map((r) => (
                            <tr key={`${r.clienteId}-${r.dest ?? "x"}`} className="border-t border-zinc-800/70">
                              <td className="px-3 py-1.5 text-zinc-100">{r.nome}</td>
                              <td className="px-3 py-1.5 text-zinc-400">
                                {r.dest ?? "—"}
                                {r.dest && !blackSet.has(r.dest.toLowerCase()) ? (
                                  <button
                                    type="button"
                                    className="ml-2 text-[11px] text-zinc-500 hover:text-amber-400 hover:underline"
                                    onClick={() => addToBlacklist(r.dest!, "admin")}
                                  >
                                    Blacklist
                                  </button>
                                ) : null}
                              </td>
                              <td className={`px-3 py-1.5 ${esitoClass(r.esito)}`}>{esitoLabel(r.esito)}</td>
                              <td className="px-3 py-1.5 text-zinc-400">{r.nota ?? "—"}</td>
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
