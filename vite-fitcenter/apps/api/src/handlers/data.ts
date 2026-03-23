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
import { bumpMetaVersion, cacheGet, cacheSet, getBudgetDepSig } from "../services/persistent-cache.js"
import { rowToCliente, rowToAbbonamento } from "../data/map-sql-to-types.js"
import type {
  Cliente,
  Abbonamento,
  DashboardStats,
  DettaglioBlocco,
  DettaglioConsulente,
  DettaglioMeseResponse,
} from "../types/gestionale.js"

/** Budget: solo da admin (store). Default 12 mesi per l'anno indicato. */
function getDefaultBudgetList(anno?: number): { anno: number; mese: number; budget: number }[] {
  const y = anno ?? new Date().getFullYear()
  return Array.from({ length: 12 }, (_, i) => ({ anno: y, mese: i + 1, budget: 60000 }))
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
const EXCLUDE_CAT_DESC_VENDITE_LISTE = new Set(["ACQUATICITA", "CAMPUS SPORTIVI", "GESTANTI", "SCUOLA NUOTO"])

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
  const id = await gestionaleSql.getConsultantIdUtente(nome)
  if (id) return id
  const key = nome.toLowerCase()
  return CONSULENTE_NOME_TO_ID[key] ?? undefined
}

function cacheScope(req: Request): string {
  const u = getScopedUser(req)
  if (u.role === "admin") return "admin"
  const nome = u.consulenteNome ?? u.nome ?? u.username
  return `operatore:${nome}`
}

const HISTORICAL_TTL_MS = Number(process.env.HISTORICAL_TTL_MS ?? 10 * 365 * 24 * 60 * 60 * 1000) // ~10 anni

function getTodayKey(): string {
  const nowParts = toDateParts(new Date())
  return `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-${String(nowParts.day).padStart(2, "0")}`
}

function isAsOfToday(asOfKey: string): boolean {
  return asOfKey === getTodayKey()
}

