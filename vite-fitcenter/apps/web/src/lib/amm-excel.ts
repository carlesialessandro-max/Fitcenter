import * as XLSX from "xlsx"
import type { AmmQuota, AmmReparto, AmmTipoCosto } from "@/api/amministrazione"

export type AmmExcelPreview = {
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  descrizione: string
  totale: number
  tipoCosto: AmmTipoCosto
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
  fornitore: ["fornitore", "ragione sociale", "ragione sociale fornitore", "anagrafica", "supplier", "vendor"],
  numero: ["n documento", "numero documento", "n fattura", "numero fattura", "fattura", "n doc", "doc", "numero"],
  data: ["data documento", "data fattura", "data", "competenza", "data competenza"],
  descrizione: ["descrizione", "causale", "note", "oggetto"],
  totale: ["totale", "importo", "importo lordo", "totale lordo", "totale documento", "lordo"],
  tipo: ["tipo costo", "tipo", "fisso variabile"],
  reparto: ["reparto", "centro di costo", "sotto reparto", "macro area", "macro", "cdc"],
  perc: ["percentuale", "perc", "%", "quota"],
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

const MESI: Record<string, number> = {
  gen: 1,
  gennaio: 1,
  feb: 2,
  febbraio: 2,
  mar: 3,
  marzo: 3,
  apr: 4,
  aprile: 4,
  mag: 5,
  maggio: 5,
  giu: 6,
  giugno: 6,
  lug: 7,
  luglio: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  sett: 9,
  settembre: 9,
  ott: 10,
  ottobre: 10,
  nov: 11,
  novembre: 11,
  dic: 12,
  dicembre: 12,
}

function iso(d: number, mo: number, y: number): string {
  let year = y
  if (year < 100) year += 2000
  if (year < 1990 || year > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return ""
  return `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function parseExcelDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ""
  const isoA = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s)
  if (isoA) return iso(Number(isoA[3]), Number(isoA[2]), Number(isoA[1]))
  const it = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s)
  if (it) return iso(Number(it[1]), Number(it[2]), Number(it[3]))
  const named = /^(\d{1,2})\s+([a-zà]{3,12})\.?\s+(\d{2,4})$/i.exec(s)
  if (named) {
    const mo = MESI[named[2].toLowerCase()]
    if (mo) return iso(Number(named[1]), mo, Number(named[3]))
  }
  const serial = Number(s)
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000
    const dt = new Date(utc)
    return iso(dt.getUTCDate(), dt.getUTCMonth() + 1, dt.getUTCFullYear())
  }
  return ""
}

function matchReparto(reparti: AmmReparto[], raw: string): AmmReparto | undefined {
  const n = normKey(raw)
  if (!n) return undefined
  const attivi = reparti.filter((r) => r.attivo)
  return (
    attivi.find((r) => r.id === raw.trim() || r.codice === n.replace(/\s/g, "-")) ??
    attivi.find((r) => normKey(r.nome) === n) ??
    attivi.find((r) => normKey(r.nome).includes(n) || n.includes(normKey(r.nome)))
  )
}

function groupKey(r: AmmExcelPreview): string {
  return [r.fornitore.toLowerCase(), r.numeroDocumento.toLowerCase(), r.dataDocumento, r.totale].join("|")
}

export const AMM_EXCEL_HEADERS = [
  "Fornitore",
  "N. documento",
  "Data documento",
  "Descrizione",
  "Totale",
  "Tipo costo",
  "Reparto",
  "Percentuale",
]

export function downloadAmmExcelTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    AMM_EXCEL_HEADERS,
    ["Enel Energia", "FT-2026-001", "2026-10-01", "Utenza luce ottobre", 1000, "fisso", "Piscina", 60],
    ["Enel Energia", "FT-2026-001", "2026-10-01", "Utenza luce ottobre", 1000, "fisso", "Palestra & Fitness", 20],
    ["Enel Energia", "FT-2026-001", "2026-10-01", "Utenza luce ottobre", 1000, "fisso", "SPA & Benessere", 20],
    ["Fornitore Cloro", "2024/88", "15/09/2026", "Cloro piscina coperta", 320.5, "variabile", "Piscina coperta", 100],
  ])
  XLSX.utils.book_append_sheet(wb, ws, "Spese")
  XLSX.writeFile(wb, "modello-registro-spese.xlsx")
}

export function parseAmmExcel(file: ArrayBuffer, reparti: AmmReparto[]): AmmExcelPreview[] {
  const wb = XLSX.read(file, { type: "array", cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""]
  if (!sheet) return []
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
  if (!json.length) return []
  const keys = Object.keys(json[0] ?? {})
  const col = {
    fornitore: findCol(keys, COLS.fornitore),
    numero: findCol(keys, COLS.numero),
    data: findCol(keys, COLS.data),
    descrizione: findCol(keys, COLS.descrizione),
    totale: findCol(keys, COLS.totale),
    tipo: findCol(keys, COLS.tipo),
    reparto: findCol(keys, COLS.reparto),
    perc: findCol(keys, COLS.perc),
  }
  const parsed: AmmExcelPreview[] = []
  json.forEach((row, i) => {
    const fornitore = cell(row, col.fornitore)
    const numeroDocumento = cell(row, col.numero)
    let dataRaw = cell(row, col.data)
    const dataCell = col.data ? row[col.data] : undefined
    if (dataCell instanceof Date) {
      dataRaw = iso(dataCell.getDate(), dataCell.getMonth() + 1, dataCell.getFullYear())
    }
    const dataDocumento = parseExcelDate(dataRaw)
    const descrizione = cell(row, col.descrizione)
    const totale = parseImporto(cell(row, col.totale))
    const tipoRaw = cell(row, col.tipo).toLowerCase()
    const tipoCosto: AmmTipoCosto = /var/.test(tipoRaw) ? "variabile" : "fisso"
    const repartoRaw = cell(row, col.reparto)
    const perc = parseImporto(cell(row, col.perc)) ?? 100
    const riga = i + 2
    if (!fornitore && totale == null && !dataDocumento) return
    const hit = matchReparto(reparti, repartoRaw)
    const repartoId = hit?.id ?? ""
    let errore: string | undefined
    if (!fornitore) errore = "Fornitore mancante"
    else if (totale == null) errore = "Importo mancante"
    else if (!dataDocumento) errore = "Data documento non valida (usa AAAA-MM-GG o GG/MM/AAAA)"
    else if (!repartoRaw) errore = "Reparto mancante"
    else if (!repartoId) errore = `Reparto non riconosciuto: ${repartoRaw}`
    parsed.push({
      fornitore,
      numeroDocumento,
      dataDocumento,
      descrizione,
      totale: totale ?? 0,
      tipoCosto,
      quote: [{ repartoId, percentuale: perc }],
      errore,
      riga,
    })
  })

  const groups = new Map<string, AmmExcelPreview>()
  for (const p of parsed) {
    if (p.errore) {
      groups.set(`err-${p.riga}`, p)
      continue
    }
    const k = groupKey(p)
    const cur = groups.get(k)
    if (!cur) {
      groups.set(k, { ...p, quote: p.quote.map((q) => ({ ...q })) })
      continue
    }
    for (const q of p.quote) {
      const ex = cur.quote.find((x) => x.repartoId === q.repartoId)
      if (ex) ex.percentuale = Math.round((ex.percentuale + q.percentuale) * 100) / 100
      else cur.quote.push({ ...q })
    }
  }

  return [...groups.values()].map((p) => {
    if (p.errore) return p
    const somma = Math.round(p.quote.reduce((s, q) => s + q.percentuale, 0) * 100) / 100
    if (Math.abs(somma - 100) >= 0.05) {
      return { ...p, errore: `Ripartizione ${somma}% (deve essere 100%)` }
    }
    return p
  })
}
