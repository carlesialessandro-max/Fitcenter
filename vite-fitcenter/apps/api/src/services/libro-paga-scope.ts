import type { LpagaLivello, LpagaPersonale } from "../store/libro-paga-db.js"

export function personaleLivelloRadici(p: Pick<LpagaPersonale, "livelloId" | "livelloIds">): string[] {
  const ids = [...(p.livelloIds ?? []), ...(p.livelloId ? [p.livelloId] : [])].map((x) => x.trim()).filter(Boolean)
  return [...new Set(ids)]
}

function isRepartoRoot(l: LpagaLivello): boolean {
  const p = (l.parentId ?? "").trim()
  return !p || p === "0"
}

function repartoRootId(livelli: LpagaLivello[], id: string): string {
  const byId = new Map(livelli.map((l) => [l.id, l]))
  let cur = byId.get(id)
  let guard = 0
  while (cur && guard++ < 40) {
    if (isRepartoRoot(cur)) return cur.id
    const pid = (cur.parentId ?? "").trim()
    if (!pid) return cur.id
    cur = byId.get(pid)
  }
  return id
}

/** Primo antenato attivo (salta livelli disattivati nella catena parentId). */
function nearestActiveAncestorId(
  livelli: LpagaLivello[],
  attivoIds: Set<string>,
  nodeId: string
): string | undefined {
  const byId = new Map(livelli.map((l) => [l.id, l]))
  let cur = byId.get(nodeId)
  let guard = 0
  while (cur && guard++ < 50) {
    const pid = (cur.parentId ?? "").trim()
    if (!pid || pid === "0") return undefined
    if (attivoIds.has(pid)) return pid
    cur = byId.get(pid)
  }
  return undefined
}

function livelloChildrenScoped(
  livelli: LpagaLivello[],
  attivi: LpagaLivello[],
  attivoIds: Set<string>,
  parentId: string
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const l of attivi) {
    if ((l.parentId ?? "").trim() === parentId && !seen.has(l.id)) {
      out.push(l.id)
      seen.add(l.id)
    }
  }
  for (const l of attivi) {
    if (seen.has(l.id)) continue
    if ((l.parentId ?? "").trim() === parentId) continue
    if (nearestActiveAncestorId(livelli, attivoIds, l.id) === parentId) {
      out.push(l.id)
      seen.add(l.id)
    }
  }
  return out
}

/** Unione sottoalberi + mansioni agganciate saltando padri disattivati (come picker reparti). */
export function livelloAlberoUnion(livelli: LpagaLivello[], rootIds: string[]): Set<string> {
  const attivi = livelli.filter((l) => l.attivo !== false)
  const attivoIds = new Set(attivi.map((l) => l.id))
  const roots = [...new Set(rootIds.map((x) => x.trim()).filter(Boolean))]
  const out = new Set<string>()
  for (const id of roots) {
    for (const x of livelloSottoAlbero(livelli, id)) out.add(x)
  }
  for (const r of roots) out.add(r)

  let added = true
  while (added) {
    added = false
    for (const id of out) {
      for (const cid of livelloChildrenScoped(livelli, attivi, attivoIds, id)) {
        if (!out.has(cid)) {
          out.add(cid)
          added = true
        }
      }
    }
  }

  for (const r of roots) {
    const rootL = livelli.find((l) => l.id === r)
    if (rootL && !isRepartoRoot(rootL)) continue
    for (const l of attivi) {
      if (out.has(l.id)) continue
      if (!l.retribuibile) continue
      if (repartoRootId(livelli, l.id) !== r) continue
      if (livelloSottoAlbero(livelli, r).has(l.id)) continue
      out.add(l.id)
    }
  }

  return out
}

