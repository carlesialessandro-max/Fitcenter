import type { LpagaLivello } from "../api/libroPaga"

export function LibroPagaRepartiMulti({
  reparti,
  value,
  onChange,
}: {
  reparti: LpagaLivello[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  if (!reparti.length) {
    return <p className="text-xs text-zinc-500">Nessun reparto disponibile.</p>
  }
  return (
    <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/40 p-2">
      {reparti.map((l) => {
        const checked = value.includes(l.id)
        const label = l.dominio && l.dominio !== l.nome ? `${l.dominio} · ${l.nome}` : l.nome
        return (
          <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 text-sm text-zinc-300 hover:bg-zinc-800/50">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                onChange(checked ? value.filter((x) => x !== l.id) : [...value, l.id])
              }}
              className="accent-amber-500"
            />
            {label}
          </label>
        )
      })}
    </div>
  )
}

export function livelloIdsFromPersona(p?: { livelloId?: string; livelloIds?: string[] }): string[] {
  if (p?.livelloIds?.length) return [...p.livelloIds]
  if (p?.livelloId) return [p.livelloId]
  return []
}

export function livelloAlberoUnionUi(livelli: LpagaLivello[], rootIds: string[]): Set<string> {
  const ids = new Set<string>()
  for (const rootId of rootIds) {
    if (!rootId) continue
    ids.add(rootId)
    let added = true
    while (added) {
      added = false
      for (const l of livelli) {
        if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
          ids.add(l.id)
          added = true
        }
      }
    }
  }
  return ids
}
