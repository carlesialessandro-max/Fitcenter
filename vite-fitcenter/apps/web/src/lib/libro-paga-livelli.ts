type LivelloTurno = {
  id: string
  nome: string
  parentId?: string
  retribuibile?: boolean
  attivo?: boolean
}

function isRepartoRoot(l: Pick<LivelloTurno, "parentId">): boolean {
  const p = (l.parentId ?? "").trim()
  return !p || p === "0"
}

function sottoAlbero(livelli: LivelloTurno[], rootId: string): Set<string> {
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

/** Foglia retribuibile, oppure cartella usata come sede di lavoro (es. Scuole Esterne). */
export function mansioniInseribiliTurno<T extends LivelloTurno>(livelli: T[]): T[] {
  const attivi = livelli.filter((l) => l.attivo !== false)
  const retr = new Set(attivi.filter((l) => l.retribuibile).map((l) => l.id))
  return attivi.filter((l) => {
    if (l.retribuibile) return true
    if (isRepartoRoot(l)) return false
    const tree = sottoAlbero(attivi, l.id)
    return ![...tree].some((id) => id !== l.id && retr.has(id))
  })
}

export function livelloIdsAssegnati(
  me: { livelloId?: string; livelloIds?: string[] },
  livelli: LivelloTurno[]
): Set<string> {
  const roots = [...new Set([...(me.livelloIds ?? []), ...(me.livelloId ? [me.livelloId] : [])].map((x) => x.trim()).filter(Boolean))]
  const out = new Set<string>()
  for (const r of roots) {
    for (const id of sottoAlbero(livelli, r)) out.add(id)
  }
  return out
}

export function filtraAlberoLivelli<T extends { id: string; children?: T[] }>(nodes: T[] | undefined, allowed: Set<string>): T[] {
  if (!nodes?.length) return []
  const out: T[] = []
  for (const n of nodes) {
    const kids = filtraAlberoLivelli(n.children, allowed)
    if (allowed.has(n.id) || kids.length) {
      out.push({ ...n, ...(kids.length ? { children: kids } : { children: undefined }) })
    }
  }
  return out
}

/** In area personale: mansioni proprie (assegnate + sottoalbero), non tutte le deleghe del team. */
export function mansioniTurnoProprio<T extends LivelloTurno>(
  me: { livelloId?: string; livelloIds?: string[] },
  inseribili: T[],
  tutti: LivelloTurno[]
): T[] {
  const roots = [...new Set([...(me.livelloIds ?? []), ...(me.livelloId ? [me.livelloId] : [])].map((x) => x.trim()).filter(Boolean))]
  if (!roots.length) return inseribili
  const allowed = new Set<string>()
  for (const r of roots) {
    for (const id of sottoAlbero(tutti, r)) allowed.add(id)
  }
  const own = inseribili.filter((l) => allowed.has(l.id))
  return own.length ? own : inseribili
}
