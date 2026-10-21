import { FIC_DEFAULT_REPARTO, ficStore, maskToken, type FicConfig } from "../store/fattureincloud.js"

const BASE = "https://api-v2.fattureincloud.it"
const TYPES = ["expense", "self_invoice"] as const

export type FicCompany = {
  id: number
  name: string
  accessToken?: string
}

export type FicDoc = {
  id: number
  type: string
  fornitore: string
  numeroDocumento: string
  dataDocumento: string
  descrizione: string
  totale: number
}

export type FicIssuedDoc = {
  id: number
  type: string
  cliente: string
  numeroDocumento: string
  dataDocumento: string
  descrizione: string
  totale: number
}

export type FicAmmIssuedTotals = {
  ricaviDanza: number
  nFattureDanza: number
  recuperiUtenze: number
  recuperiUtenzePerMese: Record<string, number>
}

type FicJson = Record<string, unknown>

function envToken(): string {
  return (process.env.FATTUREINCLOUD_ACCESS_TOKEN ?? "").trim()
}

function envCompanyId(): number {
  const n = Number(process.env.FATTUREINCLOUD_COMPANY_ID ?? "")
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function resolvedConfig(): { cfg: FicConfig | null; fromEnv: boolean } {
  const stored = ficStore.get()
  const token = envToken() || stored?.accessToken || ""
  const companyId = envCompanyId() || stored?.companyId || 0
  if (!token || !companyId) {
    if (token && !companyId) {
      return {
        cfg: {
          accessToken: token,
          companyId: 0,
          companyName: stored?.companyName ?? "",
          defaultRepartoId: stored?.defaultRepartoId || FIC_DEFAULT_REPARTO,
          connectedAt: stored?.connectedAt ?? "",
          lastSyncAt: stored?.lastSyncAt,
        },
        fromEnv: Boolean(envToken()),
      }
    }
    return { cfg: null, fromEnv: Boolean(envToken()) }
  }
  return {
    cfg: {
      accessToken: token,
      companyId,
      companyName: stored?.companyName ?? "",
      defaultRepartoId: stored?.defaultRepartoId || FIC_DEFAULT_REPARTO,
      connectedAt: stored?.connectedAt ?? "",
      lastSyncAt: stored?.lastSyncAt,
    },
    fromEnv: Boolean(envToken()),
  }
}

function errOf(status: number, body: unknown, fallback: string): Error {
  const o = body && typeof body === "object" ? (body as FicJson) : {}
  const nested = o.error && typeof o.error === "object" ? (o.error as FicJson) : o
  const msg = String(nested.message ?? o.message ?? fallback).trim() || fallback
  const e = new Error(
    status === 401 || status === 403
      ? "Token Fatture in Cloud non valido o senza permesso sui documenti richiesti."
      : msg
  )
  ;(e as Error & { status: number }).status = status >= 400 && status < 600 ? status : 502
  return e
}

async function ficFetch(path: string, token: string): Promise<FicJson> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) throw errOf(res.status, json, `Fatture in Cloud HTTP ${res.status}`)
  return (json && typeof json === "object" ? json : {}) as FicJson
}

function walkCompanies(list: unknown, out: FicCompany[]) {
  if (!Array.isArray(list)) return
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue
    const c = raw as FicJson
    const id = Number(c.id)
    if (!Number.isFinite(id) || id <= 0) continue
    const tok = String(c.access_token ?? "").trim()
    out.push({ id, name: String(c.name ?? "").trim(), accessToken: tok || undefined })
    walkCompanies(c.controlled_companies, out)
  }
}

export function flattenCompanies(payload: unknown): FicCompany[] {
  const root = payload && typeof payload === "object" ? (payload as FicJson) : {}
  const data = root.data && typeof root.data === "object" ? (root.data as FicJson) : root
  const out: FicCompany[] = []
  walkCompanies(data.companies, out)
  return out
}

export function pickCompany(companies: FicCompany[], wantedId?: number): FicCompany | null {
  if (!companies.length) return null
  if (wantedId) return companies.find((c) => c.id === wantedId) ?? null
  if (companies.length === 1) return companies[0]!
  const aqua = companies.find((c) => /aqua/i.test(c.name) || /h2\s*sport/i.test(c.name))
  return aqua ?? companies[0] ?? null
}

