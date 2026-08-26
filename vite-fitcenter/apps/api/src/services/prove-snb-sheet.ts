/**
 * Prenotazione prove bambini → Google Sheet
 * - Scuola nuoto: «PROVE SNB DA SETTEMBRE 26»
 * - Acquaticità: foglio livelli 1–3 (mesi → 3,5 anni)
 *
 * Auth: service account Google (condividere entrambi i fogli con l'email del SA, Editor).
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *   PROVE_SNB_SPREADSHEET_ID / PROVE_SNB_SHEET_GID
 *   PROVE_ACQ_SPREADSHEET_ID / PROVE_ACQ_SHEET_GID
 */
import fs from "fs"
import crypto from "crypto"
import path from "path"

export type BambiniCorso = "acquaticita" | "scuola_nuoto"

const DEFAULT_SNB = {
  spreadsheetId: "1U2oUhD6THjNV8NjGK6vX_xOKOAqpjDlPQUhrrdaFSDc",
  sheetGid: 913046247,
}
const DEFAULT_ACQ = {
  spreadsheetId: "1Gg2Itl0SODAayDBrmXt9vUox5UYy76kcugm68IWNy_8",
  sheetGid: 1077421861,
}

const MONTHS_IT: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
}

const WEEKDAY_IT: Record<string, number> = {
  domenica: 0,
  lunedi: 1,
  lunedì: 1,
  martedi: 2,
  martedì: 2,
  mercoledi: 3,
  mercoledì: 3,
  giovedi: 4,
  giovedì: 4,
  venerdi: 5,
  venerdì: 5,
  sabato: 6,
}

type ServiceAccount = {
  client_email: string
  private_key: string
}

export type ProveSlotBookRequest = {
  corso: BambiniCorso
  /** Preferito: giorno settimana + ora (il foglio ha date fisse, es. 14/09). */
  weekday?: number
  hour: number
  minute: number
  /** Alternativa: istante assoluto (oggi/domani). */
  when?: Date
  /** Data calendario esplicita dal messaggio (es. 7 settembre). */
  day?: number
  month?: number
  year?: number
  nome: string
  telefono: string
  /** Età da scrivere in cella (numero o «7 mesi»). */
  eta: number | string
}

export type ProveSlotBookResult =
  | {
      ok: true
      dayLabel: string
      orario: string
      row: number
      sheetTitle: string
    }
  | {
      ok: false
      reason: "not_configured" | "day_not_found" | "slot_not_found" | "slot_taken" | "api_error"
      detail?: string
      alternatives?: string[]
    }

let cachedToken: { accessToken: string; expiresAt: number } | null = null
let cachedSheetTitle: { gid: number; title: string; spreadsheetId: string } | null = null

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "")
}

function normCell(raw: unknown): string {
  return stripAccents(String(raw ?? "").toLowerCase()).replace(/\s+/g, " ").trim()
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim()
  if (!raw) return null
  try {
    let jsonStr = raw
    if (!raw.startsWith("{")) {
      const p = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
      if (!fs.existsSync(p)) {
        console.error("[prove-snb] GOOGLE_SERVICE_ACCOUNT_JSON file non trovato:", p)
        return null
      }
      jsonStr = fs.readFileSync(p, "utf8")
    }
    const parsed = JSON.parse(jsonStr) as ServiceAccount
    if (!parsed?.client_email || !parsed?.private_key) {
      console.error("[prove-snb] JSON service account senza client_email/private_key")
      return null
    }
    return {
      client_email: parsed.client_email,
      private_key: String(parsed.private_key).replace(/\\n/g, "\n"),
    }
  } catch (e) {
    console.error("[prove-snb] parse service account:", (e as Error)?.message ?? e)
    return null
  }
}

export function isProveSnbSheetConfigured(): boolean {
  return loadServiceAccount() != null
}

