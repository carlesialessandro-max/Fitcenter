/**
 * Confronta / spiega il conteggio "Abbonamenti attivi" come nel dashboard (buildDashboardFromData).
 *
 * Modalità SQL (default): legge da RVW_AbbonamentiUtenti (come l'API) e applica gli stessi filtri.
 * Modalità file: --excel percorso.xlsx oppure --csv percorso.csv (prima riga = intestazioni).
 *
 * Esempi:
 *   pnpm -C apps/api exec tsx scripts/abbonamenti-attivi-reconcile.ts
 *   pnpm -C apps/api exec tsx scripts/abbonamenti-attivi-reconcile.ts --asOf 2026-03-21
 *   pnpm -C apps/api exec tsx scripts/abbonamenti-attivi-reconcile.ts --excel "C:\\export\\abbonamenti.xlsx"
 *   pnpm -C apps/api exec tsx scripts/abbonamenti-attivi-reconcile.ts --csv "C:\\export\\abbonamenti.csv"
 *
 * Export «attivi» in root monorepo: attivi.xlsx o attivi.xls (stesse colonne: Q=macro, W/X=date, M=CF, O=id, S/T=corsi):
 *   pnpm -C apps/api abbonamenti:attivi-reconcile -- --layout attivi-xls --excel ../../attivi.xlsx
 *   # oppure file in vite-fitcenter/attivi.xlsx (cercato automaticamente):
 *   pnpm -C apps/api abbonamenti:attivi-reconcile -- --layout attivi-xls
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
// xlsx è CJS: con `import * as` sotto tsx/ESM `readFile` finisce su `.default`
import xlsxCjs from "xlsx"
const XLSX = xlsxCjs as typeof import("xlsx")
import * as gestionaleSql from "../src/services/gestionale-sql.js"
import { rowToAbbonamento } from "../src/data/map-sql-to-types.js"
import type { Abbonamento } from "../src/types/gestionale.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const apiEnvPath = path.resolve(__dirname, "../.env")
  dotenv.config({ path: apiEnvPath })
}

/** Allineato a handlers/data.ts (GESTIONALE_DATE_LOCALE) */
function toDateParts(d: Date): { year: number; month: number; day: number } {
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  return {
    year: useLocal ? d.getFullYear() : d.getUTCFullYear(),
    month: (useLocal ? d.getMonth() : d.getUTCMonth()) + 1,
    day: useLocal ? d.getDate() : d.getUTCDate(),
  }
}

function parseAsOfKey(raw: string | undefined): { date: Date; key: string } {
  const s = (raw ?? "").trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const year = Number(m[1])
    const month = Number(m[2])
    const day = Number(m[3])
    const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    const p = toDateParts(dt)
    const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
    return { date: dt, key }
  }
  const dt = new Date()
  const p = toDateParts(dt)
  const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
  return { date: dt, key }
}

/** Copia da handlers/data.ts — deve restare allineata a markRinnovato */
function parseDateToTime(s: string): number {
  if (!s || !s.trim()) return 0
  const t = s.trim()
  const iso = /^\d{4}-\d{2}-\d{2}/.test(t)
  if (iso) return new Date(t).getTime()
  const it = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (it) return new Date(+it[3], +it[2] - 1, +it[1]).getTime()
  /** Export Excel USA: 10/23/24 o 1/28/2026 (mese/giorno/anno) */
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (us) {
    let y = +us[3]
    if (y < 100) y += y >= 70 ? 1900 : 2000
    return new Date(y, +us[1] - 1, +us[2]).getTime()
  }
  const d = new Date(t).getTime()
  return Number.isNaN(d) ? 0 : d
}

