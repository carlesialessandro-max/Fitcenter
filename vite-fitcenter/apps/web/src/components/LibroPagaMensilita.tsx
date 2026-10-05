import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import type { LibroPagaSnapshot, LpagaMensilitaRow, LpagaPersonale, LpagaTurnoRow } from "@/api/libroPaga"

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function meseLabel(mese: string): string {
  const [ys, ms] = mese.split("-")
  const y = Number(ys)
  const m = Number(ms)
  if (!y || !m) return mese
  return new Date(y, m - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" })
}

function ruoloLabel(r: string): string {
  if (r === "admin") return "Amministratore"
  if (r === "manager") return "Responsabile"
  return "Istruttore"
}

type Pannello = { kind: "dettaglio" | "modifica"; personaleId: string }

export function LibroPagaMensilitaTab({
  data,
  mese,
  canEdit,
  hideIban,
  onSave,
  onError,
  onDone,
}: {
  data: LibroPagaSnapshot
  mese: string
  canEdit: (personaleId: string) => boolean
  hideIban?: boolean
  onSave: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) => Promise<unknown>
  onError: (s: string) => void
  onDone: () => void
}) {
  const [pannello, setPannello] = useState<Pannello | null>(null)
  const [q, setQ] = useState("")
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return data.mensilita.filter((r) => !n || r.personaleNome.toLowerCase().includes(n))
  }, [data.mensilita, q])

  const sel = pannello ? data.mensilita.find((r) => r.personaleId === pannello.personaleId) : undefined
  const persona = pannello ? data.personale.find((p) => p.id === pannello.personaleId) : undefined
  const lezioni = pannello
    ? data.turni.filter((t) => t.personaleId === pannello.personaleId).sort((a, b) => b.giorno.localeCompare(a.giorno))
    : []

  return (
    <div className="mt-4 space-y-4">
      {pannello?.kind === "modifica" && sel && canEdit(sel.personaleId) && (
        <ModificaMese
          row={sel}
          mese={mese}
          onClose={() => setPannello(null)}
          onSave={onSave}
          onError={onError}
          onDone={() => {
            setPannello(null)
            onDone()
          }}
        />
      )}
      {pannello?.kind === "dettaglio" && sel && (
        <DettaglioMese
          row={sel}
          persona={persona}
          mese={mese}
          lezioni={lezioni}
          hideIban={hideIban}
          onClose={() => setPannello(null)}
        />
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nominativo…" className={inputCls} />
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nominativo</th>
              <th className="px-3 py-2 text-right">Importo totale</th>
              <th className="px-3 py-2">Note correzione</th>
              <th className="px-3 py-2 text-right">Importo bonifico</th>
              <th className="px-3 py-2 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.personaleId} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-3 py-2">{r.personaleNome}</td>
                <td className="px-3 py-2 text-right">{eur(r.importo)}</td>
                <td className="px-3 py-2 text-zinc-400">{r.nota || "—"}</td>
                <td className="px-3 py-2 text-right">{eur(r.bonifico)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {canEdit(r.personaleId) && (
                    <button
                      type="button"
                      className={`${btnGhost} mr-1`}
                      title="Modifica"
                      onClick={() => setPannello({ kind: "modifica", personaleId: r.personaleId })}
                    >
                      Modifica
                    </button>
                  )}
                  <button
                    type="button"
                    className={btnGhost}
                    title="Dettagli"
                    onClick={() => setPannello({ kind: "dettaglio", personaleId: r.personaleId })}
                  >
                    Dettagli
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={5}>
                  Nessuna mensilità in questo mese.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DettaglioMese({
  row,
  persona,
  mese,
  lezioni,
  hideIban,
  onClose,
}: {
  row: LpagaMensilitaRow
  persona?: LpagaPersonale
  mese: string
  lezioni: LpagaTurnoRow[]
  hideIban?: boolean
  onClose: () => void
}) {
  const year = mese.slice(0, 4)
  const iban = hideIban ? "" : persona?.iban || row.iban
  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Dettaglio mese · {meseLabel(mese)}</h2>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{row.personaleNome}</p>
        </div>
        <button type="button" className={btnGhost} onClick={onClose}>
          Chiudi
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Cognome</dt>
          <dd>{persona?.cognome ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Nome</dt>
          <dd>{persona?.nome ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Username</dt>
          <dd className="font-mono text-xs text-zinc-400">{persona?.username ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Ruolo</dt>
          <dd>{ruoloLabel(persona?.ruolo ?? "user")}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Tot. progr. {year}</dt>
          <dd>{eur(row.totAnno ?? row.importo)}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Scad. contratto</dt>
          <dd>{fmtDateIt(persona?.contratto)}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">IBAN</dt>
          <dd className="font-mono text-xs">{iban?.trim() ? iban : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Importo mese</dt>
          <dd>{eur(row.importo)}</dd>
        </div>
      </dl>
      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-300">Lezioni / turni del mese</h3>
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Mansione</th>
                <th className="px-3 py-2">Creazione</th>
                <th className="px-3 py-2 text-right">Valore</th>
                <th className="px-3 py-2 text-right">Importo</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {lezioni.map((t) => (
                <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(t.giorno)}</td>
                  <td className="px-3 py-2">{t.livelloNome}</td>
                  <td className="px-3 py-2 text-zinc-400">{fmtDateIt(t.createdAt)}</td>
                  <td className="px-3 py-2 text-right">{t.quantita}</td>
                  <td className="px-3 py-2 text-right">{eur(t.importo)}</td>
                  <td className="px-3 py-2 text-zinc-400">{t.note ?? ""}</td>
                </tr>
              ))}
              {!lezioni.length && (
                <tr>
                  <td className="px-3 py-6 text-zinc-500" colSpan={6}>
                    Nessuna lezione in questo mese.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ModificaMese({
  row,
  mese,
  onClose,
  onSave,
  onError,
  onDone,
}: {
  row: LpagaMensilitaRow
  mese: string
  onClose: () => void
  onSave: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) => Promise<unknown>
  onError: (s: string) => void
  onDone: () => void
}) {
  const [bonifico, setBonifico] = useState(String(row.bonifico))
  const [nota, setNota] = useState(row.nota)
  const mut = useMutation({
    mutationFn: () =>
      onSave({
        personaleId: row.personaleId,
        mese,
        bonifico: Number(String(bonifico).replace(",", ".")),
        nota,
        chiuso: row.chiuso,
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  return (
    <form
      className="max-w-xl space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        mut.mutate()
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Correzione mensilità</h2>
        <button type="button" className={btnGhost} onClick={onClose}>
          Annulla
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-zinc-400">
          Nominativo
          <input value={row.personaleNome} disabled className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Data
          <input value={meseLabel(mese)} disabled className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Importo totale
          <input value={eur(row.importo)} disabled className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Importo bonifico
          <input value={bonifico} onChange={(e) => setBonifico(e.target.value)} className={inputCls} required />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400 sm:col-span-2">
          Note correzione
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={40}
            placeholder="Info correzione"
            className={inputCls}
          />
        </label>
      </div>
      <button type="submit" className={btnAmber} disabled={mut.isPending}>
        {mut.isPending ? "Salvataggio…" : "Salva"}
      </button>
    </form>
  )
}
