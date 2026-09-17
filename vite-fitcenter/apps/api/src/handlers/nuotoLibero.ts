import type { Request, Response } from "express"
import type { User } from "../store/auth.js"
import { readNuotoLiberoDb, writeNuotoLiberoDb } from "../store/nuoto-libero-db.js"

function canNuotoLibero(u: User): boolean {
  return u.role === "admin" || u.role === "corsi" || u.role === "bagnini"
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isHour(s: string): boolean {
  return /^(0[8-9]|1\d|2[0-2]):00$/.test(s)
}

export function getNuotoLibero(req: Request, res: Response) {
  const u = req.user!
  if (!canNuotoLibero(u)) return res.status(403).json({ message: "Permessi insufficienti" })
  const giorno = String(req.query.giorno ?? "").trim()
  const from = String(req.query.from ?? "").trim()
  const to = String(req.query.to ?? "").trim()
  const db = readNuotoLiberoDb()

  const slice = (a: string, b: string) => {
    const cells: Record<string, Record<string, number>> = {}
    for (const [day, hours] of Object.entries(db.byDay)) {
      if (day < a || day > b) continue
      const row: Record<string, number> = {}
      for (const [ora, cell] of Object.entries(hours)) row[ora] = cell.n
      cells[day] = row
    }
    return cells
  }

  if (from && to) {
    if (!isYmd(from) || !isYmd(to)) return res.status(400).json({ message: "from e to devono essere YYYY-MM-DD" })
    if (from > to) return res.status(400).json({ message: "from deve essere <= to" })
    const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
    if (days > 62) return res.status(400).json({ message: "Intervallo massimo 62 giorni" })
    return res.json({ cells: slice(from, to) })
  }
  if (giorno) {
    if (!isYmd(giorno)) return res.status(400).json({ message: "giorno deve essere YYYY-MM-DD" })
    return res.json({ cells: slice(giorno, giorno) })
  }
  return res.status(400).json({ message: "Specificare giorno oppure from e to" })
}

export function patchNuotoLibero(req: Request, res: Response) {
  const u = req.user!
  if (!canNuotoLibero(u)) return res.status(403).json({ message: "Permessi insufficienti" })
  const giorno = String((req.body as { giorno?: string })?.giorno ?? "").trim()
  const ora = String((req.body as { ora?: string })?.ora ?? "").trim()
  if (!isYmd(giorno)) return res.status(400).json({ message: "giorno deve essere YYYY-MM-DD" })
  if (!isHour(ora)) return res.status(400).json({ message: "ora deve essere HH:00 tra 08:00 e 22:00" })

  const rawN = (req.body as { presenze?: unknown })?.presenze
  const db = readNuotoLiberoDb()
  const day = { ...(db.byDay[giorno] ?? {}) }

  if (rawN == null || rawN === "") {
    delete day[ora]
  } else {
    const n = Number(rawN)
    if (!Number.isFinite(n) || n < 0 || n > 500) {
      return res.status(400).json({ message: "presenze deve essere un numero tra 0 e 500" })
    }
    day[ora] = { n: Math.round(n), at: new Date().toISOString(), by: u.nome || u.username }
  }

  const byDay = { ...db.byDay }
  if (Object.keys(day).length) byDay[giorno] = day
  else delete byDay[giorno]
  writeNuotoLiberoDb({ byDay })
  res.json({ ok: true })
}