/** Mezzanotte locale (per confronto con oggiTime nel dashboard) */
function startOfDayMsFromDateStr(s: string): number | null {
  const t = parseDateToTime(s.trim())
  if (!t) return null
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function italianOrExcelDateToIso(v: string): string {
  const t = parseDateToTime(v.trim())
  if (!t) return ""
  const d = new Date(t)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function markRinnovato(list: Abbonamento[]): void {
  type Top = { time: number; id: string | null }
  const topsByCliente = new Map<string, { top1: Top; top2: Top }>()

  for (const a of list) {
    const cliente = String(a.clienteId ?? "").trim()
    if (!cliente) continue
    const id = String(a.id ?? "").trim() || null
    const inizioT = parseDateToTime(a.dataInizio ?? "")
    const entry = topsByCliente.get(cliente)
    if (!entry) {
      topsByCliente.set(cliente, { top1: { time: inizioT, id }, top2: { time: 0, id: null } })
      continue
    }
    if (inizioT > entry.top1.time) {
      entry.top2 = entry.top1
      entry.top1 = { time: inizioT, id }
    } else if (id !== entry.top1.id && inizioT > entry.top2.time) {
      entry.top2 = { time: inizioT, id }
    }
  }

  for (const a of list) {
    const cliente = String(a.clienteId ?? "").trim()
    if (!cliente) continue
    const id = String(a.id ?? "").trim() || null
    const dataFineA = parseDateToTime(a.dataFine ?? "")
    if (!dataFineA) continue
    const entry = topsByCliente.get(cliente)
    if (!entry) {
      a.rinnovato = false
      continue
    }
    const maxOther = entry.top1.id !== id ? entry.top1.time : entry.top2.time
    a.rinnovato = maxOther > dataFineA
  }
}

/** Allineato a buildDashboardFromData (handlers/data.ts) */
function isTesseramentoAbb(a: Abbonamento): boolean {
  return (
    a.isTesseramento === true ||
    (a.prezzo != null && Number(a.prezzo) === 39) ||
    (a.pianoNome ?? "").toLowerCase().includes("tesserament") ||
    ((a.pianoNome ?? "").toLowerCase().includes("asi") && (a.pianoNome ?? "").toLowerCase().includes("isc"))
  )
}

type RejectReason =
  | "stato_non_attivo"
  | "tesseramento"
  | "date_invalid"
  | "fuori_finestra_date"
  | "incluso_attivo"

function classifyAbbonamento(a: Abbonamento, oggiTime: number): RejectReason {
  if (a.stato !== "attivo") return "stato_non_attivo"
  if (isTesseramentoAbb(a)) return "tesseramento"
  const tInizio = startOfDayMsFromDateStr(String(a.dataInizio ?? ""))
  const tFine = startOfDayMsFromDateStr(String(a.dataFine ?? ""))
  if (tInizio == null || tFine == null) return "date_invalid"
  if (!(oggiTime >= tInizio && oggiTime <= tFine)) return "fuori_finestra_date"
  return "incluso_attivo"
}

function analyze(abbonamenti: Abbonamento[], referenceDate: Date) {
  const oggi = toDateParts(referenceDate)
  const oggiTime = new Date(oggi.year, oggi.month - 1, oggi.day).getTime()

  const copy = abbonamenti.map((x) => ({ ...x }))
  markRinnovato(copy)

  const counts: Record<RejectReason, number> = {
    stato_non_attivo: 0,
    tesseramento: 0,
    date_invalid: 0,
    fuori_finestra_date: 0,
    incluso_attivo: 0,
  }

  const samples: Partial<Record<RejectReason, Abbonamento[]>> = {}

  for (const a of copy) {
    const r = classifyAbbonamento(a, oggiTime)
    counts[r]++
    if (r !== "incluso_attivo") {
      if (!samples[r]) samples[r] = []
      if ((samples[r]!.length ?? 0) < 8) samples[r]!.push(a)
    }
  }

  const attivi = copy.filter((a) => classifyAbbonamento(a, oggiTime) === "incluso_attivo")
  const in30 = new Date(referenceDate)
  in30.setDate(in30.getDate() + 30)
  const in60 = new Date(referenceDate)
  in60.setDate(in60.getDate() + 60)
  const in30Ms = new Date(in30.getFullYear(), in30.getMonth(), in30.getDate()).getTime()
  const in60Ms = new Date(in60.getFullYear(), in60.getMonth(), in60.getDate()).getTime()
  const inScadenza = attivi.filter((a) => {
    if (a.rinnovato === true) return false
    const fine = startOfDayMsFromDateStr(String(a.dataFine ?? ""))
    return fine != null && fine <= in30Ms
  }).length
  const inScadenza60 = attivi.filter((a) => {
    if (a.rinnovato === true) return false
    const fine = startOfDayMsFromDateStr(String(a.dataFine ?? ""))
    return fine != null && fine <= in60Ms
  }).length

  return {
    asOfKey: `${oggi.year}-${String(oggi.month).padStart(2, "0")}-${String(oggi.day).padStart(2, "0")}`,
    oggiTime,
    totaleRighe: copy.length,
    abbonamentiAttivi: attivi.length,
    inScadenza30: inScadenza,
    inScadenza60: inScadenza60,
    counts,
    samples,
    attiviIds: new Set(attivi.map((a) => a.id)),
  }
}

/** Normalizza intestazioni Excel/CSV verso nomi colonna tipo SQL view */
function normalizeExcelHeader(h: string): string {
  const k = h.replace(/\u00a0/g, " ").trim()
  const lower = k.toLowerCase().replace(/\s+/g, " ")
  const map: [RegExp, string][] = [
    [/id\s*iscrizione|idiscrizione|id_iscrizione/i, "IDIscrizione"],
    [/id\s*utente|idutente|cliente\s*id|codice\s*cliente/i, "IDUtente"],
    [/data\s*inizio|datainizio/i, "DataInizio"],
    [/data\s*fine|datafine/i, "DataFine"],
    [/stato/i, "Stato"],
    [/totale|prezzo|importo/i, "Totale"],
    [/categoria\s*abbonamento|descrizione\s*categoria/i, "CategoriaAbbonamentoDescrizione"],
    [/macro\s*categoria/i, "MacroCategoriaAbbonamentoDescrizione"],
    [/abbonamento(\s*descrizione)?|descrizione\s*abbonamento|nome\s*abbonamento/i, "AbbonamentoDescrizione"],
    [/idcategoria/i, "IDCategoria"],
    [/iddurata|durata/i, "IDDurata"],
    [/nome\s*operatore|consulente/i, "NomeOperatore"],
    [/cliente\s*nome|nome\s*cliente/i, "ClienteNome"],
    [/cliente\s*cognome|cognome/i, "ClienteCognome"],
    [/categoria(?!\s*abbonamento)/i, "Categoria"],
  ]
  for (const [re, name] of map) {
    if (re.test(lower) || re.test(k)) return name
  }
  return k
}

function rowFromSheetObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [hk, v] of Object.entries(obj)) {
    if (hk == null || hk === "") continue
    const key = normalizeExcelHeader(String(hk))
    if (out[key] !== undefined && String(out[key]).trim() !== "") continue
    out[key] = v
  }
  return out
}

