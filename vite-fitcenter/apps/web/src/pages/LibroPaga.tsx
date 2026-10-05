import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { libroPagaApi, type LibroPagaSnapshot, type LpagaLivello, type LpagaMensilitaRow, type LpagaPersonale } from "@/api/libroPaga"
import { useAuth } from "@/contexts/AuthContext"

type Tab = "turni" | "presenze" | "mensilita" | "livelli" | "personale"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function currentMese(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(
      new Date()
    )
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}

function todayIso(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

export function LibroPaga() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>("turni")
  const [mese, setMese] = useState(currentMese)
  const [error, setError] = useState("")

  const q = useQuery({
    queryKey: ["libro-paga", mese],
    queryFn: () => libroPagaApi.get(mese),
    enabled: role === "admin",
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ["libro-paga"] })

  if (role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Libro paga</h2>
          <p className="mt-2 text-sm text-zinc-500">Pagina disponibile solo per amministratori.</p>
        </div>
      </div>
    )
  }

  const data = q.data
  const tabs: { id: Tab; label: string }[] = [
    { id: "turni", label: "Turni" },
    { id: "presenze", label: "Presenze" },
    { id: "mensilita", label: "Mensilità" },
    { id: "livelli", label: "Livelli" },
    { id: "personale", label: "Personale" },
  ]

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Libro paga</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Istruttori inseriscono le lezioni svolte, controllo presenze e totale mese per il bonifico.
            Per ora visibile solo ad admin.
          </p>
        </div>
        <label className="grid gap-1 text-sm text-zinc-400">
          <span className="text-xs">Mese</span>
          <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className={inputCls} />
        </label>
      </div>

      {data?.storage === "json" && (
        <p className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90">
          Tabelle SQL non create (permessi o connessione write). I dati sono salvati sul server FitCenter; al
          prossimo deploy con SQL write si useranno le tabelle <code>FcLibroPaga*</code>.
        </p>
      )}
      {data?.storage === "sql" && (
        <p className="mt-3 text-xs text-zinc-500">Dati su SQL Server (tabelle FcLibroPaga*).</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t.id ? "bg-amber-500/20 text-amber-200" : "border border-zinc-700 text-zinc-400"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {q.isLoading && <p className="mt-4 text-sm text-zinc-500">Caricamento…</p>}
      {q.isError && <p className="mt-4 text-sm text-red-400">{(q.error as Error).message}</p>}

      {data && tab === "turni" && (
        <TurniTab
          data={data}
          mese={mese}
          onError={setError}
          onDone={() => {
            setError("")
            invalidate()
          }}
        />
      )}
      {data && tab === "presenze" && (
        <PresenzeTab
          data={data}
          onError={setError}
          onDone={() => {
            setError("")
            invalidate()
          }}
        />
      )}
      {data && tab === "mensilita" && (
        <MensilitaTab
          rows={data.mensilita}
          mese={mese}
          onError={setError}
          onDone={() => {
            setError("")
            invalidate()
          }}
        />
      )}
      {data && tab === "livelli" && (
        <LivelliTab
          rows={data.livelli}
          onError={setError}
          onDone={() => {
            setError("")
            invalidate()
          }}
        />
      )}
      {data && tab === "personale" && (
        <PersonaleTab
          rows={data.personale}
          onError={setError}
          onDone={() => {
            setError("")
            invalidate()
          }}
        />
      )}
    </div>
  )
}

