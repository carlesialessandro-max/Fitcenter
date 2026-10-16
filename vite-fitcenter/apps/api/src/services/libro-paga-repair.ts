import { listDelegheManagerIds } from "./libro-paga-convalida.js"
import { listPersonale, upsertPersonale, type LpagaRuolo } from "../store/libro-paga-db.js"

/** Ripristina ruolo manager per chi ha deleghe in convalida; opzionale lista username admin. */
export async function repairLibroPagaRuoliFromDeleghe(opts?: {
  adminUsernames?: string[]
}): Promise<{ managers: number; admins: number; skipped: number }> {
  const managerIds = new Set(listDelegheManagerIds())
  const adminUsernames = new Set(
    ["admin", ...(opts?.adminUsernames ?? [])].map((u) => u.trim().toLowerCase()).filter(Boolean)
  )
  const personale = await listPersonale()
  let managers = 0
  let admins = 0
  let skipped = 0
  for (const p of personale) {
    const un = (p.username ?? "").trim().toLowerCase()
    let next: LpagaRuolo | null = null
    if (un && adminUsernames.has(un)) next = "admin"
    else if (managerIds.has(p.id)) next = "manager"
    if (!next || p.ruolo === next) {
      skipped += 1
      continue
    }
    await upsertPersonale({
      id: p.id,
      nome: p.nome,
      cognome: p.cognome,
      username: p.username,
      ruolo: next,
      livelloId: p.livelloId,
      livelloIds: p.livelloIds,
      contratto: p.contratto,
      iban: p.iban,
      email: p.email,
      tesseramento: p.tesseramento,
      tesseramentoScadenza: p.tesseramentoScadenza,
      visitaMedica: p.visitaMedica,
      qualifiche: p.qualifiche,
      attivo: p.attivo !== false,
    })
    if (next === "admin") admins += 1
    else managers += 1
  }
  return { managers, admins, skipped }
}
