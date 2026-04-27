import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getScopedUser } from "../middleware/auth.js"

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function segFromRaw(s: string): "all" | "adulti" | "bambini" | "danza" {
  const t = s.trim().toLowerCase()
  if (t === "adulti") return "adulti"
  if (t === "bambini") return "bambini"
  if (t === "danza") return "danza"
  return "all"
}

export async function getIncassi(req: Request, res: Response) {
  const u = getScopedUser(req)
  if (u.role !== "admin") return res.status(403).json({ message: "Permessi insufficienti" })

  const from = String(req.query.from ?? "").trim()
  const to = String(req.query.to ?? "").trim()
  if (!isIsoDate(from) || !isIsoDate(to)) return res.status(400).json({ message: "from/to obbligatori (YYYY-MM-DD)" })
  if (from > to) return res.status(400).json({ message: "Intervallo non valido (from > to)" })

  const seg = segFromRaw(String(req.query.segment ?? "all"))
  try {
    const allRows = await gestionaleSql.queryIncassiRange({ from, to, segment: seg })

    const amountOf = (r: any): number => {
      const x = r?.CassaMovimentiImporto ?? r?.Importo ?? r?.Totale ?? r?.importo ?? r?.totale ?? 0
      const n = Number(x)
      return Number.isFinite(n) ? n : 0
    }

    const rowId = (r: any): string | null => {
      const candidates = [
        "CassaMovimentiID",
        "CassaMovimentiId",
        "IDCassaMovimenti",
        "IdCassaMovimenti",
        "IDMovimento",
        "IdMovimento",
        "MovimentoID",
        "MovimentoId",
        "ID",
        "Id",
      ]
      for (const k of candidates) {
        const v = r?.[k]
        const s = String(v ?? "").trim()
        if (s && s !== "0" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") return `${k}:${s}`
      }
      return null
    }

    const rowKeyFallback = (r: any): string => {
      const dt = String(r?.CassaMovimentiDataOperazione ?? r?.CassaMovimentiData ?? r?.DataOperazione ?? r?.Data ?? "").trim()
      const dtSec = dt ? dt.replace(/\.\d+Z?$/i, "Z").replace(/\.\d+$/i, "") : ""
      const imp = amountOf(r).toFixed(2)
      const cognome = String(r?.Cognome ?? r?.cognome ?? "").trim().toLowerCase()
      const nome = String(r?.Nome ?? r?.nome ?? "").trim().toLowerCase()
      const vend = String(r?.NomeVenditore ?? r?.VenditoreNome ?? r?.Venditore ?? r?.Operatore ?? "").trim().toLowerCase()
      const caus = String(r?.CassaMovimentiCausale ?? r?.Causale ?? "").trim().toLowerCase()
      return [dtSec, imp, cognome, nome, vend, caus].join("|")
    }

    // Richiesta: nascondi importi a zero (spesso sono righe tecniche / doppioni).
    const nonZero = allRows.filter((r) => amountOf(r) !== 0)

    const hasCategoria = (r: any): boolean => {
      const s = String(r?.CategoriaDescrizione ?? "").trim()
      return Boolean(s) && s !== "—"
    }

    // Deduplica: se la view produce righe doppie, scegli la riga "migliore".
    // Regola richiesta: preferisci quella con CategoriaDescrizione valorizzata.
    const bestByKey = new Map<string, any>()
    for (const r of nonZero) {
      const k = rowId(r) ?? rowKeyFallback(r)
      const prev = bestByKey.get(k)
      if (!prev) {
        bestByKey.set(k, r)
        continue
      }
      const prevHas = hasCategoria(prev)
      const curHas = hasCategoria(r)
      if (!prevHas && curHas) {
        bestByKey.set(k, r)
        continue
      }
      if (prevHas === curHas) {
        // tie-breaker: preferisci riga con venditore/cognome/nome/causale valorizzati (più informativa)
        const score = (x: any) => {
          const fields = [
            x?.NomeVenditore,
            x?.VenditoreNome,
            x?.Venditore,
            x?.Operatore,
            x?.Cognome,
            x?.Nome,
            x?.CassaMovimentiCausale,
          ]
          return fields.reduce((s: number, v: any) => s + (String(v ?? "").trim() ? 1 : 0), 0)
        }
        if (score(r) > score(prev)) bestByKey.set(k, r)
      }
    }
    const rows = Array.from(bestByKey.values())
    const total = rows.reduce((s, r) => s + amountOf(r as any), 0)
    res.json({ from, to, segment: seg, count: rows.length, total, rows })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

