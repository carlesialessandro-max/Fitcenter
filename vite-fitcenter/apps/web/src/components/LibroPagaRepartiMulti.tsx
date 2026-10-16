import { useMemo, useState } from "react"
import type { LpagaLivello } from "../api/libroPaga"

export function livelloIdsFromPersona(p?: { livelloId?: string; livelloIds?: string[] }): string[] {
  if (p?.livelloIds?.length) return [...p.livelloIds]
  if (p?.livelloId) return [p.livelloId]
  return []
}

export function livelloAlberoUnionUi(livelli: LpagaLivello[], rootIds: string[]): Set<string> {
  const ids = new Set<string>()
  for (const rootId of rootIds) {
    if (!rootId) continue
    for (const x of sottoAlberoUi(livelli, rootId)) ids.add(x)
  }
  return ids
}

export function sottoAlberoUi(livelli: LpagaLivello[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
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
  return ids
}

/** Toglie id ridondanti se un antenato è già selezionato (es. reparto intero). */
export function compattaLivelloIds(livelli: LpagaLivello[], value: string[]): string[] {
  const uniq = [...new Set(value.map((x) => x.trim()).filter(Boolean))]
  return uniq.filter((id) => {
    for (const other of uniq) {
      if (other === id) continue
      if (sottoAlberoUi(livelli, other).has(id)) return false
    }
    return true
  })
}

function isRoot(l: LpagaLivello): boolean {
  const p = (l.parentId ?? "").trim()
  return !p || p === "0"
}

function childrenOf(livelli: LpagaLivello[], parentId: string): LpagaLivello[] {
  return livelli
    .filter((l) => (l.parentId ?? "").trim() === parentId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
}

/** Mansioni retribuibili il cui parent non è nell’albero attivo (es. sotto livello disattivato) → visibili sotto il reparto. */
function childrenForPicker(all: LpagaLivello[], attivi: LpagaLivello[], parentId: string): LpagaLivello[] {
  const kids = childrenOf(attivi, parentId)
  const kidIds = new Set(kids.map((k) => k.id))
  const parent = all.find((l) => l.id === parentId)
  if (!parent || !isRoot(parent)) return kids
  const subtreeAttivo = sottoAlberoUi(attivi, parentId)
  for (const l of attivi) {
    if (!l.retribuibile) continue
    if (repartoRootId(all, l.id) !== parentId) continue
    if (subtreeAttivo.has(l.id)) continue
    if (!kidIds.has(l.id)) {
      kids.push(l)
      kidIds.add(l.id)
    }
  }
  return kids.sort((a, b) => a.nome.localeCompare(b.nome, "it"))
}

function repartoRootId(livelli: LpagaLivello[], id: string): string {
  const byId = new Map(livelli.map((l) => [l.id, l]))
  let cur = byId.get(id)
  let guard = 0
  while (cur && guard++ < 40) {
    if (isRoot(cur)) return cur.id
    const pid = (cur.parentId ?? "").trim()
    if (!pid) return cur.id
    cur = byId.get(pid)
  }
  return id
}

function repartoSubtreeIds(all: LpagaLivello[], attivi: LpagaLivello[], rootId: string): Set<string> {
  const ids = sottoAlberoUi(attivi, rootId)
  for (const l of attivi) {
    if (l.retribuibile && repartoRootId(all, l.id) === rootId) ids.add(l.id)
  }
  return ids
}

function toggleRepartoIntero(
  all: LpagaLivello[],
  attivi: LpagaLivello[],
  value: string[],
  rootId: string,
  on: boolean
): string[] {
  const subtree = repartoSubtreeIds(all, attivi, rootId)
  const without = value.filter((x) => !subtree.has(x))
  return on ? compattaLivelloIds(attivi, [...without, rootId]) : without
}

function selectionCopre(livelli: LpagaLivello[], value: string[], nodeId: string): boolean {
  return value.some((id) => sottoAlberoUi(livelli, id).has(nodeId))
}

function toggleNodo(
  all: LpagaLivello[],
  attivi: LpagaLivello[],
  value: string[],
  nodeId: string,
  on: boolean
): string[] {
  const rootId = repartoRootId(all, nodeId)
  const rootSubtree = repartoSubtreeIds(all, attivi, rootId)
  let next = value.filter((x) => x !== rootId)
  if (on) {
    if (!next.includes(nodeId)) next.push(nodeId)
  } else {
    next = next.filter((x) => x !== nodeId)
  }
  next = next.filter((x) => rootSubtree.has(x))
  return compattaLivelloIds(attivi, next)
}

function LivelloRow({
  allLivelli,
  livelli,
  node,
  depth,
  value,
  onChange,
  expanded,
  onToggleExpand,
}: {
  allLivelli: LpagaLivello[]
  livelli: LpagaLivello[]
  node: LpagaLivello
  depth: number
  value: string[]
  onChange: (ids: string[]) => void
  expanded: Set<string>
  onToggleExpand: (id: string) => void
}) {
  const root = isRoot(node)
  const kids = childrenForPicker(allLivelli, livelli, node.id)
  const hasKids = kids.length > 0
  const isExpanded = expanded.has(node.id)
  const esplicito = value.includes(node.id)
  const interoReparto = root && esplicito
  const repartoRoot = repartoRootId(allLivelli, node.id)
  const repartoInteroSelezionato = value.some((id) => {
    const n = allLivelli.find((l) => l.id === id)
    return Boolean(n && isRoot(n) && id === repartoRoot)
  })
  const coperto = repartoInteroSelezionato || selectionCopre(livelli, value, node.id)
  const checked = coperto
  const subtree = sottoAlberoUi(livelli, node.id)
  const selectedUnder = value.filter((x) => subtree.has(x) && x !== node.id)
  const indeterminate = root && !interoReparto && selectedUnder.length > 0
  const disabled = !root && coperto && !esplicito

  return (
    <div className={depth > 0 ? "ml-3 border-l border-zinc-800 pl-2" : ""}>
      <div className="flex items-start gap-1 rounded-lg py-0.5 hover:bg-zinc-800/40">
        {hasKids ? (
          <button
            type="button"
            aria-expanded={isExpanded}
            className="mt-0.5 shrink-0 rounded px-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => onToggleExpand(node.id)}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={checked}
            ref={(el) => {
              if (el) el.indeterminate = indeterminate
            }}
            disabled={disabled}
            onChange={() => {
              if (disabled) return
              if (root) onChange(toggleRepartoIntero(allLivelli, livelli, value, node.id, !interoReparto))
              else onChange(toggleNodo(allLivelli, livelli, value, node.id, !esplicito))
            }}
            className="mt-0.5 accent-amber-500 disabled:opacity-60"
          />
          <span className="min-w-0">
            <span className={node.retribuibile ? "" : hasKids ? "font-medium text-zinc-200" : "text-zinc-300"}>
              {node.nome}
            </span>
            {root ? (
              <span className="mt-0.5 block text-[11px] text-zinc-500">Intero reparto (tutte le mansioni sotto)</span>
            ) : node.retribuibile ? (
              <span className="mt-0.5 block text-[11px] text-zinc-600">Mansione</span>
            ) : null}
          </span>
        </label>
      </div>
      {hasKids && isExpanded
        ? kids.map((c) => (
            <LivelloRow
              key={c.id}
              allLivelli={allLivelli}
              livelli={livelli}
              node={c}
              depth={depth + 1}
              value={value}
              onChange={onChange}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
            />
          ))
        : null}
    </div>
  )
}

export function LibroPagaRepartiMulti({
  reparti,
  value,
  onChange,
}: {
  reparti: LpagaLivello[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const allLivelli = reparti
  const attivi = useMemo(() => allLivelli.filter((l) => l.attivo !== false), [allLivelli])
  const roots = useMemo(() => attivi.filter(isRoot).sort((a, b) => a.nome.localeCompare(b.nome, "it")), [attivi])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.map((r) => r.id)))

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!attivi.length) {
    return <p className="text-xs text-zinc-500">Nessun reparto disponibile.</p>
  }

  const compact = compattaLivelloIds(attivi, value)

  return (
    <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/40 p-2">
      <p className="text-[11px] leading-snug text-zinc-500">
        Seleziona il reparto principale per vedere tutto, oppure
        apri la gerarchia (▸) e spunta solo le mansioni ammesse (es. solo assistenza scuola nuoto sotto piscina).
      </p>
      {roots.map((r) => (
        <LivelloRow
          key={r.id}
          allLivelli={allLivelli}
          livelli={attivi}
          node={r}
          depth={0}
          value={compact}
          onChange={(ids) => onChange(compattaLivelloIds(attivi, ids))}
          expanded={expanded}
          onToggleExpand={toggleExpand}
        />
      ))}
    </div>
  )
}