function sheetTarget(corso: BambiniCorso): { spreadsheetId: string; sheetGid: number } {
  if (corso === "acquaticita") {
    return {
      spreadsheetId:
        (process.env.PROVE_ACQ_SPREADSHEET_ID ?? DEFAULT_ACQ.spreadsheetId).trim() ||
        DEFAULT_ACQ.spreadsheetId,
      sheetGid: Number(process.env.PROVE_ACQ_SHEET_GID ?? DEFAULT_ACQ.sheetGid) || DEFAULT_ACQ.sheetGid,
    }
  }
  return {
    spreadsheetId:
      (process.env.PROVE_SNB_SPREADSHEET_ID ?? DEFAULT_SNB.spreadsheetId).trim() ||
      DEFAULT_SNB.spreadsheetId,
    sheetGid: Number(process.env.PROVE_SNB_SHEET_GID ?? DEFAULT_SNB.sheetGid) || DEFAULT_SNB.sheetGid,
  }
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input
  return buf.toString("base64url")
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.accessToken

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  )
  const unsigned = `${header}.${claim}`
  const sign = crypto.createSign("RSA-SHA256")
  sign.update(unsigned)
  sign.end()
  const signature = sign.sign(sa.private_key, "base64url")
  const jwt = `${unsigned}.${signature}`

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  })
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !body.access_token) {
    throw new Error(`oauth token: ${body.error ?? res.status}`)
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
  }
  return body.access_token
}

