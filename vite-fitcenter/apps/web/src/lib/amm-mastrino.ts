import * as XLSX from "xlsx"
import type { AmmQuota, AmmReparto } from "@/api/amministrazione"
import { parseExcelDate } from "@/lib/amm-excel"

export type AmmMastrinoPreview = {
  nominativo: string
  mese: string
  descrizione: string
  totale: number
  quote: AmmQuota[]
  errore?: string
  riga: number
}

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

const COLS: Record<string, string[]> = {
  nominativo: ["nominativo", "dipendente", "cognome nome", "anagrafica", "nome", "soggetto"],
  mese: ["mese", "competenza", "periodo", "mese competenza"],
  data: ["data", "data documento", "data registrazione"],
  descrizione: ["descrizione", "causale", "voce", "conto", "note"],
  totale: ["importo", "lordo", "costo azienda", "dare", "retribuzione", "totale", "stipendio"],
  reparto: ["reparto", "centro di costo", "cdc", "macro"],
}

function findCol(keys: string[], aliases: string[]): string | undefined {
  const nk = keys.map((k) => ({ k, n: normKey(k) }))
  for (const a of aliases) {
    const hit = nk.find((x) => x.n === a || x.n.includes(a))
    if (hit) return hit.k
  }
  return undefined
}

function cell(row: Record<string, unknown>, key?: string): string {
  if (!key) return ""
  const v = row[key]
  if (v == null) return ""
  if (v instanceof Date) return parseExcelDate(v.toISOString().slice(0, 10)) || v.toISOString().slice(0, 10)
  return String(v).trim()
}

function parseImporto(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/€/g, "").replace(/eur/gi, "")
  if (!s) return null
  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  let n: number
  if (lastComma > lastDot) n = Number(s.replace(/\./g, "").replace(",", "."))
  else if (lastDot > lastComma) n = Number(s.replace(/,/g, ""))
  else n = Number(s.replace(",", "."))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export function parseMese(raw: string): string {
  const s = raw.trim()
  if (/^\d{4}-\d{2}$/.test(s)) return s
  const iso = parseExcelDate(s)
  if (iso) return iso.slice(0, 7)
  const my = /^(\d{1,2})[./-](\d{4})$/.exec(s)
  if (my) {
    const mo = Number(my[1])
    if (mo >= 1 && mo <= 12) return `${my[2]}-${String(mo).padStart(2, "0")}`
  }
  return ""
}

function matchReparto(reparti: AmmReparto[], raw: string): AmmReparto | undefined {
  const n = normKey(raw)
  if (!n) return undefined
  const attivi = reparti.filter((r) => r.attivo)
  if (/\b(desk|reception|segreter|amminist|direzion|ufficio)\b/.test(n)) {
    return attivi.find((r) => r.id === "amministrazione-uffici")
  }
  if (/\bpuliz/.test(n)) return attivi.find((r) => r.id === "pulizie")
  if (/\bmanutenz/.test(n)) return attivi.find((r) => r.id === "manutenzione-impianti")
  if (/\b(marketing|pubblicit)/.test(n)) return attivi.find((r) => r.id === "marketing-pubblicita")
  if (/\b(commercial|vendit)/.test(n)) return attivi.find((r) => r.id === "commerciale-vendite")
  return (
    attivi.find((r) => r.id === raw.trim() || r.codice === n.replace(/\s/g, "-")) ??
    attivi.find((r) => normKey(r.nome) === n) ??
    attivi.find((r) => normKey(r.nome).includes(n) || n.includes(normKey(r.nome)))
  )
}

export const AMM_MASTRINO_HEADERS = ["Mese", "Nominativo", "Importo", "Reparto", "Descrizione"]

export function downloadAmmMastrinoTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    AMM_MASTRINO_HEADERS,
    ["2026-10", "Rossi Maria", 2450, "Amministrazione e uffici", "Busta paga ottobre"],
    ["2026-10", "Bianchi Luca", 1800, "Pulizie", "Busta paga ottobre"],
  ])
  XLSX.utils.book_append_sheet(wb, ws, "Buste paga")
  XLSX.writeFile(wb, "modello-mastrino-stipendi.xlsx")
}

export function parseAmmMastrino(file: ArrayBuffer, reparti: AmmReparto[]): AmmMastrinoPreview[] {
  const wb = XLSX.read(file, { type: "array", cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""]
  if (!sheet) return []
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
  if (!json.length) return []
  const keys = Object.keys(json[0] ?? {})
  const col = {
    nominativo: findCol(keys, COLS.nominativo),
    mese: findCol(keys, COLS.mese),
    data: findCol(keys, COLS.data),
    descrizione: findCol(keys, COLS.descrizione),
    totale: findCol(keys, COLS.totale),
    reparto: findCol(keys, COLS.reparto),
  }
  const fallback = reparti.find((r) => r.id === "amministrazione-uffici") ?? reparti.find((r) => r.attivo)
  const out: AmmMastrinoPreview[] = []
  json.forEach((row, i) => {
    const nominativo = cell(row, col.nominativo)
    const meseRaw = cell(row, col.mese) || cell(row, col.data)
    const mese = parseMese(meseRaw)
    const descrizione = cell(row, col.descrizione)
    const totale = parseImporto(cell(row, col.totale))
    const repartoRaw = cell(row, col.reparto)
    const hit = matchReparto(reparti, repartoRaw) ?? fallback
    const riga = i + 2
    if (!nominativo && totale == null && !mese) return
    let errore: string | undefined
    if (!nominativo) errore = "Nominativo mancante"
    else if (totale == null) errore = "Importo mancante"
    else if (!mese) errore = "Mese non valido (AAAA-MM o GG/MM/AAAA)"
    else if (!hit) errore = "Reparto non riconosciuto"
    out.push({
      nominativo,
      mese,
      descrizione: descrizione || "Busta paga",
      totale: totale ?? 0,
      quote: hit ? [{ repartoId: hit.id, percentuale: 100 }] : [],
      errore,
      riga,
    })
  })
  return out
}