type LayoutMode = "default" | "attivi-xls"

function parseArgs() {
  const argv = process.argv.slice(2)
  let asOf: string | undefined
  let excel: string | undefined
  let csv: string | undefined
  let sheet = 0
  let layout: LayoutMode = "default"
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--asOf" && argv[i + 1]) {
      asOf = argv[++i]
    } else if (a.startsWith("--asOf=")) {
      asOf = a.split("=", 2)[1]
    } else if (a === "--excel" && argv[i + 1]) {
      excel = argv[++i]
    } else if (a.startsWith("--excel=")) {
      excel = a.split("=", 2)[1]
    } else if (a === "--csv" && argv[i + 1]) {
      csv = argv[++i]
    } else if (a.startsWith("--csv=")) {
      csv = a.split("=", 2)[1]
    } else if (a === "--sheet" && argv[i + 1]) {
      sheet = Number(argv[++i]) || 0
    } else if (a === "--layout" && argv[i + 1]) {
      const v = argv[++i]
      if (v === "attivi-xls") layout = "attivi-xls"
    } else if (a.startsWith("--layout=")) {
      const v = a.split("=", 2)[1]
      if (v === "attivi-xls") layout = "attivi-xls"
    }
  }
  return { asOf, excel, csv, sheet, layout }
}

