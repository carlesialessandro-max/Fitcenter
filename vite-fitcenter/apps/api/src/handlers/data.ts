import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getMockDashboardStats } from "../data/mock-gestionale.js"
import { store as leadsStore } from "../store/leads.js"
import { budgetStore } from "../store/budget.js"
import * as budgetPerConsulente from "../store/budget-per-consulente.js"
import { store as chiamateStore } from "../store/chiamate.js"
import * as abbonamentiFollowUpStore from "../store/abbonamenti-follow-up.js"
import * as convalidazioniStore from "../store/convalidazioni-giorni.js"
import { store as oreLavorateStore } from "../store/ore-lavorate.js"
import { getOperatoreConsulenteNome, getScopedUser } from "../middleware/auth.js"
import { syncCrmTelefonateToStore } from "../services/sync-crm-chiamate.js"
import {
  bumpMetaVersion,
  cacheGet,
  cacheSet,
  getBudgetDepSig,
  baseAsOfDateKey,
  isTodayCacheAsOf,
} from "../services/persistent-cache.js"
import { rowToCliente, rowToAbbonamento } from "../data/map-sql-to-types.js"
import type {
  Cliente,
  Abbonamento,
  DashboardStats,
  DettaglioBlocco,
  DettaglioConsulente,
  DettaglioMeseResponse,
} from "../types/gestionale.js"

/** Budget mensile: solo valori salvati (somma consulenti o snapshot totale). */
function getBudgetListForYear(anno: number): { anno: number; mese: number; budget: number; vendite?: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mese = i + 1
    let budget = budgetPerConsulente.getTotaleMese(anno, mese)
    if (budget <= 0) {
      const snap = budgetStore.get(anno, mese)
      if (typeof snap === "number" && snap > 0) budget = snap
    }
    return { anno, mese, budget }
  })
}

function persistBudgetMeseSnapshot(anno: number, mese: number): void {
  const totale = budgetPerConsulente.getTotaleMese(anno, mese)
  if (totale > 0) budgetStore.set(anno, mese, totale)
}

function budgetConsulenteSalvato(anno: number, mese: number, label: string): number {
  return budgetPerConsulente.getSaved(anno, mese, label) ?? 0
}

/**
 * Parti data (anno, mese, giorno) per allineare i totali a SQL.
 * Default: UTC (il driver mssql spesso restituisce Date in UTC).
 * Se GESTIONALE_DATE_LOCALE=true: usa ora locale del server (prova se i totali con UTC non coincidono).
 */
function toDateParts(d: Date): { year: number; month: number; day: number } {
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  return {
    year: useLocal ? d.getFullYear() : d.getUTCFullYear(),
    month: (useLocal ? d.getMonth() : d.getUTCMonth()) + 1,
    day: useLocal ? d.getDate() : d.getUTCDate(),
  }
}

function parseAsOf(req: Request): { date: Date; key: string } {
  const raw = String(req.query.asOf ?? "").trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (m) {
    const year = Number(m[1])
    const month = Number(m[2])
    const day = Number(m[3])
    const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    const p = toDateParts(dt)
    const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 && !Number.isNaN(dt.getTime())) {
      return { date: dt, key }
    }
  }
  const dt = new Date()
  const p = toDateParts(dt)
  const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
  return { date: dt, key }
}

function parseIntParam(v: unknown, min: number, max: number): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const x = Math.floor(n)
  if (x < min) return min
  if (x > max) return max
  return x
}

/** Importo e data da riga MovimentiVenduto (nomi colonne comuni). */
function movimentoAmount(row: Record<string, unknown>): number {
  const v = row.Importo ?? row.Totale ?? row.ImportoVendita ?? row.Ammontare ?? row.Prezzo ?? 0
  return Number(v) || 0
}
function movimentoDate(row: Record<string, unknown>): Date | null {
  const d = row.Data ?? row.DataOperazione ?? row.DataVendita ?? row.DataMovimento
  if (d == null) return null
  const t = new Date(d as string | Date)
  return Number.isNaN(t.getTime()) ? null : t
}

/** Solo importi positivi: le vendite di abbonamenti non hanno segno negativo. */
function movimentoCountAsSale(row: Record<string, unknown>): boolean {
  return movimentoAmount(row) > 0
}

/** Fallback ID. Ombretta: 312,352,73 (dati in view sotto più nomi); totale mese con MAX per IDIscrizione. */
const CONSULENTE_NOME_TO_ID: Record<string, string> = {
  "carmen severino": process.env.CONSULENTE_ID_CARMEN ?? "336",
  "serena del prete": process.env.CONSULENTE_ID_SERENA ?? "348",
  "ombretta zenoni": process.env.CONSULENTE_ID_OMBRETTA ?? "312,352,73",
}

/** Converte stringa data (YYYY-MM-DD o DD/MM/YYYY) in timestamp per confronti. */
function parseDateToTime(s: string): number {
  if (!s || !s.trim()) return 0
  const t = s.trim()
  const iso = /^\d{4}-\d{2}-\d{2}/.test(t)
  if (iso) return new Date(t).getTime()
  const it = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (it) return new Date(+it[3], +it[2] - 1, +it[1]).getTime()
  const d = new Date(t).getTime()
  return Number.isNaN(d) ? 0 : d
}

/** Marca rinnovato=true se esiste un altro abbonamento dello stesso cliente con dataInizio > dataFine di questo. */
function markRinnovato(list: Abbonamento[]): void {
  // Versione ottimizzata: O(n) invece di O(n^2).
  // Per ogni cliente teniamo il massimo (dataInizio) e il secondo massimo, così
  // possiamo decidere rapidamente se esiste un "altro" abbonamento rinnovato.
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

    // Aggiorna top1/top2 mantenendo due migliori per tempo, evitando di "duplicare" l'id.
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

/** Allineato a KPI dashboard: esclusione tesseramenti. */
function isTesseramentoAbbForKpi(a: Abbonamento): boolean {
  return (
    a.isTesseramento === true ||
    (a.prezzo != null && Number(a.prezzo) === 39) ||
    (a.pianoNome ?? "").toLowerCase().includes("tesserament") ||
    ((a.pianoNome ?? "").toLowerCase().includes("asi") && (a.pianoNome ?? "").toLowerCase().includes("isc"))
  )
}

/**
 * Esclusioni macro/categoria per pagina Abbonamenti, report vendite consulenti, ecc.
 * Non si applica al KPI «abbonamenti attivi» né alla pagina analisi attivi (lì: solo tesseramenti).
 */
const EXCLUDE_MACRO_VENDITE_LISTE = new Set(["DANZA"])
// Non escludere "SCUOLA NUOTO": include anche vendite come "AGONISMO MASTER" e lezioni private adulti.
const EXCLUDE_CAT_DESC_VENDITE_LISTE = new Set(["ACQUATICITA", "CAMPUS SPORTIVI", "GESTANTI"])

function normalizeVenditeListeKey(s: string | undefined) {
  return (s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/'/g, "'")
}

function isEsclusoVenditeListe(a: {
  macroCategoriaDescrizione?: string
  categoriaAbbonamentoDescrizione?: string
}) {
  const macro = normalizeVenditeListeKey(a.macroCategoriaDescrizione)
  const cat = normalizeVenditeListeKey(a.categoriaAbbonamentoDescrizione)
  return (
    (Boolean(macro) && EXCLUDE_MACRO_VENDITE_LISTE.has(macro)) ||
    (Boolean(cat) && EXCLUDE_CAT_DESC_VENDITE_LISTE.has(cat))
  )
}

/** Abbonamenti attivi: finestra date + solo esclusione tesseramenti (tutte le altre categorie incluse). */
function filterAbbonamentiAttiviForKpi(abbonamenti: Abbonamento[], referenceDate: Date): Abbonamento[] {
  const oggi = toDateParts(referenceDate)
  const oggiTime = new Date(oggi.year, oggi.month - 1, oggi.day).getTime()
  return abbonamenti.filter((a) => {
    if (a.stato !== "attivo" || isTesseramentoAbbForKpi(a)) return false
    const inizio = new Date(String(a.dataInizio).trim().split("T")[0])
    const fine = new Date(String(a.dataFine).trim().split("T")[0])
    const tInizio = inizio.getTime()
    const tFine = fine.getTime()
    return !Number.isNaN(tInizio) && !Number.isNaN(tFine) && oggiTime >= tInizio && oggiTime <= tFine
  })
}

function inferDurataMesiAbb(a: Abbonamento): number | null {
  const d = a.durataMesi
  if (d != null && d >= 1 && d <= 120) return d
  const p = `${a.pianoNome ?? ""} ${a.abbonamentoDescrizione ?? ""} ${a.categoriaAbbonamentoDescrizione ?? ""}`.toUpperCase()
  if (/\bANNUAL/.test(p)) return 12
  if (/SEMESTR/.test(p)) return 6
  if (/TRIMESTR/.test(p)) return 3
  if (/MENSILE|\b1\s*MESE\b/.test(p)) return 1
  if (/BIENNAL/.test(p)) return 24
  return null
}

function bucketDurataLabel(m: number | null): string {
  if (m == null) return "Durata non nota"
  if (m <= 1) return "1 mese"
  if (m <= 3) return "2–3 mesi"
  if (m <= 6) return "4–6 mesi"
  if (m <= 12) return "7–12 mesi"
  return "Oltre 12 mesi"
}

/**
 * Stima «bambini» da testi gestionale (macro, categoria, piano).
 * Non c’è data di nascita nel payload abbonamento lato API.
 */
function isAbbonamentoBambiniEuristico(a: Abbonamento): boolean {
  const text = `${a.macroCategoriaDescrizione ?? ""} ${a.categoriaAbbonamentoDescrizione ?? ""} ${a.pianoNome ?? ""} ${a.abbonamentoDescrizione ?? ""}`
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  return (
    /\bBAMBIN[IO]\b/.test(text) ||
    /\bMINI\b/.test(text) ||
    /GIOVANISSIM/.test(text) ||
    /ESORDIEN/.test(text) ||
    /PREAGONISMO/.test(text) ||
    /PROPAGANDA/.test(text) ||
    /RAGAZZ/.test(text) ||
    /\bU(6|8|10|12|14)\b/.test(text) ||
    /PICCOLI/.test(text) ||
    /TEATRO/.test(text) ||
    (/\bAGONISMO\b/.test(text) && !/\bSENIOR\b/.test(text))
  )
}

/** Soglia anni: sotto = segmento «bambini» nei grafici attivi. Env ATTIVI_SOGLIA_ETA_ADULTI (default 18). */
function getSogliaEtaAdultiAnno(): number {
  const n = Number(process.env.ATTIVI_SOGLIA_ETA_ADULTI ?? 18)
  return Number.isFinite(n) && n > 0 && n <= 30 ? Math.floor(n) : 18
}

/** Preferisce età dal gestionale (clienteEta); se assente, stima da testi abbonamento. */
function isAbbonamentoBambini(a: Abbonamento): boolean {
  const eta = a.clienteEta
  if (eta != null && eta >= 0 && eta <= 120) return eta < getSogliaEtaAdultiAnno()
  return isAbbonamentoBambiniEuristico(a)
}

/** Se consulente (nome) è passato, risolve ID venditore (da DB o fallback env). */
async function resolveConsultantId(consulente: string | undefined): Promise<string | undefined> {
  if (!consulente?.trim()) return undefined
  const nome = consulente.trim()
  const key = nome.toLowerCase()
  // Preferisci mapping deterministico (env/fallback) per evitare fuzzy-match sulla view
  // che può includere ID di altri venditori e gonfiare i totali.
  const fixed = CONSULENTE_NOME_TO_ID[key]
  if (fixed) return fixed
  const id = await gestionaleSql.getConsultantIdUtente(nome)
  if (id) return id
  return undefined
}

function cacheScope(req: Request): string {
  const u = getScopedUser(req)
  if (u.role === "admin") return "admin"
  const nome = u.consulenteNome ?? u.nome ?? u.username
  return `operatore:${nome}`
}

const HISTORICAL_TTL_MS = Number(process.env.HISTORICAL_TTL_MS ?? 10 * 365 * 24 * 60 * 60 * 1000) // ~10 anni

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function getTodayKey(): string {
  const nowParts = toDateParts(new Date())
  return `${nowParts.year}-${pad2(nowParts.month)}-${pad2(nowParts.day)}`
}

function parseYmdKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

function lastDayOfMonthKey(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate()
  return `${year}-${pad2(month)}-${pad2(last)}`
}

function isPastCalendarMonth(anno: number, mese: number): boolean {
  const t = parseYmdKey(getTodayKey())
  if (!t) return false
  return anno < t.year || (anno === t.year && mese < t.month)
}

/** Per mesi già chiusi, i totali coincidono con l'ultimo giorno (allineato al precompute). */
function cacheAsOfKeyForTotals(asOfKey: string): string {
  if (isAsOfToday(asOfKey)) return asOfKey
  const p = parseYmdKey(asOfKey)
  const t = parseYmdKey(getTodayKey())
  if (!p || !t) return asOfKey
  const pastMonth = p.year < t.year || (p.year === t.year && p.month < t.month)
  if (pastMonth) return lastDayOfMonthKey(p.year, p.month)
  return asOfKey
}

function dettaglioMeseCacheLookup(
  asOfKey: string,
  anno: number,
  mese: number,
  giorno: number,
  consulente: string | undefined
): { cacheAsOf: string; cacheParams: { anno: number; mese: number; giorno: number; consulente: string | null } } {
  if (isPastCalendarMonth(anno, mese)) {
    const last = new Date(anno, mese, 0).getDate()
    return {
      cacheAsOf: lastDayOfMonthKey(anno, mese),
      cacheParams: { anno, mese, giorno: last, consulente: consulente ?? null },
    }
  }
  return {
    cacheAsOf: cacheAsOfKeyForTotals(asOfKey),
    cacheParams: { anno, mese, giorno, consulente: consulente ?? null },
  }
}

function dettaglioAnnoCacheAsOf(anno: number, asOfKey: string): string {
  const t = parseYmdKey(getTodayKey())
  if (!t) return asOfKey
  if (anno < t.year) return `${anno}-12-31`
  return cacheAsOfKeyForTotals(asOfKey)
}

function isAsOfToday(asOfKey: string): boolean {
  return isTodayCacheAsOf(asOfKey, getTodayKey())
}

/** Chiave cache «oggi»: blocco orario (es. 2026-05-20T14) — istantaneo se esci e rientri nella stessa ora. */
function todayHourCacheKey(dateKey: string): string {
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  const d = new Date()
  const h = useLocal ? d.getHours() : d.getUTCHours()
  return `${baseAsOfDateKey(dateKey)}T${pad2(h)}`
}

/** TTL cache oggi: fino al cambio ora (override con TODAY_CACHE_TTL_MS, min 60s). */
function getTodayCacheTtlMs(): number {
  const env = Number(process.env.TODAY_CACHE_TTL_MS)
  if (Number.isFinite(env) && env >= 60_000) return env
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  const d = new Date()
  const min = useLocal ? d.getMinutes() : d.getUTCMinutes()
  const sec = useLocal ? d.getSeconds() : d.getUTCSeconds()
  return Math.max(60_000, ((59 - min) * 60 + (59 - sec) + 1) * 1000)
}

function getCacheTtlMsForAsOf(asOfKey: string, _fallbackMs: number): number {
  return isAsOfToday(asOfKey) ? getTodayCacheTtlMs() : HISTORICAL_TTL_MS
}

/**
 * Per i totali storici (asOf != oggi) vogliamo una cache "definitiva":
 * non deve dipendere da depSig che cambia (budget/chiamate/convalidazioni).
 * Per questo, congeliamo depSig in cache per asOf storici.
 */
function getFrozenDepSig(asOfKey: string, depSig: string): string {
  return isAsOfToday(asOfKey) ? depSig : `frozen:${asOfKey}`
}

// Evita che React Query rimanga in loading infinito quando SQL non risponde.
const DASHBOARD_SQL_TIMEOUT_MS = Number(process.env.DASHBOARD_SQL_TIMEOUT_MS ?? 45_000)
function withDashboardSqlTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("__FITCENTER_DASHBOARD_SQL_TIMEOUT__")), DASHBOARD_SQL_TIMEOUT_MS)
    ),
  ])
}