function TurniTab({
  data,
  mese,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  mese: string
  onError: (s: string) => void
  onDone: () => void
}) {
  const attiviP = data.personale.filter((p) => p.attivo)
  const attiviL = data.livelli.filter((l) => l.attivo)
  const [personaleId, setPersonaleId] = useState(attiviP[0]?.id ?? "")
  const [livelloId, setLivelloId] = useState(attiviL[0]?.id ?? "")
  const [giorno, setGiorno] = useState(() => {
    const t = todayIso()
    return t.startsWith(mese) ? t : `${mese}-01`
  })
  const [quantita, setQuantita] = useState("1")
  const [note, setNote] = useState("")

  const createMut = useMutation({
    mutationFn: () =>
      libroPagaApi.createTurno({
        personaleId,
        livelloId,
        giorno,
        quantita: Number(quantita.replace(",", ".")),
        note,
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deleteTurno(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  const tot = useMemo(
    () => data.turni.reduce((s, t) => s + t.importo, 0),
    [data.turni]
  )

  return (
    <div className="mt-4 space-y-4">
      <form
        className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        <p className="mb-3 text-sm font-medium text-zinc-200">Registra lezione / turno</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 text-xs text-zinc-400">
            Persona
            <select value={personaleId} onChange={(e) => setPersonaleId(e.target.value)} className={inputCls} required>
              <option value="">—</option>
              {attiviP.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Livello
            <select value={livelloId} onChange={(e) => setLivelloId(e.target.value)} className={inputCls} required>
              <option value="">—</option>
              {attiviL.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome} ({l.fissa ? `${eur(l.retribuzione)} fisso` : `${eur(l.retribuzione)}/h`})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Giorno
            <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} className={inputCls} required />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Ore / quantità
            <input value={quantita} onChange={(e) => setQuantita(e.target.value)} className={inputCls} required />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
        </div>
        <button type="submit" className={`${btnAmber} mt-3`} disabled={createMut.isPending || !attiviP.length || !attiviL.length}>
          Aggiungi
        </button>
        {(!attiviP.length || !attiviL.length) && (
          <p className="mt-2 text-xs text-zinc-500">Prima crea almeno un livello e una persona nelle rispettive schede.</p>
        )}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Giorno</th>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Livello</th>
              <th className="px-3 py-2 text-right">Ore</th>
              <th className="px-3 py-2 text-right">Importo</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.turni.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  Nessun turno in questo mese.
                </td>
              </tr>
            )}
            {data.turni.map((t) => (
              <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(t.giorno)}</td>
                <td className="px-3 py-2">{t.personaleNome}</td>
                <td className="px-3 py-2">{t.livelloNome}</td>
                <td className="px-3 py-2 text-right">{t.quantita}</td>
                <td className="px-3 py-2 text-right">{eur(t.importo)}</td>
                <td className="px-3 py-2 text-zinc-400">{t.note ?? ""}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-xs text-red-400 hover:underline"
                    disabled={delMut.isPending}
                    onClick={() => {
                      if (confirm("Eliminare questo turno?")) delMut.mutate(t.id)
                    }}
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {data.turni.length > 0 && (
            <tfoot>
              <tr className="border-t border-zinc-700 text-zinc-100">
                <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase text-zinc-500">
                  Totale mese
                </td>
                <td className="px-3 py-2 text-right font-medium">{eur(tot)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function PresenzeTab({
  data,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  onError: (s: string) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const mut = useMutation({
    mutationFn: ({ id, valore }: { id: string; valore: number }) => libroPagaApi.putPresenza(id, valore),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2">Giorno</th>
            <th className="px-3 py-2">Persona</th>
            <th className="px-3 py-2">Livello</th>
            <th className="px-3 py-2 text-right">Dichiarato</th>
            <th className="px-3 py-2 text-right">Presenza</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {data.turni.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                Nessun turno da controllare.
              </td>
            </tr>
          )}
          {data.turni.map((t) => {
            const val = draft[t.id] ?? (t.presenzaValore != null ? String(t.presenzaValore) : String(t.quantita))
            const ok = t.presenzaValore != null
            return (
              <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(t.giorno)}</td>
                <td className="px-3 py-2">{t.personaleNome}</td>
                <td className="px-3 py-2">{t.livelloNome}</td>
                <td className="px-3 py-2 text-right">{t.quantita}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    value={val}
                    onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                    className={`${inputCls} w-24 text-right`}
                  />
                  {ok && <span className="ml-2 text-[10px] uppercase text-emerald-400">ok</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={mut.isPending}
                    onClick={() => mut.mutate({ id: t.id, valore: Number(val.replace(",", ".")) })}
                  >
                    Salva
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MensilitaTab({
  rows,
  mese,
  onError,
  onDone,
}: {
  rows: LpagaMensilitaRow[]
  mese: string
  onError: (s: string) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState<Record<string, { bonifico: string; nota: string }>>({})
  const mut = useMutation({
    mutationFn: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) =>
      libroPagaApi.putMensilita(body),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  const totImporto = rows.reduce((s, r) => s + r.importo, 0)
  const totBonifico = rows.reduce((s, r) => {
    const d = draft[r.personaleId]
    const n = d ? Number(d.bonifico.replace(",", ".")) : r.bonifico
    return s + (Number.isFinite(n) ? n : r.bonifico)
  }, 0)

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2">Persona</th>
            <th className="px-3 py-2 text-right">Turni</th>
            <th className="px-3 py-2 text-right">Ore</th>
            <th className="px-3 py-2 text-right">Controllate</th>
            <th className="px-3 py-2 text-right">Competenza</th>
            <th className="px-3 py-2 text-right">Bonifico</th>
            <th className="px-3 py-2">Nota</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                Nessuna competenza in questo mese.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const d = draft[r.personaleId] ?? { bonifico: String(r.bonifico), nota: r.nota }
            return (
              <tr key={r.personaleId} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">
                  {r.personaleNome}
                  {r.chiuso && <span className="ml-2 text-[10px] uppercase text-emerald-400">chiuso</span>}
                </td>
                <td className="px-3 py-2 text-right">{r.nTurni}</td>
                <td className="px-3 py-2 text-right">{r.ore}</td>
                <td className="px-3 py-2 text-right">
                  {r.presenzaOre}
                  <span className="ml-1 text-[10px] text-zinc-500">
                    ({r.nControllati}/{r.nTurni})
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{eur(r.importo)}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    value={d.bonifico}
                    onChange={(e) =>
                      setDraft((x) => ({ ...x, [r.personaleId]: { ...d, bonifico: e.target.value } }))
                    }
                    className={`${inputCls} w-28 text-right`}
                    disabled={r.chiuso}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={d.nota}
                    onChange={(e) => setDraft((x) => ({ ...x, [r.personaleId]: { ...d, nota: e.target.value } }))}
                    className={`${inputCls} w-40`}
                    disabled={r.chiuso}
                  />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {!r.chiuso && (
                    <button
                      type="button"
                      className={btnGhost}
                      disabled={mut.isPending}
                      onClick={() =>
                        mut.mutate({
                          personaleId: r.personaleId,
                          mese,
                          bonifico: Number(d.bonifico.replace(",", ".")),
                          nota: d.nota,
                          chiuso: false,
                        })
                      }
                    >
                      Salva
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${btnGhost} ml-1`}
                    disabled={mut.isPending}
                    onClick={() =>
                      mut.mutate({
                        personaleId: r.personaleId,
                        mese,
                        bonifico: Number(d.bonifico.replace(",", ".")),
                        nota: d.nota,
                        chiuso: !r.chiuso,
                      })
                    }
                  >
                    {r.chiuso ? "Riapri" : "Chiudi"}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-zinc-700 text-zinc-100">
              <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase text-zinc-500">
                Totali
              </td>
              <td className="px-3 py-2 text-right font-medium">{eur(totImporto)}</td>
              <td className="px-3 py-2 text-right font-medium">{eur(totBonifico)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function LivelliTab({
  rows,
  onError,
  onDone,
}: {
  rows: LpagaLivello[]
  onError: (s: string) => void
  onDone: () => void
}) {
  const [nome, setNome] = useState("")
  const [retrib, setRetrib] = useState("")
  const [fissa, setFissa] = useState(false)
  const createMut = useMutation({
    mutationFn: () =>
      libroPagaApi.createLivello({ nome, retribuzione: Number(retrib.replace(",", ".")), fissa, attivo: true }),
    onSuccess: () => {
      setNome("")
      setRetrib("")
      setFissa(false)
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const patchMut = useMutation({
    mutationFn: ({ id, attivo }: { id: string; attivo: boolean }) => libroPagaApi.patchLivello(id, { attivo }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deleteLivello(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  return (
    <div className="mt-4 space-y-4">
      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        <label className="grid gap-1 text-xs text-zinc-400">
          Nome livello
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} required />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Retribuzione €
          <input value={retrib} onChange={(e) => setRetrib(e.target.value)} className={inputCls} required />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={fissa} onChange={(e) => setFissa(e.target.checked)} />
          Importo fisso (non orario)
        </label>
        <button type="submit" className={btnAmber} disabled={createMut.isPending}>
          Aggiungi livello
        </button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2 text-right">Retribuzione</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  Nessun livello. Aggiungi ad esempio «Lezione nuoto 25m».
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{r.nome}</td>
                <td className="px-3 py-2 text-right">{eur(r.retribuzione)}</td>
                <td className="px-3 py-2 text-zinc-400">{r.fissa ? "Fisso" : "Orario"}</td>
                <td className="px-3 py-2">{r.attivo ? "Attivo" : "Disattivo"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => patchMut.mutate({ id: r.id, attivo: !r.attivo })}
                  >
                    {r.attivo ? "Disattiva" : "Riattiva"}
                  </button>
                  <button
                    type="button"
                    className="ml-2 text-xs text-red-400 hover:underline"
                    onClick={() => {
                      if (confirm("Eliminare questo livello?")) delMut.mutate(r.id)
                    }}
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PersonaleTab({
  rows,
  onError,
  onDone,
}: {
  rows: LpagaPersonale[]
  onError: (s: string) => void
  onDone: () => void
}) {
  const [nome, setNome] = useState("")
  const [iban, setIban] = useState("")
  const createMut = useMutation({
    mutationFn: () => libroPagaApi.createPersonale({ nome, iban, attivo: true }),
    onSuccess: () => {
      setNome("")
      setIban("")
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const patchMut = useMutation({
    mutationFn: ({ id, attivo }: { id: string; attivo: boolean }) => libroPagaApi.patchPersonale(id, { attivo }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => libroPagaApi.deletePersonale(id),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  return (
    <div className="mt-4 space-y-4">
      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          createMut.mutate()
        }}
      >
        <label className="grid gap-1 text-xs text-zinc-400">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} required />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          IBAN (facoltativo)
          <input value={iban} onChange={(e) => setIban(e.target.value)} className={`${inputCls} w-64`} />
        </label>
        <button type="submit" className={btnAmber} disabled={createMut.isPending}>
          Aggiungi persona
        </button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">IBAN</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  Nessuna persona. Aggiungi gli istruttori che devono essere pagati.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{r.nome}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.iban ?? "—"}</td>
                <td className="px-3 py-2">{r.attivo ? "Attivo" : "Disattivo"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => patchMut.mutate({ id: r.id, attivo: !r.attivo })}
                  >
                    {r.attivo ? "Disattiva" : "Riattiva"}
                  </button>
                  <button
                    type="button"
                    className="ml-2 text-xs text-red-400 hover:underline"
                    onClick={() => {
                      if (confirm("Eliminare questa persona?")) delMut.mutate(r.id)
                    }}
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