export async function listCompanies(token: string): Promise<FicCompany[]> {
  const json = await ficFetch("/user/companies", token)
  return flattenCompanies(json)
}

function monthBounds(mese: string): { from: string; to: string } {
  const [ys, ms] = mese.split("-")
  const y = Number(ys)
  const m = Number(ms)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw Object.assign(new Error("Mese non valido"), { status: 400 })
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, "0")
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` }
}

function inMonth(iso: string, from: string, to: string): boolean {
  const d = String(iso ?? "").slice(0, 10)
  return d >= from && d <= to
}

function normalizedText(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
}

function mapIssuedDoc(raw: unknown): FicIssuedDoc | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as FicJson
  const id = Number(o.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const amount = Number(o.amount_gross ?? o.amount_net ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const dataDocumento = String(o.date ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDocumento)) return null
  const entity = o.entity && typeof o.entity === "object" ? (o.entity as FicJson) : {}
  const items = Array.isArray(o.items_list) ? o.items_list : []
  const descriptions = [
    o.description,
    ...items.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as FicJson
      return [row.name, row.description]
    }),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
  const type = String(o.type ?? "invoice")
  const sign = /credit.?note/i.test(type) ? -1 : 1
  return {
    id,
    type,
    cliente: String(entity.name ?? "").trim(),
    numeroDocumento: String(o.invoice_number ?? o.number ?? "").trim() || `FIC-${id}`,
    dataDocumento,
    descrizione: descriptions.join(" · "),
    totale: Math.round(amount * sign * 100) / 100,
  }
}

function mapDoc(raw: unknown): FicDoc | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as FicJson
  const id = Number(o.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const totale = Number(o.amount_gross ?? o.amount_net ?? 0)
  if (!Number.isFinite(totale) || totale <= 0) return null
  const dataDocumento = String(o.date ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDocumento)) return null
  const entity = o.entity && typeof o.entity === "object" ? (o.entity as FicJson) : {}
  const fornitore = String(entity.name ?? "").trim() || "Fornitore sconosciuto"
  const numero = String(o.invoice_number ?? o.number ?? "").trim()
  const type = String(o.type ?? "expense")
  const descrizione = String(o.description ?? "").trim() || `Acquisto Fatture in Cloud (${type})`
  return {
    id,
    type,
    fornitore,
    numeroDocumento: numero || `FIC-${id}`,
    dataDocumento,
    descrizione,
    totale: Math.round(totale * 100) / 100,
  }
}

async function listType(token: string, companyId: number, type: string, from: string, to: string): Promise<FicDoc[]> {
  const docs: FicDoc[] = []
  const q = `date >= '${from}' AND date <= '${to}'`
  let page = 1
  let lastPage = 1
  let useQ = true
  while (page <= lastPage && page <= 40) {
    const qs = new URLSearchParams({
      type,
      page: String(page),
      per_page: "50",
      fieldset: "detailed",
    })
    if (useQ) qs.set("q", q)
    try {
      const json = await ficFetch(`/c/${companyId}/received_documents?${qs}`, token)
      const rows = Array.isArray(json.data) ? json.data : []
      for (const row of rows) {
        const doc = mapDoc(row)
        if (doc && inMonth(doc.dataDocumento, from, to)) docs.push(doc)
      }
      lastPage = Number(json.last_page) || 1
      page += 1
    } catch (e) {
      const st = (e as { status?: number }).status
      if (useQ && page === 1 && (st === 400 || st === 422)) {
        useQ = false
        lastPage = 1
        continue
      }
      throw e
    }
  }
  return docs
}

export async function listAcquistiMese(cfg: FicConfig, mese: string): Promise<FicDoc[]> {
  if (!cfg.companyId) throw Object.assign(new Error("Azienda Fatture in Cloud non selezionata"), { status: 400 })
  const { from, to } = monthBounds(mese)
  const seen = new Set<number>()
  const out: FicDoc[] = []
  for (const type of TYPES) {
    const rows = await listType(cfg.accessToken, cfg.companyId, type, from, to)
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
  }
  out.sort((a, b) => b.dataDocumento.localeCompare(a.dataDocumento) || a.fornitore.localeCompare(b.fornitore, "it"))
  return out
}

export async function listFattureEmessePeriodo(
  cfg: FicConfig,
  from: string,
  to: string
): Promise<FicIssuedDoc[]> {
  if (!cfg.companyId) throw Object.assign(new Error("Azienda Fatture in Cloud non selezionata"), { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw Object.assign(new Error("Intervallo date non valido"), { status: 400 })
  }
  const docs: FicIssuedDoc[] = []
  const q = `date >= '${from}' AND date <= '${to}'`
  const maxPages = 200
  for (const type of ["invoice", "credit_note"]) {
    let page = 1
    let lastPage = 1
    let useQ = true
    while (page <= lastPage && page <= maxPages) {
      const qs = new URLSearchParams({
        type,
        page: String(page),
        per_page: "50",
        fieldset: "detailed",
      })
      if (useQ) qs.set("q", q)
      try {
        const json = await ficFetch(`/c/${cfg.companyId}/issued_documents?${qs}`, cfg.accessToken)
        const rows = Array.isArray(json.data) ? json.data : []
        for (const row of rows) {
          const doc = mapIssuedDoc(row)
          if (doc && inMonth(doc.dataDocumento, from, to)) docs.push(doc)
        }
        lastPage = Number(json.last_page) || 1
        page += 1
      } catch (e) {
        const status = (e as { status?: number }).status
        if (useQ && page === 1 && (status === 400 || status === 422)) {
          useQ = false
          continue
        }
        throw e
      }
    }
    if (page <= lastPage) {
      throw Object.assign(new Error("Troppe fatture emesse nel periodo: restringi l’intervallo di date."), { status: 422 })
    }
  }
  const seen = new Set<string>()
  return docs
    .filter((doc) => {
      const key = `${doc.type}:${doc.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.dataDocumento.localeCompare(a.dataDocumento) || a.cliente.localeCompare(b.cliente, "it"))
}