export async function getDashboard(req: Request, res: Response) {
  try {
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulente = operatoreNome ?? ((req.query.consulente as string) || undefined)
    const scope = cacheScope(req)
    const asOf = parseAsOf(req)
    const cacheAsOf = cacheAsOfKeyForTotals(asOf.key)
    const depSig = getFrozenDepSig(cacheAsOf, await getBudgetDepSig())
    const cacheKeyParams = { consulente: consulente ?? null }
    const cached = await cacheGet<DashboardStats>({
      name: "data.dashboard",
      scope,
      params: cacheKeyParams,
      asOf: cacheAsOf,
      depSig,
    })
    if (cached) return res.json(cached)
    const fromSql = gestionaleSql.isGestionaleConfigured()
    if (fromSql) {
      try {
        const stats = await withDashboardSqlTimeout(
          (async (): Promise<DashboardStats> => {
            const idUtente = await resolveConsultantId(consulente)
            const oggi = toDateParts(asOf.date)
            const anno = oggi.year
            const mese = oggi.month
            let venditeMeseSql: number
            let venditePerMeseSql: { mese: number; totale: number }[]
            if (consulente == null || consulente === "") {
              const labels = budgetPerConsulente.getConsulentiLabels()
              const idParts = await Promise.all(labels.map((label) => resolveConsultantId(label)))
              const mergedIds = gestionaleSql.mergeConsultantIdStrings(idParts)
              // Storico: solo totali vendite (immutabili); evita queryAbbonamenti pesante su cache miss.
              const abbonamentiRows = isAsOfToday(asOf.key)
                ? await gestionaleSql.queryAbbonamenti(undefined)
                : []
              if (mergedIds) {
                const [prog, perMeseRaw] = await Promise.all([
                  gestionaleSql.getVenditeProgressivoMese(anno, mese, oggi.day, mergedIds),
                  gestionaleSql.getVenditePerMeseAnno(anno, mergedIds),
                ])
                venditeMeseSql = prog
                const mapMese = new Map<number, number>()
                for (const row of perMeseRaw) {
                  mapMese.set(row.mese, row.totale)
                }
                venditePerMeseSql = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
                  mese: m,
                  totale: mapMese.get(m) ?? 0,
                }))
              } else {
                const venditeResults = await Promise.all(
                  labels.map(async (label) => {
                    const id = await resolveConsultantId(label)
                    const [prog, perMese] = await Promise.all([
                      gestionaleSql.getVenditeProgressivoMese(anno, mese, oggi.day, id),
                      gestionaleSql.getVenditePerMeseAnno(anno, id),
                    ])
                    return { prog, perMese }
                  })
                )
                venditeMeseSql = venditeResults.reduce((s, r) => s + r.prog, 0)
                const mapMese = new Map<number, number>()
                for (const r of venditeResults) {
                  for (const row of r.perMese) {
                    mapMese.set(row.mese, (mapMese.get(row.mese) ?? 0) + row.totale)
                  }
                }
                venditePerMeseSql = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
                  mese: m,
                  totale: mapMese.get(m) ?? 0,
                }))
              }
              const abbonamenti = abbonamentiRows.map((r) => rowToAbbonamento(r))
              markRinnovato(abbonamenti)
              const leads = leadsStore.list({})
              const leadTotali = leads.length
              const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
              const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
              const budgetList = getBudgetListForYear(anno)
              const leadRowsForFonte = leads.map((l) => ({ Fonte: l.fonte, fonte: l.fonte }))
              return buildDashboardFromData(
                [],
                abbonamenti,
                budgetList,
                leadTotali,
                leadVinti,
                leadPersi,
                leadRowsForFonte,
                undefined,
                venditeMeseSql,
                venditePerMeseSql,
                asOf.date
              )
            }
            const [abbonamentiRows, venditeMeseSqlSingle, venditePerMeseSqlSingle] = await Promise.all([
              isAsOfToday(asOf.key) ? gestionaleSql.queryAbbonamenti(idUtente) : Promise.resolve([]),
              gestionaleSql.getVenditeProgressivoMese(anno, mese, oggi.day, idUtente),
              gestionaleSql.getVenditePerMeseAnno(anno, idUtente),
            ])
            venditeMeseSql = venditeMeseSqlSingle
            venditePerMeseSql = venditePerMeseSqlSingle
            const abbonamenti = abbonamentiRows.map((r) => rowToAbbonamento(r))
            markRinnovato(abbonamenti)
            const leads = leadsStore.list({})
            const leadTotali = leads.length
            const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
            const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
            const budgetList = getBudgetListForYear(anno)
            const leadRowsForFonte = leads.map((l) => ({ Fonte: l.fonte, fonte: l.fonte }))
            return buildDashboardFromData(
              [],
              abbonamenti,
              budgetList,
              leadTotali,
              leadVinti,
              leadPersi,
              leadRowsForFonte,
              undefined,
              venditeMeseSql,
              venditePerMeseSql,
              asOf.date
            )
          })()
        )
        await cacheSet({
          name: "data.dashboard",
          scope,
          params: cacheKeyParams,
          asOf: cacheAsOf,
          depSig,
          ttlMs: getCacheTtlMsForAsOf(cacheAsOf, 0),
          value: stats,
        })
        return res.json(stats)
      } catch (e) {
        if ((e as Error).message !== "__FITCENTER_DASHBOARD_SQL_TIMEOUT__") throw e
        const leads = leadsStore.list({})
        const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
        const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
        const stats = getMockDashboardStats(leads.length, leadVinti, leadPersi, consulente)
        if (isAsOfToday(asOf.key)) {
          // Solo "oggi": ha senso cacheare rapidamente un mock temporaneo.
          await cacheSet({
            name: "data.dashboard",
            scope,
            params: cacheKeyParams,
            asOf: cacheAsOf,
            depSig,
            ttlMs: 10_000,
            value: stats,
          })
        }
        return res.json(stats)
      }
    }
    const leads = leadsStore.list({})
    const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
    const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
    const stats = getMockDashboardStats(leads.length, leadVinti, leadPersi, consulente)
    await cacheSet({
      name: "data.dashboard",
      scope,
      params: cacheKeyParams,
      asOf: cacheAsOf,
      depSig,
      ttlMs: getCacheTtlMsForAsOf(cacheAsOf, 0),
      value: stats,
    })
    res.json(stats)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}


function buildDashboardFromData(
  clienti: Cliente[],
  abbonamenti: Abbonamento[],
  budget: { anno: number; mese: number; budget: number; vendite?: number }[],
  leadTotali: number,
  leadVinti: number,
  leadPersi: number,
  leadRows?: Record<string, unknown>[],
  movimentiVenduto?: Record<string, unknown>[],
  venditeMeseSql?: number,
  venditePerMeseSql?: { mese: number; totale: number }[],
  referenceDate?: Date
): DashboardStats {
  const now = referenceDate ? new Date(referenceDate) : new Date()
  const oggi = toDateParts(now)
  const anno = oggi.year
  const mese = oggi.month
  const attivi = filterAbbonamentiAttiviForKpi(abbonamenti, now)
  const in30 = new Date(now)
  in30.setDate(in30.getDate() + 30)
  const in60 = new Date(now)
  in60.setDate(in60.getDate() + 60)
  // In scadenza: stessi «attivi» del KPI (tutte le categorie tranne tesseramenti), non già rinnovati.
  const inScadenza = attivi.filter((a) => a.rinnovato !== true && new Date(a.dataFine) <= in30)
  const inScadenza60 = attivi.filter((a) => a.rinnovato !== true && new Date(a.dataFine) <= in60)
  const budgetCorrente = budget.find((b) => b.anno === anno && b.mese === mese)
  const budgetVal = budgetCorrente?.budget && budgetCorrente.budget > 0 ? budgetCorrente.budget : 0
  /** Totale anno = somma esatta dei budget mese (ogni mese = somma Carmen + Serena + Ombretta). */
  const budgetAnno = Math.round(
    budget
      .filter((b) => b.anno === anno)
      .reduce((s, b) => s + b.budget, 0)
  )
  const mesi = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]

  const useSqlTotals = venditeMeseSql !== undefined && venditePerMeseSql !== undefined
  const venditePerMeseMap = useSqlTotals
    ? new Map(venditePerMeseSql.map((x) => [x.mese, x.totale]))
    : null

  const venditeFromMovimenti = useSqlTotals || (movimentiVenduto && movimentiVenduto.length > 0)
  const venditeMese = useSqlTotals
    ? venditeMeseSql!
    : venditeFromMovimenti
      ? (movimentiVenduto as Record<string, unknown>[])
          .filter((r) => {
            const d = movimentoDate(r)
            if (!d || !movimentoCountAsSale(r)) return false
            const p = toDateParts(d)
            return p.year === anno && p.month === mese
          })
          .reduce((s, r) => s + movimentoAmount(r), 0)
      : abbonamenti
          .filter((a) => !a.isTesseramento && !isEsclusoVenditeListe(a))
          .filter((a) => {
            const inizio = new Date(a.dataInizio)
            return inizio.getFullYear() === anno && inizio.getMonth() + 1 === mese
          })
          .reduce((s, a) => s + a.prezzo, 0)

  const venditePerMese = budget.slice(0, 12).map((b) => {
    const vendite =
      useSqlTotals && venditePerMeseMap
        ? venditePerMeseMap.get(b.mese) ?? 0
        : venditeFromMovimenti
          ? (movimentiVenduto as Record<string, unknown>[])
              .filter((r) => {
                const d = movimentoDate(r)
                if (!d || !movimentoCountAsSale(r)) return false
                const p = toDateParts(d)
                return p.year === b.anno && p.month === b.mese
              })
              .reduce((s, r) => s + movimentoAmount(r), 0)
          : abbonamenti
              .filter((a) => !a.isTesseramento && !isEsclusoVenditeListe(a))
              .filter((a) => {
                const inizio = new Date(a.dataInizio)
                return inizio.getFullYear() === b.anno && inizio.getMonth() + 1 === b.mese
              })
              .reduce((s, a) => s + a.prezzo, 0)
    const pct = b.budget ? Math.round((vendite / b.budget) * 1000) / 10 : 0
    return {
      mese: mesi[b.mese - 1],
      anno: b.anno,
      meseNum: b.mese,
      vendite,
      budget: b.budget,
      percentuale: pct,
    }
  })

  const clientiAttivi =
    clienti.length > 0
      ? clienti.filter((c) => c.stato === "attivo").length
      : new Set(attivi.map((a) => a.clienteId)).size

  const catCount: Record<string, number> = {}
  attivi.forEach((a) => {
    catCount[a.categoria] = (catCount[a.categoria] ?? 0) + 1
  })
  const catLabels: Record<string, string> = {
    palestra: "Palestra",
    piscina: "Piscina",
    spa: "Spa",
    corsi: "Corsi",
    full_premium: "Full",
  }
  return {
    leadTotali,
    leadVinti,
    leadPersi,
    abbonamentiAttivi: attivi.length,
    abbonamentiInScadenza: inScadenza.length,
    abbonamentiInScadenza60: inScadenza60.length,
    entrateMese: venditeMese,
    budgetMese: budgetVal,
    budgetAnno,
    percentualeBudget: budgetVal ? Math.round((venditeMese / budgetVal) * 1000) / 10 : 0,
    tassoConversione: leadTotali ? Math.round((leadVinti / leadTotali) * 1000) / 10 : 0,
    clientiAttivi,
    venditePerMese,
    leadPerFonte: (() => {
      if (!leadRows?.length) return [{ fonte: "Sito Web", count: 0 }, { fonte: "Google", count: 0 }, { fonte: "Facebook", count: 0 }]
      const byFonte: Record<string, number> = {}
      leadRows.forEach((r) => {
        const f = String(r.Fonte ?? r.fonte ?? r.Source ?? r.source ?? "Altro")
        const label = f === "website" ? "Sito Web" : f === "google" ? "Google" : f === "facebook" ? "Facebook" : f
        byFonte[label] = (byFonte[label] ?? 0) + 1
      })
      return Object.entries(byFonte).map(([fonte, count]) => ({ fonte, count }))
    })(),
    abbonamentiPerCategoria: Object.entries(catCount).map(([k, v]) => ({ categoria: catLabels[k] ?? k, count: v })),
    abbonamentiInScadenzaLista: [],
    abbonamentiInScadenza60Lista: [],
  }
}

type FasciaRossiVerdi = "rossi" | "verdi" | "altro"
type FasciaRossiVerdiAgg = FasciaRossiVerdi | "misto"

type FasciaCounts = { rossi: number; verdi: number; altro: number }

