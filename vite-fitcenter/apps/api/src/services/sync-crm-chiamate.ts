import type { CrmAppuntamentoRow } from "./gestionale-sql.js"
import { store as chiamateStore } from "../store/chiamate.js"

/** Importa telefonate evase dal gestionale nel registro locale (chiamate.json). */
export function syncCrmTelefonateToStore(rows: CrmAppuntamentoRow[], consulenteLabel: string): number {
  return chiamateStore.importFromCrm(rows, consulenteLabel)
}