async function sheetsFetch(sa: ServiceAccount, url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken(sa)
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

async function resolveSheetTitle(
  sa: ServiceAccount,
  target: { spreadsheetId: string; sheetGid: number }
): Promise<string> {
  const { spreadsheetId: id, sheetGid: gid } = target
  if (cachedSheetTitle && cachedSheetTitle.spreadsheetId === id && cachedSheetTitle.gid === gid) {
    return cachedSheetTitle.title
  }
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}` +
    `?fields=sheets.properties`
  const res = await sheetsFetch(sa, url)
  const data = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>
    error?: { message?: string }
  }
  if (!res.ok) throw new Error(data.error?.message ?? `meta ${res.status}`)
  const hit = data.sheets?.find((s) => s.properties?.sheetId === gid)
  const title = hit?.properties?.title
  if (!title) throw new Error(`foglio gid=${gid} non trovato nello spreadsheet`)
  cachedSheetTitle = { gid, title, spreadsheetId: id }
  return title
}

function colLetter(index0: number): string {
  let n = index0 + 1
  let s = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function parseTimeCell(raw: unknown): { hour: number; minute: number } | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Serial Google Sheets (frazione di giorno)
    const totalMin = Math.round(((raw % 1) + (raw < 0 ? 1 : 0)) * 24 * 60)
    const hour = Math.floor(totalMin / 60) % 24
    const minute = totalMin % 60
    return { hour, minute }
  }
  const s = String(raw ?? "").trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})[:\.](\d{2})(?::\d{2})?$/)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function formatOrario(hour: number, minute: number): string {
  return `${hour}.${String(minute).padStart(2, "0")}`
}

/** Parti data Europe/Rome. */
export function romeYmd(d: Date): { y: number; m: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    day: Number(get("day")),
    weekday: wdMap[get("weekday") ?? ""] ?? 0,
  }
}

function romeHm(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { hour: get("hour"), minute: get("minute") }
}

type DaySection = {
  label: string
  /** 1-based sheet row of day title */
  titleRow: number
  year: number
  month: number
  day: number
  weekday: number
  nameCol: number
  timeCol: number
  ageCol: number
  phoneCol: number
  /** 0-based row indices in `values` that are bookable slots */
  slotRows: number[]
}

function parseDayHeader(cell: string, defaultYear: number): Omit<DaySection, "nameCol" | "timeCol" | "ageCol" | "phoneCol" | "slotRows" | "titleRow"> | null {
  const t = normCell(cell)
  // es. "lunedi' 14 settembre" / "lunedi 14 settembre 2026"
  const mName = t.match(
    /\b(domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato)\b['’]?\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?\b/
  )
  if (mName) {
    const weekday = WEEKDAY_IT[mName[1]] ?? -1
    const day = Number(mName[2])
    const month = MONTHS_IT[mName[3]] ?? 0
    const year = mName[4] ? Number(mName[4]) : defaultYear
    if (weekday >= 0 && month && day) {
      return { label: String(cell).trim(), year, month, day, weekday }
    }
  }
  // es. "martedi 15/09" / "martedi 15/09/2026"
  const mSlash = t.match(
    /\b(domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato)\b['’]?\s+(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?\b/
  )
  if (mSlash) {
    const weekday = WEEKDAY_IT[mSlash[1]] ?? -1
    const day = Number(mSlash[2])
    const month = Number(mSlash[3])
    let year = defaultYear
    if (mSlash[4]) {
      const y = Number(mSlash[4])
      year = y < 100 ? 2000 + y : y
    }
    if (weekday >= 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { label: String(cell).trim(), year, month, day, weekday }
    }
  }
  return null
}

function detectCols(headerRow: unknown[]): {
  nameCol: number
  timeCol: number
  ageCol: number
  phoneCol: number
} | null {
  let nameCol = -1
  let timeCol = -1
  let ageCol = -1
  let phoneCol = -1
  for (let c = 0; c < headerRow.length; c++) {
    const n = normCell(headerRow[c])
    if (!n) continue
    if (nameCol < 0 && (n.includes("cognome") || n.includes("nome"))) nameCol = c
    if (timeCol < 0 && n.includes("orario")) timeCol = c
    if (ageCol < 0 && (n.includes("eta") || n === "età")) ageCol = c
    if (phoneCol < 0 && (n.includes("telefon") || n.includes("cell"))) phoneCol = c
  }
  if (timeCol < 0) return null
  if (nameCol < 0) nameCol = Math.max(0, timeCol - 1)
  if (ageCol < 0) ageCol = timeCol + 1
  if (phoneCol < 0) phoneCol = ageCol + 1
  return { nameCol, timeCol, ageCol, phoneCol }
}

/** Se l'intestazione non allinea (es. colonna 1,2,3… a sinistra), trova la colonna orari dalle righe dati. */
function refineColsFromData(
  values: unknown[][],
  headerAt: number,
  cols: { nameCol: number; timeCol: number; ageCol: number; phoneCol: number }
): { nameCol: number; timeCol: number; ageCol: number; phoneCol: number } {
  const sample: unknown[][] = []
  for (let r = headerAt + 1; r < Math.min(headerAt + 8, values.length); r++) {
    sample.push(values[r] ?? [])
  }
  if (sample.length === 0) return cols

  let bestTime = cols.timeCol
  let bestScore = 0
  const maxC = Math.max(...sample.map((r) => r.length), cols.timeCol + 1)
  for (let c = 0; c < maxC; c++) {
    let score = 0
    for (const row of sample) {
      if (parseTimeCell(row[c])) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestTime = c
    }
  }
  if (bestScore === 0) {
    // Anche con timeCol da header: evita colonna «1,2,3» come nome
    let nameCol = cols.nameCol
    let idxScore = 0
    for (const row of sample) {
      const v = String(row[nameCol] ?? "").trim()
      if (/^\d{1,2}$/.test(v)) idxScore++
    }
    if (idxScore >= Math.ceil(sample.length / 2) && nameCol + 1 < maxC) {
      nameCol = nameCol + 1
    }
    return { ...cols, nameCol }
  }

  let nameCol = Math.max(0, bestTime - 1)
  let idxScore = 0
  for (const row of sample) {
    const v = String(row[nameCol] ?? "").trim()
    if (/^\d{1,2}$/.test(v)) idxScore++
  }
  if (idxScore >= Math.ceil(sample.length / 2) && nameCol > 0) {
    nameCol = nameCol - 1
  }
  // Se nameCol è ancora indici e bestTime-1 era l'indice, nome è bestTime-1 only if not index...
  // Caso tipico: [n, nome, orario] → bestTime=2, nameCol parte 1; se nameCol=1 ha nomi, ok.
  // Caso: header orario su col sbagliata, bestTime corretto.
  const header = values[headerAt] ?? []
  let ageCol = bestTime + 1
  let phoneCol = bestTime + 2
  for (let c = 0; c < header.length; c++) {
    const n = normCell(header[c])
    if (n.includes("cognome") || (n.includes("nome") && !n.includes("cognome"))) {
      // tieni nameCol già stimato se header non combacia con indici
      if (!/^\d+$/.test(String(header[c] ?? "").trim())) {
        const hv = normCell(header[c])
        if (hv.includes("cognome") || hv.includes("nome")) nameCol = c
      }
    }
    if (n.includes("eta") || n === "età") ageCol = c
    if (n.includes("telefon") || n.includes("cell")) phoneCol = c
  }
  // Header «COGNOME» spesso in col 0 mentre i dati hanno [n°, nome, orario]
  let nameIdxScore = 0
  for (const row of sample) {
    if (/^\d{1,2}$/.test(String(row[nameCol] ?? "").trim())) nameIdxScore++
  }
  if (nameIdxScore >= Math.ceil(sample.length / 2) && nameCol + 1 < bestTime) {
    nameCol = nameCol + 1
  }

  return { nameCol, timeCol: bestTime, ageCol, phoneCol }
}

function buildSections(values: unknown[][], defaultYear: number): DaySection[] {
  const sections: DaySection[] = []
  for (let r = 0; r < values.length; r++) {
    const row = values[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const parsed = parseDayHeader(String(row[c] ?? ""), defaultYear)
      if (!parsed) continue
      // header colonne: cerca nelle prossime 3 righe
      let cols: ReturnType<typeof detectCols> | null = null
      let headerAt = -1
      for (let h = r + 1; h <= Math.min(r + 3, values.length - 1); h++) {
        cols = detectCols(values[h] ?? [])
        if (cols) {
          headerAt = h
          break
        }
      }
      if (!cols || headerAt < 0) continue
      cols = refineColsFromData(values, headerAt, cols)
      const slotRows: number[] = []
      for (let sr = headerAt + 1; sr < values.length; sr++) {
        const srow = values[sr] ?? []
        // nuovo giorno → stop
        let nextDay = false
        for (const cell of srow) {
          if (parseDayHeader(String(cell ?? ""), defaultYear)) {
            nextDay = true
            break
          }
        }
        if (nextDay) break
        const tm = parseTimeCell(srow[cols.timeCol])
        if (!tm) {
          // riga vuota lunga → fine sezione
          const joined = srow.map((x) => String(x ?? "").trim()).join("")
          if (!joined && slotRows.length > 0) break
          continue
        }
        slotRows.push(sr)
      }
      sections.push({
        ...parsed,
        titleRow: r + 1,
        nameCol: cols.nameCol,
        timeCol: cols.timeCol,
        ageCol: cols.ageCol,
        phoneCol: cols.phoneCol,
        slotRows,
      })
      break
    }
  }
  return sections
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

export async function bookProveSnbSlot(req: ProveSlotBookRequest): Promise<ProveSlotBookResult> {
  const sa = loadServiceAccount()
  if (!sa) return { ok: false, reason: "not_configured" }

  try {
    const target = sheetTarget(req.corso)
    const title = await resolveSheetTitle(sa, target)
    const id = target.spreadsheetId
    const range = `${quoteSheetTitle(title)}!A1:H300`
    const getUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/` +
      `${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`
    const getRes = await sheetsFetch(sa, getUrl)
    const getBody = (await getRes.json()) as { values?: unknown[][]; error?: { message?: string } }
    if (!getRes.ok) {
      return { ok: false, reason: "api_error", detail: getBody.error?.message ?? String(getRes.status) }
    }
    const values = getBody.values ?? []
    const nowParts = romeYmd(new Date())
    const sections = buildSections(values, nowParts.y)

    let hm = { hour: req.hour, minute: req.minute }
    let daySec: DaySection | undefined

    if (req.when) {
      const ymd = romeYmd(req.when)
      hm = romeHm(req.when)
      daySec = sections.find((s) => s.year === ymd.y && s.month === ymd.m && s.day === ymd.day)
    } else if (req.day != null && req.month != null) {
      const y = req.year ?? nowParts.y
      daySec = sections.find((s) => s.year === y && s.month === req.month && s.day === req.day)
      // Se l'anno sul foglio è quello successivo (es. a dicembre), riprova
      if (!daySec && req.year == null) {
        daySec = sections.find((s) => s.month === req.month && s.day === req.day)
      }
    } else {
      const wd = req.weekday
      if (wd == null) {
        return { ok: false, reason: "day_not_found", detail: "weekday mancante" }
      }
      // Prossima sezione sul foglio con quel weekday (date ≥ oggi)
      const candidates = sections
        .filter((s) => s.weekday === wd)
        .filter((s) => {
          const key = s.year * 10000 + s.month * 100 + s.day
          const today = nowParts.y * 10000 + nowParts.m * 100 + nowParts.day
          return key >= today
        })
        .sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day)
      daySec = candidates[0]
    }

    if (!daySec) {
      const alts = sections
        .filter((s) => s.slotRows.length > 0)
        .slice(0, 8)
        .map((s) => s.label)
      return {
        ok: false,
        reason: "day_not_found",
        detail: "Nessuna sezione giorno sul foglio",
        alternatives: alts,
      }
    }

    const wanted = `${hm.hour}:${String(hm.minute).padStart(2, "0")}`
    const freeAlt: string[] = []
    let targetRowIdx: number | null = null
    let targetOrario = ""
    let taken = false

    for (const sr of daySec.slotRows) {
      const srow = values[sr] ?? []
      const tm = parseTimeCell(srow[daySec.timeCol])
      if (!tm) continue
      const label = formatOrario(tm.hour, tm.minute)
      const name = String(srow[daySec.nameCol] ?? "").trim()
      const timeMatch = tm.hour === hm.hour && tm.minute === hm.minute
      if (timeMatch) {
        if (!name && targetRowIdx == null) {
          targetOrario = label
          targetRowIdx = sr
          // scuola nuoto: uno slot = una riga; acquaticità: prima libera allo stesso orario
          if (req.corso === "scuola_nuoto") break
        } else if (name) {
          taken = true
          targetOrario = label
        }
        continue
      }
      if (!name && !freeAlt.includes(label)) freeAlt.push(label)
    }

    if (targetRowIdx != null) taken = false

    if (taken && targetRowIdx == null) {
      return {
        ok: false,
        reason: "slot_taken",
        detail: `Orario ${wanted} già occupato`,
        alternatives: freeAlt.slice(0, 8),
      }
    }
    if (targetRowIdx == null) {
      return {
        ok: false,
        reason: "slot_not_found",
        detail: `Orario ${wanted} non in elenco`,
        alternatives: freeAlt.slice(0, 8),
      }
    }

    const sheetRow = targetRowIdx + 1 // 1-based
    const nameA1 = `${quoteSheetTitle(title)}!${colLetter(daySec.nameCol)}${sheetRow}`
    const ageA1 = `${quoteSheetTitle(title)}!${colLetter(daySec.ageCol)}${sheetRow}`
    const phoneA1 = `${quoteSheetTitle(title)}!${colLetter(daySec.phoneCol)}${sheetRow}`

    const batchUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchUpdate`
    const putRes = await sheetsFetch(sa, batchUrl, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [
          { range: nameA1, values: [[req.nome]] },
          { range: ageA1, values: [[req.eta]] },
          { range: phoneA1, values: [[req.telefono]] },
        ],
      }),
    })
    const putBody = (await putRes.json()) as { error?: { message?: string } }
    if (!putRes.ok) {
      return { ok: false, reason: "api_error", detail: putBody.error?.message ?? String(putRes.status) }
    }

    return {
      ok: true,
      dayLabel: daySec.label,
      orario: targetOrario || formatOrario(hm.hour, hm.minute),
      row: sheetRow,
      sheetTitle: title,
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    console.error("[prove-snb]", msg)
    return { ok: false, reason: "api_error", detail: msg }
  }
}