function normalizeAttiviBlob(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Rossi / Verdi da testi gestionale (categoria, piano, abbonamento). */
function inferFasciaRossiVerdi(a: Abbonamento): FasciaRossiVerdi {
  const blob = normalizeAttiviBlob(
    `${a.categoriaAbbonamentoDescrizione ?? ""} ${a.abbonamentoDescrizione ?? ""} ${a.pianoNome ?? ""} ${a.macroCategoriaDescrizione ?? ""}`
  )
  if (/\bVERDI\b/.test(blob) || blob.includes("ORARIO RIDOTTO")) return "verdi"
  if (/\bROSSI\b/.test(blob) || blob.includes("ORARIO LIBERO")) return "rossi"
  if (/\bOPEN\b/.test(blob) && !/\bVERDI\b/.test(blob)) return "rossi"
  return "altro"
}

function fasciaFromCounts(c: FasciaCounts): FasciaRossiVerdiAgg {
  const parts = [c.rossi > 0, c.verdi > 0, c.altro > 0].filter(Boolean).length
  if (parts > 1) return "misto"
  if (c.rossi > 0) return "rossi"
  if (c.verdi > 0) return "verdi"
  return "altro"
}

function sottocategoriaLabelAttivi(a: Abbonamento, categoria: string): string {
  const catN = normalizeAttiviBlob(categoria)
  const abb = (a.abbonamentoDescrizione ?? "").trim()
  const piano = (a.pianoNome ?? "").trim()
  if (abb && normalizeAttiviBlob(abb) !== catN) return abb
  if (piano && normalizeAttiviBlob(piano) !== catN && normalizeAttiviBlob(piano) !== normalizeAttiviBlob(abb)) return piano
  if (abb) return abb
  if (piano) return piano
  return "Piano non specificato"
}

function byFasciaRossiVerdi(rows: Abbonamento[]): FasciaCounts {
  const c: FasciaCounts = { rossi: 0, verdi: 0, altro: 0 }
  for (const a of rows) c[inferFasciaRossiVerdi(a)]++
  return c
}

function byCategoriaDettaglio(rows: Abbonamento[], categoriaLabelFn: (a: Abbonamento) => string) {
  type CatAcc = { totale: number; byFascia: FasciaCounts; subs: Map<string, FasciaCounts & { totale: number }> }
  const m = new Map<string, CatAcc>()
  for (const a of rows) {
    const cat = categoriaLabelFn(a)
    let acc = m.get(cat)
    if (!acc) {
      acc = { totale: 0, byFascia: { rossi: 0, verdi: 0, altro: 0 }, subs: new Map() }
      m.set(cat, acc)
    }
    acc.totale++
    const fascia = inferFasciaRossiVerdi(a)
    acc.byFascia[fascia]++
    const sub = sottocategoriaLabelAttivi(a, cat)
    const subPrev = acc.subs.get(sub)
    if (!subPrev) acc.subs.set(sub, { totale: 1, rossi: fascia === "rossi" ? 1 : 0, verdi: fascia === "verdi" ? 1 : 0, altro: fascia === "altro" ? 1 : 0 })
    else {
      subPrev.totale++
      subPrev[fascia]++
    }
  }
  return Array.from(m.entries())
    .map(([categoria, acc]) => ({
      categoria,
      totale: acc.totale,
      fascia: fasciaFromCounts(acc.byFascia),
      byFascia: acc.byFascia,
      sottocategorie: Array.from(acc.subs.entries())
        .map(([sottocategoria, sub]) => ({
          sottocategoria,
          totale: sub.totale,
          fascia: fasciaFromCounts(sub),
          byFascia: { rossi: sub.rossi, verdi: sub.verdi, altro: sub.altro },
        }))
        .sort((a, b) => b.totale - a.totale || a.sottocategoria.localeCompare(b.sottocategoria, "it")),
    }))
    .sort((a, b) => b.totale - a.totale || a.categoria.localeCompare(b.categoria, "it"))
}

/** Admin: attivi per KPI, ripartiti per durata (fascia) e stima adulti / bambini. */
export async function getAbbonamentiAttiviAnalisi(req: Request, res: Response) {
  try {
    const { date, key } = parseAsOf(req)
    let list: Abbonamento[] = []
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryAbbonamenti(undefined)
      list = rows.map((r) => rowToAbbonamento(r))
    } else {
      const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
      list = [...mockAbbonamenti]
    }
    markRinnovato(list)
    let attivi = filterAbbonamentiAttiviForKpi(list, date)

    const soglia = getSogliaEtaAdultiAnno()

    // Dedupe bambini: lo stesso cliente iscritto a più corsi va contato una sola volta.
    // Regola scelta: tiene la durata inferita più alta (se esiste un valore).
    const dedupBambiniByClienteId = (rows: Abbonamento[]): Abbonamento[] => {
      const byCliente = new Map<string, Abbonamento>()
      for (const a of rows) {
        const id = String(a.clienteId ?? "").trim()
        if (!id) continue
        const prev = byCliente.get(id)
        if (!prev) {
          byCliente.set(id, a)
          continue
        }
        const dPrev = inferDurataMesiAbb(prev)
        const dNext = inferDurataMesiAbb(a)
        if (dPrev == null && dNext != null) {
          byCliente.set(id, a)
          continue
        }
        if (dNext != null && (dPrev == null || dNext > dPrev)) {
          byCliente.set(id, a)
          continue
        }
      }
      return Array.from(byCliente.values())
    }
    const orderDurata = ["1 mese", "2–3 mesi", "4–6 mesi", "7–12 mesi", "Oltre 12 mesi", "Durata non nota"] as const
    const byDurata = (rows: Abbonamento[]) => {
      const mCount = new Map<string, number>()
      const mMesi = new Map<string, number>()
      for (const a of rows) {
        const label = bucketDurataLabel(inferDurataMesiAbb(a))
        mCount.set(label, (mCount.get(label) ?? 0) + 1)
        const mesi = inferDurataMesiAbb(a) ?? 0
        mMesi.set(label, (mMesi.get(label) ?? 0) + mesi)
      }
      return orderDurata.map((durata) => ({
        durata,
        count: mCount.get(durata) ?? 0,
        totaleDurataMesi: mMesi.get(durata) ?? 0,
      }))
    }
    const categoriaLabel = (a: Abbonamento) =>
      (a.categoriaAbbonamentoDescrizione ?? a.macroCategoriaDescrizione ?? a.categoria ?? "ALTRO").toString().trim() || "ALTRO"
    const normalizeCategoria = (s: string) =>
      s
        .toUpperCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/\s+/g, " ")
        .trim()
    const adultiCategoriaEscluse = new Set(["QUOTE DANZA", "DANZA ADULTI", "DANZA BAMBINI", "PROFESSIONALE", "INVITO"])
    const isGestantiCategoria = (a: Abbonamento) => normalizeCategoria(categoriaLabel(a)).includes("GESTANTI")
    const isAdultiCategoriaEsclusa = (a: Abbonamento) => adultiCategoriaEscluse.has(normalizeCategoria(categoriaLabel(a)))
    const byCategoria = (rows: Abbonamento[]) => {
      const m = new Map<string, number>()
      for (const a of rows) {
        const label = categoriaLabel(a)
        m.set(label, (m.get(label) ?? 0) + 1)
      }
      return Array.from(m.entries())
        .map(([categoria, totale]) => ({ categoria, totale }))
        .sort((a, b) => b.totale - a.totale || a.categoria.localeCompare(b.categoria))
    }

    const adultiRaw = attivi.filter((a) => !isAbbonamentoBambini(a))
    const bambiniRaw = attivi.filter((a) => isAbbonamentoBambini(a))
    // Regole business applicate in modo unico a TUTTI i blocchi (card/grafici/liste),
    // così i totali tornano sempre con la somma per categoria.
    const adulti = adultiRaw.filter((a) => !isAdultiCategoriaEsclusa(a) && !isGestantiCategoria(a))
    const bambini = dedupBambiniByClienteId([...bambiniRaw, ...adultiRaw.filter((a) => isGestantiCategoria(a))])
    const attiviSegmentati = [...adulti, ...bambini]
    const conEta = attiviSegmentati.filter((a) => a.clienteEta != null).length

    const durataMesiForTotal = (a: Abbonamento) => inferDurataMesiAbb(a) ?? 0
    const sumDurataMesi = (rows: Abbonamento[]) => rows.reduce((s, a) => s + durataMesiForTotal(a), 0)
    const adultiTotDurataMesi = sumDurataMesi(adulti)
    const bambiniTotDurataMesi = sumDurataMesi(bambini)
    const totaleDurataMesi = adultiTotDurataMesi + bambiniTotDurataMesi

    const totaleAttiviSegmentati = attiviSegmentati.length
    const notaClassificazione =
      totaleAttiviSegmentati === 0
        ? "Nessun abbonamento attivo nel periodo."
        : conEta === totaleAttiviSegmentati
          ? `Adulti / bambini: età dal gestionale (colonna Eta / join utenti). Minori di ${soglia} anni = bambini. Fasce durata: DurataMesi o parole chiave nel nome abbonamento.`
          : conEta > 0
            ? `Adulti / bambini: dove c’è l’età (${conEta} su ${totaleAttiviSegmentati} attivi) si usa il gestionale (< ${soglia} anni = bambini); per gli altri resta la stima da macro/categorie. Durata: campi DurataMesi/Durata o testo (annuale, mensile, …).`
            : `Nessuna età nelle righe: classificazione adulti/bambini solo da testi (macro, categoria, piano). Se l'età è nella view abbonamenti (a.*), verifica il nome colonna nel mapping. Se è solo su Utenti, imposta in .env GESTIONALE_UTENTI_COL_ETA=<nome_esatto_colonna>. Soglia anni: ATTIVI_SOGLIA_ETA_ADULTI=${soglia}.`

    res.json({
      asOf: key,
      sogliaEtaAdulti: soglia,
      attiviConEta: conEta,
      totaleAttivi: totaleAttiviSegmentati,
      totaleDurataMesi,
      adulti: {
        totale: adulti.length,
        totaleDurataMesi: adultiTotDurataMesi,
        byDurata: byDurata(adulti),
        byCategoria: byCategoria(adulti),
        byCategoriaDettaglio: byCategoriaDettaglio(adulti, categoriaLabel),
        byFasciaRossiVerdi: byFasciaRossiVerdi(adulti),
      },
      bambini: {
        totale: bambini.length,
        totaleDurataMesi: bambiniTotDurataMesi,
        byDurata: byDurata(bambini),
        byCategoria: byCategoria(bambini),
        byCategoriaDettaglio: byCategoriaDettaglio(bambini, categoriaLabel),
        byFasciaRossiVerdi: byFasciaRossiVerdi(bambini),
      },
      notaClassificazione,
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Danza: abbonamenti attivi oggi filtrati su categoria DANZA (drilldown client). */
export async function getDanzaAttiviOggi(req: Request, res: Response) {
  try {
    const now = new Date()
    const todayIso = now.toISOString().slice(0, 10)
    let rawRows: Record<string, unknown>[] = []
    if (gestionaleSql.isGestionaleConfigured()) {
      rawRows = await gestionaleSql.queryAbbonamenti(undefined)
    } else {
      const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
      // Mock: ricostruiamo righe "raw" minime partendo dal tipo Abbonamento.
      rawRows = mockAbbonamenti.map((a) => ({
        IDIscrizione: a.id,
        IDUtente: a.clienteId,
        ClienteCognome: (a.clienteNome ?? "").split(" ").slice(0, 1).join(" "),
        ClienteNome: (a.clienteNome ?? "").split(" ").slice(1).join(" "),
        ClienteEmail: "",
        ClienteSms: "",
        AbbonamentoDescrizione: a.abbonamentoDescrizione ?? a.pianoNome,
        CategoriaAbbonamentoDescrizione: a.categoriaAbbonamentoDescrizione ?? "DANZA",
        MacroCategoriaAbbonamentoDescrizione: a.macroCategoriaDescrizione ?? "",
        DataInizio: a.dataInizio,
        DataFine: a.dataFine,
        Totale: a.prezzo,
        // Mock pagamento: consideriamo non pagato.
        ImportoPagato: 0,
        DaPagare: a.prezzo,
        Residuo: a.prezzo,
        StatoPagamento: "NON PAGATO",
      }))
    }

    const norm = (s: string) =>
      s
        .toUpperCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/\s+/g, " ")
        .trim()
    const isDanzaRow = (row: Record<string, unknown>, a: Abbonamento) => {
      const cat = norm(String(row.CategoriaAbbonamentoDescrizione ?? a.categoriaAbbonamentoDescrizione ?? a.categoria ?? ""))
      const macro = norm(String(row.MacroCategoriaAbbonamentoDescrizione ?? a.macroCategoriaDescrizione ?? ""))
      const piano = norm(String(row.AbbonamentoDescrizione ?? a.pianoNome ?? ""))
      return cat === "DANZA" || cat.includes("DANZA") || macro.includes("DANZA") || piano.includes("DANZA")
    }

    const pick = (raw: any, keys: string[]) => {
      for (const k of keys) {
        const v = raw?.[k]
        if (v == null) continue
        const s = String(v).trim()
        if (s) return s
      }
      return null
    }

    const pickNum = (raw: any, keys: string[]): number | null => {
      for (const k of keys) {
        const v = raw?.[k]
        if (v == null || String(v).trim() === "") continue
        const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
        if (Number.isFinite(n)) return n
      }
      return null
    }

    type DanzaItem = {
      idIscrizione: string
      clienteId: string
      clienteNome: string
      email: string | null
      telefono: string | null
      abbonamento: string | null
      categoria: string
      microcategoria: string
      scadenza: string | null
      dataInizio: string // YYYY-MM-DD
      dataFine: string // YYYY-MM-DD
      totale: number
      pagato: number
      daPagare: number
    }

    const parseItDateOnly = (v: unknown): string | null => {
      if (v == null) return null
      const s = String(v).trim()
      if (!s) return null
      // placeholder comuni per "non pagato"
      if (s === "0" || s === "0.00.00" || s === "0,00,00" || s === "00/00/0000" || s === "00/00/0000 0.00.00") return null
      // es: "30/04/2026 0.00.00"
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (m) {
        const iso = `${m[3]}-${m[2]}-${m[1]}`
        if (iso === "1900-01-01") return null
        return iso
      }
      const d = new Date(s as any)
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString().slice(0, 10)
        if (iso === "1900-01-01") return null
        // "0" su alcuni parser -> 1970-01-01
        if (iso === "1970-01-01" && (s === "0" || s === "0.0" || s === "0.00")) return null
        return iso
      }
      return null
    }

    const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "")
    const rowGetNorm = (row: any, wants: string[]): unknown => {
      const keys = Object.keys(row ?? {})
      if (!keys.length) return undefined
      const map = new Map<string, string>()
      for (const k of keys) map.set(normKey(k), k)
      for (const w of wants) {
        const hit = map.get(normKey(w))
        if (hit != null) return row[hit]
      }
      return undefined
    }

    let minDataInizioIso: string | null = null
    const itemsAll: DanzaItem[] = []
    const itemsDanza: DanzaItem[] = []
    const rateAggByIscrizione = new Map<string, { paid: number; due: number }>()
    const cassaPaidByIscrizione = new Map<string, number>()
    const totaleByIscrizione = new Map<string, number>()
    for (const row of rawRows) {
      const a = rowToAbbonamento(row)
      const di = String(a.dataInizio ?? "").slice(0, 10)
      const df = String(a.dataFine ?? "").slice(0, 10)
      if (!di || !df || di > todayIso || df < todayIso) continue
      const isDanza = isDanzaRow(row, a)
      if (!minDataInizioIso || di < minDataInizioIso) minDataInizioIso = di

      // Rate: preferiamo questa fonte se disponibile (Data Rata / Data Pagato / Abbonamenti Pagamenti Importo).
      const idIscrAgg =
        String(a.id ?? rowGetNorm(row, ["ID Iscrizione", "IDIscrizione", "IdIscrizione"]) ?? row.IDIscrizione ?? "").trim() ||
        String(row.IDIscrizione ?? "")

      // Regola richiesta: pagato = CassaMovimentiImporto, totale = Totale, daPagare = Totale - pagato (tutto sulla stessa riga/view)
      const totaleRow =
        pickNum(row, ["Totale", "totale", "Importo", "Prezzo"]) ??
        (() => {
          const v = rowGetNorm(row, ["Totale", "totale", "Importo", "Prezzo"])
          if (v == null || String(v).trim() === "") return null
          const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
          return Number.isFinite(n) ? n : null
        })()
      const cassaMovImpRow =
        pickNum(row, ["Cassa Movimenti Importo", "CassaMovimentiImporto", "CassaMovimenti Importo", "Cassamovimentiimporto"]) ??
        (() => {
          const v = rowGetNorm(row, ["Cassa Movimenti Importo", "CassaMovimentiImporto", "Cassamovimentiimporto"])
          if (v == null || String(v).trim() === "") return null
          const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
          return Number.isFinite(n) ? n : null
        })()
      if (idIscrAgg) {
        if (totaleRow != null && totaleRow > 0) {
          totaleByIscrizione.set(idIscrAgg, Math.max(totaleByIscrizione.get(idIscrAgg) ?? 0, totaleRow))
        }
        if (cassaMovImpRow != null && cassaMovImpRow >= 0) {
          cassaPaidByIscrizione.set(idIscrAgg, Math.max(cassaPaidByIscrizione.get(idIscrAgg) ?? 0, cassaMovImpRow))
        }
      }
      const rataIso = parseItDateOnly(
        rowGetNorm(row, ["Data Rata", "DataRata", "Abbonamenti Pagamenti Data Rata", "AbbonamentiPagamentiDataRata"])
      )
      const rataImporto =
        pickNum(row, [
          "Abbonamenti Pagamenti Importo",
          "AbbonamentiPagamentiImporto",
          "PagamentiImporto",
          "ImportoRata",
          "Importo Rata",
        ]) ??
        (() => {
          const v = rowGetNorm(row, [
            "Abbonamenti Pagamenti Importo",
            "AbbonamentiPagamentiImporto",
            "Abbonamenti_Pagamenti_Importo",
            "Pagamenti Importo",
            "PagamentiImporto",
            "ImportoRata",
            "Importo Rata",
            "Importo_Rata",
          ])
          if (v == null || String(v).trim() === "") return null
          const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
          return Number.isFinite(n) ? n : null
        })()

      // Pagato reale: usa CassaMovimentiImporto (se presente).
      const cassaMovImp =
        pickNum(row, ["Cassa Movimenti Importo", "CassaMovimentiImporto", "CassaMovimenti Importo", "CassaImporto"]) ??
        (() => {
          const v = rowGetNorm(row, ["Cassa Movimenti Importo", "CassaMovimentiImporto", "Cassamovimentiimporto"])
          if (v == null || String(v).trim() === "") return null
          const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
          return Number.isFinite(n) ? n : null
        })()
      // In alcune viste il campo Importo può contenere importo "previsto".
      // Quindi richiediamo anche un indicatore di movimento reale (data operazione o id movimento).
      const cassaMovIdIscr = String(rowGetNorm(row, ["Cassa Movimenti ID Iscrizione", "CassaMovimentiIDIscrizione"]) ?? "").trim()
      const cassaMovIdMov = String(
        rowGetNorm(row, ["IDCassaMovimenti", "IdCassaMovimenti", "CassaMovimentiId", "IDMovimento", "IdMovimento", "MovimentoId"]) ?? ""
      ).trim()
      // IMPORTANT: non usare "Data Operazione" come segnale, spesso è la data operazione dell'iscrizione.
      const hasMovimentoReale = !!cassaMovIdIscr || !!cassaMovIdMov
      const paidByCassa =
        hasMovimentoReale && cassaMovImp != null && (Number(cassaMovImp) || 0) > 0 ? (Number(cassaMovImp) || 0) : 0

      if (idIscrAgg && rataIso && rataImporto != null && rataImporto > 0) {
        // Considera solo rate nel periodo dell'abbonamento attivo
        if (rataIso >= di && rataIso <= df) {
          const cur = rateAggByIscrizione.get(idIscrAgg) ?? { paid: 0, due: 0 }
          // Se l'incasso in cassa è presente, conteggia pagato (al massimo l'importo rata). Altrimenti resta dovuto.
          if (paidByCassa > 0) cur.paid += Math.min(rataImporto, paidByCassa)
          else cur.due += rataImporto
          rateAggByIscrizione.set(idIscrAgg, cur)
        }
      }

      const email = pick(row, ["Email", "E_mail", "Mail", "ClienteEmail"])
      const telefono = pick(row, ["SMS", "Cellulare", "Telefono", "Telefono_1", "Telefono1", "ClienteSms"])
      const totale =
        pickNum(row, ["Totale", "Importo", "Prezzo"]) ??
        (Number(a.prezzo ?? 0) || 0)
      const pagatoRaw = pickNum(row, ["ImportoPagato", "Pagato", "Versato", "Incassato", "Acconto"])
      const daPagareRaw = pickNum(row, ["DaPagare", "ImportoDaPagare", "Residuo", "ResiduoEuro", "Rimanente", "SaldoResiduo"])

      const statoPagamento = String(
        row.StatoPagamento ?? row.StatoPag ?? row.Stato ?? row.Pagamento ?? row.EsitoPagamento ?? ""
      )
        .trim()
        .toLowerCase()

      let pagato = pagatoRaw
      let daPagare = daPagareRaw
      if (daPagare == null && pagato != null) daPagare = Math.max(0, totale - pagato)
      if (pagato == null && daPagare != null) pagato = Math.max(0, totale - daPagare)
      if (pagato == null && daPagare == null) {
        if (/\b(non pagat|da pagare|insolut|scopert)\b/.test(statoPagamento)) {
          pagato = 0
          daPagare = totale
        } else if (/\b(pagat|saldat|ok)\b/.test(statoPagamento)) {
          pagato = totale
          daPagare = 0
        } else {
          // Fallback storico in assenza di metadati pagamento.
          pagato = totale
          daPagare = 0
        }
      }
      pagato = Math.max(0, Number(pagato ?? 0) || 0)
      daPagare = Math.max(0, Number(daPagare ?? Math.max(0, totale - pagato)) || 0)

      const categoria = String(a.categoriaAbbonamentoDescrizione ?? row.CategoriaAbbonamentoDescrizione ?? "DANZA").trim() || "DANZA"
      const micro =
        String(row.AbbonamentoDurataDescrizione ?? row.AbbonamentoDescrizione ?? a.abbonamentoDescrizione ?? a.pianoNome ?? "").trim() ||
        "—"

      const it: DanzaItem = {
        idIscrizione: String(a.id ?? row["ID Iscrizione"] ?? row.IDIscrizione ?? "").trim() || String(row.IDIscrizione ?? ""),
        clienteId: String(a.clienteId ?? row.IDUtente ?? "").trim() || String(row.IDUtente ?? ""),
        clienteNome: String(a.clienteNome ?? "").trim() || "—",
        email,
        telefono,
        abbonamento: (a.abbonamentoDescrizione ?? a.pianoNome ?? null) as any,
        categoria,
        microcategoria: micro,
        scadenza: a.dataFine ? String(a.dataFine).slice(0, 10) : null,
        dataInizio: di,
        dataFine: df,
        totale,
        pagato,
        daPagare,
      }
      itemsAll.push(it)
      if (isDanza) itemsDanza.push(it)
    }

    // Se abbiamo rate per IDIscrizione, sono la fonte più affidabile.
    // pagato = somma rate con DataPagato valorizzata
    // daPagare = somma rate senza DataPagato
    for (const it of itemsAll) {
      const agg = rateAggByIscrizione.get(it.idIscrizione)
      if (!agg) continue
      const sum = (Number(agg.paid) || 0) + (Number(agg.due) || 0)
      if (sum <= 0) continue
      it.pagato = Math.max(0, Number(agg.paid) || 0)
      it.daPagare = Math.max(0, Number(agg.due) || 0)
      // Se il totale riga è incoerente, manteniamo comunque rate come verità.
      it.totale = Math.max(it.totale ?? 0, it.pagato + it.daPagare)
    }

    // Override finale (regola richiesta): pagato = CassaMovimentiImporto, totale = Totale, daPagare = Totale - pagato.
    // Se la view espone questi campi, sono la fonte di verità.
    for (const it of itemsAll) {
      if (!totaleByIscrizione.has(it.idIscrizione) && !cassaPaidByIscrizione.has(it.idIscrizione)) continue
      const tot = totaleByIscrizione.get(it.idIscrizione) ?? it.totale ?? 0
      const paid = cassaPaidByIscrizione.get(it.idIscrizione) ?? 0
      it.totale = Math.max(0, Number(tot) || 0)
      it.pagato = Math.max(0, Math.min(it.totale, Number(paid) || 0))
      it.daPagare = Math.max(0, it.totale - it.pagato)
    }

    // Allineamento "pagato / da pagare" con i movimenti di cassa (gestionale):
    // pagato = somma importo per IDIscrizione nel periodo [min(dataInizio), oggi]
    // daPagare = max(0, totale - pagato)
    // Applica solo se non abbiamo rate (altrimenti rischia di marcare pagato quando ci sono rate insolute).
    const hasAnyRate = rateAggByIscrizione.size > 0
    if (!hasAnyRate && gestionaleSql.isGestionaleConfigured() && minDataInizioIso) {
      const pagatoRows = await gestionaleSql.queryCassaMovimentiSumByIscrizione(minDataInizioIso, todayIso)
      const paidByIscrizione = new Map<string, number>()
      for (const r of pagatoRows) {
        const id = String((r as any)?.IDIscrizione ?? (r as any)?.idIscrizione ?? "").trim()
        if (!id) continue
        const tot = Number((r as any)?.Totale ?? (r as any)?.totale ?? 0) || 0
        paidByIscrizione.set(id, tot)
      }
      const hasAnyMatch = itemsAll.some((it) => paidByIscrizione.has(it.idIscrizione))

      if (hasAnyMatch) {
        for (const it of itemsAll) {
          const paid = paidByIscrizione.get(it.idIscrizione) ?? 0
          it.pagato = Math.max(0, paid)
          it.daPagare = Math.max(0, (it.totale ?? 0) - it.pagato)
        }
      } else {
        // Fallback robusto: attribuzione per cliente usando i movimenti nel range dell'abbonamento attivo.
        // Caso tipico: RVW_CassaMovimentiUtenti non espone/valorizza IDIscrizione.
        const clienteIds = [...new Set(itemsAll.map((it) => it.clienteId).filter(Boolean))].map(String)
        const movs = await gestionaleSql.queryCassaMovimentiLiteByClienteIds({
          from: minDataInizioIso,
          to: todayIso,
          clienteIds,
        })
        const movsByCliente = new Map<string, { t: number; imp: number }[]>()
        for (const m of movs) {
          const cid = String(m.clienteId ?? "").trim()
          if (!cid) continue
          const iso = m.dataOperazioneIso ? m.dataOperazioneIso.slice(0, 10) : null
          if (!iso) continue
          const imp = Number(m.importo ?? 0) || 0
          if (imp <= 0) continue
          const arr = movsByCliente.get(cid) ?? []
          arr.push({ t: Date.parse(`${iso}T00:00:00.000Z`), imp })
          movsByCliente.set(cid, arr)
        }
        for (const arr of movsByCliente.values()) arr.sort((a, b) => a.t - b.t)

        // Per ogni cliente: distribuisce i movimenti sugli abbonamenti attivi (ordinati per inizio),
        // rispettando il range date dell'abbonamento e senza superare il totale.
        const itemsByCliente = new Map<string, DanzaItem[]>()
        for (const it of itemsAll) {
          const arr = itemsByCliente.get(it.clienteId) ?? []
          arr.push(it)
          itemsByCliente.set(it.clienteId, arr)
        }
        for (const arr of itemsByCliente.values()) arr.sort((a, b) => a.dataInizio.localeCompare(b.dataInizio))

        for (const [cid, subs] of itemsByCliente.entries()) {
          const movArr = movsByCliente.get(cid) ?? []
          for (const it of subs) {
            it.pagato = 0
            it.daPagare = Math.max(0, it.totale ?? 0)
          }
          for (const mv of movArr) {
            // trova il primo abbonamento che include la data movimento e ha ancora residuo
            for (const it of subs) {
              const startT = Date.parse(`${it.dataInizio}T00:00:00.000Z`)
              const endT = Date.parse(`${it.dataFine}T23:59:59.999Z`)
              if (mv.t < startT || mv.t > endT) continue
              const due = Math.max(0, (it.totale ?? 0) - (it.pagato ?? 0))
              if (due <= 0) continue
              const take = Math.min(due, mv.imp)
              if (take <= 0) continue
              it.pagato = (it.pagato ?? 0) + take
              it.daPagare = Math.max(0, (it.totale ?? 0) - it.pagato)
              mv.imp -= take
              if (mv.imp <= 0) break
            }
          }
        }
      }
    }

    const byCategoria = new Map<string, DanzaItem[]>()
    for (const it of itemsDanza) {
      const arr = byCategoria.get(it.categoria) ?? []
      arr.push(it)
      byCategoria.set(it.categoria, arr)
    }

    const categorie = Array.from(byCategoria.entries())
      .map(([categoria, catItems]) => {
        const byMicro = new Map<string, DanzaItem[]>()
        for (const it of catItems) {
          const arr = byMicro.get(it.microcategoria) ?? []
          arr.push(it)
          byMicro.set(it.microcategoria, arr)
        }
        const microcategorie = Array.from(byMicro.entries())
          .map(([microcategoria, microItems]) => ({
            microcategoria,
            totaleIscritti: microItems.length,
            totaleEuro: microItems.reduce((s, x) => s + (x.totale || 0), 0),
            pagatoEuro: microItems.reduce((s, x) => s + (x.pagato || 0), 0),
            daPagareEuro: microItems.reduce((s, x) => s + (x.daPagare || 0), 0),
            items: microItems.sort((a, b) => String(a.clienteNome).localeCompare(String(b.clienteNome))),
          }))
          .sort((a, b) => b.totaleIscritti - a.totaleIscritti || a.microcategoria.localeCompare(b.microcategoria))
        return {
          categoria,
          totaleIscritti: catItems.length,
          totaleEuro: catItems.reduce((s, x) => s + (x.totale || 0), 0),
          pagatoEuro: catItems.reduce((s, x) => s + (x.pagato || 0), 0),
          daPagareEuro: catItems.reduce((s, x) => s + (x.daPagare || 0), 0),
          microcategorie,
        }
      })
      .sort((a, b) => b.totaleIscritti - a.totaleIscritti || a.categoria.localeCompare(b.categoria))

    const byCategoriaAll = new Map<string, DanzaItem[]>()
    for (const it of itemsAll) {
      const arr = byCategoriaAll.get(it.categoria) ?? []
      arr.push(it)
      byCategoriaAll.set(it.categoria, arr)
    }
    const categorieGenerali = Array.from(byCategoriaAll.entries())
      .map(([categoria, catItems]) => ({
        categoria,
        totaleIscritti: catItems.length,
        totaleEuro: catItems.reduce((s, x) => s + (x.totale || 0), 0),
        pagatoEuro: catItems.reduce((s, x) => s + (x.pagato || 0), 0),
        daPagareEuro: catItems.reduce((s, x) => s + (x.daPagare || 0), 0),
      }))
      .sort((a, b) => b.totaleIscritti - a.totaleIscritti || a.categoria.localeCompare(b.categoria))

    const totaliGenerali = {
      totaleIscritti: itemsAll.length,
      totaleEuro: itemsAll.reduce((s, x) => s + (x.totale || 0), 0),
      pagatoEuro: itemsAll.reduce((s, x) => s + (x.pagato || 0), 0),
      daPagareEuro: itemsAll.reduce((s, x) => s + (x.daPagare || 0), 0),
    }

    res.json({ asOf: todayIso, totaliGenerali, categorieGenerali, categorie })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getClienti(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.json([])
    }
    const rows = await gestionaleSql.queryClienti()
    const abbonamentiCount = new Map<string, number>()
    const list = rows.map((r) => rowToCliente(r, abbonamentiCount))
    res.json(list)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

function sqlScalarDateToIso(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function addCalendarDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days, 12, 0, 0))
  return d.toISOString().slice(0, 10)
}

