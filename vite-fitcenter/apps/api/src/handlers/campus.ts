import type { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { rowToAbbonamento, rowToCliente } from "../data/map-sql-to-types.js"
import { campusStore } from "../store/campus.js"
import { getScopedUser } from "../middleware/auth.js"
import XLSX from "xlsx"

function firstMarchIsoItaly(): string {
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric" }).format(new Date()).slice(0, 4)
  return `${y}-03-01`
}

/** Data odierna in calendario Europe/Rome (YYYY-MM-DD), coerente col gestionale IT. */
function todayIsoItaly(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  } catch {
    return new Date().toISOString().split("T")[0]
  }
}

const CAMPUS_WEEKS_2026: { from: string; to: string }[] = [
  { from: "2026-06-15", to: "2026-06-19" },
  { from: "2026-06-22", to: "2026-06-26" },
  { from: "2026-06-29", to: "2026-07-03" },
  { from: "2026-07-06", to: "2026-07-10" },
  { from: "2026-07-13", to: "2026-07-17" },
  { from: "2026-07-20", to: "2026-07-24" },
  { from: "2026-07-27", to: "2026-07-31" },
  { from: "2026-08-03", to: "2026-08-07" },
  { from: "2026-08-10", to: "2026-08-14" },
  { from: "2026-08-17", to: "2026-08-21" },
  { from: "2026-08-24", to: "2026-08-28" },
  { from: "2026-08-31", to: "2026-09-04" },
  { from: "2026-09-07", to: "2026-09-11" },
]

const EXCEL_WEEK_HEADERS: Record<string, string> = {
  "2026-06-15": "15 - 19 GIUGNO",
  "2026-06-22": "22 - 26 GIUGNO",
  "2026-06-29": "29  GIUGNO - 03 LUGLIO",
  "2026-07-06": " 06 - 10 LUGLIO",
  "2026-07-13": "13 - 17 LUGLIO",
  "2026-07-20": "20 - 24 LUGLIO",
  "2026-07-27": "27   - 31 LUGLIO",
  "2026-08-03": "03 - 07 AGOSTO",
  "2026-08-10": "10 - 14 AGOSTO",
  "2026-08-17": "17 - 21 AGOSTO",
  "2026-08-24": "24 - 28 AGOSTO",
  "2026-08-31": "31 AGOSTO - 04 SETTEMBRE",
  "2026-09-07": "07 - 11 SETTEMBRE",
}

function normToken(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Importi it-IT / SQL: migliaia con `.`, decimali con `,`; oppure numero nativo. */
function parseMoneyIt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  let s = String(v ?? "").trim()
  if (!s) return 0
  s = s.replace(/\s/g, "").replace(/€/gi, "").replace(/eur/gi, "").trim()
  // 1.234,56 o 12.345,6
  const itGrouped = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/.exec(s)
  if (itGrouped) {
    const n = Number(`${itGrouped[1]!.replace(/\./g, "")}.${itGrouped[2]}`)
    return Number.isFinite(n) ? n : 0
  }
  // 1234,56 (decimali con virgola)
  if (/,/.test(s) && (!/\./.test(s) || s.lastIndexOf(",") > s.lastIndexOf("."))) {
    s = s.replace(/\./g, "").replace(",", ".")
  } else {
    s = s.replace(",", ".")
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Importo da RVW (fallback). Preferire colonne esplicite; opz. `GESTIONALE_CAMPUS_COL_IMPORTO`.
 * Niente match «fuzzy» su nomi che contengono importo (evita colonne tipo ImportoPagato).
 */
function campusImportoVendutoRvW(row: Record<string, unknown>): number {
  const rawCol = (process.env.GESTIONALE_CAMPUS_COL_IMPORTO ?? "").trim().replace(/[\[\]]/g, "")
  if (rawCol && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawCol)) {
    const v = (row as any)[rawCol]
    if (v != null && String(v).trim() !== "") return parseMoneyIt(v)
  }
  const keys = [
    "Importo",
    "importo",
    "AbbonamentiImporto",
    "Abbonamenti Importo",
    "Abbonamenti_Importo",
    "ImportoAbbonamento",
    "ImportoRiga",
    "ImportoVendita",
    "ImportoIscrizione",
  ]
  for (const k of keys) {
    const v = (row as any)[k]
    if (v != null && String(v).trim() !== "") return parseMoneyIt(v)
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.replace(/\s/g, "").toLowerCase() !== "importo") continue
    if (v != null && String(v).trim() !== "") return parseMoneyIt(v)
  }
  return 0
}