function getCacheTtlMsForAsOf(asOfKey: string, fallbackMs: number): number {
  return isAsOfToday(asOfKey) ? fallbackMs : HISTORICAL_TTL_MS
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
    const depSig = await getBudgetDepSig()
    const cacheKeyParams = { consulente: consulente ?? null }
    const cached = await cacheGet<DashboardStats>({
      name: "data.dashboard",
      scope,
      params: cacheKeyParams,
      asOf: asOf.key,
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
              const [abbonamentiRows, ...venditeResults] = await Promise.all([
                gestionaleSql.queryAbbonamenti(undefined),
                ...labels.map(async (label) => {
                  const id = await resolveConsultantId(label)
                  const [prog, perMese] = await Promise.all([
                    gestionaleSql.getVenditeProgressivoMese(anno, mese, oggi.day, id),
                    gestionaleSql.getVenditePerMeseAnno(anno, id),
                  ])
                  return { prog, perMese }
                }),
              ])
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
              const abbonamenti = abbonamentiRows.map((r) => rowToAbbonamento(r))
              markRinnovato(abbonamenti)
              const leads = leadsStore.list({})
              const leadTotali = leads.length
              const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
              const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
              const budgetList = mergeBudgetWithStore(getDefaultBudgetList(undefined))
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
              gestionaleSql.queryAbbonamenti(idUtente),
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
            const budgetList = mergeBudgetWithStore(getDefaultBudgetList(undefined))
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
          asOf: asOf.key,
          depSig,
          ttlMs: getCacheTtlMsForAsOf(asOf.key, 60_000),
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
            asOf: asOf.key,
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
      asOf: asOf.key,
      depSig,
      ttlMs: getCacheTtlMsForAsOf(asOf.key, 60_000),
      value: stats,
    })
    res.json(stats)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

function mergeBudgetWithStore(budget: { anno: number; mese: number; budget: number; vendite?: number }[]) {
  const overrides = budgetStore.getAll()
  const map = new Map<string, typeof budget[0]>()
  budget.forEach((b) => map.set(`${b.anno}-${b.mese}`, { ...b }))
  overrides.forEach((o) => {
    const existing = map.get(`${o.anno}-${o.mese}`)
    map.set(`${o.anno}-${o.mese}`, { anno: o.anno, mese: o.mese, budget: o.budget, vendite: existing?.vendite })
  })
  const result = Array.from(map.values()).sort((a, b) => a.anno - b.anno || a.mese - b.mese)
  result.forEach((r) => {
    const totalePerConsulente = budgetPerConsulente.getTotaleMese(r.anno, r.mese)
    r.budget = Math.round(totalePerConsulente)
  })
  return result
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
  const budgetVal = budgetCorrente?.budget ?? 60000
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
      adulti: { totale: adulti.length, totaleDurataMesi: adultiTotDurataMesi, byDurata: byDurata(adulti), byCategoria: byCategoria(adulti) },
      bambini: { totale: bambini.length, totaleDurataMesi: bambiniTotDurataMesi, byDurata: byDurata(bambini), byCategoria: byCategoria(bambini) },
      notaClassificazione,
    })
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
    const defaultList = getDefaultBudgetList(anno)
    const budget = mergeBudgetWithStore(defaultList)
    const perConsulente = budgetPerConsulente.getAll(anno)
    res.json({ list: budget, perConsulente, consulenti: budgetPerConsulente.getConsulentiLabels() })
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
      await bumpMetaVersion("budget")
      return res.json({ anno, mese, consulenteLabel, budget })
    }
    if (typeof budget !== "number") return res.status(400).json({ message: "budget obbligatorio" })
    budgetPerConsulente.getConsulentiLabels().forEach((label) => {
      budgetPerConsulente.set(anno, mese, label, Math.round(budget / 3))
    })
    await bumpMetaVersion("budget")
    res.json({ anno, mese, budget })
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
    const budgetList = mergeBudgetWithStore(getDefaultBudgetList(anno))
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

    const idUtente = await resolveConsultantId(consulente)
    const { rows, totalCount } = await gestionaleSql.getVenditeMovimentiCategoriaDurata(from, to, idUtente ?? undefined)

    res.json({ from, to, totalCount, rows })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
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
      const budgetList = mergeBudgetWithStore(getDefaultBudgetList(anno))
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