function monthRangeFromQuery(req: Request): { fromIso: string; toIso: string; year: number; month: number } {
  const now = new Date()
  const yRaw = typeof req.query.year === "string" ? Number(req.query.year) : NaN
  const mRaw = typeof req.query.month === "string" ? Number(req.query.month) : NaN
  const year = Number.isFinite(yRaw) && yRaw >= 2000 && yRaw <= 2100 ? Math.trunc(yRaw) : now.getFullYear()
  const month = Number.isFinite(mRaw) && mRaw >= 1 && mRaw <= 12 ? Math.trunc(mRaw) : now.getMonth() + 1
  const fromIso = `${year}-${String(month).padStart(2, "0")}-01`
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const toIso = `${nextMonth.y}-${String(nextMonth.m).padStart(2, "0")}-01`
  return { fromIso, toIso, year, month }
}

/** Mese intero (year/month) oppure intervallo Dal/Al inclusivo (from/to) come Stampa report. */
function referralRangeFromQuery(req: Request): {
  fromIso: string
  toIsoExclusive: string
  year: number
  month: number
  rangeToInclusive: string
} {
  const fromRaw = String(req.query.from ?? "").trim()
  const toRaw = String(req.query.to ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) && fromRaw <= toRaw) {
    return {
      fromIso: fromRaw,
      toIsoExclusive: addCalendarDaysIso(toRaw, 1),
      year: Number(fromRaw.slice(0, 4)),
      month: Number(fromRaw.slice(5, 7)),
      rangeToInclusive: toRaw,
    }
  }
  const mr = monthRangeFromQuery(req)
  return {
    fromIso: mr.fromIso,
    toIsoExclusive: mr.toIso,
    year: mr.year,
    month: mr.month,
    rangeToInclusive: addCalendarDaysIso(mr.toIso, -1),
  }
}

