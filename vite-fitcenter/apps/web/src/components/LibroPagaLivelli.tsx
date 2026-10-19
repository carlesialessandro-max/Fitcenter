import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import type { LibroPagaSnapshot, LpagaLivello, LpagaTreeNode } from "@/api/libroPaga"

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function Tree({ nodes, depth = 0 }: { nodes: LpagaTreeNode[]; depth?: number }) {
  return (
    <ul className={depth ? "ml-4 border-l border-zinc-800 pl-3" : ""}>
      {nodes.map((n) => (
        <li key={n.id} className="py-0.5 text-sm text-zinc-300">
          <span
            className={
              n.attivo === false
                ? "text-zinc-600 line-through"
                : n.retribuibile
                  ? "text-zinc-200"
                  : "italic text-zinc-400"
            }
          >
            {n.nome}
          </span>
          {n.attivo === false ? <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-600">nascosto</span> : null}
          {n.children?.length ? <Tree nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  )
}

export function LibroPagaLivelliTab({
  data,
  q,
  setQ,
  onError,
  onDone,
  createLivello,
  patchLivello,
  deleteLivello,
  showTreeDefault = false,
}: {
  data: Pick<LibroPagaSnapshot, "livelli" | "tree">
  q: string
  setQ: (s: string) => void
  onError: (s: string) => void
  onDone: () => void
  createLivello: (body: {
    nome: string
    parentId?: string
    retribuzione: number
    fissa: boolean
    retribuibile?: boolean
    attivo?: boolean
  }) => Promise<unknown>
  patchLivello: (id: string, body: Partial<LpagaLivello>) => Promise<unknown>
  deleteLivello: (id: string) => Promise<unknown>
  showTreeDefault?: boolean
}) {
  const [showTree, setShowTree] = useState(showTreeDefault)
  const [nome, setNome] = useState("")
  const [parentId, setParentId] = useState("")
  const [retrib, setRetrib] = useState("")
  const [fissa, setFissa] = useState(false)
  const [retribuibile, setRetribuibile] = useState(true)
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return data.livelli.filter((l) => !n || `${l.nome} ${l.dominio} ${l.parentNome}`.toLowerCase().includes(n))
  }, [data.livelli, q])
  const createMut = useMutation({
    mutationFn: () =>
      createLivello({
        nome,
        parentId: parentId || undefined,
        retribuzione: Number(retrib.replace(",", ".") || 0),
        fissa,
        retribuibile,
        attivo: true,
      }),
    onSuccess: () => {
      setNome("")
      setRetrib("")
      onDone()
    },
    onError: (e: Error) => onError(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => deleteLivello(id),
    onSuccess: onDone,
    onError: (e: Error) =>
      onError(
        /usato da turni/i.test(e.message)
          ? `${e.message}. Puoi nasconderlo così non si usa più per i nuovi turni.`
          : e.message,
      ),
  })
  const hideMut = useMutation({
    mutationFn: ({ id, attivo }: { id: string; attivo: boolean }) => patchLivello(id, { attivo }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca livello…" className={inputCls} />
        <button type="button" className={btnGhost} onClick={() => setShowTree((v) => !v)}>
          {showTree ? "Nascondi gerarchia" : "Visualizza gerarchia"}
        </button>
      </div>
      {showTree && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">Gerarchia livelli</h2>
          {data.tree?.length ? (
            <Tree nodes={data.tree} />
          ) : (
            <p className="text-sm text-zinc-500">Nessun livello in anagrafica.</p>
          )}
        </div>
      )}
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
          Padre / dominio
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
            <option value="">(radice)</option>
            {data.livelli.map((l: LpagaLivello) => (
              <option key={l.id} value={l.id}>
                {l.nome}
                {l.attivo === false ? " (nascosto)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Paga €
          <input value={retrib} onChange={(e) => setRetrib(e.target.value)} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={retribuibile} onChange={(e) => setRetribuibile(e.target.checked)} />
          Retribuibile
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={fissa} onChange={(e) => setFissa(e.target.checked)} />
          Fissa
        </label>
        <button type="submit" className={btnAmber} disabled={createMut.isPending}>
          Aggiungi livello
        </button>
      </form>
      <p className="text-xs text-zinc-500">
        Se un livello è usato da turni esistenti non si può eliminare: nascondilo. Resta nello storico, ma non compare più
        tra le mansioni per i nuovi turni.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Dominio</th>
              <th className="px-3 py-2">Retribuibile</th>
              <th className="px-3 py-2 text-right">Paga</th>
              <th className="px-3 py-2">Oraria/Fissa</th>
              <th className="px-3 py-2">Statistiche</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-zinc-800 ${r.attivo === false ? "text-zinc-500" : "text-zinc-200"}`}>
                <td className="px-3 py-2">
                  {r.nome}
                  {r.attivo === false ? (
                    <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                      nascosto
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-zinc-400">{r.dominio}</td>
                <td className="px-3 py-2">{r.retribuibile ? "SI" : "NO"}</td>
                <td className="px-3 py-2 text-right">{r.retribuibile ? eur(r.retribuzione) : "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{r.retribuibile ? (r.fissa ? "fissa" : "oraria") : "—"}</td>
                <td className="px-3 py-2">{r.statistica ? "SI" : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      className="text-xs text-amber-300 hover:underline"
                      disabled={hideMut.isPending}
                      onClick={() => {
                        const next = r.attivo === false
                        if (
                          !next &&
                          !window.confirm(
                            `Nascondere «${r.nome}»? I turni già inseriti restano, ma il livello non si potrà più usare per i nuovi turni.`,
                          )
                        ) {
                          return
                        }
                        hideMut.mutate({ id: r.id, attivo: next })
                      }}
                    >
                      {r.attivo === false ? "Mostra" : "Nascondi"}
                    </button>
                    <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => delMut.mutate(r.id)}>
                      Elimina
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={7}>
                  Nessun livello trovato.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