/** Lead: da sito, campagne FB e Google (store locale). Non si importano dal gestionale. Per consulente bambini (Irene) filtra solo categoria bambini. */
export async function getLeadsFromGestionale(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    const filters: { categoria?: "bambini" } = {}
    if (u?.leadFilter === "bambini") filters.categoria = "bambini"
    res.json(leadsStore.list(filters))
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
    const updated = leadsStore.update(id, { consulenteNome })
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
  const trend = budgetProgressivo > 0 ? Math.round((consuntivo / budgetProgressivo) * 10000) / 100 : 0
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
    const tr = progressivoPerConsulente > 0 ? Math.round((cons / progressivoPerConsulente) * 10000) / 100 : 0
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
  const trend = budgetProgressivo > 0 ? Math.round((consuntivo / budgetProgressivo) * 10000) / 100 : 0
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
  const trend = budgetProgressivo > 0 ? Math.round((consuntivo / budgetProgressivo) * 10000) / 100 : 0
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
    budgetProgressivo > 0 ? Math.round((consuntivo / budgetProgressivo) * 10000) / 100 : 0
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
      const tr = progressivoPerConsulente > 0 ? Math.round((cons / progressivoPerConsulente) * 10000) / 100 : 0
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
    const depSig = await getBudgetDepSig()
    const cacheKeyParams = { anno, mese, giorno, consulente: consulente ?? null }
    const cached = await cacheGet<DettaglioMeseResponse>({
      name: "data.dettaglio-mese",
      scope,
      params: cacheKeyParams,
      asOf: asOf.key,
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
      const merged = mergeBudgetWithStore(getDefaultBudgetList(anno))
      budgetMese = consulente
        ? budgetPerConsulente.get(anno, mese, consulente)
        : (merged.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 60000)
      if (!useMovimenti) {
        try {
          const rows = await withDettaglioSqlTimeout(gestionaleSql.queryAbbonamenti(idUtente))
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
                const budgetCons = budgetPerConsulente.get(anno, mese, label)
                const budgetGiornoCons = budgetCons / giorniNelMese
                const budgetProgressivoMeseCons = (budgetCons * giorno) / giorniNelMese
                const [venditeGiorno, venditeMese] = await Promise.all([
                  gestionaleSql.getVenditeTotaleGiorno(anno, mese, giorno, id),
                  gestionaleSql.getVenditeTotaleMese(anno, mese, giorno, id),
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
              gestionaleSql.getVenditeTotaleMese(anno, mese, giorno, idUtente),
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
      params: cacheKeyParams,
      asOf: asOf.key,
      depSig,
      ttlMs: dettaglioMeseWarning ? 10_000 : getCacheTtlMsForAsOf(asOf.key, 60_000),
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
    const depSig = await getBudgetDepSig()
    const cacheKeyParams = { anno }
    const cached = await cacheGet<{ anno: number; annoLabel: string; dettaglio: DettaglioBlocco }>({
      name: "data.dettaglio-anno",
      scope,
      params: cacheKeyParams,
      asOf: asOf.key,
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
        const b = budgetPerConsulente.get(anno, m, label)
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
      asOf: asOf.key,
      depSig,
      ttlMs: getCacheTtlMsForAsOf(asOf.key, 10 * 60_000),
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

/** Convalida giorno lavorativo (consulente). */
export async function getConvalidazioni(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    const mese = Number(req.query.mese)
    const operatoreNome = getOperatoreConsulenteNome(req)
    const consulenteNome = (operatoreNome ?? (req.query.consulente as string))?.trim()
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
type ReportRow = {
  consulenteNome: string
  vendite: number
  budget: number
  percentualeBudget: number
  telefonate: number
  oreLavorate: number
  oreAttese: number
  percentualeOre: number
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

function clampRangeToMonth(from: Date, to: Date): { from: Date; to: Date } {
  const a = new Date(from)
  a.setUTCHours(0, 0, 0, 0)
  const b = new Date(to)
  b.setUTCHours(0, 0, 0, 0)
  const monthStart = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0))
  const outFrom = a < monthStart ? monthStart : a
  const outTo = b > monthEnd ? monthEnd : b
  return { from: outFrom, to: outTo }
}

function oreDiff(oraInizio: string, oraFine: string): number {
  const [h1, m1] = oraInizio.split(":").map((x) => Number(x))
  const [h2, m2] = oraFine.split(":").map((x) => Number(x))
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return 0
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1)
  return Math.max(0, mins / 60)
}

/** Report per consulenti: vendite + telefonate + ore lavorate con % ore (ore/attese) su settimana/mese/anno. */
export async function getReportConsulenti(req: Request, res: Response) {
  try {
    const periodo = String(req.query.periodo ?? "week") as ReportPeriodo
    const asOfRaw = String(req.query.asOf ?? "")
    const asOf = asOfRaw && /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? new Date(`${asOfRaw}T12:00:00Z`) : new Date()

    const labels = budgetPerConsulente.getConsulentiLabels()

    let from: Date
    let to: Date
    if (periodo === "year") {
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
      to = new Date(from); to.setDate(to.getDate() + 6)
    }

    const fromIso = toISODate(from)
    const toIso = toISODate(to)
    const oreAttese = countWeekdaysMonFri(from, to) * 8

    const rows: ReportRow[] = []
    let cachedMockAbbonamenti: Abbonamento[] | null = null
    const mockVenditePerConsulente = (consulenteNome: string, from: Date, to: Date) => {
      // Lazily import is done once below; this function only filters and sums.
      if (!cachedMockAbbonamenti) return 0
      return cachedMockAbbonamenti
        .filter((a) => (a.consulenteNome ?? "") === consulenteNome)
        .filter((a) => !a.isTesseramento)
        .filter((a) => !isEsclusoVenditeListe(a))
        .filter((a) => {
          const di = new Date(a.dataInizio)
          di.setUTCHours(0, 0, 0, 0)
          return di >= from && di <= to
        })
        .reduce((s, a) => s + (a.prezzo ?? 0), 0)
    }

    const ensureMockLoaded = async () => {
      if (cachedMockAbbonamenti) return cachedMockAbbonamenti
      const mod = await import("../data/mock-gestionale.js")
      cachedMockAbbonamenti = mod.mockAbbonamenti
      return cachedMockAbbonamenti
    }

    for (const consulenteNome of labels) {
      let idUtente: string | undefined
      try {
        idUtente = await withReportConsulentiSqlTimeout(resolveConsultantId(consulenteNome))
      } catch (e) {
        if ((e as Error).message !== "__FITCENTER_REPORT_CONSULENTI_SQL_TIMEOUT__") throw e
        idUtente = undefined
      }
      let vendite = 0

      // Budget periodo per consulente
      let budget = 0
      if (periodo === "year") {
        const y = asOf.getUTCFullYear()
        for (let m = 1; m <= 12; m++) budget += budgetPerConsulente.get(y, m, consulenteNome)
      } else if (periodo === "month") {
        budget = budgetPerConsulente.get(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, consulenteNome)
      } else {
        // Settimana: proporzionale al budget mensile in base ai giorni lavorativi del mese coperti dalla settimana.
        const y = from.getUTCFullYear()
        const m = from.getUTCMonth() + 1
        const budgetMese = budgetPerConsulente.get(y, m, consulenteNome)
        const monthStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
        const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
        const giorniLavorativiMese = countWeekdaysMonFri(monthStart, monthEnd)
        const clipped = clampRangeToMonth(from, to)
        const giorniLavorativiSettimanaNelMese = countWeekdaysMonFri(clipped.from, clipped.to)
        budget = giorniLavorativiMese > 0
          ? (budgetMese / giorniLavorativiMese) * giorniLavorativiSettimanaNelMese
          : 0
      }

      if (gestionaleSql.isGestionaleConfigured() && idUtente) {
        try {
          const abbonRows = await withReportConsulentiSqlTimeout(gestionaleSql.queryAbbonamenti(idUtente))
          const abbonamenti = abbonRows
            .map((r) => rowToAbbonamento(r))
            .filter((a) => !a.isTesseramento)
            .filter((a) => !isEsclusoVenditeListe(a))
            .filter((a) => {
              const di = new Date(a.dataInizio)
              di.setUTCHours(0, 0, 0, 0)
              return di >= from && di <= to
            })
          vendite = abbonamenti.reduce((s, a) => s + (a.prezzo ?? 0), 0)
        } catch (e) {
          if ((e as Error).message !== "__FITCENTER_REPORT_CONSULENTI_SQL_TIMEOUT__") throw e
          await ensureMockLoaded()
          vendite = mockVenditePerConsulente(consulenteNome, from, to)
        }
      } else {
        await ensureMockLoaded()
        vendite = mockVenditePerConsulente(consulenteNome, from, to)
      }

      // Telefonate: persistite localmente.
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
      const percentualeBudget = budget > 0 ? Math.round((vendite / budget) * 1000) / 10 : 0

      rows.push({
        consulenteNome,
        vendite: Math.round(vendite * 100) / 100,
        budget: Math.round(budget * 100) / 100,
        percentualeBudget,
        telefonate,
        oreLavorate: Math.round(oreLavorate * 10) / 10,
        oreAttese,
        percentualeOre,
      })
    }

    rows.sort((a, b) => b.vendite - a.vendite)
    res.json({ periodo, from: fromIso, to: toIso, rows })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