export async function getReferralPresentati(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    const consulenteQ = typeof req.query.consulente === "string" ? req.query.consulente.trim() : ""
    const tuttiIVenditori =
      u.role === "admin" &&
      (req.query.tutti === "1" || req.query.tutti === "true" || String(req.query.tutti ?? "").toLowerCase() === "yes")

    const rangeEarly = referralRangeFromQuery(req)

    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.json({
        items: [],
        totaleEuro: 0,
        totaleClienti: 0,
        venditoreIdsResolved: [] as number[],
        tuttiIVenditori,
        range: undefined,
      })
    }

    let venditoreIdsResolved: number[] = []

    if (u.role === "admin") {
      if (!tuttiIVenditori) {
        if (!consulenteQ) {
          return res.json({
            items: [],
            totaleEuro: 0,
            totaleClienti: 0,
            venditoreIdsResolved: [],
            tuttiIVenditori: false,
            hint: "Seleziona «Tutti i venditori» oppure una consulente nel menu.",
            range: {
              year: rangeEarly.year,
              month: rangeEarly.month,
              from: rangeEarly.fromIso,
              to: rangeEarly.rangeToInclusive,
            },
          })
        }
        const idStr = await resolveConsultantId(consulenteQ)
        if (!idStr?.trim()) {
          return res.json({
            items: [],
            totaleEuro: 0,
            totaleClienti: 0,
            venditoreIdsResolved: [],
            tuttiIVenditori: false,
            range: {
              year: rangeEarly.year,
              month: rangeEarly.month,
              from: rangeEarly.fromIso,
              to: rangeEarly.rangeToInclusive,
            },
          })
        }
        venditoreIdsResolved = gestionaleSql.parseConsultantIds(idStr)
      }
    } else if (u.role === "operatore") {
      const opNome = getOperatoreConsulenteNome(req)?.trim() || ""
      if (!opNome) {
        return res.json({
          items: [],
          totaleEuro: 0,
          totaleClienti: 0,
          venditoreIdsResolved: [],
          tuttiIVenditori: false,
          hint: "Profilo operatore senza consulente associata.",
          range: {
            year: rangeEarly.year,
            month: rangeEarly.month,
            from: rangeEarly.fromIso,
            to: rangeEarly.rangeToInclusive,
          },
        })
      }
      const idStr = await resolveConsultantId(opNome)
      if (!idStr?.trim()) {
        return res.json({
          items: [],
          totaleEuro: 0,
          totaleClienti: 0,
          venditoreIdsResolved: [],
          tuttiIVenditori: false,
          range: {
            year: rangeEarly.year,
            month: rangeEarly.month,
            from: rangeEarly.fromIso,
            to: rangeEarly.rangeToInclusive,
          },
        })
      }
      venditoreIdsResolved = gestionaleSql.parseConsultantIds(idStr)
    }

    const { fromIso, toIsoExclusive, year, month, rangeToInclusive } = rangeEarly
    const rows = await gestionaleSql.queryReferralPresentati(venditoreIdsResolved, fromIso, toIsoExclusive)
    const items = rows.map((row) => {
      const pc = String(row.SocioPresentatoreCognome ?? "").trim()
      const pn = String(row.SocioPresentatoreNome ?? "").trim()
      const pid =
        row.SocioPresentatoreIDUtente != null && String(row.SocioPresentatoreIDUtente).trim() !== ""
          ? String(row.SocioPresentatoreIDUtente)
          : row.ReferralIDSocioPresentatore != null && String(row.ReferralIDSocioPresentatore).trim() !== ""
            ? String(row.ReferralIDSocioPresentatore)
            : null
      return {
        clienteId: String(row.ClienteIDUtente ?? ""),
        cognome: String(row.ClienteCognome ?? ""),
        nome: String(row.ClienteNome ?? ""),
        email: row.ClienteEmail != null && String(row.ClienteEmail).trim() !== "" ? String(row.ClienteEmail) : null,
        telefono: row.ClienteSms != null && String(row.ClienteSms).trim() !== "" ? String(row.ClienteSms) : null,
        presentatoDaId: pid,
        presentatoDaNome: pc || pn ? `${pc} ${pn}`.trim() : null,
        idIscrizione: row.ReferralIDIscrizione != null ? String(row.ReferralIDIscrizione) : null,
        abbonamento: row.ReferralAbbDescrizione != null && String(row.ReferralAbbDescrizione).trim() !== "" ? String(row.ReferralAbbDescrizione) : null,
        dataPresentazione: sqlScalarDateToIso(row.ReferralDataPresentazione),
        dataInizioAbb: sqlScalarDateToIso(row.ReferralDataInizio),
        dataFineAbb: sqlScalarDateToIso(row.ReferralDataFine),
        importoPagato: Number(row.ReferralImportoPagato ?? row.ReferralImportoAbb ?? 0) || 0,
        totaleMese: Number(row.ReferralTotaleMese ?? 0) || 0,
      }
    })
    const totaleEuro = Math.round(items.reduce((s, x) => s + x.totaleMese, 0) * 100) / 100
    const totaleClienti = items.length
    res.json({
      items,
      totaleEuro,
      totaleClienti,
      venditoreIdsResolved,
      tuttiIVenditori: u.role === "admin" ? tuttiIVenditori : false,
      range: { year, month, from: fromIso, to: rangeToInclusive },
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getAbbonamenti(req: Request, res: Response) {
  try {
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulente = operatoreNome ?? ((req.query.consulente as string) || undefined)
    const inScadenzaRaw = req.query.inScadenza
    const inScadenza =
      inScadenzaRaw === "30" ? 30 : inScadenzaRaw === "60" ? 60 : undefined
    const options = inScadenza != null ? { inScadenza } : undefined
    if (gestionaleSql.isGestionaleConfigured()) {
      const idVenditore = await resolveConsultantId(consulente)
      if (consulente && !idVenditore) {
        return res.json([])
      }
      // Una sola query: se inScadenza è impostato si restituiscono solo abbonamenti in scadenza (meno righe)
      const rows = idVenditore
        ? await gestionaleSql.queryAbbonamenti(idVenditore, options)
        : await gestionaleSql.queryAbbonamenti(undefined, options)
      let list = rows.map((r) => rowToAbbonamento(r))
      markRinnovato(list)
      list = list.filter((a) => !a.isTesseramento)
      list = list.filter((a) => !isEsclusoVenditeListe(a))
      // Admin: quando non filtra per una consulente specifica, mostra solo abbonamenti delle 3 consulenti.
      if (!consulente?.trim()) {
        const allowed = budgetPerConsulente.getConsulentiLabels().map((x) => x.toLowerCase().trim())
        list = list.filter((a) => {
          const row = (a.consulenteNome ?? "").trim().toLowerCase()
          return allowed.some((want) => row === want || row.includes(want) || want.includes(row))
        })
      }
      if (consulente?.trim()) {
        const want = consulente.trim().toLowerCase()
        list = list.filter((a) => {
          const row = (a.consulenteNome ?? "").trim().toLowerCase()
          return row === want || row.includes(want) || want.includes(row)
        })
      }
      return res.json(list)
    }
    const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
    let list = [...mockAbbonamenti]
    if (consulente) list = list.filter((a) => a.consulenteNome === consulente)
    markRinnovato(list)
    list = list.filter((a) => !a.isTesseramento)
    list = list.filter((a) => !isEsclusoVenditeListe(a))
    res.json(list)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Budget: suddiviso per le 3 consulenti per mese; il totale mese = budget generale. */
export async function getBudget(req: Request, res: Response) {
  try {
    const y = Number(req.query.anno)
    const anno = Number.isNaN(y) || req.query.anno === "" ? new Date().getFullYear() : y
    const budget = getBudgetListForYear(anno)
    const perConsulente = budgetPerConsulente.getAll(anno)
    res.json({
      list: budget,
      perConsulente,
      consulenti: budgetPerConsulente.getConsulentiLabels(),
      storico: budgetPerConsulente.getStoricoAnno(anno),
      anniDisponibili: budgetPerConsulente.getAnniDisponibili(),
    })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function setBudget(req: Request, res: Response) {
  try {
    const body = req.body as { anno: number; mese: number; budget?: number; consulenteLabel?: string }
    const { anno, mese, budget, consulenteLabel } = body
    if (anno == null || mese == null) {
      return res.status(400).json({ message: "anno e mese sono obbligatori" })
    }
    if (consulenteLabel != null && consulenteLabel !== "") {
      if (typeof budget !== "number") return res.status(400).json({ message: "budget obbligatorio per consulente" })
      budgetPerConsulente.set(anno, mese, consulenteLabel, Math.round(budget))
      persistBudgetMeseSnapshot(anno, mese)
      await bumpMetaVersion("budget")
      return res.json({ anno, mese, consulenteLabel, budget, totaleMese: budgetPerConsulente.getTotaleMese(anno, mese) })
    }
    if (typeof budget !== "number") return res.status(400).json({ message: "budget obbligatorio" })
    budgetPerConsulente.getConsulentiLabels().forEach((label) => {
      budgetPerConsulente.set(anno, mese, label, Math.round(budget / 3))
    })
    persistBudgetMeseSnapshot(anno, mese)
    await bumpMetaVersion("budget")
    res.json({ anno, mese, budget, totaleMese: budgetPerConsulente.getTotaleMese(anno, mese) })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Storico vendite e budget per anno: 12 mesi. Totali calcolati in SQL (stesso risultato delle query). */
export async function getVenditeStorico(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulente = operatoreNome ?? ((req.query.consulente as string) || undefined)
    if (isNaN(anno) || anno < 2000 || anno > 2100) {
      return res.status(400).json({ message: "Parametro anno obbligatorio e valido (2000-2100)" })
    }
    const MESI_NOMI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
    const fromSql = gestionaleSql.isGestionaleConfigured()
    const idUtente = await resolveConsultantId(consulente)
    const budgetList = getBudgetListForYear(anno)
    let venditePerMese: { mese: string; anno: number; meseNum: number; vendite: number; budget: number; percentuale: number }[]

    if (fromSql) {
      const venditeSql = await gestionaleSql.getVenditePerMeseAnno(anno, idUtente)
      const mapVendite = new Map(venditeSql.map((x) => [x.mese, x.totale]))
      venditePerMese = budgetList.map((b) => {
        const vendite = mapVendite.get(b.mese) ?? 0
        const pct = b.budget ? Math.round((vendite / b.budget) * 1000) / 10 : 0
        return {
          mese: MESI_NOMI[b.mese - 1],
          anno: b.anno,
          meseNum: b.mese,
          vendite,
          budget: b.budget,
          percentuale: pct,
        }
      })
    } else {
      const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
      const abbonamenti = consulente ? mockAbbonamenti.filter((a) => a.consulenteNome === consulente) : mockAbbonamenti
      venditePerMese = budgetList.map((b) => {
        const vendite = abbonamenti
          .filter((a) => !a.isTesseramento && !isEsclusoVenditeListe(a))
          .filter((a) => {
            const inizio = new Date(a.dataInizio)
            return inizio.getFullYear() === b.anno && inizio.getMonth() + 1 === b.mese
          })
          .reduce((s, a) => s + a.prezzo, 0)
        const pct = b.budget ? Math.round((vendite / b.budget) * 1000) / 10 : 0
        return {
          mese: MESI_NOMI[b.mese - 1],
          anno: b.anno,
          meseNum: b.mese,
          vendite,
          budget: b.budget,
          percentuale: pct,
        }
      })
    }
    res.json({ anno, venditePerMese })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Distribuzione vendite (movimenti) per categoria e durata (abbonamenti venduti).
 *  Periodo: ultimi N mesi (default 12). */
export async function getVenditeMovimentiCategoriaDurata(req: Request, res: Response) {
  try {
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulente = operatoreNome ?? ((req.query.consulente as string) || undefined)

    const now = new Date()
    const to = now.toISOString().slice(0, 10)

    // Richiesta: "mese corrente" (non ultimi N mesi).
    const year = now.getUTCFullYear()
    const monthIndex = now.getUTCMonth() // 0..11
    const from = new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0)).toISOString().slice(0, 10)

    let idUtente = await resolveConsultantId(consulente)
    // Se admin non seleziona consulente: default = somma delle 3 consulenti (come dashboard).
    if (!idUtente) {
      const labels = budgetPerConsulente.getConsulentiLabels()
      const idParts = await Promise.all(labels.map((label) => resolveConsultantId(label)))
      idUtente = gestionaleSql.mergeConsultantIdStrings(idParts)
    }
    const { rows, totalCount, byAbbonamento } = await gestionaleSql.getVenditeMovimentiCategoriaDurata(from, to, idUtente ?? undefined)

    res.json({ from, to, totalCount, rows, byAbbonamento })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

const VENDITE_CROSS_SQL_TIMEOUT_MS = gestionaleSql.getVenditeCrossRequestTimeoutMs()

function withVenditeCrossSqlTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error("__FITCENTER_VENDITE_CROSS_SQL_TIMEOUT__")), VENDITE_CROSS_SQL_TIMEOUT_MS)
    ),
  ])
}

/** Elenco cross (cambio tipologia): rate pagate nel mese + rate future; totale incluso in dashboard entrate. */
export async function getVenditeCross(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.status(503).json({ message: "Gestionale SQL non configurato" })
    }
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulente = operatoreNome ?? ((req.query.consulente as string) || undefined)

    const now = new Date()
    const anno = parseIntParam(req.query.anno, 2000, 2100) ?? now.getFullYear()
    const mese = parseIntParam(req.query.mese, 1, 12) ?? now.getMonth() + 1
    const ultimoGiorno = new Date(anno, mese, 0).getDate()
    const from = `${anno}-${String(mese).padStart(2, "0")}-01`
    const to = `${anno}-${String(mese).padStart(2, "0")}-${String(ultimoGiorno).padStart(2, "0")}`

    let idUtente = await resolveConsultantId(consulente)
    if (!idUtente && !operatoreNome) {
      const labels = budgetPerConsulente.getConsulentiLabels()
      const idParts = await Promise.all(labels.map((label) => resolveConsultantId(label)))
      idUtente = gestionaleSql.mergeConsultantIdStrings(idParts)
    }

    const { rows, totale } = await withVenditeCrossSqlTimeout(
      gestionaleSql.getVenditeCrossElenco(from, to, idUtente ?? undefined)
    )
    res.json({ from, to, rows, totale, consulente: consulente ?? null })
  } catch (e) {
    const msg = (e as Error).message
    if (msg === "__FITCENTER_VENDITE_CROSS_SQL_TIMEOUT__") {
      return res.status(504).json({
        message: `Timeout SQL cross dopo ${VENDITE_CROSS_SQL_TIMEOUT_MS} ms — restringi il mese o riprova`,
      })
    }
    res.status(500).json({ message: msg })
  }
}

/** Totale vendite e budget per anno (admin). Vendite da MovimentiVenduto se disponibile. */
export async function getTotaliAnni(req: Request, res: Response) {
  try {
    const depSig = await getBudgetDepSig()
    const scope = cacheScope(req)
    const asOf = "today"
    const cached = await cacheGet<{ totali: { anno: number; vendite: number; budget: number; percentuale: number }[] }>({
      name: "data.totali-anni",
      scope,
      params: {},
      asOf,
      depSig,
    })
    if (cached) return res.json(cached)
    const fromSql = gestionaleSql.isGestionaleConfigured()
    const venditeSqlPerAnno = fromSql ? await gestionaleSql.getVenditeTotaliPerAnno() : []
    const mapVenditeSqlPerAnno = new Map(venditeSqlPerAnno.map((x) => [x.anno, x.totale]))
    let abbonamenti: Abbonamento[] = []
    if (fromSql && venditeSqlPerAnno.length === 0) {
      const rows = await gestionaleSql.queryAbbonamenti()
      abbonamenti = rows.map((r) => rowToAbbonamento(r))
    } else if (!fromSql) {
      const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
      abbonamenti = mockAbbonamenti
    }
    const anniFromVendite = new Set<number>()
    if (venditeSqlPerAnno.length > 0) {
      venditeSqlPerAnno.forEach((x) => anniFromVendite.add(x.anno))
    } else {
      abbonamenti.forEach((a) => anniFromVendite.add(new Date(a.dataInizio).getFullYear()))
    }
    const budgetAll = budgetStore.getAll()
    const anniFromBudget = new Set(budgetAll.map((b) => b.anno))
    const anni = Array.from(new Set([...anniFromVendite, ...anniFromBudget])).sort((a, b) => a - b)
    const totali = anni.map((anno) => {
      const vendite = venditeSqlPerAnno.length > 0
        ? (mapVenditeSqlPerAnno.get(anno) ?? 0)
        : abbonamenti
            .filter((a) => !a.isTesseramento && !isEsclusoVenditeListe(a))
            .filter((a) => new Date(a.dataInizio).getFullYear() === anno)
            .reduce((s, a) => s + a.prezzo, 0)
      const budgetList = getBudgetListForYear(anno)
      const budget = budgetList.reduce((s, b) => s + b.budget, 0)
      const percentuale = budget ? Math.round((vendite / budget) * 1000) / 10 : 0
      return { anno, vendite, budget, percentuale }
    })
    const payload = { totali }
    await cacheSet({
      name: "data.totali-anni",
      scope,
      params: {},
      asOf,
      depSig,
      ttlMs: 10 * 60_000,
      value: payload,
    })
    res.json(payload)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Lead CRM: store locale. Admin vede tutto. Operatore: vede il pool della sua fascia (bambini vs generale)
 *  e **sempre** i lead assegnati a lei (nome o username), anche se `categoria` non coincide (errori Zapier / riassegnazione). */
export async function getLeadsFromGestionale(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role === "admin") {
      res.json(leadsStore.list({}))
      return
    }
    const meNome = (u.consulenteNome ?? u.nome ?? "").trim()
    const meUser = (u.username ?? "").trim().toLowerCase()
    const isBambiniScope = u.leadFilter === "bambini"
    const all = leadsStore.list({})
    const filtered = all.filter((lead) => {
      const assignedNome = String(lead.consulenteNome ?? "").trim()
      const assignedId = String(lead.consulenteId ?? "").trim().toLowerCase()
      const assignedToMe =
        (meNome.length > 0 && assignedNome.length > 0 && assignedNome.toLowerCase() === meNome.toLowerCase()) ||
        (meUser.length > 0 && assignedId.length > 0 && assignedId === meUser)
      if (assignedToMe) return true
      const cat = lead.categoria ?? "generale"
      if (isBambiniScope) return cat === "bambini"
      return cat === "generale"
    })
    res.json(filtered)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/**
 * Presa in carico lead (operatore).
 * Una volta assegnato a una consulente, non può essere riassegnato da altri.
 */
export async function assignLeadToMe(req: Request, res: Response) {
  try {
    const consulenteNome = getOperatoreConsulenteNome(req)
    if (!consulenteNome) return res.status(403).json({ message: "Solo operatore può assegnarsi un lead" })
    const id = String(req.params.id ?? "").trim()
    if (!id) return res.status(400).json({ message: "id lead mancante" })
    const lead = leadsStore.get(id)
    if (!lead) return res.status(404).json({ message: "Lead non trovato" })
    const already = (lead.consulenteNome ?? "").trim()
    if (already && already.toLowerCase() !== consulenteNome.toLowerCase()) {
      return res.status(409).json({ message: `Lead già assegnato a ${already}` })
    }
    const consulenteId = (getScopedUser(req).username ?? "").trim() || undefined
    const updated = leadsStore.update(id, { consulenteNome, ...(consulenteId ? { consulenteId } : {}) })
    if (!updated) return res.status(404).json({ message: "Lead non trovato" })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Debug: mappa consulenti (nome → id) e conteggi, per capire perché i dati sono vuoti. */
export async function getDebugConsulenti(req: Request, res: Response) {
  try {
    const map = await gestionaleSql.getConsultantIdUtenteMap()
    const byId = new Map<string, string>()
    map.forEach((id, nome) => {
      if (!byId.has(id)) byId.set(id, nome)
    })
    const consulenti = Array.from(byId.entries()).map(([id, nome]) => ({ nome, id }))
    let movimentiTotal = 0
    let abbonamentiTotal = 0
    let movimentiConFiltro = 0
    let abbonamentiConFiltro = 0
    let sampleMovimentiKeys: string[] = []
    let sampleAbbonamentiKeys: string[] = []
    let movimentiCarmen = 0
    let abbonamentiCarmen = 0
    if (gestionaleSql.isGestionaleConfigured()) {
      const [allMov, allAbb] = await Promise.all([
        gestionaleSql.queryMovimentiVenduto(),
        gestionaleSql.queryAbbonamenti(),
      ])
      movimentiTotal = allMov.length
      abbonamentiTotal = allAbb.length
      if (allMov.length > 0) sampleMovimentiKeys = Object.keys(allMov[0] as object)
      if (allAbb.length > 0) sampleAbbonamentiKeys = Object.keys(allAbb[0] as object)
      if (consulenti.length > 0) {
        const id = consulenti[0].id
        const [mov, abb] = await Promise.all([
          gestionaleSql.queryMovimentiVenduto(id),
          gestionaleSql.queryAbbonamenti(id),
        ])
        movimentiConFiltro = mov.length
        abbonamentiConFiltro = abb.length
      }
    }
    const idCarmen = map.get("Carmen Severino") ?? map.get("carmen severino")
    if (idCarmen && gestionaleSql.isGestionaleConfigured()) {
      const [movC, abbC] = await Promise.all([
        gestionaleSql.queryMovimentiVenduto(idCarmen),
        gestionaleSql.queryAbbonamenti(idCarmen),
      ])
      movimentiCarmen = movC.length
      abbonamentiCarmen = abbC.length
    }
    res.json({
      consulenti,
      movimentiTotal,
      abbonamentiTotal,
      tableAbbonamenti: gestionaleSql.getAbbonamentiTableName(),
      movimentiConFiltroId: consulenti[0]?.id ?? null,
      movimentiConFiltro,
      abbonamentiConFiltro,
      idCarmen: idCarmen ?? null,
      movimentiCarmen,
      abbonamentiCarmen,
      sampleMovimentiKeys,
      sampleAbbonamentiKeys,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}

/** Verifica connessione SQL: utile per capire se .env e il DB sono ok. */
export async function getSqlStatus(req: Request, res: Response) {
  const configured = gestionaleSql.isGestionaleConfigured()
  if (!configured) {
    return res.json({
      configured: false,
      connected: false,
      message: "SQL non configurato: imposta SQL_CONNECTION_STRING in apps/api/.env",
    })
  }
  try {
    const pool = await gestionaleSql.getPool()
    if (!pool) {
      const err = gestionaleSql.getLastConnectionError()
      return res.json({
        configured: true,
        connected: false,
        message: "Connessione fallita.",
        error: err ?? "Controlla server, database, user, password e rete (porta 1433, firewall).",
      })
    }
    const [clientiRows, abbonamentiRows] = await Promise.all([
      gestionaleSql.queryClienti(),
      gestionaleSql.queryAbbonamenti(),
    ])
    res.json({
      configured: true,
      connected: true,
      clienti: clientiRows.length,
      abbonamenti: abbonamentiRows.length,
    })
  } catch (e) {
    res.status(500).json({
      configured: true,
      connected: false,
      error: (e as Error).message,
    })
  }
}

const MESI_LABEL = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
const GIORNI_SETTIMANA = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"]

function buildDettaglioBloccoFromMovimenti(
  movimenti: Record<string, unknown>[],
  budgetTotale: number,
  budgetProgressivo: number,
  idUtenteToNome?: Map<string, string>
): DettaglioBlocco {
  const consuntivo = movimenti.reduce((s, r) => s + movimentoAmount(r), 0)
  const scostamento = consuntivo - budgetProgressivo
  const trend = budgetProgressivo > 0 ? Math.round(((consuntivo - budgetProgressivo) / budgetProgressivo) * 10000) / 100 : 0
  const consulentiMap = new Map<string, number>()
  movimenti.forEach((r) => {
    const id = String(r.IDVenditore ?? r.IDUtente ?? r.Id ?? r.id ?? "—")
    const nome = idUtenteToNome?.get(id) ?? id
    consulentiMap.set(nome, (consulentiMap.get(nome) ?? 0) + movimentoAmount(r))
  })
  const nConsulenti = Math.max(consulentiMap.size, 1)
  const budgetPerConsulente = budgetTotale / nConsulenti
  const progressivoPerConsulente = budgetProgressivo / nConsulenti
  const perConsulente: DettaglioConsulente[] = Array.from(consulentiMap.entries()).map(([nome, cons]) => {
    const scost = cons - progressivoPerConsulente
    const tr =
      progressivoPerConsulente > 0
        ? Math.round(((cons - progressivoPerConsulente) / progressivoPerConsulente) * 10000) / 100
        : 0
    return {
      consulente: nome,
      budget: Math.round(budgetPerConsulente * 100) / 100,
      budgetProgressivo: Math.round(progressivoPerConsulente * 100) / 100,
      consuntivo: cons,
      scostamento: Math.round(scost * 100) / 100,
      assenze: 0,
      improduttivi: 0,
      trend: tr,
    }
  })
  if (perConsulente.length === 0) {
    perConsulente.push({
      consulente: "Totale",
      budget: Math.round(budgetPerConsulente * 100) / 100,
      budgetProgressivo: Math.round(progressivoPerConsulente * 100) / 100,
      consuntivo: 0,
      scostamento: Math.round(-progressivoPerConsulente * 100) / 100,
      assenze: 0,
      improduttivi: 0,
      trend: 0,
    })
  }
  return {
    budget: Math.round(budgetTotale * 100) / 100,
    budgetProgressivo: Math.round(budgetProgressivo * 100) / 100,
    consuntivo,
    scostamento: Math.round(scostamento * 100) / 100,
    assenze: 0,
    improduttivi: 0,
    trend,
    perConsulente,
  }
}

/** Blocco dettaglio da totali calcolati in SQL (stesso risultato delle query). */
function buildDettaglioBloccoFromTotale(
  consuntivo: number,
  budgetTotale: number,
  budgetProgressivo: number
): DettaglioBlocco {
  const scostamento = consuntivo - budgetProgressivo
  const trend = budgetProgressivo > 0 ? Math.round(((consuntivo - budgetProgressivo) / budgetProgressivo) * 10000) / 100 : 0
  return {
    budget: Math.round(budgetTotale * 100) / 100,
    budgetProgressivo: Math.round(budgetProgressivo * 100) / 100,
    consuntivo,
    scostamento: Math.round(scostamento * 100) / 100,
    assenze: 0,
    improduttivi: 0,
    trend,
    perConsulente: [
      {
        consulente: "Totale",
        budget: Math.round(budgetTotale * 100) / 100,
        budgetProgressivo: Math.round(budgetProgressivo * 100) / 100,
        consuntivo,
        scostamento: Math.round(scostamento * 100) / 100,
        assenze: 0,
        improduttivi: 0,
        trend,
      },
    ],
  }
}

/** Dettaglio con una riga per consulente (admin: tutte e 3). */
function buildDettaglioBloccoFromPerConsulente(rows: DettaglioConsulente[]): DettaglioBlocco {
  const budget = rows.reduce((s, r) => s + r.budget, 0)
  const budgetProgressivo = rows.reduce((s, r) => s + r.budgetProgressivo, 0)
  const consuntivo = rows.reduce((s, r) => s + r.consuntivo, 0)
  const scostamento = consuntivo - budgetProgressivo
  const trend = budgetProgressivo > 0 ? Math.round(((consuntivo - budgetProgressivo) / budgetProgressivo) * 10000) / 100 : 0
  return {
    budget: Math.round(budget * 100) / 100,
    budgetProgressivo: Math.round(budgetProgressivo * 100) / 100,
    consuntivo,
    scostamento: Math.round(scostamento * 100) / 100,
    assenze: 0,
    improduttivi: 0,
    trend,
    perConsulente: rows,
  }
}

function buildDettaglioBlocco(
  abbonamenti: Abbonamento[],
  budgetTotale: number,
  budgetProgressivo: number
): DettaglioBlocco {
  const consuntivo = abbonamenti.reduce((s, a) => s + a.prezzo, 0)
  const scostamento = consuntivo - budgetProgressivo
  const trend =
    budgetProgressivo > 0 ? Math.round(((consuntivo - budgetProgressivo) / budgetProgressivo) * 10000) / 100 : 0
  const consulentiMap = new Map<string, number>()
  abbonamenti.forEach((a) => {
    const nome = a.consulenteNome ?? "—"
    consulentiMap.set(nome, (consulentiMap.get(nome) ?? 0) + a.prezzo)
  })
  const nConsulenti = Math.max(consulentiMap.size, 1)
  const budgetPerConsulente = budgetTotale / nConsulenti
  const progressivoPerConsulente = budgetProgressivo / nConsulenti
  const perConsulente: DettaglioConsulente[] = Array.from(consulentiMap.entries()).map(
    ([nome, cons]) => {
      const scost = cons - progressivoPerConsulente
      const tr =
        progressivoPerConsulente > 0
          ? Math.round(((cons - progressivoPerConsulente) / progressivoPerConsulente) * 10000) / 100
          : 0
      return {
        consulente: nome,
        budget: Math.round(budgetPerConsulente * 100) / 100,
        budgetProgressivo: Math.round(progressivoPerConsulente * 100) / 100,
        consuntivo: cons,
        scostamento: Math.round(scost * 100) / 100,
        assenze: 0,
        improduttivi: 0,
        trend: tr,
      }
    }
  )
  if (perConsulente.length === 0) {
    perConsulente.push({
      consulente: "Totale",
      budget: Math.round(budgetPerConsulente * 100) / 100,
      budgetProgressivo: Math.round(progressivoPerConsulente * 100) / 100,
      consuntivo: 0,
      scostamento: Math.round(-progressivoPerConsulente * 100) / 100,
      assenze: 0,
      improduttivi: 0,
      trend: 0,
    })
  }
  return {
    budget: Math.round(budgetTotale * 100) / 100,
    budgetProgressivo: Math.round(budgetProgressivo * 100) / 100,
    consuntivo,
    scostamento: Math.round(scostamento * 100) / 100,
    assenze: 0,
    improduttivi: 0,
    trend,
    perConsulente,
  }
}

// Evita che React Query rimanga in loading infinito quando SQL non risponde.
const DETTAGLIO_SQL_TIMEOUT_MS = Number(process.env.DETTAGLIO_SQL_TIMEOUT_MS ?? 45_000)
function withDettaglioSqlTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("__FITCENTER_DETTAGLIO_SQL_TIMEOUT__")), DETTAGLIO_SQL_TIMEOUT_MS)
    ),
  ])
}

// Timeout dedicato per report/admin (pagina "consulenti"), perché qui facciamo più query in loop.
const REPORT_CONSULENTI_SQL_TIMEOUT_MS = Number(process.env.REPORT_CONSULENTI_SQL_TIMEOUT_MS ?? 45_000)
function withReportConsulentiSqlTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(
        () => rej(new Error("__FITCENTER_REPORT_CONSULENTI_SQL_TIMEOUT__")),
        REPORT_CONSULENTI_SQL_TIMEOUT_MS
      )
    ),
  ])
}

