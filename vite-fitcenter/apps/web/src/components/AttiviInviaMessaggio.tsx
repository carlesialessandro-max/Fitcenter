import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { AttiviContatto, AttiviProdotto } from "@/types/gestionale"

type SegmentoFiltro = "tutti" | "adulti" | "bambini"
type Channel = "email" | "sms"

type Props = {
  asOf: string
}

type Leaf = {
  key: string
  gruppo: string
  piano: string
  n: number
}

function toggleSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function isStaffOrDanza(s: string): boolean {
  const n = s.toUpperCase()
  return n.includes("STAFF") || n.includes("DANZA")
}

function prodottiDi(c: AttiviContatto): AttiviProdotto[] {
  if (c.prodotti?.length) return c.prodotti
  return [{ macro: c.macro ?? "", categoria: c.categoria, piano: c.piano || c.categoria }]
}

function foldTesto(s: string): string {
  return s
    .toLowerCase()
    .replace(/h\s*2\s*0/g, "h2o")
    .replace(/h\s*2\s*o/g, "h2o")
}

/** Come «Macro cat.» in gestionale: PACCHETTI INGRESSI è un gruppo a sé, non va sotto Nuoto/H2O. */
function gruppoDi(p: AttiviProdotto): string {
  const macro = (p.macro ?? "").trim()
  const cat = (p.categoria ?? "").trim()
  const piano = (p.piano ?? "").trim()
  if (macro && /PACCHETT/i.test(macro) && !isStaffOrDanza(macro)) return macro
  if (cat && /PACCHETT/i.test(cat) && !isStaffOrDanza(cat)) return cat
  return cat || macro || piano || "Altro"
}

/** q=h2o → solo piani H2O; q=rossi → gruppo Rossi. Non include i pacchetti ingressi. */
function prodottoMatchQ(p: AttiviProdotto, q: string): boolean {
  if (!q) return true
  const ql = foldTesto(q)
  const piano = foldTesto(p.piano)
  const gruppo = foldTesto(p.categoria)
  const macro = foldTesto(p.macro ?? "")
  if (piano.includes(ql)) return true
  if (gruppo.includes(ql) || macro.includes(ql)) return true
  return false
}

