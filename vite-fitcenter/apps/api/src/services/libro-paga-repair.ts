import { listDelegheManagerIds } from "./libro-paga-convalida.js"
import {
  copyPersonaleHrFromSql,
  listPersonale,
  resetLibroPagaSqlReady,
  upsertPersonale,
  type LpagaRuolo,
} from "../store/libro-paga-db.js"

/** Ripristina ruoli e date corsi da SQL; poi manager da deleghe convalida. */
export async function repairLibroPagaRuoliFromDeleghe(opts?: {
  adminUsernames?: string[]
}): Promise<{
  managers: number
  admins: number
  skipped: number
  fromSql: number
  dates: number
  sqlManagers: number
  sqlAdmins: number
  sqlWithDates: number
  sqlRows: number
  deleghe: number
}> {
  resetLibroPagaSqlReady()
  const sqlHr = await copyPersonaleHrFromSql()
  resetLibroPagaSqlReady()
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
  return {
    managers,
    admins,
    skipped,
    fromSql: sqlHr.copied,
    dates: sqlHr.dates,
    sqlManagers: sqlHr.sqlManagers,
    sqlAdmins: sqlHr.sqlAdmins,
    sqlWithDates: sqlHr.sqlWithDates,
    sqlRows: sqlHr.sqlRows,
    deleghe: managerIds.size,
  }
}
