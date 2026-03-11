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

export async function getDashboard(req: Request, res: Response) {
  try {
    const consulente = (req.query.consulente as string) || undefined
    const fromSql = gestionaleSql.isGestionaleConfigured()
    if (fromSql) {
      const [clientiRows, abbonamentiRows] = await Promise.all([
        gestionaleSql.queryClienti(),
        gestionaleSql.queryAbbonamenti(),
      ])
      let abbonamenti = abbonamentiRows.map((r) => rowToAbbonamento(r))
      if (consulente) abbonamenti = abbonamenti.filter((a) => a.consulenteNome === consulente)
      const clienti = clientiRows.map((r) => {
        const count = abbonamenti.filter((a) => String(a.clienteId) === String(r.Id ?? r.id)).length
        return rowToCliente(r, new Map([[String(r.Id ?? r.id), count]]))
      })
      const leads = leadsStore.list({})
      const leadTotali = leads.length
      const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
      const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
      const budgetList = mergeBudgetWithStore(getDefaultBudgetList(undefined))
      const leadRowsForFonte = leads.map((l) => ({ Fonte: l.fonte, fonte: l.fonte }))
      const stats = buildDashboardFromData(clienti, abbonamenti, budgetList, leadTotali, leadVinti, leadPersi, leadRowsForFonte)
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
  leadRows?: Record<string, unknown>[]
): DashboardStats {
  const now = new Date()
  const anno = now.getFullYear()
  const mese = now.getMonth() + 1
  const attivi = abbonamenti.filter((a) => a.stato === "attivo")
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const in60 = new Date()
  in60.setDate(in60.getDate() + 60)
  const inScadenza = attivi.filter((a) => new Date(a.dataFine) <= in30)
  const inScadenza60 = attivi.filter((a) => new Date(a.dataFine) <= in60)
  const budgetCorrente = budget.find((b) => b.anno === anno && b.mese === mese)
  const venditeMese = abbonamenti
    .filter((a) => {
      const inizio = new Date(a.dataInizio)
      return inizio.getFullYear() === anno && inizio.getMonth() + 1 === mese
    })
    .reduce((s, a) => s + a.prezzo, 0)
  const budgetVal = budgetCorrente?.budget ?? 6000
  const mesi = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]
  const venditePerMese = budget.slice(0, 12).map((b) => {
    const vendite =
      abbonamenti
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
    clientiAttivi: clienti.filter((c) => c.stato === "attivo").length,
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
    abbonamentiInScadenzaLista: inScadenza.map((a) => ({ clienteNome: a.clienteNome, piano: a.pianoNome.toLowerCase(), dataFine: a.dataFine })),
    abbonamentiInScadenza60Lista: inScadenza60.map((a) => ({ clienteNome: a.clienteNome, piano: a.pianoNome.toLowerCase(), dataFine: a.dataFine })),
  }
}

export async function getClienti(req: Request, res: Response) {
  try {
    if (gestionaleSql.isGestionaleConfigured()) {
      const [clientiRows, abbonamentiRows] = await Promise.all([
        gestionaleSql.queryClienti(),
        gestionaleSql.queryAbbonamenti(),
      ])
      const abbonamenti = abbonamentiRows.map((r) => rowToAbbonamento(r))
      const countByCliente = new Map<string, number>()
      abbonamenti.filter((a) => a.stato === "attivo").forEach((a) => {
        countByCliente.set(a.clienteId, (countByCliente.get(a.clienteId) ?? 0) + 1)
      })
      const clienti = clientiRows.map((r) => rowToCliente(r, countByCliente))
      return res.json(clienti)
    }
    const { mockClienti } = await import("../data/mock-gestionale.js")
    res.json(mockClienti)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getAbbonamenti(req: Request, res: Response) {
  try {
    const consulente = (req.query.consulente as string) || undefined
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryAbbonamenti()
      let list = rows.map((r) => rowToAbbonamento(r))
      if (consulente) list = list.filter((a) => a.consulenteNome === consulente)
      return res.json(list)
    }
    const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
    let list = mockAbbonamenti
    if (consulente) list = list.filter((a) => a.consulenteNome === consulente)
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

/** Storico vendite e budget per anno: 12 mesi (Gennaio–Dicembre) con nomi mese. */
export async function getVenditeStorico(req: Request, res: Response) {
  try {
    const anno = Number(req.query.anno)
    const consulente = (req.query.consulente as string) || undefined
    if (isNaN(anno) || anno < 2000 || anno > 2100) {
      return res.status(400).json({ message: "Parametro anno obbligatorio e valido (2000-2100)" })
    }
    const MESI_NOMI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
    let abbonamenti: Abbonamento[]
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryAbbonamenti()
      abbonamenti = rows.map((r) => rowToAbbonamento(r))
    } else {
      const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
      abbonamenti = mockAbbonamenti
    }
    if (consulente) abbonamenti = abbonamenti.filter((a) => a.consulenteNome === consulente)
    const budgetList = mergeBudgetWithStore(getDefaultBudgetList(anno))
    const venditePerMese = budgetList.map((b) => {
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
    res.json({ anno, venditePerMese })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Totale vendite e budget per anno (admin). Budget = merge store + default 12 mesi. */
export async function getTotaliAnni(req: Request, res: Response) {
  try {
    let abbonamenti: Abbonamento[]
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryAbbonamenti()
      abbonamenti = rows.map((r) => rowToAbbonamento(r))
    } else {
      const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
      abbonamenti = mockAbbonamenti
    }
    const anniFromVendite = new Set<number>()
    abbonamenti.forEach((a) => {
      anniFromVendite.add(new Date(a.dataInizio).getFullYear())
    })
    const budgetAll = budgetStore.getAll()
    const anniFromBudget = new Set(budgetAll.map((b) => b.anno))
    const anni = Array.from(new Set([...anniFromVendite, ...anniFromBudget])).sort((a, b) => a - b)
    const totali = anni.map((anno) => {
      const vendite = abbonamenti
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

const MESI_LABEL = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
const GIORNI_SETTIMANA = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"]

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
    if (giorno == null || isNaN(giorno)) giorno = Math.min(new Date().getDate(), giorniNelMese)
    giorno = Math.min(Math.max(1, giorno), giorniNelMese)

    let abbonamenti: Abbonamento[]
    let budgetMese: number
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryAbbonamenti()
      abbonamenti = rows.map((r) => rowToAbbonamento(r))
      const merged = mergeBudgetWithStore(getDefaultBudgetList())
      budgetMese = merged.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 6000
    } else {
      const { mockAbbonamenti, mockBudget } = await import("../data/mock-gestionale.js")
      abbonamenti = mockAbbonamenti
      budgetMese = mockBudget.find((b) => b.anno === anno && b.mese === mese)?.budget ?? 6000
    }
    if (consulente) abbonamenti = abbonamenti.filter((a) => a.consulenteNome === consulente)

    const fineGiorno = new Date(anno, mese - 1, giorno, 23, 59, 59)
    const abbonamentiMese = abbonamenti.filter((a) => {
      const d = new Date(a.dataInizio)
      return d.getFullYear() === anno && d.getMonth() + 1 === mese && d <= fineGiorno
    })
    const abbonamentiGiorno = abbonamentiMese.filter((a) => {
      const d = new Date(a.dataInizio)
      return d.getDate() === giorno
    })

    const budgetGiorno = budgetMese / giorniNelMese
    const budgetProgressivoMese = (budgetMese * giorno) / giorniNelMese

    const bloccoGiorno = buildDettaglioBlocco(abbonamentiGiorno, budgetGiorno, budgetGiorno)
    const bloccoMese = buildDettaglioBlocco(abbonamentiMese, budgetMese, budgetProgressivoMese)

    const dataOra = new Date(anno, mese - 1, giorno)
    const giornoLabel = `${GIORNI_SETTIMANA[dataOra.getDay()].toUpperCase()} ${giorno} ${MESI_LABEL[mese - 1].toUpperCase()} ${anno}`

    const result: DettaglioMeseResponse = {
      anno,
      mese,
      meseLabel: `${MESI_LABEL[mese - 1].toUpperCase()} ${anno}`,
      giorno,
      giornoLabel,
      giorniNelMese,
      dettaglioGiorno: bloccoGiorno,
      dettaglioMese: bloccoMese,
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