export function AttiviInviaMessaggio({ asOf }: Props) {
  const [open, setOpen] = useState(false)
  const [segmento, setSegmento] = useState<SegmentoFiltro>("tutti")
  const [gruppo, setGruppo] = useState("")
  const [pianoSel, setPianoSel] = useState("")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [channel, setChannel] = useState<Channel>("email")
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [confirm, setConfirm] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ["abbonamenti-attivi-contatti", asOf],
    queryFn: () => dataApi.getAbbonamentiAttiviContatti({ asOf }),
    enabled: open,
    staleTime: 60_000,
  })

  const allRows = data?.rows ?? []
  const ql = q.trim().toLowerCase()

  const bySegmento = useMemo(() => {
    return allRows.filter((c) => {
      if (segmento === "adulti" && c.segmento !== "adulti") return false
      if (segmento === "bambini" && c.segmento !== "bambini") return false
      return !isStaffOrDanza(c.categoria) && !isStaffOrDanza(c.macro ?? "") && !isStaffOrDanza(c.piano)
    })
  }, [allRows, segmento])

  const foglie = useMemo(() => {
    const m = new Map<string, Leaf>()
    for (const c of bySegmento) {
      for (const p of prodottiDi(c)) {
        if (!p.piano || isStaffOrDanza(p.piano) || isStaffOrDanza(p.categoria) || isStaffOrDanza(p.macro ?? "")) continue
        const g = gruppoDi(p)
        const key = `${g}|||${p.piano}`
        const prev = m.get(key)
        if (prev) prev.n += 1
        else m.set(key, { key, gruppo: g, piano: p.piano, n: 1 })
      }
    }
    return Array.from(m.values()).sort((a, b) => a.gruppo.localeCompare(b.gruppo, "it") || a.piano.localeCompare(b.piano, "it"))
  }, [bySegmento])

  const gruppi = useMemo(() => {
    const s = new Set(foglie.map((f) => f.gruppo))
    return Array.from(s).sort((a, b) => a.localeCompare(b, "it"))
  }, [foglie])

  const foglieGruppo = useMemo(() => {
    if (!gruppo) return foglie
    return foglie.filter((f) => f.gruppo === gruppo)
  }, [foglie, gruppo])

  const prodottiSelect = useMemo(() => {
    const seen = new Set<string>()
    const out: { piano: string; n: number }[] = []
    for (const f of foglieGruppo) {
      if (seen.has(f.piano)) {
        const hit = out.find((x) => x.piano === f.piano)
        if (hit) hit.n += f.n
        continue
      }
      seen.add(f.piano)
      out.push({ piano: f.piano, n: f.n })
    }
    return out.sort((a, b) => a.piano.localeCompare(b.piano, "it"))
  }, [foglieGruppo])

  useEffect(() => {
    if (gruppo && !gruppi.includes(gruppo)) setGruppo("")
  }, [gruppi, gruppo])

  useEffect(() => {
    if (pianoSel && !prodottiSelect.some((p) => p.piano === pianoSel)) setPianoSel("")
  }, [prodottiSelect, pianoSel])

  const rows = useMemo(() => {
    return bySegmento.filter((c) => {
      const prods = prodottiDi(c)
      const haFiltroTipo = Boolean(gruppo || pianoSel)
      const prodOk = prods.some((p) => {
        if (isStaffOrDanza(p.piano) || isStaffOrDanza(p.categoria) || isStaffOrDanza(p.macro ?? "")) return false
        if (gruppo && gruppoDi(p) !== gruppo) return false
        if (pianoSel && p.piano !== pianoSel) return false
        if (!haFiltroTipo && ql && !prodottoMatchQ(p, ql)) return false
        return true
      })
      if (prodOk) return true
      if (ql && !haFiltroTipo) {
        const hay = foldTesto(`${c.nome} ${c.email ?? ""}`)
        if (hay.includes(foldTesto(ql))) return true
      }
      return false
    })
  }, [bySegmento, ql, gruppo, pianoSel])

  const rowKey = `${segmento}|${gruppo}|${pianoSel}|${ql}|${rows.length}|${rows[0]?.clienteId ?? ""}`
  useEffect(() => {
    setSelected(new Set(rows.map((r) => r.clienteId)))
    setConfirm(false)
  }, [rowKey])

  const sendM = useMutation({
    mutationFn: () =>
      dataApi.postAbbonamentiAttiviInvia({
        asOf,
        segmento,
        piani: pianoSel ? [pianoSel] : undefined,
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

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.clienteId)), [rows, selected])
  const reachable = useMemo(() => {
    if (channel === "email") return selectedRows.filter((r) => r.email)
    return selectedRows.filter((r) => r.telefono)
  }, [selectedRows, channel])

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

  const conEmail = rows.filter((r) => r.email).length
  const conTel = rows.filter((r) => r.telefono).length

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
                  Come in gestionale: scegli il gruppo (Rossi, Pacchetti ingressi, Nuoto libero…) poi il prodotto. «h2o»
                  filtra solo SMILE H2O; i pacchetti si selezionano dal menu, non arrivano da quella ricerca. Staff esclusi.
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

              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cerca prodotto o nome: h2o, smile, nuoto libero…"
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
              />

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-zinc-400">
                  Gruppo (macro / categoria)
                  <select
                    value={gruppo}
                    onChange={(e) => {
                      setGruppo(e.target.value)
                      setPianoSel("")
                    }}
                    className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  >
                    <option value="">Tutti i gruppi</option>
                    {gruppi.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-zinc-400">
                  Prodotto (abbonamento)
                  <select
                    value={pianoSel}
                    onChange={(e) => setPianoSel(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  >
                    <option value="">{gruppo ? "Tutti i prodotti del gruppo" : "Tutti i prodotti"}</option>
                    {prodottiSelect.map((p) => (
                      <option key={p.piano} value={p.piano}>
                        {p.piano} ({p.n})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-1 text-[11px] text-zinc-600">
                Esempio: gruppo «ROSSI - orario libero» + «SMILE H2O» = solo H2O. Per i pacchetti: gruppo «PACCHETTI
                INGRESSI» poi il prodotto (nuoto libero, corsi, spa…).
              </p>
              {(gruppo || pianoSel || ql) && (
                <button
                  type="button"
                  className="mt-2 text-xs text-amber-400 hover:underline"
                  onClick={() => {
                    setGruppo("")
                    setPianoSel("")
                    setQ("")
                  }}
                >
                  Azzera filtri
                </button>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                <p>
                  {isLoading
                    ? "Caricamento elenco…"
                    : `${rows.length} in elenco · ${conEmail} con email · ${conTel} con cellulare`}
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
                        key={`${r.segmento}-${r.clienteId}`}
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
  const tipo = prodottiDi(row)
    .map((p) => (p.categoria && p.piano && p.categoria !== p.piano ? `${p.categoria} · ${p.piano}` : p.piano || p.categoria))
    .join(" · ")
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
      <td className="max-w-[260px] truncate px-2 py-1.5 text-xs text-zinc-400" title={tipo}>
        {tipo}
      </td>
      <td className="px-2 py-1.5 text-xs text-zinc-500">
        {row.email ? <span className="mr-2 text-zinc-300">{row.email}</span> : <span className="mr-2">no email</span>}
        {row.telefono ? <span className="text-zinc-300">{row.telefono}</span> : <span>no tel</span>}
      </td>
    </tr>
  )
}
