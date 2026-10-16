/**
 * Ripristina ruolo manager da libro-paga-convalida.json (chiavi deleghe).
 * Username "admin" resta sempre admin.
 *
 * Da apps/api:
 *   pnpm exec tsx scripts/repair-lpaga-ruoli-from-deleghe.ts
 *   pnpm exec tsx scripts/repair-lpaga-ruoli-from-deleghe.ts --admin admin,altro
 */
import "dotenv/config"
import { repairLibroPagaRuoliFromDeleghe } from "../src/services/libro-paga-repair.js"

function parseAdmins(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ""
    if (a === "--admin") {
      out.push(...String(argv[i + 1] ?? "").split(","))
      i += 1
      continue
    }
    if (a.startsWith("--admin=")) {
      out.push(...a.slice("--admin=".length).split(","))
      continue
    }
    if (a.startsWith("--admin,")) {
      out.push(...a.slice("--admin,".length).split(","))
    }
  }
  return out.map((s) => s.trim()).filter(Boolean)
}

const admins = parseAdmins(process.argv.slice(2))

const r = await repairLibroPagaRuoliFromDeleghe({ adminUsernames: admins })
console.log(
  `SQL (dbgym) admin=${r.sqlAdmins} manager=${r.sqlManagers}; copiati sul JSON=${r.fromSql}; deleghe=${r.deleghe}; responsabili=${r.managers}; admin=${r.admins}; invariati=${r.skipped}`
)