/** Root monorepo vite-fitcenter (cartella che contiene apps/ e attivi.xls). __dirname = apps/api/scripts */
function monorepoViteRoot(): string {
  return path.resolve(__dirname, "../../..")
}

function loadExcelSheetMatrix(abs: string, sheetIndex: number): { name: string; matrix: unknown[][] } {
  const wb = XLSX.readFile(abs)
  const name = wb.SheetNames[sheetIndex] ?? wb.SheetNames[0]
  const sh = wb.Sheets[name]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, raw: false, defval: "" }) as unknown[][]
  return { name, matrix }
}

function cellAt(row: unknown[], i: number): string {
  const v = row[i]
  if (v == null) return ""
  return String(v).trim()
}

/** Allinea le categorie escluse dal dashboard (stesso testo in CategoriaAbbonamentoDescrizione). */
function deriveCategoriaPerDashboard(combined: string): string | undefined {
  const u = combined
    .toUpperCase()
    .replace(/\u2019/g, "'")
    .replace(/'/g, "'")
    .replace(/\s+/g, " ")
    .trim()
  if (u.includes("SCUOLA NUOTO")) return "SCUOLA NUOTO"
  if (u.includes("CAMPUS SPORTIVI")) return "CAMPUS SPORTIVI"
  if (u.includes("GESTANTI")) return "GESTANTI"
  if (u.includes("ACQUATICITA")) return "ACQUATICITA"
  return undefined
}

/** Macro DANZA nel dashboard = stringa normalizzata esattamente «DANZA». */
function deriveMacroDanzaIfAny(combined: string): string | undefined {
  const u = combined.toUpperCase()
  if (/\bDANZA\b/.test(u)) return "DANZA"
  return undefined
}

/**
 * Layout export «attivi.xlsx» (gestionale reale, 27 colonne, spesso senza riga intestazione):
 * 0–1 cognome/nome, 12=tel, 13=CF, 14=consulente vendita, 15=id riga/iscrizione,
 * 16=tipo (NUOVI/CORSI), 17=num, 18=macro (ABBONAMENTI STAFF, ACQUATICITA'…),
 * 19–20=codici, 21–22=corso/dettaglio orario, 25–26=data inizio/fine (formato USA M/D/YY).
 *
 * Layout precedente (screenshot 24+ colonne IT): impostare env ATTIVI_LAYOUT=legacy
 */
const COL = {
  legacy: {
    cognome: 0,
    nome: 1,
    cf: 12,
    idIscr: 14,
    consulente: 13,
    macroQ: 16,
    dettS: 18,
    dettT: 19,
    idAux: [] as const,
    dataInizio: 22,
    dataFine: 23,
    dataFirstRowIsHeader: true,
  },
  /** file reale vite-fitcenter/attivi.xlsx */
  v2026: {
    cognome: 0,
    nome: 1,
    cf: 13,
    idIscr: 15,
    /** Colonne aggiuntive per id univoco (codici gestionale) */
    idAux: [19, 20] as const,
    consulente: 14,
    macroQ: 18,
    dettS: 21,
    dettT: 22,
    dataInizio: 25,
    dataFine: 26,
    dataFirstRowIsHeader: false,
  },
} as const

function attiviLayoutMode(): "legacy" | "v2026" {
  const e = (process.env.ATTIVI_LAYOUT ?? "").trim().toLowerCase()
  if (e === "legacy" || e === "old" || e === "v1") return "legacy"
  return "v2026"
}

function rowsFromAttiviXlsLayout(matrix: unknown[][]): Record<string, unknown>[] {
  if (matrix.length < 1) return []
  const mode = attiviLayoutMode()
  const C = COL[mode]
  const out: Record<string, unknown>[] = []
  const start = C.dataFirstRowIsHeader ? 1 : 0
  for (let i = start; i < matrix.length; i++) {
    const row = matrix[i] as unknown[]
    if (!row?.length) continue
    if (row.every((c) => String(c ?? "").trim() === "")) continue
    const w = cellAt(row, C.dataInizio)
    const x = cellAt(row, C.dataFine)
    if (!w && !x) continue
    /** Alcuni export ripetono la riga intestazione in fondo al foglio */
    if (/data\s*inizio/i.test(w) || /^codice\s*fiscale$/i.test(cellAt(row, C.cf))) continue
    const q = cellAt(row, C.macroQ)
    const s = cellAt(row, C.dettS)
    const tcol = cellAt(row, C.dettT)
    const combined = `${q} ${s} ${tcol}`
    const catDer = deriveCategoriaPerDashboard(combined)
    const macroDanza = deriveMacroDanzaIfAny(combined)
    const di = italianOrExcelDateToIso(w) || w
    const df = italianOrExcelDateToIso(x) || x
    const idParts = [cellAt(row, C.idIscr), ...C.idAux.map((j) => cellAt(row, j))].filter(Boolean)
    const idIscr = idParts.length ? idParts.join("-") : `xls-row-${i + 1}`
    out.push({
      Stato: "attivo",
      IDIscrizione: idIscr,
      IDUtente: cellAt(row, C.cf) || cellAt(row, C.idIscr) || `anon-${i + 1}`,
      DataInizio: di,
      DataFine: df,
      MacroCategoriaAbbonamentoDescrizione: macroDanza ?? q,
      CategoriaAbbonamentoDescrizione: catDer ?? "",
      AbbonamentoDescrizione: [s, tcol].filter(Boolean).join(" — "),
      ClienteCognome: cellAt(row, C.cognome),
      ClienteNome: cellAt(row, C.nome),
      NomeOperatore: cellAt(row, C.consulente),
    })
  }
  return out
}

function loadCsv(filePath: string): Record<string, unknown>[] {
  const text = fs.readFileSync(filePath, "utf8")
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const delim = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ","
  const split = (line: string): string[] => {
    const out: string[] = []
    let cur = ""
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        q = !q
      } else if (!q && c === delim) {
        out.push(cur.trim())
        cur = ""
      } else {
        cur += c
      }
    }
    out.push(cur.trim())
    return out
  }
  const headers = split(lines[0]).map((h) => h.replace(/^"|"$/g, ""))
  const rows: Record<string, unknown>[] = []
  for (let li = 1; li < lines.length; li++) {
    const cells = split(lines[li]).map((c) => c.replace(/^"|"$/g, ""))
    const obj: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? ""
    })
    rows.push(rowFromSheetObject(obj))
  }
  return rows
}

