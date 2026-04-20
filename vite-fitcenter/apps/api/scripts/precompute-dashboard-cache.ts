/**
 * Pre-popola la cache persistente (apps/api/data/app.sqlite) dei dati amministratore.
 *
 * Obiettivo: evitare che al primo login / primo F5 l'admin debba attendere calcoli SQL lenti.
 *
 * Eseguire dalla root monorepo:
 *   pnpm exec tsx apps/api/scripts/precompute-dashboard-cache.ts
 */
import { getDashboard, getDettaglioAnno, getDettaglioMese, getReportConsulenti } from "../src/handlers/data.js"
import { cacheGet, getBudgetDepSig } from "../src/services/persistent-cache.js"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

type AdminUser = { username: string; nome: string; role: "admin" }

const ADMIN: AdminUser = { username: "admin", nome: "Amministratore", role: "admin" }

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function toDateParts(d: Date) {
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  return {
    year: useLocal ? d.getFullYear() : d.getUTCFullYear(),
    month: (useLocal ? d.getMonth() : d.getUTCMonth()) + 1,
    day: useLocal ? d.getDate() : d.getUTCDate(),
  }
}

function ymdToAsOfKey(year: number, month: number, day: number) {
  // Replica la logica di parseAsOf() in handlers/data.ts:
  // dt viene creato in UTC a mezzogiorno, poi estraiamo day/month/year in base a GESTIONALE_DATE_LOCALE.
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const p = toDateParts(dt)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

function daysInMonth(year: number, month: number) {
  // month: 1..12 -> ultimo giorno del mese
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate()
}

function parseYearsArg(raw: string | undefined): number[] | null {
  const t = String(raw ?? "").trim()
  if (!t) return null
  const parts = t
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 2000 && n <= 2100)
  return parts.length ? Array.from(new Set(parts)).sort((a, b) => a - b) : null
}

function parseArgValue(key: string): string | null {
  const idx = process.argv.findIndex((a) => a === key)
  if (idx < 0) return null
  return process.argv[idx + 1] ?? null
}

function computeMonthRange(now: Date, yearsBack: number, yearsOverride: number[] | null) {
  if (yearsOverride && yearsOverride.length) {
    const startYear = yearsOverride[0]!
    const endYear = yearsOverride[yearsOverride.length - 1]!
    // Di default scaldiamo fino al mese precedente (dati "stabili").
    const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
    const yNow = useLocal ? now.getFullYear() : now.getUTCFullYear()
    const mNow = (useLocal ? now.getMonth() : now.getUTCMonth()) + 1
    const prevMonth = mNow - 1
    const prevYear = prevMonth >= 1 ? yNow : yNow - 1
    const prevMonthClamped = prevMonth >= 1 ? prevMonth : 12
    const endDay = daysInMonth(prevYear, prevMonthClamped)
    const end = { year: prevYear, month: prevMonthClamped, day: endDay }
    const start = { year: startYear, month: 1, day: 1 }
    // Se endYear è nel passato rispetto a prevYear, chiudiamo al 31/12 endYear.
    if (endYear < end.year) {
      return { start, end: { year: endYear, month: 12, day: 31 } }
    }
    return { start, end }
  }
  return monthRangeLastDay(now, yearsBack)
}

function monthRangeLastDay(now: Date, yearsBack: number) {
  const useLocal = process.env.GESTIONALE_DATE_LOCALE === "true"
  const y = useLocal ? now.getFullYear() : now.getUTCFullYear()
  const m = (useLocal ? now.getMonth() : now.getUTCMonth()) + 1 // 1..12

  // ultimo giorno del mese precedente (evita "today")
  const prevMonth = m - 1
  const prevYear = prevMonth >= 1 ? y : y - 1
  const prevMonthClamped = prevMonth >= 1 ? prevMonth : 12
  const endDay = daysInMonth(prevYear, prevMonthClamped)
  const end = { year: prevYear, month: prevMonthClamped, day: endDay }

  // start: stesso mese/della data "ora - yearsBack", poi prendiamo il 1° del mese (intervallo di mesi completo)
  const startBase = new Date(now)
  if (useLocal) startBase.setFullYear(startBase.getFullYear() - yearsBack)
  else startBase.setUTCFullYear(startBase.getUTCFullYear() - yearsBack)
  const startYear = useLocal ? startBase.getFullYear() : startBase.getUTCFullYear()
  const startMonth = (useLocal ? startBase.getMonth() : startBase.getUTCMonth()) + 1
  const start = { year: startYear, month: startMonth, day: 1 }

  return { start, end }
}

function createRes() {
  const res: any = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(_payload: unknown) {
      return undefined
    },
  }
  return res
}

async function call(fn: (req: any, res: any) => Promise<any>, query: Record<string, unknown>) {
  const req: any = { query, user: ADMIN }
  const res = createRes()
  await fn(req, res)
}