export function livelloSottoAlbero(livelli: LpagaLivello[], rootId: string): Set<string> {
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

export function radiciReparto(livelli: LpagaLivello[]): { id: string; nome: string }[] {
  return livelli
    .filter((l) => !l.parentId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
    .map((l) => ({ id: l.id, nome: l.nome }))
}

/** Mansione visibile se risale (anche via padri disattivati) a un nodo già nello scope o a una radice assegnata. */
export function expandScopeTree(livelli: LpagaLivello[], roots: string[], base: Set<string>): Set<string> {
  const byId = new Map(livelli.map((l) => [l.id, l]))
  const rootSet = new Set(roots.map((x) => x.trim()).filter(Boolean))
  const out = new Set(base)
  for (const l of livelli) {
    if (out.has(l.id)) continue
    let cur: LpagaLivello | undefined = l
    let guard = 0
    while (cur && guard++ < 60) {
      if (rootSet.has(cur.id) || out.has(cur.id)) {
        out.add(l.id)
        break
      }
      const pid = (cur.parentId ?? "").trim()
      if (!pid || pid === "0") break
      cur = byId.get(pid)
    }
  }
  return out
}

/** Albero mansioni del viewer (responsabile) o del reparto scelto (admin). */
export function resolveLivelloTree(
  viewer: Pick<LpagaPersonale, "id" | "ruolo" | "livelloId" | "livelloIds">,
  livelli: LpagaLivello[],
  repartoId?: string
): Set<string> | undefined {
  if (viewer.ruolo === "manager") {
    const roots = personaleLivelloRadici(viewer)
    if (!roots.length) return new Set()
    const base = livelloAlberoUnion(livelli, roots)
    return expandScopeTree(livelli, roots, base)
  }
  if (viewer.ruolo === "admin" && repartoId) {
    return livelloSottoAlbero(livelli, repartoId)
  }
  return undefined
}

/** Turni visibili: istruttore = propri; responsabile/admin-reparto = mansione nel sottoalbero. */
export function turnoNelScope(
  t: { personaleId: string; livelloId: string },
  opts: { viewerId: string; ruolo: LpagaPersonale["ruolo"]; tree?: Set<string> }
): boolean {
  if (opts.ruolo === "user") return t.personaleId === opts.viewerId
  if (opts.tree) return opts.tree.has(t.livelloId)
  return true
}

/** Istruttore: solo sé. Responsabile: persone assegnate al sottoalbero. Admin: tutti. */
export function personaleVisibile(
  viewer: Pick<LpagaPersonale, "id" | "ruolo" | "livelloId" | "livelloIds">,
  personale: LpagaPersonale[],
  livelli: LpagaLivello[]
): Set<string> {
  if (viewer.ruolo === "admin") return new Set(personale.map((p) => p.id))
  const roots = personaleLivelloRadici(viewer)
  if (viewer.ruolo === "user" || !roots.length) return new Set([viewer.id])
  const tree = alberoAssegnabileAnagrafica(viewer, livelli)
  const ids = new Set<string>([viewer.id])
  for (const p of personale) {
    if (personaleLivelloRadici(p).some((id) => tree.has(id))) ids.add(p.id)
  }
  return ids
}

/**
 * Chi può essere convalidato: anagrafica nel sottoalbero + chi ha turni
 * sulla mansione del responsabile (es. Baldi in palestra ma anagrafato altrove).
 */
export function personaleRaggiungibile(
  viewer: Pick<LpagaPersonale, "id" | "ruolo" | "livelloId" | "livelloIds">,
  personale: LpagaPersonale[],
  livelli: LpagaLivello[],
  turni: { personaleId: string; livelloId: string }[],
  extraTree?: Set<string>
): Set<string> {
  if (viewer.ruolo === "admin") return new Set(personale.map((p) => p.id))
  const vis = personaleVisibile(viewer, personale, livelli)
  const mgrRoots = viewer.ruolo === "manager" ? personaleLivelloRadici(viewer) : []
  const tree =
    extraTree ?? (mgrRoots.length ? alberoAssegnabileAnagrafica(viewer, livelli) : undefined)
  if (!tree?.size) return vis
  const ids = new Set(vis)
  for (const p of personale) {
    if (personaleLivelloRadici(p).some((id) => tree.has(id))) ids.add(p.id)
  }
  for (const t of turni) {
    if (tree.has(t.livelloId)) ids.add(t.personaleId)
  }
  return ids
}

export function livelliInseribili(
  viewer: Pick<LpagaPersonale, "ruolo" | "livelloId" | "livelloIds">,
  livelli: LpagaLivello[],
  tree?: Set<string>
): LpagaLivello[] {
  const retribuibili = livelli.filter((l) => l.attivo && l.retribuibile)
  const roots = personaleLivelloRadici(viewer)
  const scope = tree ?? (viewer.ruolo === "admin" || !roots.length ? undefined : livelloAlberoUnion(livelli, roots))
  if (!scope) return retribuibili
  const scoped = retribuibili.filter((l) => scope.has(l.id))
  return scoped
}

/** Albero (reparti + mansioni) in cui il viewer può assegnare anagrafiche. */
export function alberoAssegnabileAnagrafica(
  viewer: Pick<LpagaPersonale, "ruolo" | "livelloId" | "livelloIds">,
  livelli: LpagaLivello[]
): Set<string> {
  const attivi = livelli.filter((l) => l.attivo !== false)
  if (viewer.ruolo === "admin") return new Set(attivi.map((l) => l.id))
  const roots = personaleLivelloRadici(viewer)
  if (!roots.length) return new Set()
  return expandScopeTree(livelli, roots, livelloAlberoUnion(livelli, roots))
}

/** Nodi (reparti e mansioni) in cui il viewer può creare/modificare anagrafiche. */
export function livelliAssegnabiliAnagrafica(
  viewer: Pick<LpagaPersonale, "ruolo" | "livelloId" | "livelloIds">,
  livelli: LpagaLivello[]
): LpagaLivello[] {
  const attivi = livelli.filter((l) => l.attivo !== false)
  if (viewer.ruolo === "admin") return attivi
  const tree = alberoAssegnabileAnagrafica(viewer, livelli)
  const inTree = attivi.filter((l) => tree.has(l.id))
  if (inTree.length) return inTree
  const roots = personaleLivelloRadici(viewer)
  return attivi.filter((l) => roots.includes(l.id))
}