/** Chiave IDIscrizione allineata tra RVW abbonamenti e righe cassa (numerico / ".0"). */
function normIscrizioneCampusKey(v: unknown): string {
  const s = String(v ?? "").trim()
  if (!s) return ""
  const n = Number(s.replace(",", "."))
  if (Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER && Number.isInteger(n)) return String(n)
  if (Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER) return String(Math.trunc(n))
  return s
}

function isCampusAbb(a: ReturnType<typeof rowToAbbonamento>): boolean {
  const macro = normToken(a.macroCategoriaDescrizione ?? "")
  const cat = normToken(a.categoriaAbbonamentoDescrizione ?? "")
  // Richiesta: MacroCategoria = CORSI, CategoriaAbbonamenti = CAMPUS SPORTIVI
  return macro.includes("corsi") && cat.includes("campus sportivi")
}

function fmtIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}`
}

function parseIsoDate(iso: string): Date | null {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseLooseDate(s: unknown): Date | null {
  if (s instanceof Date && !Number.isNaN(s.getTime())) return s
  const raw = String(s ?? "").trim()
  if (!raw) return null
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return parseIsoDate(raw)
  // IT dd/mm/yyyy or dd-mm-yyyy
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(raw)
  if (m) {
    const dd = String(m[1]).padStart(2, "0")
    const mm = String(m[2]).padStart(2, "0")
    const yyyy = m[3]
    return parseIsoDate(`${yyyy}-${mm}-${dd}`)
  }
  // IT datetime da gestionale/SQL: "03/03/2026 17.02.25" o "03/03/2026 17:02:25" (ore con . o :)
  const mdt = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?/.exec(raw)
  if (mdt) {
    const dd = String(mdt[1]).padStart(2, "0")
    const mm = String(mdt[2]).padStart(2, "0")
    const yyyy = mdt[3]
    return parseIsoDate(`${yyyy}-${mm}-${dd}`)
  }
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Giorno calendario in Europe/Rome (YYYY-MM-DD), allineato al gestionale IT. */
function toDayIsoItaly(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** Range inclusivo [fromIso,toIso] confrontando solo la data in Italia (evita shift timezone server/SQL). */
function inClosedRangeItaly(d: Date, fromIso: string, toIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return true
  const day = toDayIsoItaly(d)
  return day >= fromIso && day <= toIso
}

/** Overlap tra periodo abbonamento e filtro usando stringhe YYYY-MM-DD (stesso criterio del gestionale su date pure). */
function overlapsRangeItaly(aFrom: string, aTo: string, rangeFrom: string, rangeTo: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeTo)) {
    return overlapsRange(aFrom, aTo, rangeFrom, rangeTo)
  }
  const sliceIso = (s: string) => {
    const t = String(s ?? "").trim()
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(t)
    return m ? m[1]! : ""
  }
  const s = sliceIso(aFrom)
  const e = sliceIso(aTo)
  if (!s && !e) return true
  const start = s || e
  const end = e || s
  if (!start || !end) return overlapsRange(aFrom, aTo, rangeFrom, rangeTo)
  return end >= rangeFrom && start <= rangeTo
}

/** Incluso nel periodo «1 mar – oggi» come vendita campus: data inserimento/operazione, altrimenti overlap periodo lezione. */
function campusAbbonamentoInDateRange(
  row: Record<string, unknown>,
  a: ReturnType<typeof rowToAbbonamento>,
  rangeFrom: string,
  rangeTo: string,
): boolean {
  const rif = pickDataAbbonamentoInserito(row)
  if (rif && inClosedRangeItaly(rif, rangeFrom, rangeTo)) return true
  const op = parseLooseDate(
    (row as any).DataOperazione ?? (row as any).DataOperazioneAbbonamento ?? (row as any).AbbonamentiDataOperazione
  )
  if (op && inClosedRangeItaly(op, rangeFrom, rangeTo)) return true
  const di = parseLooseDate((row as any).DataIscrizione ?? (row as any).DataIscrizioneAbbonamento)
  if (di && inClosedRangeItaly(di, rangeFrom, rangeTo)) return true
  return overlapsRangeItaly(a.dataInizio, a.dataFine, rangeFrom, rangeTo)
}

function overlapsRange(aFrom: string, aTo: string, rangeFrom: string, rangeTo: string): boolean {
  const af = parseIsoDate(aFrom)
  const at = parseIsoDate(aTo)
  const rf = parseIsoDate(rangeFrom)
  const rt = parseIsoDate(rangeTo)
  if (!rf || !rt) return true
  // In alcune view/casi storici DataInizio/DataFine possono essere vuote o in formato non ISO.
  // Non vogliamo sottostimare: se non riusciamo a leggere una delle due date, facciamo fallback
  // all'altra; se mancano entrambe includiamo comunque la riga.
  const start = af ?? at
  const end = at ?? af
  if (!start && !end) return true
  const startT = (start ?? rf).getTime()
  const endT = (end ?? rt).getTime()
  return endT >= rf.getTime() && startT <= rt.getTime()
}

function weeksForAbbonamento(aFrom: string, aTo: string, weeks: { from: string; to: string }[]): string[] {
  const out: string[] = []
  for (const w of weeks) {
    if (overlapsRange(aFrom, aTo, w.from, w.to)) out.push(w.from)
  }
  return out
}

function pickFirstNonEmpty(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = (row as any)[k]
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return ""
}

/**
 * Data di riferimento come nel gestionale: filtro "Abbonamento inserito dal–al".
 * Priorità: date di inserimento / operazione vendita; poi colonna generica `Data` (spesso l’unica in RVW).
 */
function pickDataAbbonamentoInserito(row: Record<string, unknown>): Date | null {
  const keys = [
    "DataInserimento",
    "Data Inserimento",
    "DataInserimentoAbbonamento",
    "Data Inserimento Abbonamento",
    "DataAbbonamentoInserito",
    "Data Abbonamento Inserito",
    "DataInserito",
    "Data Inserito",
    "AbbonamentiDataOperazione",
    "Abbonamenti Data Operazione",
    "DataOperazioneAbbonamento",
    "DataOperazione",
    "Data Operazione",
    "DataIscrizione",
    "Data Iscrizione",
    "DataContratto",
    "Data Contratto",
    "DataRegistrazione",
    "Data Registrazione",
    // Alcune RVW espongono solo `Data` come data vendita / inserimento (senza overlap col periodo lezione estate).
    "Data",
    "DataCreazione",
    "Data Creazione",
    "DataUltimaModifica",
    "Data Ultima Modifica",
  ]
  for (const k of keys) {
    const v = (row as any)[k]
    if (v == null) continue
    if (typeof v === "string" && !v.trim()) continue
    const d = parseLooseDate(v)
    if (d) return d
  }
  // Fallback: qualunque colonna il cui nome suggerisce inserimento / operazione / vendita (driver con alias diversi).
  for (const [k, v] of Object.entries(row)) {
    if (v == null || (typeof v === "string" && !v.trim())) continue
    const nk = k
      .replace(/\s/g, "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
    if (!nk.includes("data")) continue
    if (nk.includes("nascita")) continue
    if (nk.includes("datapag") || nk.includes("pagato") || nk.includes("rata")) continue
    if (nk.includes("fine") && (nk.includes("abbon") || nk.includes("iscriz"))) continue
    if (nk.includes("inizio") && nk.includes("abbon")) continue
    if (nk.includes("modific") || nk.includes("ultimamod")) continue
    if (
      nk.includes("inser") ||
      nk.includes("operaz") ||
      nk.includes("iscriz") ||
      nk.includes("contrat") ||
      nk.includes("vendit") ||
      nk.includes("regist")
    ) {
      const d = parseLooseDate(v)
      if (d) return d
    }
  }
  return null
}

export async function getCampus(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0")
    res.setHeader("Pragma", "no-cache")
    const u = getScopedUser(req)
    // Reception (operatore) deve poter consultare il Campus in lettura.
    if (u.role !== "admin" && u.role !== "campus" && u.role !== "operatore" && u.role !== "firme") {
      return res.status(403).json({ message: "Permessi insufficienti" })
    }

    const rangeFrom = String(req.query.from ?? firstMarchIsoItaly()).trim() || firstMarchIsoItaly()
    const rangeTo = String(req.query.to ?? todayIsoItaly()).trim() || todayIsoItaly()

    const rows = await gestionaleSql.queryAbbonamenti(undefined)
    // Da RVW_AbbonamentiUtenti: genitore = PaganteNome, telefono = SMS
    const paganteByClienteId = new Map<string, string>()
    const smsByClienteId = new Map<string, string>()
    const emailByClienteId = new Map<string, string>()

    const campusRowsRaw = rows
      .map((r) => {
        const row = r as Record<string, unknown>
        const clienteId = String((r as any).IDUtente ?? (r as any).IdUtente ?? (r as any).idUtente ?? (r as any).ClienteId ?? "").trim()
        const paganteNome = pickFirstNonEmpty(r, ["PaganteNome", "Pagante", "Pagante_Nome"])
        const sms = pickFirstNonEmpty(r, ["SMS", "Sms", "sms", "Cellulare", "cellulare", "Telefono", "telefono", "Telefono_1", "Telefono1"])
        const email = pickFirstNonEmpty(r, ["Email", "email", "Mail", "mail"])
        if (clienteId) {
          if (paganteNome && !paganteByClienteId.has(clienteId)) paganteByClienteId.set(clienteId, paganteNome)
          if (sms && !smsByClienteId.has(clienteId)) smsByClienteId.set(clienteId, sms)
          if (email && !emailByClienteId.has(clienteId)) emailByClienteId.set(clienteId, email)
        }
        const a = rowToAbbonamento(r)
        const importoRvW = campusImportoVendutoRvW(row)
        return { a, importoRvW, row }
      })
      .filter(({ a }) => isCampusAbb(a))
      .filter(({ a, row }) => campusAbbonamentoInDateRange(row, a, rangeFrom, rangeTo))

    const vendutoDaMovimenti = (process.env.GESTIONALE_CAMPUS_VENDUTO_DA_MOVIMENTI ?? "true").toLowerCase() !== "false"
    const idList = [
      ...new Set(
        campusRowsRaw
          .map(({ a }) => normIscrizioneCampusKey(a.id))
          .filter((k) => k.length > 0),
      ),
    ]
    const vendutoMovByIscr =
      vendutoDaMovimenti && gestionaleSql.isGestionaleConfigured() && idList.length > 0
        ? await gestionaleSql.queryMovimentiVendutoSumByIscrizioneIds(rangeFrom, rangeTo, idList)
        : new Map<string, number>()
    const movGiaApplicato = new Set<string>()
    const campusAbbonamenti = campusRowsRaw.map(({ a, importoRvW }) => {
      const iscr = normIscrizioneCampusKey(a.id)
      let importoVenduto = importoRvW
      if (vendutoDaMovimenti && iscr) {
        const m = vendutoMovByIscr.get(iscr)
        if (m != null && m > 0) {
          if (!movGiaApplicato.has(iscr)) {
            importoVenduto = m
            movGiaApplicato.add(iscr)
          } else {
            // Stessa iscrizione duplicata in RVW: il venduto da movimenti va contato una sola volta.
            importoVenduto = 0
          }
        }
      }
      return { a, importoVenduto }
    })
    // Venduto = somma Importo movimenti vendita nel periodo (come «Abbonamenti venduti»), fallback RVW; pagato = cassa per IDIscrizione (dedup).
    const iscrizionePagatoGiaSommata = new Set<string>()

    const byCliente = new Map<
      string,
      {
        clienteId: string
        clienteNome: string
        clienteEta?: number
        cellulare?: string
        email?: string
        genitoreSql?: string
        items: { abbonamentoId: string; pianoNome: string; dataInizio: string; dataFine: string; settimane: string[]; prezzo: number }[]
        totaleVenduto: number
        totalePagato: number
      }
    >()

    const pagatoRows = await gestionaleSql.queryAbbonamentiPagamentiSumCassaCampusByIscrizione(rangeFrom, rangeTo)
    const pagatoByIscrizione = new Map<string, number>()
    pagatoRows.forEach((r) => {
      const id = normIscrizioneCampusKey((r as any).IDIscrizione ?? (r as any).idIscrizione)
      const tot = Number((r as any).Totale ?? (r as any).totale ?? 0) || 0
      if (id) pagatoByIscrizione.set(id, tot)
    })

    for (const { a, importoVenduto } of campusAbbonamenti) {
      const weeks = weeksForAbbonamento(a.dataInizio, a.dataFine, CAMPUS_WEEKS_2026)
      const entry =
        byCliente.get(a.clienteId) ??
        {
          clienteId: a.clienteId,
          clienteNome: a.clienteNome,
          clienteEta: a.clienteEta,
          cellulare: smsByClienteId.get(a.clienteId) || undefined,
          email: emailByClienteId.get(a.clienteId) || undefined,
          genitoreSql: paganteByClienteId.get(a.clienteId) || undefined,
          items: [],
          totaleVenduto: 0,
          totalePagato: 0,
        }
      entry.items.push({
        abbonamentoId: a.id,
        pianoNome: a.pianoNome,
        dataInizio: a.dataInizio,
        dataFine: a.dataFine,
        settimane: weeks,
        prezzo: importoVenduto,
      })
      entry.totaleVenduto += importoVenduto
      const iscrId = normIscrizioneCampusKey(a.id)
      if (iscrId) {
        const pk = `${a.clienteId}::${iscrId}`
        if (!iscrizionePagatoGiaSommata.has(pk)) {
          iscrizionePagatoGiaSommata.add(pk)
          entry.totalePagato += pagatoByIscrizione.get(iscrId) ?? 0
        }
      }
      byCliente.set(a.clienteId, entry)
    }

    const weeks = CAMPUS_WEEKS_2026.map((w) => ({
      key: w.from,
      from: w.from,
      to: w.to,
      label: `${fmtIt(w.from)}–${fmtIt(w.to)}`,
    }))
    const bambini = Array.from(byCliente.values()).sort((a, b) => a.clienteNome.localeCompare(b.clienteNome))

    const payload = {
      range: { from: rangeFrom, to: rangeTo },
      weeks,
      bambini: bambini.map((c) => {
        const saved = campusStore.get(c.clienteId)
        return {
          ...c,
          totaleDaPagare: Math.max(0, Number(c.totaleVenduto ?? 0) - Number(c.totalePagato ?? 0)),
          cognomeNome: c.clienteNome,
          eta: c.clienteEta,
          email: c.email,
          allergie: saved?.allergie ?? "",
          note: saved?.note ?? "",
          gruppo: saved?.gruppo ?? "",
          genitore: saved?.genitore ?? c.genitoreSql ?? "",
          consensoWhatsapp: saved?.consensoWhatsapp ?? null,
          liv: saved?.liv ?? "",
          weekNotes: saved?.weeks ?? {},
        }
      }),
    }
    res.json(payload)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function patchCampusCliente(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })
    const clienteId = String(req.params.clienteId ?? "").trim()
    if (!clienteId) return res.status(400).json({ message: "clienteId mancante" })
    const body = (req.body ?? {}) as { gruppo?: string; genitore?: string; consensoWhatsapp?: boolean; liv?: string; allergie?: string; note?: string }
    const updated = campusStore.upsertCliente(clienteId, {
      gruppo: body.gruppo,
      genitore: body.genitore,
      consensoWhatsapp: body.consensoWhatsapp,
      liv: body.liv,
      allergie: body.allergie,
      note: body.note,
    })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function patchCampusWeekNote(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })
    const clienteId = String(req.params.clienteId ?? "").trim()
    const weekKey = String(req.params.weekKey ?? "").trim()
    if (!clienteId || !weekKey) return res.status(400).json({ message: "parametri mancanti" })
    const body = (req.body ?? {}) as { note?: string; gruppo?: string }
    const updated = campusStore.upsertWeek(clienteId, weekKey, { note: body.note, gruppo: body.gruppo })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

function normNameKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function pickRowVal(row: Record<string, unknown>, key: string): string {
  const v = (row as any)[key]
  if (v == null) return ""
  return String(v).trim()
}

export async function importCampusPlanningExcel(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })
    const file = (req as any).file as { buffer?: Buffer } | undefined
    const buf = file?.buffer
    if (!buf || buf.length === 0) return res.status(400).json({ message: "File mancante" })

    // Costruisco mappa nome->clienteId dagli attuali campus in range.
    const rows = await gestionaleSql.queryAbbonamenti(undefined)
    const rangeFrom = firstMarchIsoItaly()
    const rangeTo = todayIsoItaly()
    const campusAbbonamenti = rows
      .map((r) => ({ r, a: rowToAbbonamento(r) }))
      .filter(({ a }) => isCampusAbb(a))
      .filter(({ a, r }) => campusAbbonamentoInDateRange(r as Record<string, unknown>, a, rangeFrom, rangeTo))
      .map(({ a }) => a)
    // Totale contrattuale dalla view pagamenti (RVW_AbbonamentiPagamentiUtenti): serve per acconti + rate.
    const totVendutoByIscrizione = new Map<string, number>()
    if (gestionaleSql.isGestionaleConfigured() && campusAbbonamenti.length > 0) {
      const ids = campusAbbonamenti.map((a) => a.id).filter(Boolean)
      const totRows = await gestionaleSql.queryAbbonamentiPagamentiTotaleCassaByIscrizione(ids)
      for (const r of totRows) {
        const id = String((r as any).IDIscrizione ?? (r as any).idIscrizione ?? "").trim()
        const tot = Number((r as any).Totale ?? (r as any).totale ?? 0) || 0
        if (id && tot > 0) totVendutoByIscrizione.set(id, tot)
      }
    }
    const nameToClienteId = new Map<string, string>()
    campusAbbonamenti.forEach((a) => {
      const k = normNameKey(a.clienteNome)
      if (k && !nameToClienteId.has(k)) nameToClienteId.set(k, a.clienteId)
    })

    const wb = XLSX.read(buf, { type: "buffer" })
    const sheetName = wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as Record<string, unknown>[]
    if (json.length === 0) return res.status(400).json({ message: "Foglio vuoto" })

    // Trovo la riga header che contiene 'gruppo' (sotto le settimane) per mappare weekHeader -> groupCol.
    const headerRow = json.find((r) => Object.values(r).some((v) => String(v).toLowerCase().includes("gruppo")))
    const keys = Object.keys(json[0] ?? {})
    const groupColByWeekStart = new Map<string, string>()
    if (headerRow) {
      for (const [weekStart, headerLabel] of Object.entries(EXCEL_WEEK_HEADERS)) {
        const idx = keys.indexOf(headerLabel)
        if (idx > 0) {
          const prevKey = keys[idx - 1]
          const prevVal = String((headerRow as any)[prevKey] ?? "").trim().toLowerCase()
          if (prevVal === "gruppo") groupColByWeekStart.set(weekStart, prevKey)
        }
      }
    }

    let updated = 0
    let skipped = 0

    for (const r of json) {
      const nome = pickRowVal(r, "COGNOME E NOME")
      const liv = pickRowVal(r, "LIV")
      const allergie = pickRowVal(r, "ALLERGIE")
      const genitore = pickRowVal(r, "GENITORE")
      const note = pickRowVal(r, "note")

      // Salta righe intestazione/vuote.
      const idxRaw = String((r as any).__EMPTY ?? "").trim()
      const idxNum = Number(idxRaw)
      if (!nome || !Number.isFinite(idxNum) || idxNum <= 0) continue

      const clienteId = nameToClienteId.get(normNameKey(nome))
      if (!clienteId) {
        skipped += 1
        continue
      }

      // Gruppo globale: primo gruppo trovato nelle settimane.
      let gruppoGlobal = ""
      for (const [weekStart, colKey] of groupColByWeekStart.entries()) {
        const v = pickRowVal(r, colKey)
        if (v) {
          gruppoGlobal = v
          // Salvo gruppo anche per la settimana specifica.
          campusStore.upsertWeek(clienteId, weekStart, { gruppo: v })
        }
      }

      campusStore.upsertCliente(clienteId, {
        liv: liv || undefined,
        allergie: allergie || undefined,
        genitore: genitore || undefined,
        note: note || undefined,
        gruppo: gruppoGlobal || undefined,
      })
      updated += 1
    }

    res.json({ ok: true, updated, skipped })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

