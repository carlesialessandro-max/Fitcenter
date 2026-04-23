import type { Request, Response } from "express"
import sql from "mssql"
import { getPool } from "../services/gestionale-sql.js"

type SqlViewInfo = { query: string; schema: string; name: string }

function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

type WeekdayKey = "lun" | "mar" | "mer" | "gio" | "ven" | "sab" | "dom"
function weekdayKeyIt(d: Date): WeekdayKey {
  // JS: 0=dom, 1=lun, ...
  const map: WeekdayKey[] = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"]
  return map[d.getDay()] ?? "lun"
}

function weekdayTokens(key: WeekdayKey): { abbr: string; full: string; fullNoAccent: string } {
  switch (key) {
    case "lun":
      return { abbr: "lun", full: "lunedì", fullNoAccent: "lunedi" }
    case "mar":
      return { abbr: "mar", full: "martedì", fullNoAccent: "martedi" }
    case "mer":
      return { abbr: "mer", full: "mercoledì", fullNoAccent: "mercoledi" }
    case "gio":
      return { abbr: "gio", full: "giovedì", fullNoAccent: "giovedi" }
    case "ven":
      return { abbr: "ven", full: "venerdì", fullNoAccent: "venerdi" }
    case "sab":
      return { abbr: "sab", full: "sabato", fullNoAccent: "sabato" }
    case "dom":
      return { abbr: "dom", full: "domenica", fullNoAccent: "domenica" }
  }
}

function yesLike(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase()
  return s === "si" || s === "sì" || s === "true" || s === "1" || s === "y" || s === "yes"
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
}

function anyStringFieldContains(raw: Record<string, unknown>, needle: string): boolean {
  const n = normalizeText(needle)
  if (!n) return false
  for (const v of Object.values(raw)) {
    if (typeof v !== "string") continue
    const hay = normalizeText(v)
    if (hay.includes(n)) return true
  }
  return false
}

function isRowForWeekday(raw: Record<string, unknown>, wk: { abbr: string; full: string; fullNoAccent: string }): boolean {
  // Caso 1: colonna tipo "Giovedì"/"Giovedi" = Si
  for (const [k, v] of Object.entries(raw)) {
    const kn = normalizeText(k)
    if (kn === wk.fullNoAccent) {
      if (yesLike(v)) return true
    }
  }

  // Caso 2: stringhe tipo "BAMBINI Gio" o simili
  const re = new RegExp(`\\b${wk.abbr}\\b`, "i")
  for (const v of Object.values(raw)) {
    if (typeof v !== "string") continue
    if (re.test(v)) return true
  }

  // Caso 3 (fallback): testo che contiene il nome giorno
  if (anyStringFieldContains(raw, wk.full) || anyStringFieldContains(raw, wk.fullNoAccent)) return true
  return false
}

function extractTimeHHmm(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  // "1899-12-30 17:45:00.000"
  const m1 = s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/)
  if (m1) return `${m1[1].padStart(2, "0")}:${m1[2]}`
  // "17.45-18.30"
  const m2 = s.match(/\b(\d{1,2})\.(\d{2})\b/)
  if (m2) return `${m2[1].padStart(2, "0")}:${m2[2]}`
  return null
}

function firstNonEmpty(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k]
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return null
}

function guessOrario(raw: Record<string, unknown>): { from: string | null; to: string | null; label: string | null } {
  const label =
    firstNonEmpty(raw, ["Orario", "OrarioCorso", "Turno", "DescrizioneOrario", "FasciaOraria"]) ??
    firstNonEmpty(raw, ["Descrizione", "NomeCorso", "Corso", "Servizio", "ServizioDescrizione", "CorsiDescrizione"])

  const from =
    extractTimeHHmm(firstNonEmpty(raw, ["OraInizio", "DalleOre", "Inizio", "OrarioInizio", "DataOraInizio"])) ??
    extractTimeHHmm(firstNonEmpty(raw, ["CorsiOraInizio", "CorsiDalleOre", "CorsiInizio", "Dalle"])) ??
    extractTimeHHmm(label)
  const to =
    extractTimeHHmm(firstNonEmpty(raw, ["OraFine", "AlleOre", "Fine", "OrarioFine", "DataOraFine"])) ??
    extractTimeHHmm(firstNonEmpty(raw, ["CorsiOraFine", "CorsiAlleOre", "CorsiFine", "Alle"])) ??
    null

  return { from, to, label }
}

function sqlViewInfo(): SqlViewInfo {
  const raw = (process.env.GESTIONALE_VIEW_CORSI_UTENTI ?? "RVW_CorsiUtenti").trim()
  const safe = raw && /^[A-Za-z0-9_\.\[\]]+$/.test(raw) ? raw : "RVW_CorsiUtenti"
  const cleaned = safe.replace(/[\[\]]/g, "")
  // Qualifica dbo se non è già qualificato
  if (cleaned.includes(".")) {
    const [schema, name] = cleaned.split(".", 2) as [string, string]
    const query = safe.includes("[") ? safe : safe.split(".").map((p) => `[${p}]`).join(".")
    return { query, schema: schema || "dbo", name: name || "RVW_CorsiUtenti" }
  }
  return { query: `[dbo].[${cleaned}]`, schema: "dbo", name: cleaned || "RVW_CorsiUtenti" }
}

