import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getMockDashboardStats } from "../data/mock-gestionale.js"
import { store as leadsStore } from "../store/leads.js"
import { budgetStore } from "../store/budget.js"
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
  return Array.from({ length: 12 }, (_, i) => ({ anno: y, mese: i + 1, budget: 6000 }))
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
  for (const a of list) {
    const dataFineA = parseDateToTime(a.dataFine ?? "")
    if (!dataFineA) continue
    const clienteA = String(a.clienteId ?? "").trim()
    if (!clienteA) continue
    const hasRinnovo = list.some(
      (b) =>
        b.id !== a.id &&
        String(b.clienteId ?? "").trim() === clienteA &&
        parseDateToTime(b.dataInizio ?? "") > dataFineA
    )
    a.rinnovato = hasRinnovo
  }
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

export async function getDashboard(req: Request, res: Response) {
  try {
    const consulente = (req.query.consulente as string) || undefined
    const fromSql = gestionaleSql.isGestionaleConfigured()
    if (fromSql) {
      const idUtente = await resolveConsultantId(consulente)
      const now = new Date()
      const oggi = toDateParts(now)
      const anno = oggi.year
      const mese = oggi.month
      const [abbonamentiRows, venditeMeseSql, venditePerMeseSql] = await Promise.all([
        gestionaleSql.queryAbbonamenti(idUtente),
        gestionaleSql.getVenditeTotaleMese(anno, mese, oggi.day, idUtente),
        gestionaleSql.getVenditePerMeseAnno(anno, idUtente),
      ])
      const abbonamenti = abbonamentiRows.map((r) => rowToAbbonamento(r))
      const leads = leadsStore.list({})
      const leadTotali = leads.length
      const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
      const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
      const budgetList = mergeBudgetWithStore(getDefaultBudgetList(undefined))
      const leadRowsForFonte = leads.map((l) => ({ Fonte: l.fonte, fonte: l.fonte }))
      const stats = buildDashboardFromData(
        [],
        abbonamenti,
        budgetList,
        leadTotali,
        leadVinti,
        leadPersi,
        leadRowsForFonte,
        undefined,
        venditeMeseSql,
        venditePerMeseSql
      )
      return res.json(stats)
    }
    const leads = leadsStore.list({})
    const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
    const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
    const stats = getMockDashboardStats(leads.length, leadVinti, leadPersi, consulente)
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
  return Array.from(map.values()).sort((a, b) => a.anno - b.anno || a.mese - b.mese)
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
  venditePerMeseSql?: { mese: number; totale: number }[]
): DashboardStats {
  const now = new Date()
  const oggi = toDateParts(now)
  const anno = oggi.year
  const mese = oggi.month
  const attivi = abbonamenti.filter((a) => a.stato === "attivo")
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const in60 = new Date()
  in60.setDate(in60.getDate() + 60)
  const inScadenza = attivi.filter((a) => new Date(a.dataFine) <= in30)
  const inScadenza60 = attivi.filter((a) => new Date(a.dataFine) <= in60)
  const budgetCorrente = budget.find((b) => b.anno === anno && b.mese === mese)
  const budgetVal = budgetCorrente?.budget ?? 6000
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

export async function getClienti(req: Request, res: Response) {
  try {
    res.json([])
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getAbbonamenti(req: Request, res: Response) {
  try {
    const consulente = (req.query.consulente as string) || undefined
    if (gestionaleSql.isGestionaleConfigured()) {
      const idVenditore = await resolveConsultantId(consulente)
      if (consulente && !idVenditore) {
        return res.json([])
      }
      // Una sola query: se c'è consulente solo la sua lista (evita query "tutti" che può bloccare o essere lenta)
      const rows = idVenditore
        ? await gestionaleSql.queryAbbonamenti(idVenditore)
        : await gestionaleSql.queryAbbonamenti(undefined)
      const list = rows.map((r) => rowToAbbonamento(r))
      markRinnovato(list)
      return res.json(list)
    }
    const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
    let list = [...mockAbbonamenti]
    if (consulente) list = list.filter((a) => a.consulenteNome === consulente)
    markRinnovato(list)
    res.json(list)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Budget: assegnato ogni mese dall'admin (store). Non si importa dal gestionale. */
export async function getBudget(req: Request, res: Response) {
  try {
    const defaultList = gestionaleSql.isGestionaleConfigured()
      ? getDefaultBudgetList()
      : (await import("../data/mock-gestionale.js")).mockBudget
    const budget = mergeBudgetWithStore(defaultList)
    res.json(budget)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function setBudget(req: Request, res: Response) {
  try {
    const { anno, mese, budget } = req.body as { anno: number; mese: number; budget: number }
    if (anno == null || mese == null || budget == null) {
      return res.status(400).json({ message: "anno, mese e budget sono obbligatori" })
    }
    budgetStore.set(anno, mese, budget)
    res.json({ anno, mese, budget })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Storico vendite e budget per anno: 12 mesi. Totali calcolati in SQL (stesso risultato delle query). */
export async function getVenditeStorico(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    const consulente = (req.query.consulente as string) || undefined
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

/** Totale vendite e budget per anno (admin). Vendite da MovimentiVenduto se disponibile. */
export async function getTotaliAnni(req: Request, res: Response) {
  try {
    const fromSql = gestionaleSql.isGestionaleConfigured()
    const movimenti = fromSql ? await gestionaleSql.queryMovimentiVenduto() : []
    const useMovimenti = movimenti.length > 0
    let abbonamenti: Abbonamento[] = []
    if (fromSql && !useMovimenti) {
      const rows = await gestionaleSql.queryAbbonamenti()
      abbonamenti = rows.map((r) => rowToAbbonamento(r))
    } else if (!fromSql) {
      const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
      abbonamenti = mockAbbonamenti
    }
    const anniFromVendite = new Set<number>()
    if (useMovimenti) {
      (movimenti as Record<string, unknown>[]).forEach((r) => {
        const d = movimentoDate(r)
        if (d) anniFromVendite.add(toDateParts(d).year)
      })
    } else {
      abbonamenti.forEach((a) => anniFromVendite.add(new Date(a.dataInizio).getFullYear()))
    }
    const budgetAll = budgetStore.getAll()
    const anniFromBudget = new Set(budgetAll.map((b) => b.anno))
    const anni = Array.from(new Set([...anniFromVendite, ...anniFromBudget])).sort((a, b) => a - b)
    const totali = anni.map((anno) => {
      const vendite = useMovimenti
        ? (movimenti as Record<string, unknown>[])
            .filter((r) => {
              const d = movimentoDate(r)
              return d && movimentoCountAsSale(r) && toDateParts(d).year === anno
            })
            .reduce((s, r) => s + movimentoAmount(r), 0)
        : abbonamenti
            .filter((a) => new Date(a.dataInizio).getFullYear() === anno)
            .reduce((s, a) => s + a.prezzo, 0)
      const budgetList = mergeBudgetWithStore(getDefaultBudgetList(anno))
      const budget = budgetList.reduce((s, b) => s + b.budget, 0)
      const percentuale = budget ? Math.round((vendite / budget) * 1000) / 10 : 0
      return { anno, vendite, budget, percentuale }
    })
    res.json({ totali })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Lead: da sito, campagne FB e Google (store locale). Non si importano dal gestionale. */
export async function getLeadsFromGestionale(req: Request, res: Response) {
  try {
    res.json(leadsStore.list({}))
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
      consulente: "—",
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
        consulente: "—",
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
      consulente: "—",
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

export async function getDettaglioMese(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    const mese = Number(req.query.mese)
    let giorno = req.query.giorno != null ? Number(req.query.giorno) : null
    if (isNaN(anno) || isNaN(mese) || mese < 1 || mese > 12) {
      return res.status(400).json({ message: "anno e mese obbligatori e validi" })
    }
    const consulente = (req.query.consulente as string) || undefined
    const giorniNelMese = new Date(anno, mese, 0).getDate()
    if (giorno == null || isNaN(giorno)) {
      const oggi = toDateParts(new Date())
      giorno = oggi.year === anno && oggi.month === mese
        ? Math.min(oggi.day, giorniNelMese)
        : giorniNelMese
    }
    giorno = Math.min(Math.max(1, giorno), giorniNelMese)

    let abbonamenti: Abbonamento[] = []
    let budgetMese: number
    const fromSql = gestionaleSql.isGestionaleConfigured()
    const idUtente = await resolveConsultantId(consulente)
    const movimenti = fromSql ? [] : ((await gestionaleSql.queryMovimentiVenduto(idUtente)) as Record<string, unknown>[])
    const useMovimenti = movimenti.length > 0

    if (fromSql) {
      const merged = mergeBudgetWithStore(getDefaultBudgetList())
      budgetMese = merged.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 6000
      if (!useMovimenti) {
        const rows = await gestionaleSql.queryAbbonamenti(idUtente)
        abbonamenti = rows.map((r) => rowToAbbonamento(r))
      }
    } else {
      const { mockAbbonamenti, mockBudget } = await import("../data/mock-gestionale.js")
      abbonamenti = mockAbbonamenti
      budgetMese = mockBudget.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 6000
      if (consulente) abbonamenti = abbonamenti.filter((a) => a.consulenteNome === consulente)
    }

    const budgetGiorno = budgetMese / giorniNelMese
    const budgetProgressivoMese = (budgetMese * giorno) / giorniNelMese

    let bloccoGiorno: DettaglioBlocco
    let bloccoMese: DettaglioBlocco
    if (fromSql) {
      const [totaleGiornoSql, totaleMeseSql] = await Promise.all([
        gestionaleSql.getVenditeTotaleGiorno(anno, mese, giorno, idUtente),
        gestionaleSql.getVenditeTotaleMese(anno, mese, giorno, idUtente),
      ])
      bloccoGiorno = buildDettaglioBloccoFromTotale(totaleGiornoSql, budgetGiorno, budgetGiorno)
      bloccoMese = buildDettaglioBloccoFromTotale(totaleMeseSql, budgetMese, budgetProgressivoMese)
    } else if (useMovimenti) {
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
    } else {
      const fineGiorno = new Date(anno, mese - 1, giorno, 23, 59, 59)
      const abbonamentiMese = abbonamenti.filter((a) => {
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

    const result: DettaglioMeseResponse & { _debug?: { consulente: string | undefined; idUtente: string | undefined } } = {
      anno,
      mese,
      meseLabel: `${MESI_LABEL[mese - 1].toUpperCase()} ${anno}`,
      giorno,
      giornoLabel,
      giorniNelMese,
      dettaglioGiorno: bloccoGiorno,
      dettaglioMese: bloccoMese,
      _debug: { consulente, idUtente: idUtente ?? undefined },
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
