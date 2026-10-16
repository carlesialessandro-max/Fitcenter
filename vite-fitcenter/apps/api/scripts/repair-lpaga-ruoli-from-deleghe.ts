/**
 * Ripristina ruolo manager da libro-paga-convalida.json (chiavi deleghe).
 * Admin: npx tsx scripts/repair-lpaga-ruoli-from-deleghe.ts --admin user1,user2
 */
import "dotenv/config"
import { repairLibroPagaRuoliFromDeleghe } from "../src/services/libro-paga-repair.js"

const admins = (() => {
  const i = process.argv.indexOf("--admin")
  if (i < 0) return []
  return String(process.argv[i + 1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
})()

const r = await repairLibroPagaRuoliFromDeleghe({ adminUsernames: admins })
console.log(`Responsabili: ${r.managers}, admin: ${r.admins}, invariati: ${r.skipped}`)
