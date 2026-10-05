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

/** Istruttore: solo sé. Responsabile: persone del sottoalbero del suo livello (es. Desk, piscina). Admin: tutti. */
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

export function livelliInseribili(
  viewer: Pick<LpagaPersonale, "ruolo" | "livelloId">,
  livelli: LpagaLivello[]
): LpagaLivello[] {
  const retribuibili = livelli.filter((l) => l.attivo && l.retribuibile)
  if (viewer.ruolo === "admin" || !viewer.livelloId) return retribuibili
  const tree = livelloSottoAlbero(livelli, viewer.livelloId)
  const scoped = retribuibili.filter((l) => tree.has(l.id))
  return scoped.length ? scoped : retribuibili
}
