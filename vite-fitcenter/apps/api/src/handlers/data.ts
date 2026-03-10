import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getMockDashboardStats } from "../data/mock-gestionale.js"
import { store as leadsStore } from "../store/leads.js"
import { rowToCliente, rowToAbbonamento, rowToBudget } from "../data/map-sql-to-types.js"
import { rowToLead } from "../data/map-sql-to-lead.js"
import type { Cliente, Abbonamento, DashboardStats } from "../types/gestionale.js"

export async function getDashboard(req: Request, res: Response) {
  try {
    const fromSql = gestionaleSql.isGestionaleConfigured()
    if (fromSql) {
      const [clientiRows, abbonamentiRows, budgetRows, leadRows] = await Promise.all([
        gestionaleSql.queryClienti(),
        gestionaleSql.queryAbbonamenti(),
        gestionaleSql.queryBudget(),
        gestionaleSql.queryLead(),
      ])
      const abbonamenti = abbonamentiRows.map((r) => rowToAbbonamento(r))
      const clienti = clientiRows.map((r) => {
        const count = abbonamenti.filter((a) => String(a.clienteId) === String(r.Id ?? r.id)).length
        return rowToCliente(r, new Map([[String(r.Id ?? r.id), count]]))
      })
      const leadTotali = leadRows.length
      const leadVinti = leadRows.filter((r: Record<string, unknown>) => String(r.Stato ?? r.stato).toLowerCase().includes("vinto") || String(r.Stato ?? r.stato).toLowerCase().includes("convertito")).length
      const leadPersi = leadRows.filter((r: Record<string, unknown>) => String(r.Stato ?? r.stato).toLowerCase().includes("perso")).length
      const stats = buildDashboardFromData(clienti, abbonamenti, budgetRows.map(rowToBudget), leadTotali, leadVinti, leadPersi, leadRows)
      return res.json(stats)
    }
    const leads = leadsStore.list({})
    const leadVinti = leads.filter((l) => l.stato === "chiuso_vinto").length
    const leadPersi = leads.filter((l) => l.stato === "chiuso_perso").length
    const stats = getMockDashboardStats(leads.length, leadVinti, leadPersi)
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
  leadRows?: Record<string, unknown>[]
): DashboardStats {
  const now = new Date()
  const anno = now.getFullYear()
  const mese = now.getMonth() + 1
  const attivi = abbonamenti.filter((a) => a.stato === "attivo")
  const inScadenza = attivi.filter((a) => {
    const fine = new Date(a.dataFine)
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    return fine <= in30
  })
  const budgetCorrente = budget.find((b) => b.anno === anno && b.mese === mese)
  const venditeMese = abbonamenti
    .filter((a) => {
      const inizio = new Date(a.dataInizio)
      return inizio.getFullYear() === anno && inizio.getMonth() + 1 === mese
    })
    .reduce((s, a) => s + a.prezzo, 0)
  const budgetVal = budgetCorrente?.budget ?? 6000
  const mesi = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]
  const venditePerMese = budget.slice(0, 6).map((b) => ({
    mese: mesi[b.mese - 1],
    vendite: b.vendite ?? 0,
    budget: b.budget,
  }))
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
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryAbbonamenti()
      const list = rows.map((r) => rowToAbbonamento(r))
      return res.json(list)
    }
    const { mockAbbonamenti } = await import("../data/mock-gestionale.js")
    res.json(mockAbbonamenti)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getBudget(req: Request, res: Response) {
  try {
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryBudget()
      res.json(rows.map((r) => rowToBudget(r)))
      return
    }
    const { mockBudget } = await import("../data/mock-gestionale.js")
    res.json(mockBudget)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

/** Lead dal gestionale SQL; se non configurato il frontend usa GET /api/leads (store locale) */
export async function getLeadsFromGestionale(req: Request, res: Response) {
  try {
    if (gestionaleSql.isGestionaleConfigured()) {
      const rows = await gestionaleSql.queryLead()
      const leads = rows.map((r) => rowToLead(r))
      return res.json(leads)
    }
    res.json(leadsStore.list({}))
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