export async function getDettaglioMese(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    const mese = Number(req.query.mese)
    let giorno = req.query.giorno != null ? Number(req.query.giorno) : null
    if (isNaN(anno) || isNaN(mese) || mese < 1 || mese > 12) {
      return res.status(400).json({ message: "anno e mese obbligatori e validi" })
    }
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulente = operatoreNome ?? ((req.query.consulente as string) || undefined)
    const giorniNelMese = new Date(anno, mese, 0).getDate()
    if (giorno == null || isNaN(giorno)) {
      const oggi = toDateParts(parseAsOf(req).date)
      giorno = oggi.year === anno && oggi.month === mese
        ? Math.min(oggi.day, giorniNelMese)
        : giorniNelMese
    }
    giorno = Math.min(Math.max(1, giorno), giorniNelMese)

    const scope = cacheScope(req)
    const asOf = parseAsOf(req)
    const { cacheAsOf, cacheParams } = dettaglioMeseCacheLookup(asOf.key, anno, mese, giorno, consulente)
    const depSig = getFrozenDepSig(cacheAsOf, await getBudgetDepSig())
    const cached = await cacheGet<DettaglioMeseResponse>({
      name: "data.dettaglio-mese",
      scope,
      params: cacheParams,
      asOf: cacheAsOf,
      depSig,
    })
    if (cached) return res.json(cached)

    let abbonamenti: Abbonamento[] = []
    let budgetMese: number
    let fromSql = gestionaleSql.isGestionaleConfigured()
    let dettaglioMeseWarning: string | undefined
    const idUtente = await resolveConsultantId(consulente)
    const movimenti = fromSql ? [] : ((await gestionaleSql.queryMovimentiVenduto(idUtente)) as Record<string, unknown>[])
    const useMovimenti = movimenti.length > 0

    if (fromSql) {
      budgetMese = consulente
        ? budgetConsulenteSalvato(anno, mese, consulente)
        : budgetPerConsulente.getTotaleMese(anno, mese) || (budgetStore.get(anno, mese) ?? 0)
      if (!useMovimenti) {
        try {
          const rows = isAsOfToday(asOf.key)
            ? await withDettaglioSqlTimeout(gestionaleSql.queryAbbonamenti(idUtente))
            : []
          abbonamenti = rows.map((r) => rowToAbbonamento(r))
        } catch (e) {
          if ((e as Error).message === "__FITCENTER_DETTAGLIO_SQL_TIMEOUT__") {
            dettaglioMeseWarning = `Timeout SQL per dettaglio-mese dopo ${DETTAGLIO_SQL_TIMEOUT_MS} ms — uso dati mock`
            fromSql = false
            const { mockAbbonamenti, mockBudget } = await import("../data/mock-gestionale.js")
            abbonamenti = mockAbbonamenti
            budgetMese = mockBudget.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 60000
            if (consulente) abbonamenti = abbonamenti.filter((a) => a.consulenteNome === consulente)
          } else {
            throw e
          }
        }
      }
    } else {
      const { mockAbbonamenti, mockBudget } = await import("../data/mock-gestionale.js")
      abbonamenti = mockAbbonamenti
      budgetMese = mockBudget.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 60000
      if (consulente) abbonamenti = abbonamenti.filter((a) => a.consulenteNome === consulente)
    }

    let budgetGiorno = budgetMese / giorniNelMese
    let budgetProgressivoMese = (budgetMese * giorno) / giorniNelMese

    let bloccoGiorno!: DettaglioBlocco
    let bloccoMese!: DettaglioBlocco
    if (fromSql) {
      try {
        const sqlBuilt = await withDettaglioSqlTimeout(
          (async () => {
            const labels = budgetPerConsulente.getConsulentiLabels()
            if (!idUtente && labels.length > 0) {
              const perConsulenteGiorno: DettaglioConsulente[] = []
              const perConsulenteMese: DettaglioConsulente[] = []
              for (const label of labels) {
                const id = await resolveConsultantId(label)
                const budgetCons = budgetConsulenteSalvato(anno, mese, label)
                const budgetGiornoCons = budgetCons / giorniNelMese
                const budgetProgressivoMeseCons = (budgetCons * giorno) / giorniNelMese
                const [venditeGiorno, venditeMese] = await Promise.all([
                  gestionaleSql.getVenditeTotaleGiorno(anno, mese, giorno, id),
                  gestionaleSql.getVenditeProgressivoMese(anno, mese, giorno, id),
                ])
                const scostG = venditeGiorno - budgetGiornoCons
                const scostM = venditeMese - budgetProgressivoMeseCons
                const trendG = budgetGiornoCons > 0 ? Math.round((venditeGiorno / budgetGiornoCons) * 10000) / 100 : 0
                const trendM =
                  budgetProgressivoMeseCons > 0 ? Math.round((venditeMese / budgetProgressivoMeseCons) * 10000) / 100 : 0
                perConsulenteGiorno.push({
                  consulente: label,
                  budget: Math.round(budgetGiornoCons * 100) / 100,
                  budgetProgressivo: Math.round(budgetGiornoCons * 100) / 100,
                  consuntivo: venditeGiorno,
                  scostamento: Math.round(scostG * 100) / 100,
                  assenze: 0,
                  improduttivi: 0,
                  trend: trendG,
                })
                perConsulenteMese.push({
                  consulente: label,
                  budget: Math.round(budgetCons * 100) / 100,
                  budgetProgressivo: Math.round(budgetProgressivoMeseCons * 100) / 100,
                  consuntivo: venditeMese,
                  scostamento: Math.round(scostM * 100) / 100,
                  assenze: 0,
                  improduttivi: 0,
                  trend: trendM,
                })
              }
              return {
                bloccoGiorno: buildDettaglioBloccoFromPerConsulente(perConsulenteGiorno),
                bloccoMese: buildDettaglioBloccoFromPerConsulente(perConsulenteMese),
              }
            }
            const [totaleGiornoSql, totaleMeseSql] = await Promise.all([
              gestionaleSql.getVenditeTotaleGiorno(anno, mese, giorno, idUtente),
              gestionaleSql.getVenditeProgressivoMese(anno, mese, giorno, idUtente),
            ])
            return {
              bloccoGiorno: buildDettaglioBloccoFromTotale(totaleGiornoSql, budgetGiorno, budgetGiorno),
              bloccoMese: buildDettaglioBloccoFromTotale(totaleMeseSql, budgetMese, budgetProgressivoMese),
            }
          })()
        )
        bloccoGiorno = sqlBuilt.bloccoGiorno
        bloccoMese = sqlBuilt.bloccoMese
      } catch (e) {
        if ((e as Error).message === "__FITCENTER_DETTAGLIO_SQL_TIMEOUT__") {
          dettaglioMeseWarning = `Timeout SQL per dettaglio-mese dopo ${DETTAGLIO_SQL_TIMEOUT_MS} ms — uso dati mock`
          fromSql = false
          const { mockAbbonamenti, mockBudget } = await import("../data/mock-gestionale.js")
          abbonamenti = mockAbbonamenti
          budgetMese = mockBudget.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 60000
          if (consulente) abbonamenti = abbonamenti.filter((a) => a.consulenteNome === consulente)
          budgetGiorno = budgetMese / giorniNelMese
          budgetProgressivoMese = (budgetMese * giorno) / giorniNelMese
        } else {
          throw e
        }
      }
    }

    if (!fromSql && useMovimenti) {
      const nomeToId = await gestionaleSql.getConsultantIdUtenteMap()
      const idToNome = new Map<string, string>()
      nomeToId.forEach((id, nome) => idToNome.set(id, nome))
      const movArr = movimenti as Record<string, unknown>[]
      const movimentiMese = movArr.filter((r) => {
        const d = movimentoDate(r)
        if (!d || !movimentoCountAsSale(r)) return false
        const p = toDateParts(d)
        return p.year === anno && p.month === mese && p.day <= giorno!
      })
      const movimentiGiorno = movArr.filter((r) => {
        const d = movimentoDate(r)
        if (!d || !movimentoCountAsSale(r)) return false
        const p = toDateParts(d)
        return p.year === anno && p.month === mese && p.day === giorno
      })
      bloccoGiorno = buildDettaglioBloccoFromMovimenti(movimentiGiorno, budgetGiorno, budgetGiorno, idToNome)
      bloccoMese = buildDettaglioBloccoFromMovimenti(movimentiMese, budgetMese, budgetProgressivoMese, idToNome)
    } else if (!fromSql) {
      const fineGiorno = new Date(anno, mese - 1, giorno, 23, 59, 59)
      const venditeAbb = abbonamenti.filter((a) => !a.isTesseramento && !isEsclusoVenditeListe(a))
      const abbonamentiMese = venditeAbb.filter((a) => {
        const d = new Date(a.dataInizio)
        return d.getFullYear() === anno && d.getMonth() + 1 === mese && d <= fineGiorno
      })
      const abbonamentiGiorno = abbonamentiMese.filter((a) => {
        const d = new Date(a.dataInizio)
        return d.getDate() === giorno
      })
      bloccoGiorno = buildDettaglioBlocco(abbonamentiGiorno, budgetGiorno, budgetGiorno)
      bloccoMese = buildDettaglioBlocco(abbonamentiMese, budgetMese, budgetProgressivoMese)
    }

    const dataOra = new Date(anno, mese - 1, giorno)
    const giornoLabel = `${GIORNI_SETTIMANA[dataOra.getDay()].toUpperCase()} ${giorno} ${MESI_LABEL[mese - 1].toUpperCase()} ${anno}`

    const result: DettaglioMeseResponse & {
      _debug?: { consulente: string | undefined; idUtente: string | undefined }
      _warning?: string
    } = {
      anno,
      mese,
      meseLabel: `${MESI_LABEL[mese - 1].toUpperCase()} ${anno}`,
      giorno,
      giornoLabel,
      giorniNelMese,
      dettaglioGiorno: bloccoGiorno,
      dettaglioMese: bloccoMese,
      _debug: { consulente, idUtente: idUtente ?? undefined },
      ...(dettaglioMeseWarning ? { _warning: dettaglioMeseWarning } : {}),
    }
    if (dettaglioMeseWarning && !isAsOfToday(asOf.key)) {
      // Evita di "congelare" dati mock su storico: se oggi abbiamo problemi di rete/SQL,
      // al prossimo refresh (con storico non scaduto) verrà ricalcolato solo dopo un buon segnale.
      return res.json(result)
    }

    await cacheSet({
      name: "data.dettaglio-mese",
      scope,
      params: cacheParams,
      asOf: cacheAsOf,
      depSig,
      ttlMs: dettaglioMeseWarning ? 10_000 : getCacheTtlMsForAsOf(cacheAsOf, 0),
      value: result,
    })
    res.json(result)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}


