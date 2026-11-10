import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import type { AttiviContatto, AttiviProdotto } from "@/types/gestionale"

type SegmentoFiltro = "tutti" | "adulti" | "bambini"
type SessoFiltro = "tutti" | "M" | "F"
type Channel = "email" | "sms"

type Props = {
  asOf: string
  consulente?: string
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

const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const IMAGE_OK = /^image\/(jpeg|jpg|png|webp|gif)$/i

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ""))
    r.onerror = () => reject(new Error("Impossibile leggere la grafica"))
    r.readAsDataURL(file)
  })
}

function foldTesto(s: string): string {
  return s
    .toLowerCase()
    .replace(/h\s*2\s*0/g, "h2o")
    .replace(/h\s*2\s*o/g, "h2o")
}

function normPiano(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
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

export function AttiviInviaMessaggio({ asOf, consulente }: Props) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [segmento, setSegmento] = useState<SegmentoFiltro>("tutti")
  const [sessoFiltro, setSessoFiltro] = useState<SessoFiltro>("tutti")
  const [gruppo, setGruppo] = useState("")
  const [pianiSel, setPianiSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [channel, setChannel] = useState<Channel>("email")
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageErr, setImageErr] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const { data, isLoading, error } = useQuery({
    queryKey: ["abbonamenti-attivi-contatti", asOf, consulente ?? ""],
    queryFn: () => dataApi.getAbbonamentiAttiviContatti({ asOf, consulente }),
    enabled: open,
    staleTime: 60_000,
  })

  const allRows = data?.rows ?? []
  const ql = q.trim().toLowerCase()

  const bySegmento = useMemo(() => {
    return allRows.filter((c) => {
      if (segmento === "adulti" && c.segmento !== "adulti") return false
      if (segmento === "bambini" && c.segmento !== "bambini") return false
      if (sessoFiltro === "M" && c.sesso !== "M") return false
      if (sessoFiltro === "F" && c.sesso !== "F") return false
      return !isStaffOrDanza(c.categoria) && !isStaffOrDanza(c.macro ?? "") && !isStaffOrDanza(c.piano)
    })
  }, [allRows, segmento, sessoFiltro])

  const foglie = useMemo(() => {
    const m = new Map<string, Leaf>()
    for (const c of bySegmento) {
      for (const p of prodottiDi(c)) {
        const piano = normPiano(p.piano)
        const cat = normPiano(p.categoria)
        const macro = normPiano(p.macro ?? "")
        if (!piano || isStaffOrDanza(piano) || isStaffOrDanza(cat) || isStaffOrDanza(macro)) continue
        const g = gruppoDi({ ...p, piano, categoria: cat, macro })
        const key = `${g}|||${piano}`
        const prev = m.get(key)
        if (prev) prev.n += 1
        else m.set(key, { key, gruppo: g, piano, n: 1 })
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
    setPianiSel((prev) => {
      if (!prev.size) return prev
      const ok = new Set(prodottiSelect.map((p) => p.piano))
      const next = new Set([...prev].filter((x) => ok.has(x)))
      if (next.size === prev.size) return prev
      return next
    })
  }, [prodottiSelect])

  const rows = useMemo(() => {
    return bySegmento.filter((c) => {
      const prods = prodottiDi(c)
      const haFiltroTipo = Boolean(gruppo || pianiSel.size)
      const prodOk = prods.some((p) => {
        if (isStaffOrDanza(p.piano) || isStaffOrDanza(p.categoria) || isStaffOrDanza(p.macro ?? "")) return false
        if (gruppo && gruppoDi(p) !== gruppo) return false
        if (pianiSel.size && !pianiSel.has(normPiano(p.piano))) return false
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
  }, [bySegmento, ql, gruppo, pianiSel])

  const rowKey = `${segmento}|${sessoFiltro}|${gruppo}|${[...pianiSel].sort().join(",")}|${ql}|${rows.length}|${rows[0]?.clienteId ?? ""}`
  useEffect(() => {
    setSelected(new Set(rows.map((r) => r.clienteId)))
    setConfirm(false)
  }, [rowKey])

  const sendM = useMutation({
    mutationFn: async () => {
      let immagine: { filename: string; contentType: string; dataBase64: string } | undefined
      if (channel === "email" && imageFile) {
        const dataUrl = await readFileAsDataUrl(imageFile)
        immagine = {
          filename: imageFile.name,
          contentType: imageFile.type || "image/jpeg",
          dataBase64: dataUrl,
        }
      }
      return dataApi.postAbbonamentiAttiviInvia({
        asOf,
        consulente: consulente || undefined,
        segmento,
        sesso: sessoFiltro === "tutti" ? undefined : sessoFiltro,
        piani: pianiSel.size ? Array.from(pianiSel) : undefined,
        clienteIds: Array.from(selected),
        channel,
        subject: channel === "email" ? subject.trim() : undefined,
        text: text.trim(),
        confirm: true,
        immagine,
      })
    },
    onSuccess: (res) => {
      const skipped = res.skipped ? `, ${res.skipped} senza contatto (nel log)` : ""
      const fail = res.failed ? `, ${res.failed} rifiutati dal server (nel log)` : ""
      setResultMsg(`Inviati ${res.sent}${fail}${skipped}. Per un reclamo: Log invii.`)
      setConfirm(false)
      void queryClient.invalidateQueries({ queryKey: ["abbonamenti-attivi-invii"] })
    },
  })

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.clienteId)), [rows, selected])
  const reachable = useMemo(() => {
    if (channel === "email") return selectedRows.filter((r) => r.email)
    return selectedRows.filter((r) => r.telefono)
  }, [selectedRows, channel])

  function clearImage() {
    setImageFile(null)
    setImageErr(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  function onPickImage(f: File | undefined) {
    if (!f) return
    if (!IMAGE_OK.test(f.type)) {
      setImageErr("Usa JPG, PNG, WebP o GIF")
      return
    }
    if (f.size > IMAGE_MAX_BYTES) {
      setImageErr("Grafica troppo pesante (max 8 MB)")
      return
    }
    setImageErr(null)
    setImageFile(f)
  }

  function close() {
    setOpen(false)
    setConfirm(false)
    setResultMsg(null)
    clearImage()
    sendM.reset()
  }

  const canSend =
    confirm &&
    text.trim().length > 0 &&
    (channel !== "email" || subject.trim().length > 0) &&
    !imageErr &&
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
                  Come in gestionale: scegli il gruppo (Rossi, Pacchetti ingressi, Nuoto libero…) poi uno o più prodotti.
                  «h2o» filtra solo SMILE H2O; i pacchetti si selezionano dall&apos;elenco, non arrivano da quella ricerca.
                  Puoi filtrare maschi/femmine. Staff esclusi.
                </p>
              </div>
              <button type="button" onClick={close} className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                Chiudi
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Età</span>
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
                <span className="mx-1 hidden h-4 w-px bg-zinc-700 sm:block" aria-hidden />
                <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Sesso</span>
                {(
                  [
                    ["tutti", "Tutti"],
                    ["M", "Maschi"],
                    ["F", "Femmine"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={`sesso-${id}`}
                    type="button"
                    onClick={() => setSessoFiltro(id)}
                    className={`rounded-full px-3 py-1 text-sm ${
                      sessoFiltro === id ? "bg-sky-500 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
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
                      setPianiSel(new Set())
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
                <div className="block text-xs font-medium text-zinc-400">
                  <div className="flex items-center justify-between gap-2">
                    <span>Prodotto (abbonamento)</span>
                    <span className="font-normal text-zinc-500">
                      {pianiSel.size
                        ? `${pianiSel.size} selezionat${pianiSel.size === 1 ? "o" : "i"}`
                        : gruppo
                          ? "tutti del gruppo"
                          : "tutti"}
                    </span>
                  </div>
                  <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-zinc-600 bg-zinc-950 px-2 py-1">
                    {prodottiSelect.length === 0 ? (
                      <p className="py-2 text-zinc-500">Nessun prodotto in elenco.</p>
                    ) : (
                      prodottiSelect.map((p) => (
                        <label
                          key={p.piano}
                          className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm text-zinc-100 hover:bg-zinc-800/70"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={pianiSel.has(p.piano)}
                            onChange={() => setPianiSel((prev) => toggleSet(prev, p.piano))}
                          />
                          <span className="min-w-0 flex-1 leading-snug">
                            {p.piano} <span className="text-zinc-500">({p.n})</span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-3 border-t border-zinc-800 pt-1.5 font-normal">
                    <button
                      type="button"
                      className="text-[11px] text-amber-400 hover:underline"
                      onClick={() => setPianiSel(new Set(prodottiSelect.map((p) => p.piano)))}
                    >
                      Tutti visibili
                    </button>
                    <button
                      type="button"
                      className="text-[11px] text-zinc-400 hover:underline"
                      onClick={() => setPianiSel(new Set())}
                    >
                      Azzera selezione
                    </button>
                  </div>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-zinc-600">
                Nessun prodotto spuntato = tutti. Più prodotti = chi ha almeno uno di quelli (OR). Esempio: gruppo «ROSSI
                - orario libero» + SMILE H2O e SMILE FIT. Per i pacchetti: gruppo «PACCHETTI INGRESSI» poi i prodotti.
              </p>
              {(gruppo || pianiSel.size > 0 || ql || sessoFiltro !== "tutti") && (
                <button
                  type="button"
                  className="mt-2 text-xs text-amber-400 hover:underline"
                  onClick={() => {
                    setGruppo("")
                    setPianiSel(new Set())
                    setQ("")
                    setSessoFiltro("tutti")
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
                      <th className="px-2 py-1.5 font-medium">Sesso</th>
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
                        <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
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
              {channel === "email" ? (
                <div className="mt-2">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                    className="hidden"
                    onChange={(e) => onPickImage(e.target.files?.[0])}
                  />
                  {imagePreview && imageFile ? (
                    <div className="flex items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-2">
                      <img
                        src={imagePreview}
                        alt="Anteprima locandina"
                        className="h-36 w-auto max-w-[160px] rounded-md object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-100">{imageFile.name}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          {(imageFile.size / 1024).toFixed(0)} KB · nell&apos;email compare sotto il testo, in
                          miniatura
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          <button
                            type="button"
                            className="text-xs text-amber-400 hover:underline"
                            onClick={() => imageInputRef.current?.click()}
                          >
                            Cambia grafica
                          </button>
                          <button
                            type="button"
                            className="text-xs text-red-400 hover:underline"
                            onClick={clearImage}
                          >
                            Rimuovi
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="w-full rounded-lg border border-dashed border-zinc-600 bg-zinc-950 px-3 py-3 text-left text-sm text-zinc-400 hover:border-amber-500/70 hover:text-zinc-200"
                    >
                      Allega locandina (JPG, PNG…)
                      <span className="mt-0.5 block text-[11px] text-zinc-600">
                        Compare nell&apos;email sotto il testo, in miniatura. Max 8 MB.
                      </span>
                    </button>
                  )}
                  {imageErr ? <p className="mt-1 text-xs text-red-400">{imageErr}</p> : null}
                </div>
              ) : null}
              <p className="mt-1 text-[11px] text-zinc-500">
                {channel === "sms"
                  ? `${text.length}/1000 caratteri · SMSHosting (un SMS per cellulare; non compare in «Campagne»)`
                  : "Email in BCC: in Gmail non vedi gli altri. Chi è stato avvertito lo trovi in Log invii."}
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
              {selectedRows.length > reachable.length && (
                <p className="mt-2 text-xs text-amber-300/90">
                  Esclusi (niente {channel === "email" ? "email" : "telefono"} in anagrafica):{" "}
                  {selectedRows
                    .filter((r) => (channel === "email" ? !r.email : !r.telefono))
                    .map((r) => r.nome)
                    .join(", ")}
                </p>
              )}
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
      <td className="px-2 py-1.5 text-xs">
        {row.sesso === "M" ? (
          <span className="text-sky-300">M</span>
        ) : row.sesso === "F" ? (
          <span className="text-pink-300">F</span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
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
