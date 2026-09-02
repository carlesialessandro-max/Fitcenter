import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { AttiviContatto } from "@/types/gestionale"

type SegmentoFiltro = "tutti" | "adulti" | "bambini"
type Channel = "email" | "sms"

type Props = {
  asOf: string
}

function toggleSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function AttiviInviaMessaggio({ asOf }: Props) {
  const [open, setOpen] = useState(false)
  const [segmento, setSegmento] = useState<SegmentoFiltro>("tutti")
  const [categorieSel, setCategorieSel] = useState<string[]>([])
  const [q, setQ] = useState("")
  const [qDebounced, setQDebounced] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [channel, setChannel] = useState<Channel>("email")
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [confirm, setConfirm] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 280)
    return () => clearTimeout(t)
  }, [q])

  const categorieKey = [...categorieSel].sort((a, b) => a.localeCompare(b, "it")).join("|")

  const { data, isLoading, error } = useQuery({
    queryKey: ["abbonamenti-attivi-contatti", asOf, segmento, categorieKey, qDebounced],
    queryFn: () =>
      dataApi.getAbbonamentiAttiviContatti({
        asOf,
        segmento,
        categorie: categorieSel,
        q: qDebounced,
      }),
    enabled: open,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!data?.rows) return
    setSelected(new Set(data.rows.map((r) => r.clienteId)))
    setConfirm(false)
    setResultMsg(null)
  }, [data])

  const sendM = useMutation({
    mutationFn: () =>
      dataApi.postAbbonamentiAttiviInvia({
        asOf,
        segmento,
        categorie: categorieSel,
        clienteIds: Array.from(selected),
        channel,
        subject: channel === "email" ? subject.trim() : undefined,
        text: text.trim(),
        confirm: true,
      }),
    onSuccess: (res) => {
      const skipped = res.skipped ? `, saltati ${res.skipped} senza ${channel === "email" ? "email" : "telefono"}` : ""
      const fail = res.failed ? `, falliti ${res.failed}` : ""
      setResultMsg(`Inviati ${res.sent}${fail}${skipped}.`)
      setConfirm(false)
    },
  })

  const rows = data?.rows ?? []
  const categorie = data?.categorie ?? []

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.clienteId)), [rows, selected])
  const reachable = useMemo(() => {
    if (channel === "email") return selectedRows.filter((r) => r.email)
    return selectedRows.filter((r) => r.telefono)
  }, [selectedRows, channel])

  function toggleCategoria(cat: string) {
    setCategorieSel((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]))
  }

  function close() {
    setOpen(false)
    setConfirm(false)
    setResultMsg(null)
    sendM.reset()
  }

  const canSend =
    confirm &&
    text.trim().length > 0 &&
    (channel !== "email" || subject.trim().length > 0) &&
    reachable.length > 0 &&
    reachable.length <= 800 &&
    !sendM.isPending

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
      >
        Invia email / SMS
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="attivi-invia-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center"
          onClick={close}
        >
          <div
            className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div>
                <h2 id="attivi-invia-title" className="text-base font-semibold text-zinc-100">
                  Messaggio agli abbonati attivi
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Filtra adulti/bambini e tipo abbonamento (es. piscina), controlla l&apos;elenco e invia email o SMS
                  (SMSHosting).
                </p>
              </div>
              <button type="button" onClick={close} className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                Chiudi
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["tutti", "Tutti"],
                    ["adulti", "Adulti"],
                    ["bambini", "Bambini"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSegmento(id)}
                    className={`rounded-full px-3 py-1 text-sm ${
                      segmento === id ? "bg-amber-500 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tipologie abbonamento</p>
                <p className="mb-2 text-[11px] text-zinc-600">Nessuna spunta = tutte. Esempio: seleziona solo le voci piscina / H2O / scuola nuoto.</p>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
                  {categorie.length === 0 && !isLoading ? (
                    <span className="text-xs text-zinc-500">Nessuna categoria</span>
                  ) : (
                    categorie.map((cat) => {
                      const on = categorieSel.includes(cat)
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => toggleCategoria(cat)}
                          className={`rounded-full px-2.5 py-1 text-xs ${
                            on ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                          }`}
                        >
                          {cat}
                        </button>
                      )
                    })
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs text-sky-400 hover:underline"
                    onClick={() =>
                      setCategorieSel(categorie.filter((c) => /PISCINA|H2O|NUOTO|ACQUA|AQUATIC/i.test(c)))
                    }
                  >
                    Solo piscina / H2O
                  </button>
                  <button
                    type="button"
                    className="text-xs text-emerald-400 hover:underline"
                    onClick={() =>
                      setCategorieSel(categorie.filter((c) => /GYM|PALESTR|FITNESS|SMILE FIT/i.test(c)))
                    }
                  >
                    Solo palestra
                  </button>
                  {categorieSel.length > 0 && (
                    <button type="button" onClick={() => setCategorieSel([])} className="text-xs text-amber-400 hover:underline">
                      Azzera tipologie
                    </button>
                  )}
                </div>
              </div>

              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cerca nome, piano, email…"
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                <p>
                  {isLoading
                    ? "Caricamento elenco…"
                    : `${rows.length} in elenco · ${data?.conEmail ?? 0} con email · ${data?.conTelefono ?? 0} con cellulare`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-amber-400 hover:underline"
                    onClick={() => setSelected(new Set(rows.map((r) => r.clienteId)))}
                  >
                    Seleziona tutti
                  </button>
                  <button type="button" className="text-zinc-400 hover:underline" onClick={() => setSelected(new Set())}>
                    Nessuno
                  </button>
                </div>
              </div>

              {error && <p className="mt-2 text-sm text-red-400">{(error as Error).message}</p>}

              <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-zinc-800">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500">
                    <tr>
                      <th className="w-8 px-2 py-1.5" />
                      <th className="px-2 py-1.5 font-medium">Cliente</th>
                      <th className="px-2 py-1.5 font-medium">Seg.</th>
                      <th className="px-2 py-1.5 font-medium">Abbonamento</th>
                      <th className="px-2 py-1.5 font-medium">Contatti</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <ContattoRow
                        key={r.clienteId}
                        row={r}
                        checked={selected.has(r.clienteId)}
                        channel={channel}
                        onToggle={() => setSelected((prev) => toggleSet(prev, r.clienteId))}
                      />
                    ))}
                    {!isLoading && rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                          Nessun abbonato con questi filtri.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setChannel("email")}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    channel === "email" ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => setChannel("sms")}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    channel === "sms" ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  SMS
                </button>
              </div>

              {channel === "email" && (
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Oggetto email"
                  maxLength={300}
                  className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                />
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={channel === "sms" ? "Testo SMS…" : "Testo email…"}
                rows={channel === "sms" ? 4 : 6}
                maxLength={channel === "sms" ? 1000 : 20000}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                {channel === "sms"
                  ? `${text.length}/1000 caratteri · SMSHosting (un SMS per cellulare)`
                  : "Email in copia nascosta (BCC), gruppi da 40"}
              </p>
            </div>

            <div className="border-t border-zinc-800 px-4 py-3">
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Confermo l&apos;invio {channel === "email" ? "email" : "SMS"} a{" "}
                  <strong className="text-zinc-100">{reachable.length}</strong> persone
                  {selectedRows.length > reachable.length
                    ? ` (${selectedRows.length - reachable.length} senza ${channel === "email" ? "email" : "telefono"} esclusi)`
                    : ""}
                  .
                </span>
              </label>
              {reachable.length > 800 && (
                <p className="mt-2 text-sm text-red-400">Troppi destinatari ({reachable.length}). Max 800: restringi i filtri.</p>
              )}
              {sendM.isError && <p className="mt-2 text-sm text-red-400">{(sendM.error as Error).message}</p>}
              {resultMsg && <p className="mt-2 text-sm text-emerald-400">{resultMsg}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800">
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => sendM.mutate()}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sendM.isPending ? "Invio in corso…" : `Invia ${channel === "email" ? "email" : "SMS"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ContattoRow({
  row,
  checked,
  channel,
  onToggle,
}: {
  row: AttiviContatto
  checked: boolean
  channel: Channel
  onToggle: () => void
}) {
  const missing = channel === "email" ? !row.email : !row.telefono
  return (
    <tr className={`border-t border-zinc-800/70 ${missing ? "opacity-60" : ""} ${checked ? "bg-zinc-800/30" : ""}`}>
      <td className="px-2 py-1.5">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td className="px-2 py-1.5 text-zinc-100">{row.nome}</td>
      <td className="px-2 py-1.5">
        <span className={row.segmento === "bambini" ? "text-violet-300" : "text-emerald-300"}>
          {row.segmento === "bambini" ? "B" : "A"}
        </span>
      </td>
      <td className="max-w-[220px] truncate px-2 py-1.5 text-xs text-zinc-400" title={`${row.categoria} ${row.piano}`}>
        {row.categoria}
        {row.piano ? ` · ${row.piano}` : ""}
      </td>
      <td className="px-2 py-1.5 text-xs text-zinc-500">
        {row.email ? <span className="mr-2 text-zinc-300">{row.email}</span> : <span className="mr-2">no email</span>}
        {row.telefono ? <span className="text-zinc-300">{row.telefono}</span> : <span>no tel</span>}
      </td>
    </tr>
  )
}