async function main() {
  loadEnv()
  const { asOf, excel, csv, sheet, layout } = parseArgs()
  const { date: refDate, key } = parseAsOfKey(asOf)

  let rows: Record<string, unknown>[]

  const root = monorepoViteRoot()
  /** Stesso layout colonne per .xls e .xlsx (SheetJS legge entrambi). */
  const defaultAttiviCandidates = [
    path.join(root, "attivi.xlsx"),
    path.join(root, "attivi.xls"),
    path.join(root, "apps", "attivi.xlsx"),
    path.join(root, "apps", "attivi.xls"),
  ]
  const envAttivi = process.env.ATTIVI_XLS?.trim()
  const defaultAttiviPath =
    (envAttivi && fs.existsSync(path.resolve(envAttivi)) ? path.resolve(envAttivi) : undefined) ??
    defaultAttiviCandidates.find((p) => fs.existsSync(p)) ??
    defaultAttiviCandidates[0]
  const excelPath =
    excel ?? (layout === "attivi-xls" ? defaultAttiviPath : undefined)

  if (layout === "attivi-xls" && excelPath) {
    const abs = path.resolve(excelPath)
    if (!fs.existsSync(abs)) {
      console.error(
        "File non trovato. Metti attivi.xlsx o attivi.xls in vite-fitcenter/ (o apps/), oppure:",
        "ATTIVI_XLS=percorso in .env oppure --excel \"...\""
      )
      console.error("Percorso atteso (default):", abs)
      console.error("Percorsi provati:", defaultAttiviCandidates.join(" | "))
      process.exit(1)
    }
    const { name, matrix } = loadExcelSheetMatrix(abs, sheet)
    rows = rowsFromAttiviXlsLayout(matrix)
    console.log(
      `[file] layout=attivi-xls (${attiviLayoutMode()}) Excel: ${abs} foglio "${name}" righe dati ${rows.length}`
    )
  } else if (excel) {
    const abs = path.resolve(excel)
    if (!fs.existsSync(abs)) {
      console.error("File Excel non trovato:", abs)
      process.exit(1)
    }
    const wb = XLSX.readFile(abs)
    const name = wb.SheetNames[sheet] ?? wb.SheetNames[0]
    const sh = wb.Sheets[name]
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sh, { defval: "", raw: false })
    rows = json.map((r) => rowFromSheetObject(r))
    console.log(`[file] Excel: ${abs} foglio "${name}" righe ${rows.length}`)
  } else if (csv) {
    const abs = path.resolve(csv)
    if (!fs.existsSync(abs)) {
      console.error("File CSV non trovato:", abs)
      process.exit(1)
    }
    rows = loadCsv(abs)
    console.log(`[file] CSV: ${abs} righe ${rows.length}`)
  } else {
    if (layout === "attivi-xls") {
      console.error('Usa --layout attivi-xls insieme a --excel oppure metti "attivi.xls" nella cartella vite-fitcenter/')
      process.exit(1)
    }
    if (!gestionaleSql.isGestionaleConfigured()) {
      console.error("SQL non configurato: imposta SQL_CONNECTION_STRING in apps/api/.env oppure usa --excel / --csv")
      process.exit(1)
    }
    rows = await gestionaleSql.queryAbbonamenti(undefined)
    console.log(`[sql] Righe da queryAbbonamenti: ${rows.length}`)
  }

  const abbonamenti = rows.map((r) => rowToAbbonamento(r))
  const r = analyze(abbonamenti, refDate)

  console.log("\n=== Riepilogo (stessa logica dashboard KPI «Abbonamenti attivi») ===")
  console.log("Data riferimento (asOf):", key, `(env GESTIONALE_DATE_LOCALE=${process.env.GESTIONALE_DATE_LOCALE ?? "false"})`)
  console.log("Totale righe elaborate:", r.totaleRighe)
  console.log("Abbonamenti attivi (KPI):", r.abbonamentiAttivi)
  console.log("In scadenza 30gg (non rinnovati):", r.inScadenza30)
  console.log("In scadenza 60gg (non rinnovati):", r.inScadenza60)
  console.log("\nMotivi esclusione (conteggio):")
  for (const [k, v] of Object.entries(r.counts)) {
    console.log(`  ${k}: ${v}`)
  }

  console.log("\nEsempi esclusi (max 8 per categoria):")
  for (const reason of Object.keys(r.samples) as RejectReason[]) {
    const list = r.samples[reason]
    if (!list?.length) continue
    console.log(`\n-- ${reason} --`)
    for (const a of list) {
      console.log(
        `  id=${a.id} cliente=${a.clienteId} stato=${a.stato} inizio=${a.dataInizio} fine=${a.dataFine} prezzo=${a.prezzo} piano="${a.pianoNome?.slice(0, 60)}" tesser=${a.isTesseramento} macro=${a.macroCategoriaDescrizione ?? ""} catAbb=${a.categoriaAbbonamentoDescrizione ?? ""}`
      )
    }
  }

  console.log("\nNote:")
  console.log("- «attivo» nel mapping SQL = dataFine >= oggi (calendar) salvo colonna Stato esplicita.")
  console.log("- Esclusi dal KPI attivi: solo tesseramenti (IDCategoria 19, testi TESSERAMENTI/ASI+ISCRIZIONE, ecc.). Tutte le altre categorie incluse.")
  console.log("- Finestra attivo: dataInizio <= asOf <= dataFine (come dashboard).")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
