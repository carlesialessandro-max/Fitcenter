import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { getDataDir, readJson, writeJson } from "./persist.js"

export type AmmRepartoTipo = "operativo" | "struttura"
export type AmmTipoCosto = "fisso" | "variabile"
export type AmmOrigine = "manuale" | "ocr"

export type AmmReparto = {
  id: string
  codice: string
  nome: string
  tipo: AmmRepartoTipo
  note?: string
  attivo: boolean
  ordine: number
}

export type AmmFornitore = {
  id: string
  ragioneSociale: string
}

export type AmmQuota = {
  repartoId: string
  percentuale: number
}

export type AmmSpesa = {
  id: string
  fornitore: string
  fornitoreId?: string
  numeroDocumento: string
  dataDocumento: string
  descrizione: string
  totale: number
  tipoCosto: AmmTipoCosto
  quote: AmmQuota[]
  pathPdf?: string
  origine: AmmOrigine
  createdAt: string
  updatedAt: string
}

type FileShape = {
  reparti: AmmReparto[]
  fornitori: AmmFornitore[]
  spese: AmmSpesa[]
}

const FILE = "amministrazione-costi.json"

export const REPARTI_SEED: AmmReparto[] = [
  { id: "piscina", codice: "piscina", nome: "Piscina", tipo: "operativo", attivo: true, ordine: 1, note: "Coperta, estiva, parco acquatico" },
  { id: "fitness", codice: "fitness", nome: "Fitness / Corsi", tipo: "operativo", attivo: true, ordine: 2, note: "Palestra, corsi, pole dance, personal" },
  { id: "manutenzione", codice: "manutenzione", nome: "Manutenzione", tipo: "operativo", attivo: true, ordine: 3 },
  {
    id: "amministrazione",
    codice: "amministrazione",
    nome: "Amministrazione, Desk e Uffici",
    tipo: "struttura",
    attivo: true,
    ordine: 4,
    note: "Costo fisso di gestione struttura",
  },
  {
    id: "utenze",
    codice: "utenze",
    nome: "Utenze generali",
    tipo: "struttura",
    attivo: true,
    ordine: 5,
    note: "Costo fisso da ripartire",
  },
]

function empty(): FileShape {
  return { reparti: REPARTI_SEED.map((r) => ({ ...r })), fornitori: [], spese: [] }
}

function load(): FileShape {
  const raw = readJson<Partial<FileShape>>(FILE, empty())
  const seedById = new Map(REPARTI_SEED.map((r) => [r.id, r]))
  const have = new Set((raw.reparti ?? []).map((r) => r.id))
  const reparti = [...(raw.reparti ?? [])]
  for (const s of REPARTI_SEED) {
    if (!have.has(s.id)) reparti.push({ ...s })
  }
  return {
    reparti: reparti.map((r) => ({
      ...seedById.get(r.id),
      ...r,
      attivo: r.attivo !== false,
      ordine: Number(r.ordine) || 99,
    })),
    fornitori: Array.isArray(raw.fornitori) ? raw.fornitori : [],
    spese: Array.isArray(raw.spese) ? raw.spese : [],
  }
}

function save(d: FileShape) {
  writeJson(FILE, d)
}

function nowIso(): string {
  return new Date().toISOString()
}