let cachedCols: { key: string; cols: string[]; at: number } | null = null
async function getViewColumns(pool: sql.ConnectionPool, schema: string, name: string): Promise<string[]> {
  const cacheKey = `${schema}.${name}`.toLowerCase()
  const now = Date.now()
  if (cachedCols && cachedCols.key === cacheKey && now - cachedCols.at < 60_000) return cachedCols.cols

  const q = `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @name
    ORDER BY ORDINAL_POSITION
  `
  const r = await pool.request().input("schema", sql.NVarChar, schema).input("name", sql.NVarChar, name).query(q)
  const cols = (r.recordset ?? [])
    .map((x: any) => String(x?.COLUMN_NAME ?? "").trim())
    .filter(Boolean)
  cachedCols = { key: cacheKey, cols, at: now }
  return cols
}

function pickExistingColumn(cols: string[], candidates: string[]): string | null {
  const map = new Map(cols.map((c) => [normalizeText(c), c]))
  for (const cand of candidates) {
    const got = map.get(normalizeText(cand))
    if (got) return got
  }
  return null
}

export async function getScuolaNuotoToday(req: Request, res: Response) {
  const pool = await getPool()
  if (!pool) return res.status(503).json({ message: "SQL non configurato" })

  const now = new Date()
  const isoToday = toIsoDateLocal(now)
  const wk = weekdayTokens(weekdayKeyIt(now))

  const view = sqlViewInfo()

  let dateStartCol: string | null = null
  let dateEndCol: string | null = null
  try {
    const cols = await getViewColumns(pool, view.schema, view.name)
    dateStartCol = pickExistingColumn(cols, ["CorsiDataInizio", "corsidatainizio", "data_inizio_corso", "datainizio"])
    dateEndCol = pickExistingColumn(cols, ["CorsiDataFine", "corsidatafine", "data_fine_corso", "datafine"])
  } catch {
    // best effort: se non riusciamo a leggere metadata, proviamo query senza filtro colonne.
  }

  const where: string[] = []
  if (dateStartCol) where.push(`(TRY_CONVERT(date, [${dateStartCol}]) IS NULL OR TRY_CONVERT(date, [${dateStartCol}]) <= @today)`)
  if (dateEndCol) where.push(`(TRY_CONVERT(date, [${dateEndCol}]) IS NULL OR TRY_CONVERT(date, [${dateEndCol}]) >= @today)`)

  const q = `
    SELECT *
    FROM ${view.query}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
  `

  let rows: Record<string, unknown>[] = []
  try {
    const r = await pool.request().input("today", sql.Date, isoToday).query(q)
    rows = (r.recordset ?? []) as any
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    return res.status(500).json({
      message: "Query corsi fallita",
      detail: msg,
      debug: { view: view.query, startCol: dateStartCol, endCol: dateEndCol },
    })
  }

  const filtered = rows.filter((raw) => isRowForWeekday(raw, wk))

  type Participant = {
    nome: string | null
    cognome: string | null
    cellulare: string | null
    email: string | null
    eta: number | null
    raw?: Record<string, unknown>
  }

  type Group = {
    key: string
    corso: string
    oraInizio: string | null
    oraFine: string | null
    periodo: string | null
    istruttore: string | null
    vasca: string | null
    servizio: string | null
    utenti: Participant[]
  }

  const groups = new Map<string, Group>()

  for (const raw of filtered) {
    const nome = firstNonEmpty(raw, ["Nome", "nome", "UtenteNome", "ClienteNome", "AnagraficaNome"])
    const cognome = firstNonEmpty(raw, ["Cognome", "cognome", "UtenteCognome", "ClienteCognome", "AnagraficaCognome"])
    const cellulare = firstNonEmpty(raw, ["Cellulare", "Telefono", "Tel", "TelefonoCellulare"])
    const email = firstNonEmpty(raw, ["Email", "E-mail", "Mail"])
    const etaRaw = firstNonEmpty(raw, ["Eta", "Età", "Anni"])
    const eta = etaRaw != null && /^\d+$/.test(etaRaw.trim()) ? Number(etaRaw.trim()) : null

    const { from, to, label } = guessOrario(raw)
    const servizio =
      firstNonEmpty(raw, ["Servizio", "ServizioDescrizione", "Categoria", "TipoServizio"]) ??
      (label && label.includes("BAMBINI") ? "BAMBINI" : null)
    const vasca = firstNonEmpty(raw, ["Vasca", "VascaDescrizione", "Impianto", "Struttura"])
    const istruttore = firstNonEmpty(raw, ["Istruttore", "Docente", "Maestro", "Operatore", "Consulente", "Allenatore"])
    const periodo = firstNonEmpty(raw, ["Periodo", "CorsiPeriodo", "PeriodoDescrizione", "NomePeriodo"])
    const corsoName =
      firstNonEmpty(raw, ["Corso", "NomeCorso", "CorsiNome", "CorsiDescrizione", "DescrizioneCorso", "Descrizione"]) ??
      label ??
      "Corso"

    const key = `${normalizeText(servizio ?? "")}::${normalizeText(corsoName)}::${from ?? ""}-${to ?? ""}::${normalizeText(vasca ?? "")}::${normalizeText(istruttore ?? "")}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        key,
        corso: corsoName,
        oraInizio: from,
        oraFine: to,
        periodo,
        istruttore,
        vasca,
        servizio,
        utenti: [],
      })
    }

    groups.get(key)!.utenti.push({
      nome,
      cognome,
      cellulare,
      email,
      eta,
      raw: undefined,
    })
  }

  const out = Array.from(groups.values()).sort((a, b) => {
    const ta = (a.oraInizio ?? "99:99").replace(":", "")
    const tb = (b.oraInizio ?? "99:99").replace(":", "")
    if (ta !== tb) return ta.localeCompare(tb)
    return a.corso.localeCompare(b.corso)
  })

  return res.json({
    today: isoToday,
    weekday: wk.full,
    countRows: rows.length,
    countMatched: filtered.length,
    corsi: out,
  })
}