export function riepilogoFattureAmm(docs: FicIssuedDoc[]): FicAmmIssuedTotals {
  let ricaviDanza = 0
  let nFattureDanza = 0
  let recuperiUtenze = 0
  const recuperiUtenzePerMese: Record<string, number> = {}
  for (const doc of docs) {
    const cliente = normalizedText(doc.cliente)
    const descrizione = normalizedText(doc.descrizione)
    if (cliente.includes("CENTRO ARTE DANZA")) {
      ricaviDanza += doc.totale
      nFattureDanza += 1
    }
    if (
      cliente.includes("BIG FOOD") &&
      /\b(ENERGIA|ENERGY|GAS)\b/.test(descrizione)
    ) {
      recuperiUtenze += doc.totale
      const mese = doc.dataDocumento.slice(0, 7)
      recuperiUtenzePerMese[mese] = (recuperiUtenzePerMese[mese] ?? 0) + doc.totale
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    ricaviDanza: round2(ricaviDanza),
    nFattureDanza,
    recuperiUtenze: round2(recuperiUtenze),
    recuperiUtenzePerMese: Object.fromEntries(
      Object.entries(recuperiUtenzePerMese).map(([mese, importo]) => [mese, round2(importo)])
    ),
  }
}

export function publicStatus() {
  const { cfg, fromEnv } = resolvedConfig()
  if (!cfg?.accessToken) {
    return { connected: false, fromEnv, companyId: null, companyName: "", tokenMasked: "", defaultRepartoId: FIC_DEFAULT_REPARTO, lastSyncAt: null as string | null }
  }
  return {
    connected: Boolean(cfg.companyId),
    fromEnv,
    companyId: cfg.companyId || null,
    companyName: cfg.companyName,
    tokenMasked: maskToken(cfg.accessToken),
    defaultRepartoId: cfg.defaultRepartoId || FIC_DEFAULT_REPARTO,
    lastSyncAt: cfg.lastSyncAt ?? null,
  }
}