/** Dettaglio anno: totale + per consulente (budget anno, progressivo a oggi, consuntivo, scostamento, assenze, improduttivi, trend). */
export async function getDettaglioAnno(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    if (Number.isNaN(anno) || anno < 2000 || anno > 2100) {
      return res.status(400).json({ message: "anno obbligatorio e valido (2000-2100)" })
    }
    const scope = cacheScope(req)
    const asOf = parseAsOf(req)
    const cacheAsOf = dettaglioAnnoCacheAsOf(anno, asOf.key)
    const depSig = getFrozenDepSig(cacheAsOf, await getBudgetDepSig())
    const cacheKeyParams = { anno }
    const cached = await cacheGet<{ anno: number; annoLabel: string; dettaglio: DettaglioBlocco }>({
      name: "data.dettaglio-anno",
      scope,
      params: cacheKeyParams,
      asOf: cacheAsOf,
      depSig,
    })
    if (cached) return res.json(cached)
    const oggi = toDateParts(asOf.date)
    const labels = budgetPerConsulente.getConsulentiLabels()
    const perConsulente: DettaglioConsulente[] = []

    for (const label of labels) {
      const id = await resolveConsultantId(label)
      const venditePerMese = gestionaleSql.isGestionaleConfigured()
        ? await gestionaleSql.getVenditePerMeseAnno(anno, id)
        : []
      const venditeAnno = venditePerMese.reduce((s, x) => s + x.totale, 0)
      let budgetAnno = 0
      let budgetProgressivoAnno = 0
      for (let m = 1; m <= 12; m++) {
        const b = budgetConsulenteSalvato(anno, m, label)
        budgetAnno += b
        if (anno < oggi.year || (anno === oggi.year && m < oggi.month)) {
          budgetProgressivoAnno += b
        } else if (anno === oggi.year && m === oggi.month) {
          const giorniNelMese = new Date(anno, m, 0).getDate()
          budgetProgressivoAnno += (b * Math.min(oggi.day, giorniNelMese)) / giorniNelMese
        }
      }
      const scost = venditeAnno - budgetProgressivoAnno
      const trend = budgetProgressivoAnno > 0 ? Math.round((venditeAnno / budgetProgressivoAnno) * 10000) / 100 : 0
      perConsulente.push({
        consulente: label,
        budget: Math.round(budgetAnno * 100) / 100,
        budgetProgressivo: Math.round(budgetProgressivoAnno * 100) / 100,
        consuntivo: venditeAnno,
        scostamento: Math.round(scost * 100) / 100,
        assenze: 0,
        improduttivi: 0,
        trend,
      })
    }

    const dettaglio = buildDettaglioBloccoFromPerConsulente(perConsulente)
    const payload = { anno, annoLabel: String(anno), dettaglio }
    await cacheSet({
      name: "data.dettaglio-anno",
      scope,
      params: cacheKeyParams,
      asOf: cacheAsOf,
      depSig,
      ttlMs: getCacheTtlMsForAsOf(cacheAsOf, 0),
      value: payload,
    })
    res.json(payload)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Follow-up rinnovi abbonamenti: stato e note per abbonamento (come CRM vendita). */
export async function getAbbonamentiFollowUp(req: Request, res: Response) {
  try {
    const all = abbonamentiFollowUpStore.store.getAll()
    res.json(all)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function updateAbbonamentiFollowUp(req: Request, res: Response) {
  try {
    const abbonamentoId = String(req.params.abbonamentoId ?? "")
    if (!abbonamentoId) return res.status(400).json({ message: "abbonamentoId mancante" })
    const body = req.body as { stato?: string; note?: string }
    const entry = abbonamentiFollowUpStore.store.set(abbonamentoId, {
      stato: body.stato as abbonamentiFollowUpStore.RinnovoStato | undefined,
      note: body.note,
    })
    res.json(entry)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Appuntamenti CRM (RVW_CRMUtenti) per dettaglio abbonamento: venditore, cliente nome/cognome, operatore. Solo mese in corso. */
export async function getCrmAppuntamenti(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.json([])
    }
    const nomeVenditore = String(req.query.nomeVenditore ?? "").trim()
    const cognome = String(req.query.cognome ?? "").trim()
    const nome = String(req.query.nome ?? "").trim()
    const nomeOperatore = String(req.query.nomeOperatore ?? getOperatoreConsulenteNome(req) ?? "").trim()
    const rows = await gestionaleSql.queryCrmAppuntamenti({
      nomeVenditore,
      cognome,
      nome,
      nomeOperatore,
    })
    res.json(rows)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Appuntamenti CRM per consulente (operatore): range date, default oggi→+14. */
export async function getCrmAppuntamentiOperatore(req: Request, res: Response) {
  try {
    const from = String(req.query.from ?? "").trim()
    const to = String(req.query.to ?? "").trim()
    const today = new Date()
    const defFrom = today.toISOString().slice(0, 10)
    const defTo = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : defFrom
    const toIso = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : defTo

    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.json({ from: fromIso, to: toIso, rows: [] })
    }

    const operatoreNome = getOperatoreConsulenteNome(req)
    const nomeOperatore = String(operatoreNome ?? (req.query.consulente as string) ?? "").trim()
    if (!nomeOperatore) return res.status(400).json({ message: "consulente/nomeOperatore obbligatorio" })

    const soloTelefonate =
      String(req.query.soloTelefonate ?? "").toLowerCase() === "1" ||
      String(req.query.soloTelefonate ?? "").toLowerCase() === "true"
    const includeCompletate =
      String(req.query.includeCompletate ?? "").toLowerCase() === "1" ||
      String(req.query.includeCompletate ?? "").toLowerCase() === "true"
    const rows = soloTelefonate
      ? await gestionaleSql.queryCrmTelefonateOperatore({
          nomeOperatore,
          from: fromIso,
          to: toIso,
          soloDaFare: !includeCompletate,
        })
      : await gestionaleSql.queryCrmAppuntamentiOperatore({ nomeOperatore, from: fromIso, to: toIso })

    if (soloTelefonate && includeCompletate) {
      const synced = syncCrmTelefonateToStore(
        rows.filter((r) => Boolean(r.dataEvasione?.trim())),
        nomeOperatore
      )
      if (synced > 0) await bumpMetaVersion("chiamate")
    }

    res.json({ from: fromIso, to: toIso, rows })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Appuntamenti CRM per cliente (nome+cognome) nel range date. */
export async function getCrmAppuntamentiCliente(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) return res.json({ from: "", to: "", rows: [] })
    const cognome = String(req.query.cognome ?? "").trim()
    const nome = String(req.query.nome ?? "").trim()
    if (!cognome || !nome) return res.status(400).json({ message: "nome e cognome obbligatori" })
    const from = String(req.query.from ?? "").trim()
    const to = String(req.query.to ?? "").trim()
    const today = new Date()
    const defFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10)
    const defTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : defFrom
    const toIso = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : defTo
    const rows = await gestionaleSql.queryCrmAppuntamentiCliente({ cognome, nome, from: fromIso, to: toIso })
    res.json({ from: fromIso, to: toIso, rows })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Convalida giorno lavorativo (consulente). */
export async function getConvalidazioni(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    const mese = Number(req.query.mese)
    const u = getScopedUser(req)
    const operatoreNome = getOperatoreConsulenteNome(req)
    // Admin può richiedere qualsiasi consulente via query; non-admin solo se stesso.
    const consulenteNome =
      (u.role === "admin" ? (req.query.consulente as string) : (operatoreNome ?? (req.query.consulente as string)))?.trim()
    if (Number.isNaN(anno) || Number.isNaN(mese)) {
      return res.status(400).json({ message: "anno e mese obbligatori" })
    }
    if (!consulenteNome) return res.status(400).json({ message: "consulente obbligatorio" })
    const convalidati = convalidazioniStore.getGiorniConvalidati(consulenteNome, anno, mese)
    res.json({ anno, mese, consulenteNome, convalidati })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Admin: convalidazioni mese per tutti i consulenti presenti nello store. */
export async function getConvalidazioniAdminAll(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin") return res.status(403).json({ message: "Permessi insufficienti" })
    const anno = Number(req.query.anno)
    const mese = Number(req.query.mese)
    if (Number.isNaN(anno) || Number.isNaN(mese)) {
      return res.status(400).json({ message: "anno e mese obbligatori" })
    }
    const all = convalidazioniStore.getAllByMonth(anno, mese)
    res.json({ anno, mese, all })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function setConvalidazione(req: Request, res: Response) {
  try {
    const body = req.body as { anno: number; mese: number; giorno: number; convalidato: boolean; consulenteNome: string }
    const { anno, mese, giorno, convalidato } = body
    if (anno == null || mese == null || giorno == null || typeof convalidato !== "boolean") {
      return res.status(400).json({ message: "anno, mese, giorno e convalidato obbligatori" })
    }
    const u = getScopedUser(req)
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulenteNome = (operatoreNome ?? body.consulenteNome)?.trim()
    if (!consulenteNome) return res.status(400).json({ message: "consulenteNome obbligatorio" })
    if (u.role !== "admin" && operatoreNome && consulenteNome !== operatoreNome) {
      return res.status(403).json({ message: "Permessi insufficienti" })
    }
    convalidazioniStore.set(consulenteNome, anno, mese, giorno, convalidato)
    await bumpMetaVersion("convalidazioni")
    res.json({ anno, mese, giorno, convalidato })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Ore lavorate: lista (consulente, anno, mese) e creazione. Solo operatore per i propri dati; admin può vedere tutti. */
export async function getOreLavorate(req: Request, res: Response) {
  try {
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulente = (operatoreNome ?? (req.query.consulente as string))?.trim()
    const anno = req.query.anno != null ? Number(req.query.anno) : undefined
    const mese = req.query.mese != null ? Number(req.query.mese) : undefined
    const list = oreLavorateStore.list({
      consulenteNome: consulente || undefined,
      anno: Number.isNaN(anno as number) ? undefined : (anno as number),
      mese: Number.isNaN(mese as number) ? undefined : (mese as number),
    })
    res.json(list)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function postOraLavorata(req: Request, res: Response) {
  try {
    const body = req.body as { consulenteNome: string; giorno: string; oraInizio: string; oraFine: string }
    const { consulenteNome, giorno, oraInizio, oraFine } = body
    const operatoreNome = getOperatoreConsulenteNome(req)
    const nome = (operatoreNome ?? consulenteNome)?.trim()
    if (!nome) return res.status(400).json({ message: "consulenteNome obbligatorio" })
    const u = getScopedUser(req)
    if (u.role !== "admin" && operatoreNome && nome !== operatoreNome) {
      return res.status(403).json({ message: "Permessi insufficienti" })
    }
    if (!giorno || !/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
      return res.status(400).json({ message: "giorno obbligatorio (YYYY-MM-DD)" })
    }
    if (!oraInizio || !/^\d{1,2}:\d{2}$/.test(oraInizio)) {
      return res.status(400).json({ message: "oraInizio obbligatorio (HH:mm)" })
    }
    if (!oraFine || !/^\d{1,2}:\d{2}$/.test(oraFine)) {
      return res.status(400).json({ message: "oraFine obbligatorio (HH:mm)" })
    }
    if (oraInizio >= oraFine) {
      return res.status(400).json({ message: "oraFine deve essere successiva a oraInizio" })
    }
    const created = oreLavorateStore.create({ consulenteNome: nome, giorno, oraInizio, oraFine })
    res.status(201).json(created)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function deleteOraLavorata(req: Request, res: Response) {
  try {
    const id = String(req.params.id)
    const operatoreNome = getOperatoreConsulenteNome(req)
    const list = oreLavorateStore.list({})
    const row = list.find((r) => r.id === id)
    if (!row) return res.status(404).json({ message: "Ora lavorata non trovata" })
    const u = getScopedUser(req)
    if (u.role !== "admin" && (operatoreNome ?? "") !== (row.consulenteNome ?? "")) {
      return res.status(403).json({ message: "Puoi eliminare solo le tue ore" })
    }
    oreLavorateStore.delete(id)
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

type ReportPeriodo = "week" | "month" | "year"
type ReportMovimentoDettaglio = {
  data: string
  cliente: string
  abbonamento: string
  importo: number
}
type ReportCrossDettaglio = {
  data: string
  cliente: string
  abbonamento: string
  totale: number
}
type ReportOreDettaglio = {
  giorno: string
  oraInizio: string
  oraFine: string
  ore: number
  convalidato: boolean
}
type ReportRow = {
  consulenteNome: string
  vendite: number
  /** Iscrizioni distinte con movimento nel periodo (stesso filtro di Andamento vendite). */
  movimentiAndamento: number
  /** Budget mese intero salvato (mese di «to»). */
  budgetMese: number
  /** Budget prorata sul periodo Dal/Al. */
  budget: number
  percentualeBudget: number
  telefonate: number
  clientiNuovi: number
  rinnovi: number
  invitoClienti: number
  /** Passaggi a CROSS (elenco vendite cross). */
  crossAbbonamenti: number
  crossTotaleEuro: number
  oreLavorate: number
  oreAttese: number
  percentualeOre: number
  giorniConvalidati: number
  giorniConvalidatiLista: string
  dettaglioOreLavorate: ReportOreDettaglio[]
  dettaglioClientiNuovi: ReportMovimentoDettaglio[]
  dettaglioRinnovi: ReportMovimentoDettaglio[]
  dettaglioInvito: ReportMovimentoDettaglio[]
  dettaglioCross: ReportCrossDettaglio[]
  totaleEuroClientiNuovi: number
  totaleEuroRinnovi: number
}

function normalizeCategoryToken(s: string | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isMacroClienteNuovo(macro: string): boolean {
  const x = normalizeCategoryToken(macro)
  return x === "NUOVI" || x === "GOLD ESTIVO" || x === "GOLD ESITVO" || x === "GOLD PREMIUM"
}

/** YYYY-MM-DD da dataInizio (mappa già normalizza; evita confronti Date/timezone). */
function abbonamentoDataInizioKey(dataInizio: string | undefined): string | null {
  const key = String(dataInizio ?? "").trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}

function abbonamentoInRangeCalendar(dataInizio: string | undefined, fromKey: string, toKey: string): boolean {
  const key = abbonamentoDataInizioKey(dataInizio)
  if (key) return key >= fromKey && key <= toKey
  const di = new Date(String(dataInizio ?? "").trim())
  if (Number.isNaN(di.getTime())) return false
  di.setUTCHours(0, 0, 0, 0)
  const k = di.toISOString().slice(0, 10)
  return k >= fromKey && k <= toKey
}

/** Conteggio report: macro da view; se assente, cerca nelle descrizioni categoria/abbonamento. */
function isMacroClienteNuovoAbb(a: Abbonamento): boolean {
  const macro = a.macroCategoriaDescrizione ?? ""
  if (macro.trim()) {
    if (isMacroClienteNuovo(macro)) return true
    const mx = normalizeCategoryToken(macro)
    if (mx.includes("NUOVI") || mx.includes("GOLD ESTIVO") || mx.includes("GOLD ESITVO") || mx.includes("GOLD PREMIUM")) {
      return true
    }
  }
  const blob = normalizeCategoryToken(`${a.categoriaAbbonamentoDescrizione ?? ""} ${a.abbonamentoDescrizione ?? ""}`)
  if (!blob) return false
  return (
    blob.includes("GOLD ESTIVO") ||
    blob.includes("GOLD ESITVO") ||
    blob.includes("GOLD PREMIUM") ||
    (blob.includes("NUOVI") && !blob.includes("RINNOVI"))
  )
}

function isMacroRinnoviAbb(a: Abbonamento): boolean {
  const macro = a.macroCategoriaDescrizione ?? ""
  if (macro.trim()) {
    const mx = normalizeCategoryToken(macro)
    if (mx === "RINNOVI" || mx.includes("RINNOVI")) return true
  }
  const blob = normalizeCategoryToken(`${a.categoriaAbbonamentoDescrizione ?? ""} ${a.abbonamentoDescrizione ?? ""}`)
  return blob.includes("RINNOVI")
}

function isCategoriaInvitoAbb(a: Abbonamento): boolean {
  // Richiesta: Invito clienti = MacroCategoria=INVITO e Categoria=settimanaprovaingressi
  const macro = normalizeCategoryToken(a.macroCategoriaDescrizione ?? "")
  const cat = normalizeCategoryToken(a.categoriaAbbonamentoDescrizione ?? "")
  const macroKey = macro.replace(/[\s_]+/g, "")
  const catKey = cat.replace(/[\s_]+/g, "")
  return macroKey === "INVITO" && catKey === "SETTIMANAPROVAINGRESSI"
}

function toISODate(d: Date): string {
  const x = new Date(d)
  // Evita scivolamenti di 1 giorno tra timezone (il frontend usa ISO date).
  x.setUTCHours(0, 0, 0, 0)
  return x.toISOString().slice(0, 10)
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = (day + 6) % 7 // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d
}

function countWeekdaysMonFri(from: Date, to: Date): number {
  const a = new Date(from)
  a.setUTCHours(0, 0, 0, 0)
  const b = new Date(to)
  b.setUTCHours(0, 0, 0, 0)
  let count = 0
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow >= 1 && dow <= 5) count++
  }
  return count
}

/** Parsing YYYY-MM-DD senza shift fuso: stessi numeri scelti nel date picker. */
function parseIsoDatePartsCalendar(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** Come `getDettaglioMese`: giorni nel mese con `new Date(anno, mese, 0).getDate()` (locale server). */
function daysInMonthLocal(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate()
}

/**
 * Budget prorata sul range [fp, tp] inclusivo, stessa formula del dashboard:
 * per ogni mese, `budgetMese * (giorni nell’intersezione / giorni del mese)`.
 */
function budgetProRataCalendarParts(
  fp: { year: number; month: number; day: number },
  tp: { year: number; month: number; day: number },
  consulenteNome: string
): number {
  if (
    fp.year > tp.year ||
    (fp.year === tp.year && fp.month > tp.month) ||
    (fp.year === tp.year && fp.month === tp.month && fp.day > tp.day)
  ) {
    return 0
  }

  let sum = 0
  let y = fp.year
  let m = fp.month

  while (y < tp.year || (y === tp.year && m <= tp.month)) {
    const dim = daysInMonthLocal(y, m)
    const startD = y === fp.year && m === fp.month ? fp.day : 1
    const endD = y === tp.year && m === tp.month ? tp.day : dim
    const sd = Math.max(1, Math.min(startD, dim))
    const ed = Math.max(1, Math.min(endD, dim))
    if (sd <= ed) {
      const giorni = ed - sd + 1
      const budgetMese = budgetConsulenteSalvato(y, m, consulenteNome)
      sum += dim > 0 ? (budgetMese / dim) * giorni : 0
    }
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return sum
}

/**
 * Euro vendite su [fa,ta] usando solo `getVenditeProgressivoMese` (stessa logica SQL del dashboard).
 * Utile se la CTE sulla view fallisce o non è configurata.
 */
async function venditeEuroRangeViaProgressivo(
  fa: { year: number; month: number; day: number },
  ta: { year: number; month: number; day: number },
  idUtente: string
): Promise<number> {
  if (
    fa.year > ta.year ||
    (fa.year === ta.year && fa.month > ta.month) ||
    (fa.year === ta.year && fa.month === ta.month && fa.day > ta.day)
  ) {
    return 0
  }
  let total = 0
  let y = fa.year
  let m = fa.month
  for (;;) {
    if (y > ta.year || (y === ta.year && m > ta.month)) break
    const dim = daysInMonthLocal(y, m)
    const startD = y === fa.year && m === fa.month ? fa.day : 1
    const endD = y === ta.year && m === ta.month ? ta.day : dim
    if (startD <= endD) {
      const thruEnd = await gestionaleSql.getVenditeProgressivoMese(y, m, endD, idUtente)
      const before = startD > 1 ? await gestionaleSql.getVenditeProgressivoMese(y, m, startD - 1, idUtente) : 0
      total += thruEnd - before
    }
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return Math.max(0, Math.round(total * 100) / 100)
}

function oreDiff(oraInizio: string, oraFine: string): number {
  const [h1, m1] = oraInizio.split(":").map((x) => Number(x))
  const [h2, m2] = oraFine.split(":").map((x) => Number(x))
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return 0
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1)
  return Math.max(0, mins / 60)
}

function convalidatiInRange(consulenteNome: string, fromIso: string, toIso: string): { count: number; lista: string } {
  const fa = parseIsoDatePartsCalendar(fromIso)
  const ta = parseIsoDatePartsCalendar(toIso)
  if (!fa || !ta) return { count: 0, lista: "—" }
  const giorni: string[] = []
  const cur = new Date(fa.year, fa.month - 1, fa.day)
  const end = new Date(ta.year, ta.month - 1, ta.day)
  while (cur <= end) {
    const y = cur.getFullYear()
    const m = cur.getMonth() + 1
    const d = cur.getDate()
    if (convalidazioniStore.get(consulenteNome, y, m, d)) {
      giorni.push(`${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`)
    }
    cur.setDate(cur.getDate() + 1)
  }
  return { count: giorni.length, lista: giorni.length ? giorni.join(", ") : "—" }
}

function isGiornoConvalidato(consulenteNome: string, giornoIso: string): boolean {
  const p = parseIsoDatePartsCalendar(giornoIso)
  if (!p) return false
  return convalidazioniStore.get(consulenteNome, p.year, p.month, p.day)
}

/** Report per consulenti: vendite + telefonate + ore lavorate con % ore (ore/attese) su settimana/mese/anno. */
export async function getReportConsulenti(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    if (u.role !== "admin" && u.role !== "operatore") {
      return res.status(403).json({ message: "Permessi insufficienti" })
    }

    const periodo = String(req.query.periodo ?? "week") as ReportPeriodo
    const asOfRaw = String(req.query.asOf ?? "")
    const asOf = asOfRaw && /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? new Date(`${asOfRaw}T12:00:00Z`) : new Date()
    const fromRaw = String(req.query.from ?? "")
    const toRaw = String(req.query.to ?? "")
    const selectedConsulentiRaw = String(req.query.consulenti ?? "")
    const selectedConsulenti = selectedConsulentiRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    const labels = budgetPerConsulente.getConsulentiLabels()
    let labelsFiltered = selectedConsulenti.length > 0 ? labels.filter((l) => selectedConsulenti.includes(l)) : labels
    const scopedConsulente = u.role === "operatore" ? getOperatoreConsulenteNome(req) : null
    if (scopedConsulente) {
      labelsFiltered = labelsFiltered.filter((l) => l === scopedConsulente)
      if (labelsFiltered.length === 0) labelsFiltered = [scopedConsulente]
    }

    let from: Date
    let to: Date
    const hasCustomRange = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)
    if (hasCustomRange) {
      from = new Date(`${fromRaw}T00:00:00Z`)
      to = new Date(`${toRaw}T23:59:59.999Z`)
      if (from > to) return res.status(400).json({ message: "Intervallo date non valido (from > to)" })
    } else if (periodo === "year") {
      const y = asOf.getUTCFullYear()
      from = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0))
      to = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999))
    } else if (periodo === "month") {
      const y = asOf.getUTCFullYear()
      const m = asOf.getUTCMonth() // 0..11
      from = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
      to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999))
    } else {
      from = startOfWeekMonday(asOf)
      to = new Date(from)
      to.setUTCDate(to.getUTCDate() + 6)
    }

    const fromIso = toISODate(from)
    const toIso = toISODate(to)
    const oreAttese = countWeekdaysMonFri(from, to) * 8
    const faCal = hasCustomRange ? parseIsoDatePartsCalendar(fromRaw) : null
    const taCal = hasCustomRange ? parseIsoDatePartsCalendar(toRaw) : null

    // Cache persistente (admin): utile per report storici e per precompute one-shot.
    // asOfKey: usiamo "toIso" perché identifica il punto temporale del report.
    const scope = cacheScope(req)
    const depSig = await getBudgetDepSig()
    const consulentiKey = labelsFiltered.join("|")
    const cacheKeyParams = { v: 3, from: fromIso, to: toIso, consulenti: consulentiKey || null }
    const cached = await cacheGet<any>({
      name: "data.report-consulenti",
      scope,
      params: cacheKeyParams,
      asOf: toIso,
      depSig,
    })
    if (cached) return res.json(cached)

    const rows: ReportRow[] = []
    let cachedMockAbbonamenti: Abbonamento[] | null = null

    const crossByVenditore = new Map<number, number>()
    if (gestionaleSql.isGestionaleConfigured()) {
      try {
        const cr = await withReportConsulentiSqlTimeout(
          gestionaleSql.getCrossAbbonamentiDaLogByVenditore(fromIso, toIso)
        )
        if (cr.ok) {
          for (const row of cr.rows) {
            crossByVenditore.set(row.idVenditore, row.cnt)
          }
        }
      } catch {
        /* report resta con cross a 0 */
      }
    }

    const ensureMockLoaded = async () => {
      if (cachedMockAbbonamenti) return cachedMockAbbonamenti
      const mod = await import("../data/mock-gestionale.js")
      cachedMockAbbonamenti = mod.mockAbbonamenti
      return cachedMockAbbonamenti
    }

    for (const consulenteNome of labelsFiltered) {
      let idUtente: string | undefined
      try {
        idUtente = await withReportConsulentiSqlTimeout(resolveConsultantId(consulenteNome))
      } catch (e) {
        if ((e as Error).message !== "__FITCENTER_REPORT_CONSULENTI_SQL_TIMEOUT__") throw e
        idUtente = undefined
      }
      let vendite = 0
      let venditeAbbRows: Abbonamento[] = []
      let reportCountRows: Abbonamento[] = []

      // Budget periodo per consulente (prorata calendario = dettaglio mese; Dal/Al = stringe picker senza UTC)
      let budget = 0
      let budgetMese = 0
      if (hasCustomRange) {
        budget = faCal && taCal ? budgetProRataCalendarParts(faCal, taCal, consulenteNome) : 0
        if (taCal) budgetMese = budgetConsulenteSalvato(taCal.year, taCal.month, consulenteNome)
      } else if (periodo === "year") {
        const y = asOf.getUTCFullYear()
        for (let m = 1; m <= 12; m++) budget += budgetConsulenteSalvato(y, m, consulenteNome)
        budgetMese = budgetConsulenteSalvato(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, consulenteNome)
      } else if (periodo === "month") {
        budget = budgetConsulenteSalvato(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, consulenteNome)
        budgetMese = budget
      } else {
        budget = budgetProRataCalendarParts(toDateParts(from), toDateParts(to), consulenteNome)
        const tp = toDateParts(to)
        budgetMese = budgetConsulenteSalvato(tp.year, tp.month, consulenteNome)
      }

      if (gestionaleSql.isGestionaleConfigured() && idUtente) {
        try {
          const abbonRows = await withReportConsulentiSqlTimeout(gestionaleSql.queryAbbonamenti(idUtente))
          const abbonamenti = abbonRows
            .map((r) => rowToAbbonamento(r))
            .filter((a) => !a.isTesseramento)
            .filter((a) => abbonamentoInRangeCalendar(a.dataInizio, fromIso, toIso))
          reportCountRows = abbonamenti
          venditeAbbRows = abbonamenti.filter((a) => !isEsclusoVenditeListe(a))
          vendite = venditeAbbRows.reduce((s, a) => s + (a.prezzo ?? 0), 0)
        } catch (e) {
          if ((e as Error).message !== "__FITCENTER_REPORT_CONSULENTI_SQL_TIMEOUT__") throw e
          await ensureMockLoaded()
          const source = cachedMockAbbonamenti ?? ([] as Abbonamento[])
          const abbonamenti = source
            .filter((a) => (a.consulenteNome ?? "") === consulenteNome)
            .filter((a) => !a.isTesseramento)
            .filter((a) => abbonamentoInRangeCalendar(a.dataInizio, fromIso, toIso))
          reportCountRows = abbonamenti
          venditeAbbRows = abbonamenti.filter((a) => !isEsclusoVenditeListe(a))
          vendite = venditeAbbRows.reduce((s, a) => s + (a.prezzo ?? 0), 0)
        }
      } else {
        await ensureMockLoaded()
        const source = cachedMockAbbonamenti ?? ([] as Abbonamento[])
        const abbonamenti = source
          .filter((a) => (a.consulenteNome ?? "") === consulenteNome)
          .filter((a) => !a.isTesseramento)
          .filter((a) => abbonamentoInRangeCalendar(a.dataInizio, fromIso, toIso))
        reportCountRows = abbonamenti
        venditeAbbRows = abbonamenti.filter((a) => !isEsclusoVenditeListe(a))
        vendite = venditeAbbRows.reduce((s, a) => s + (a.prezzo ?? 0), 0)
      }

      let movimentiAndamento = 0
      let venditeDaViewSql = false
      // Dashboard consuntivo = `getVenditeProgressivoMese` → query per-iscrizione (Totale view + Temp_Stampe).
      // `getVenditeTotaleRangeView` somma invece SUM(M.Importo): più alta se ci sono più movimenti sulla stessa iscrizione.
      const venditeByMovimento = process.env.GESTIONALE_VENDITE_BY_MOVIMENTO === "true"
      if (gestionaleSql.isGestionaleConfigured() && idUtente) {
        try {
          const [euro, mov] = await Promise.all([
            venditeByMovimento
              ? withReportConsulentiSqlTimeout(gestionaleSql.getVenditeTotaleRangeView(fromIso, toIso, idUtente))
              : Promise.resolve({ ok: false as const, totaleEuro: 0 }),
            withReportConsulentiSqlTimeout(
              gestionaleSql.getVenditeMovimentiCategoriaDurata(fromIso, toIso, idUtente)
            ),
          ])
          if (euro.ok) {
            vendite = euro.totaleEuro
            venditeDaViewSql = true
          }
          movimentiAndamento = mov.totalCount ?? 0
        } catch {
          /* mantieni vendite da abbonamenti */
        }
      }

      if (gestionaleSql.isGestionaleConfigured() && idUtente && !venditeDaViewSql) {
        try {
          if (hasCustomRange && faCal && taCal) {
            vendite = await withReportConsulentiSqlTimeout(
              venditeEuroRangeViaProgressivo(faCal, taCal, idUtente)
            )
          } else if (periodo === "week") {
            const rf = toDateParts(from)
            const rt = toDateParts(to)
            vendite = await withReportConsulentiSqlTimeout(
              venditeEuroRangeViaProgressivo(
                { year: rf.year, month: rf.month, day: rf.day },
                { year: rt.year, month: rt.month, day: rt.day },
                idUtente
              )
            )
          } else {
            const f = parseIsoDatePartsCalendar(fromIso)
            const t = parseIsoDatePartsCalendar(toIso)
            if (f && t) {
              vendite = await withReportConsulentiSqlTimeout(
                venditeEuroRangeViaProgressivo(f, t, idUtente)
              )
            }
          }
        } catch {
          /* vendite da abbonamenti */
        }
      }

      // Telefonate: sync da gestionale + registro locale.
      if (gestionaleSql.isGestionaleConfigured()) {
        try {
          const crmTel = await gestionaleSql.queryCrmTelefonateOperatore({
            nomeOperatore: consulenteNome,
            from: fromIso,
            to: toIso,
            soloDaFare: false,
          })
          syncCrmTelefonateToStore(crmTel, consulenteNome)
        } catch {
          /* sync best-effort */
        }
      }
      const chiamate = chiamateStore.list({
        consulenteId: consulenteNome,
        da: fromIso,
        a: toIso,
      })
      const telefonate = chiamate.length

      // Ore lavorate: persistite localmente.
      const oreRows = oreLavorateStore.list({ consulenteNome })
        .filter((r) => r.giorno >= fromIso && r.giorno <= toIso)
      const oreLavorate = oreRows.reduce((s, r) => s + oreDiff(r.oraInizio, r.oraFine), 0)
      const percentualeOre = oreAttese > 0 ? Math.round((oreLavorate / oreAttese) * 1000) / 10 : 0
      const { count: giorniConvalidati, lista: giorniConvalidatiLista } = convalidatiInRange(consulenteNome, fromIso, toIso)
      const dettaglioOreLavorate: ReportOreDettaglio[] = oreRows
        .slice()
        .sort((a, b) => a.giorno.localeCompare(b.giorno) || a.oraInizio.localeCompare(b.oraInizio))
        .map((r) => ({
          giorno: r.giorno,
          oraInizio: r.oraInizio,
          oraFine: r.oraFine,
          ore: Math.round(oreDiff(r.oraInizio, r.oraFine) * 10) / 10,
          convalidato: isGiornoConvalidato(consulenteNome, r.giorno),
        }))
      const percentualeBudget = budget > 0 ? Math.round((vendite / budget) * 1000) / 10 : 0

      let clientiNuovi = 0
      let rinnovi = 0
      let invitoClienti = 0
      if (gestionaleSql.isGestionaleConfigured() && idUtente) {
        try {
          const conteggi = await withReportConsulentiSqlTimeout(
            gestionaleSql.getReportConteggiAndamento(fromIso, toIso, idUtente)
          )
          if (conteggi.ok) {
            clientiNuovi = conteggi.clientiNuovi
            rinnovi = conteggi.rinnovi
            invitoClienti = conteggi.invitoClienti
          } else {
            clientiNuovi = reportCountRows.filter((a) => isMacroClienteNuovoAbb(a)).length
            rinnovi = reportCountRows.filter((a) => isMacroRinnoviAbb(a)).length
            invitoClienti = reportCountRows.filter((a) => isCategoriaInvitoAbb(a)).length
          }
        } catch {
          clientiNuovi = reportCountRows.filter((a) => isMacroClienteNuovoAbb(a)).length
          rinnovi = reportCountRows.filter((a) => isMacroRinnoviAbb(a)).length
          invitoClienti = reportCountRows.filter((a) => isCategoriaInvitoAbb(a)).length
        }
      } else {
        clientiNuovi = reportCountRows.filter((a) => isMacroClienteNuovoAbb(a)).length
        rinnovi = reportCountRows.filter((a) => isMacroRinnoviAbb(a)).length
        invitoClienti = reportCountRows.filter((a) => isCategoriaInvitoAbb(a)).length
      }

      let crossAbbonamenti = 0
      let crossTotaleEuro = 0
      const dettaglioCross: ReportCrossDettaglio[] = []
      if (idUtente) {
        try {
          const crossElenco = await withReportConsulentiSqlTimeout(
            gestionaleSql.getVenditeCrossElenco(fromIso, toIso, idUtente)
          )
          crossAbbonamenti = crossElenco.rows.length
          crossTotaleEuro = Math.round(crossElenco.totale * 100) / 100
          for (const cr of crossElenco.rows) {
            dettaglioCross.push({
              data: cr.dataCross,
              cliente: cr.cliente,
              abbonamento: cr.abbonamento,
              totale: Math.round(cr.totale * 100) / 100,
            })
          }
        } catch {
          for (const vid of gestionaleSql.parseConsultantIds(idUtente)) {
            crossAbbonamenti += crossByVenditore.get(vid) ?? 0
          }
        }
      }

      let dettaglioClientiNuovi: ReportMovimentoDettaglio[] = []
      let dettaglioRinnovi: ReportMovimentoDettaglio[] = []
      let dettaglioInvito: ReportMovimentoDettaglio[] = []
      let totaleEuroClientiNuovi = 0
      let totaleEuroRinnovi = 0
      if (gestionaleSql.isGestionaleConfigured() && idUtente) {
        try {
          const [nuovi, rin, inv] = await Promise.all([
            withReportConsulentiSqlTimeout(gestionaleSql.getReportMovimentiElenco(fromIso, toIso, idUtente, "clientiNuovi")),
            withReportConsulentiSqlTimeout(gestionaleSql.getReportMovimentiElenco(fromIso, toIso, idUtente, "rinnovi")),
            withReportConsulentiSqlTimeout(gestionaleSql.getReportInvitoElenco(fromIso, toIso, idUtente)),
          ])
          if (nuovi.ok) {
            dettaglioClientiNuovi = nuovi.rows
            totaleEuroClientiNuovi = nuovi.totaleEuro
            if (clientiNuovi === 0) clientiNuovi = nuovi.rows.length
          }
          if (rin.ok) {
            dettaglioRinnovi = rin.rows
            totaleEuroRinnovi = rin.totaleEuro
            if (rinnovi === 0) rinnovi = rin.rows.length
          }
          if (inv.ok) {
            dettaglioInvito = inv.rows
            if (invitoClienti === 0) invitoClienti = inv.rows.length
          }
        } catch {
          /* mantieni conteggi aggregati */
        }
      }

      rows.push({
        consulenteNome,
        vendite: Math.round(vendite * 100) / 100,
        movimentiAndamento,
        budgetMese: Math.round(budgetMese * 100) / 100,
        budget: Math.round(budget * 100) / 100,
        percentualeBudget,
        telefonate,
        clientiNuovi,
        rinnovi,
        invitoClienti,
        crossAbbonamenti,
        crossTotaleEuro,
        oreLavorate: Math.round(oreLavorate * 10) / 10,
        oreAttese,
        percentualeOre,
        giorniConvalidati,
        giorniConvalidatiLista,
        dettaglioOreLavorate,
        dettaglioClientiNuovi,
        dettaglioRinnovi,
        dettaglioInvito,
        dettaglioCross,
        totaleEuroClientiNuovi,
        totaleEuroRinnovi,
      })
    }

    rows.sort((a, b) => b.vendite - a.vendite)

    const sumV = rows.reduce((s, r) => s + r.vendite, 0)
    const sumB = rows.reduce((s, r) => s + r.budget, 0)
    const sumBMese = rows.reduce((s, r) => s + r.budgetMese, 0)
    const sumMov = rows.reduce((s, r) => s + r.movimentiAndamento, 0)
    const sumTel = rows.reduce((s, r) => s + r.telefonate, 0)
    const sumNuovi = rows.reduce((s, r) => s + r.clientiNuovi, 0)
    const sumRin = rows.reduce((s, r) => s + r.rinnovi, 0)
    const sumInv = rows.reduce((s, r) => s + r.invitoClienti, 0)
    const sumCross = rows.reduce((s, r) => s + r.crossAbbonamenti, 0)
    const sumCrossEuro = rows.reduce((s, r) => s + r.crossTotaleEuro, 0)
    const sumEuroNuovi = rows.reduce((s, r) => s + r.totaleEuroClientiNuovi, 0)
    const sumEuroRin = rows.reduce((s, r) => s + r.totaleEuroRinnovi, 0)
    const sumOre = rows.reduce((s, r) => s + r.oreLavorate, 0)
    const sumConvalidati = rows.reduce((s, r) => s + r.giorniConvalidati, 0)
    const scost = Math.round((sumV - sumB) * 100) / 100
    const pctB = sumB > 0 ? Math.round((sumV / sumB) * 1000) / 10 : 0
    const oreAtteseRiga = rows.length > 0 ? rows[0].oreAttese : 0
    const pctOre =
      rows.length > 0 && oreAtteseRiga > 0
        ? Math.round((sumOre / (oreAtteseRiga * rows.length)) * 1000) / 10
        : 0

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    res.setHeader("Pragma", "no-cache")
    const payload = {
      periodo,
      from: fromIso,
      to: toIso,
      computedAt: new Date().toISOString(),
      rows,
      totals: {
        movimentiAndamento: sumMov,
        vendite: Math.round(sumV * 100) / 100,
        budgetMese: Math.round(sumBMese * 100) / 100,
        budget: Math.round(sumB * 100) / 100,
        scostamento: scost,
        percentualeBudget: pctB,
        telefonate: sumTel,
        clientiNuovi: sumNuovi,
        rinnovi: sumRin,
        invitoClienti: sumInv,
        crossAbbonamenti: sumCross,
        crossTotaleEuro: Math.round(sumCrossEuro * 100) / 100,
        totaleEuroClientiNuovi: Math.round(sumEuroNuovi * 100) / 100,
        totaleEuroRinnovi: Math.round(sumEuroRin * 100) / 100,
        oreLavorate: Math.round(sumOre * 10) / 10,
        oreAttese: oreAtteseRiga,
        percentualeOre: pctOre,
        giorniConvalidati: sumConvalidati,
      },
    }

    await cacheSet({
      name: "data.report-consulenti",
      scope,
      params: cacheKeyParams,
      asOf: toIso,
      depSig,
      ttlMs: getCacheTtlMsForAsOf(toIso, 60_000),
      value: payload,
    })

    res.json(payload)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getCassaMovimentiUtenti(req: Request, res: Response) {
  try {
    const rawAsOf = String(req.query.asOf ?? "").trim()
    const asOfIso = rawAsOf && /^\d{4}-\d{2}-\d{2}$/.test(rawAsOf) ? rawAsOf : undefined
    const windowMinutes = parseIntParam(req.query.windowMinutes, 1, 24 * 60)
    const limit = parseIntParam(req.query.limit, 50, 2000) ?? undefined
    const out = await gestionaleSql.queryCassaMovimentiUtenti({
      asOfIso,
      windowMinutes: windowMinutes ?? undefined,
      limit,
    })
    res.json(out)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
