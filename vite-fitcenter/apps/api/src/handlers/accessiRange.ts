import { Request, Response } from "express"
import * as gestionaleSql from "../services/gestionale-sql.js"
import { getScopedUser } from "../middleware/auth.js"

function parseIsoDate(s: string): Date | null {
  const t = String(s ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getAccessiUtentiRange(req: Request, res: Response) {
  try {
    if (!gestionaleSql.isGestionaleConfigured()) {
      return res.json({ rows: [], meta: { fromSql: false } })
    }
    const pool = await gestionaleSql.getPool()
    if (!pool) {
      return res.status(503).json({ message: "Database non connesso" })
    }

    const fromRaw = String(req.query.from ?? "").trim()
    const toRaw = String(req.query.to ?? "").trim()
    const from = parseIsoDate(fromRaw)
    const to = parseIsoDate(toRaw)
    if (!from || !to) return res.status(400).json({ message: "from/to obbligatori (YYYY-MM-DD)" })
    if (from > to) return res.status(400).json({ message: "Intervallo non valido (from > to)" })

    const maxDays = 31
    const days = Math.floor((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000) + 1
    if (!Number.isFinite(days) || days <= 0) return res.status(400).json({ message: "Intervallo non valido" })
    if (days > maxDays) return res.status(400).json({ message: `Range troppo lungo (max ${maxDays} giorni)` })

    // Query unica: la vista accessi espone datetime → possiamo filtrare con BETWEEN senza ciclare giorno-per-giorno.
    let rows = await gestionaleSql.queryAccessiUtenti({ from: fromRaw, to: toRaw })

    // Scuola nuoto: mostra solo accessi piscina (i bambini non possono accedere alla palestra).
    const u = getScopedUser(req)
    if (u.role === "scuola_nuoto") {
      const isPiscina = (r: any): boolean => {
        const raw = (r?.raw ?? {}) as any
        const blob = [
          raw?.Concentratore,
          raw?.concentratore,
          raw?.Terminale,
          raw?.terminale,
          raw?.TerminaleDescrizione,
          raw?.TerminaleDesc,
          raw?.DescrizioneTerminale,
          raw?.Varco,
          raw?.VarcoDescrizione,
          raw?.Descrizione,
          raw?.Note,
          r?.dataEntrata,
          r?.dataUscita,
        ]
          .map((x) => String(x ?? ""))
          .join(" ")
          .toLowerCase()
        return blob.includes("piscina")
      }
      rows = rows.filter(isPiscina)
    }

    res.json({ rows, meta: { fromSql: true, from: fromRaw, to: toRaw, days, count: rows.length } })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