async function main() {
  // Allinea lo script all'avvio dell'API: carica apps/api/.env
  const __dirnameForFile = path.dirname(fileURLToPath(import.meta.url))
  const apiEnvPath = path.resolve(__dirnameForFile, "../.env")
  dotenv.config({ path: apiEnvPath })

  const now = new Date()
  const yearsBack = Number(parseArgValue("--years-back") ?? process.env.PRECOMPUTE_YEARS_BACK ?? 3)
  const yearsOverride = parseYearsArg(parseArgValue("--years") ?? undefined)
  const strictSql = (process.env.PRECOMPUTE_STRICT_SQL ?? "true").toLowerCase() !== "false"
  const depSig = await getBudgetDepSig()
  const scope = "admin"
  const consulenteParams = { consulente: null }

  const { start, end } = computeMonthRange(now, yearsBack, yearsOverride)
  console.log(
    `[precompute] ${
      yearsOverride?.length ? `years=${yearsOverride.join(",")}` : `years-back=${yearsBack}`
    } (start=${start.year}-${pad2(start.month)}-${pad2(start.day)} end=${end.year}-${pad2(end.month)}-${pad2(end.day)})`
  )

  const yearsSeen = new Set<number>()

  // Itera mese per mese.
  for (let y = start.year; y <= end.year; y++) {
    const mStart = y === start.year ? start.month : 1
    const mEnd = y === end.year ? end.month : 12
    for (let m = mStart; m <= mEnd; m++) {
      const lastDay = daysInMonth(y, m)
      const asOf = ymdToAsOfKey(y, m, lastDay)
      const fromIso = `${y}-${pad2(m)}-01`
      const toIso = `${y}-${pad2(m)}-${pad2(lastDay)}`

      yearsSeen.add(y)

      // Write-once: se data.dashboard per quel mese (asOf=ultimo-giorno) è già presente, saltiamo tutto.
      const dashCached = await cacheGet({
        name: "data.dashboard",
        scope,
        params: consulenteParams,
        asOf,
        depSig,
      })

      if (dashCached) {
        console.log(`[precompute] skip mese ${y}-${pad2(m)} (asOf=${asOf}) cache HIT dashboard`)
        continue
      }

      console.log(`[precompute] mese ${y}-${pad2(m)} (asOf=${asOf}) cache MISS -> calcolo`)

      // data.dashboard (entrate mese + grafico)
      await call(getDashboard as any, { asOf })

      const dashAfter = await cacheGet({
        name: "data.dashboard",
        scope,
        params: consulenteParams,
        asOf,
        depSig,
      })
      if (!dashAfter) {
        const msg = `[precompute] storico data.dashboard NON salvato per asOf=${asOf} (probabile timeout SQL: mock non viene cacheato per storico).`
        if (strictSql) throw new Error(msg)
        console.warn(msg)
      }

      // dettaglio mese (budget + consuntivo progressivo fino al "giorno" scelto)
      // In UI per admin, giorno è derivato da asOf.day; qui forziamo i totali di mese con asOf = ultimo giorno.
      await call(getDettaglioMese as any, { anno: y, mese: m, giorno: lastDay, asOf })

      const meseAfter = await cacheGet({
        name: "data.dettaglio-mese",
        scope,
        params: { anno: y, mese: m, giorno: lastDay, consulente: null },
        asOf,
        depSig,
      })
      if (!meseAfter) {
        const msg = `[precompute] storico data.dettaglio-mese NON salvato per asOf=${asOf} (anno=${y}, mese=${m}).`
        if (strictSql) throw new Error(msg)
        console.warn(msg)
      }

      // Report consulenti per il mese (range custom): cached su data.report-consulenti.
      const repCached = await cacheGet({
        name: "data.report-consulenti",
        scope,
        params: { from: fromIso, to: toIso, consulenti: null },
        asOf: toIso,
        depSig,
      })
      if (repCached) {
        console.log(`[precompute] skip report-consulenti ${y}-${pad2(m)} cache HIT`)
      } else {
        console.log(`[precompute] report-consulenti ${y}-${pad2(m)} cache MISS -> calcolo`)
        await call(getReportConsulenti as any, { from: fromIso, to: toIso, asOf: toIso })
      }
    }
  }

  // dettaglio-anno per gli anni toccati (asOf=31/12)
  for (const y of Array.from(yearsSeen).sort((a, b) => a - b)) {
    const asOf = ymdToAsOfKey(y, 12, 31)
    const yearCached = await cacheGet({
      name: "data.dettaglio-anno",
      scope,
      params: { anno: y },
      asOf,
      depSig,
    })
    if (yearCached) {
      console.log(`[precompute] skip anno ${y} cache HIT dettaglio-anno`)
      continue
    }
    console.log(`[precompute] anno ${y} cache MISS -> calcolo dettaglio-anno`)
    await call(getDettaglioAnno as any, { anno: y, asOf })

    const annoAfter = await cacheGet({
      name: "data.dettaglio-anno",
      scope,
      params: { anno: y },
      asOf,
      depSig,
    })
    if (!annoAfter) {
      const msg = `[precompute] storico data.dettaglio-anno NON salvato per asOf=${asOf} (anno=${y}).`
      if (strictSql) throw new Error(msg)
      console.warn(msg)
    }
  }

  console.log("[precompute] completato.")
}

main().catch((e) => {
  console.error("[precompute] errore:", e)
  process.exit(1)
})

