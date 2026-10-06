import type { LpagaLivello, LpagaPersonale } from "../store/libro-paga-db.js"

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

/** Albero mansioni del viewer (responsabile) o del reparto scelto (admin). */
export function resolveLivelloTree(
  viewer: Pick<LpagaPersonale, "id" | "ruolo" | "livelloId">,
  livelli: LpagaLivello[],
  repartoId?: string
): Set<string> | undefined {
  if (viewer.ruolo === "manager") {
    return viewer.livelloId ? livelloSottoAlbero(livelli, viewer.livelloId) : new Set()
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
  viewer: Pick<LpagaPersonale, "id" | "ruolo" | "livelloId">,
  personale: LpagaPersonale[],
  livelli: LpagaLivello[]
): Set<string> {
  if (viewer.ruolo === "admin") return new Set(personale.map((p) => p.id))
  if (viewer.ruolo === "user" || !viewer.livelloId) return new Set([viewer.id])
  const tree = livelloSottoAlbero(livelli, viewer.livelloId)
  const ids = new Set<string>([viewer.id])
  for (const p of personale) {
    if (p.livelloId && tree.has(p.livelloId)) ids.add(p.id)
  }
  return ids
}

/**
 * Chi può essere convalidato: anagrafica nel sottoalbero + chi ha turni
 * sulla mansione del responsabile (es. Baldi in palestra ma anagrafato altrove).
 */
export function personaleRaggiungibile(
  viewer: Pick<LpagaPersonale, "id" | "ruolo" | "livelloId">,
  personale: LpagaPersonale[],
  livelli: LpagaLivello[],
  turni: { personaleId: string; livelloId: string }[],
  extraTree?: Set<string>
): Set<string> {
  if (viewer.ruolo === "admin") return new Set(personale.map((p) => p.id))
  const vis = personaleVisibile(viewer, personale, livelli)
  const tree =
    extraTree ??
    (viewer.ruolo === "manager" && viewer.livelloId ? livelloSottoAlbero(livelli, viewer.livelloId) : undefined)
  if (!tree?.size) return vis
  const ids = new Set(vis)
  for (const p of personale) {
    if (p.livelloId && tree.has(p.livelloId)) ids.add(p.id)
  }
  for (const t of turni) {
    if (tree.has(t.livelloId)) ids.add(t.personaleId)
  }
  return ids
}

export function livelliInseribili(
  viewer: Pick<LpagaPersonale, "ruolo" | "livelloId">,
  livelli: LpagaLivello[],
  tree?: Set<string>
): LpagaLivello[] {
  const retribuibili = livelli.filter((l) => l.attivo && l.retribuibile)
  const scope = tree ?? (viewer.ruolo === "admin" || !viewer.livelloId ? undefined : livelloSottoAlbero(livelli, viewer.livelloId))
  if (!scope) return retribuibili
  const scoped = retribuibili.filter((l) => scope.has(l.id))
  return scoped
}
