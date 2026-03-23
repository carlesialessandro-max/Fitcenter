/**
 * Script one-shot: svuota i lead esistenti e inserisce i 18 lead dal foglio (Facebook Ads / campagne).
 * Eseguire dalla root del monorepo: pnpm exec tsx apps/api/scripts/seed-leads.ts
 * oppure da apps/api: pnpm exec tsx scripts/seed-leads.ts
 */
import { store } from "../src/store/leads.js"
import { SEED_LEADS } from "./seed-leads-data.js"

const before = store.list().length
store.clearAll()
const created = store.createMany(SEED_LEADS)
console.log(`Lead sostituiti: ${before} → ${created.length} (inseriti ${SEED_LEADS.length})`)
process.exit(0)