export function pdfDir(): string {
  const dir = path.join(getDataDir(), "amministrazione-pdf")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function quoteSomma(quote: AmmQuota[]): number {
  return Math.round(quote.reduce((s, q) => s + Number(q.percentuale || 0), 0) * 100) / 100
}

export function quoteValide(quote: AmmQuota[]): boolean {
  if (!quote.length) return false
  const seen = new Set<string>()
  for (const q of quote) {
    if (!q.repartoId || seen.has(q.repartoId)) return false
    if (!Number.isFinite(q.percentuale) || q.percentuale < 0) return false
    seen.add(q.repartoId)
  }
  return Math.abs(quoteSomma(quote) - 100) < 0.05
}

export function allocateQuote(totale: number, quote: AmmQuota[]): { repartoId: string; importo: number }[] {
  const t = Number(totale) || 0
  const out: { repartoId: string; importo: number }[] = []
  let acc = 0
  quote.forEach((q, i) => {
    const last = i === quote.length - 1
    const imp = last ? Math.round((t - acc) * 100) / 100 : Math.round(((t * q.percentuale) / 100) * 100) / 100
    acc = Math.round((acc + imp) * 100) / 100
    out.push({ repartoId: q.repartoId, importo: imp })
  })
  return out
}

export const ammCostiStore = {
  listReparti(all = false): AmmReparto[] {
    const r = load().reparti.sort((a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome, "it"))
    return all ? r : r.filter((x) => x.attivo)
  },
  upsertReparto(body: Partial<AmmReparto> & { nome: string }): AmmReparto {
    const d = load()
    const nome = body.nome.trim()
    if (!nome) throw Object.assign(new Error("Nome reparto obbligatorio"), { status: 400 })
    const id = String(body.id ?? "").trim() || randomUUID()
    const cur = d.reparti.find((r) => r.id === id)
    const row: AmmReparto = {
      id,
      codice: (body.codice ?? cur?.codice ?? nome).trim().toLowerCase().replace(/\s+/g, "-"),
      nome,
      tipo: body.tipo === "struttura" || body.tipo === "operativo" ? body.tipo : (cur?.tipo ?? "operativo"),
      note: (body.note ?? cur?.note ?? "").trim() || undefined,
      attivo: body.attivo ?? cur?.attivo ?? true,
      ordine: Number(body.ordine ?? cur?.ordine ?? 50),
    }
    if (cur) Object.assign(cur, row)
    else d.reparti.push(row)
    save(d)
    return row
  },
  listFornitori(): AmmFornitore[] {
    return load().fornitori.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale, "it"))
  },
  ensureFornitore(nome: string): AmmFornitore {
    const d = load()
    const n = nome.trim()
    if (!n) throw Object.assign(new Error("Fornitore obbligatorio"), { status: 400 })
    const hit = d.fornitori.find((f) => f.ragioneSociale.toLowerCase() === n.toLowerCase())
    if (hit) return hit
    const row: AmmFornitore = { id: randomUUID(), ragioneSociale: n }
    d.fornitori.push(row)
    save(d)
    return row
  },
  listSpese(): AmmSpesa[] {
    return load().spese.slice().sort((a, b) => b.dataDocumento.localeCompare(a.dataDocumento) || b.createdAt.localeCompare(a.createdAt))
  },
  getSpesa(id: string): AmmSpesa | undefined {
    return load().spese.find((s) => s.id === id)
  },
  upsertSpesa(body: Partial<AmmSpesa> & { fornitore: string; dataDocumento: string; totale: number; quote: AmmQuota[] }): AmmSpesa {
    const d = load()
    const dataDocumento = String(body.dataDocumento ?? "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDocumento)) throw Object.assign(new Error("Data documento non valida"), { status: 400 })
    const totale = Number(String(body.totale).replace(",", "."))
    if (!Number.isFinite(totale) || totale < 0) throw Object.assign(new Error("Importo non valido"), { status: 400 })
    const quote = (body.quote ?? []).map((q) => ({
      repartoId: String(q.repartoId ?? "").trim(),
      percentuale: Number(String(q.percentuale).replace(",", ".")),
    }))
    if (!quoteValide(quote)) throw Object.assign(new Error("La ripartizione deve sommare 100%"), { status: 400 })
    const ids = new Set(d.reparti.map((r) => r.id))
    for (const q of quote) {
      if (!ids.has(q.repartoId)) throw Object.assign(new Error("Reparto sconosciuto nella ripartizione"), { status: 400 })
    }
    const fornitore = body.fornitore.trim()
    if (!fornitore) throw Object.assign(new Error("Fornitore obbligatorio"), { status: 400 })
    const f = this.ensureFornitore(fornitore)
    const id = String(body.id ?? "").trim() || randomUUID()
    const cur = d.spese.find((s) => s.id === id)
    const row: AmmSpesa = {
      id,
      fornitore,
      fornitoreId: f.id,
      numeroDocumento: String(body.numeroDocumento ?? cur?.numeroDocumento ?? "").trim(),
      dataDocumento,
      descrizione: String(body.descrizione ?? cur?.descrizione ?? "").trim(),
      totale: Math.round(totale * 100) / 100,
      tipoCosto: body.tipoCosto === "variabile" || body.tipoCosto === "fisso" ? body.tipoCosto : (cur?.tipoCosto ?? "fisso"),
      quote,
      pathPdf: body.pathPdf ?? cur?.pathPdf,
      origine: body.origine ?? cur?.origine ?? "manuale",
      createdAt: cur?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    }
    if (cur) Object.assign(cur, row)
    else d.spese.push(row)
    save(d)
    return row
  },
  setPdf(id: string, filename: string): AmmSpesa {
    const d = load()
    const cur = d.spese.find((s) => s.id === id)
    if (!cur) throw Object.assign(new Error("Spesa non trovata"), { status: 404 })
    cur.pathPdf = filename
    cur.updatedAt = nowIso()
    save(d)
    return cur
  },
  deleteSpesa(id: string): void {
    const d = load()
    const cur = d.spese.find((s) => s.id === id)
    d.spese = d.spese.filter((s) => s.id !== id)
    save(d)
    if (cur?.pathPdf) {
      const p = path.join(pdfDir(), path.basename(cur.pathPdf))
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  },
}
