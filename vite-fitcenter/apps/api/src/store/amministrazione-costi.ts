import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { getDataDir, readJson, writeJson } from "./persist.js"

export type AmmRepartoTipo = "operativo" | "struttura"
export type AmmLivello = "macro" | "sotto"
export type AmmTipoCosto = "fisso" | "variabile"
export type AmmOrigine = "manuale" | "ocr" | "excel"
export type AmmBustaOrigine = "manuale" | "mastrino"

export type AmmReparto = {
  id: string
  codice: string
  nome: string
  tipo: AmmRepartoTipo
  livello: AmmLivello
  macroId?: string
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

export type AmmBusta = {
  id: string
  nominativo: string
  mese: string
  descrizione: string
  totale: number
  quote: AmmQuota[]
  origine: AmmBustaOrigine
  createdAt: string
  updatedAt: string
}

type FileShape = {
  reparti: AmmReparto[]
  fornitori: AmmFornitore[]
  spese: AmmSpesa[]
  buste: AmmBusta[]
}

export const BUSTA_DEFAULT_REPARTO = "amministrazione-uffici"

const FILE = "amministrazione-costi.json"

function macro(id: string, nome: string, tipo: AmmRepartoTipo, ordine: number, note?: string): AmmReparto {
  return { id, codice: id, nome, tipo, livello: "macro", attivo: true, ordine, note }
}

function sotto(id: string, macroId: string, nome: string, tipo: AmmRepartoTipo, ordine: number, note?: string): AmmReparto {
  return { id, codice: id, nome, tipo, livello: "sotto", macroId, attivo: true, ordine, note }
}

export const REPARTI_SEED: AmmReparto[] = [
  macro("piscina", "Piscina", "operativo", 10, "Coperta, estiva, scuole nuoto, corsi in acqua"),
  sotto("piscina-coperta", "piscina", "Piscina coperta", "operativo", 11),
  sotto("piscina-estiva", "piscina", "Piscina estiva e parco acquatico", "operativo", 12),
  sotto("scuola-nuoto-bambini", "piscina", "Scuola nuoto bambini", "operativo", 13),
  sotto("scuola-nuoto-adulti", "piscina", "Scuola nuoto adulti", "operativo", 14),
  sotto("corsi-acqua", "piscina", "Corsi in acqua e attività di gruppo", "operativo", 15),

  macro("fitness", "Palestra & Fitness", "operativo", 20, "Palestra, corsi, pole dance, personal"),
  sotto("palestra-sala-pesi", "fitness", "Palestra e sala pesi", "operativo", 21),
  sotto("corsi-fitness", "fitness", "Corsi fitness e attività di gruppo", "operativo", 22),
  sotto("pole-dance", "fitness", "Pole Dance", "operativo", 23),
  sotto("personal-training", "fitness", "Personal Training", "operativo", 24),

  macro("spa", "SPA & Benessere", "operativo", 30),
  sotto("spa-benessere", "spa", "SPA e benessere", "operativo", 31),

  macro("servizi", "Servizi operativi", "operativo", 40),
  sotto("manutenzione-impianti", "servizi", "Manutenzione e impianti", "operativo", 41),
  sotto("pulizie", "servizi", "Pulizie", "operativo", 42),
  sotto("personale-condiviso", "servizi", "Personale condiviso", "operativo", 43),

  macro("gestione", "Gestione & Direzione", "struttura", 50, "Costi fissi: desk, uffici, marketing, commerciale"),
  sotto("amministrazione-uffici", "gestione", "Amministrazione e uffici", "struttura", 51, "Desk, segreteria, direzione"),
  sotto("marketing-pubblicita", "gestione", "Marketing e pubblicità", "struttura", 52),
  sotto("commerciale-vendite", "gestione", "Commerciale e vendite", "struttura", 53),

  macro("generali", "Spese generali & Utenze", "struttura", 60, "Da ripartire sulle macro-aree operative"),
  sotto("utenze-generali", "generali", "Utenze generali", "struttura", 61, "Luce, gas, acqua dell'intera struttura"),
  sotto("costi-generali-struttura", "generali", "Costi generali della struttura", "struttura", 62, "Affitti, assicurazioni"),
  sotto("altri-costi", "generali", "Altri costi", "struttura", 63),
]

const SEED_IDS = new Set(REPARTI_SEED.map((r) => r.id))

/** Vecchi centri (prima del dettaglio sotto-reparto) → macro attuale. */
export const REPARTO_ID_LEGACY: Record<string, string> = {
  manutenzione: "servizi",
  amministrazione: "gestione",
  utenze: "generali",
}

function empty(): FileShape {
  return { reparti: REPARTI_SEED.map((r) => ({ ...r })), fornitori: [], spese: [], buste: [] }
}

function remapRepartoId(id: string): string {
  return REPARTO_ID_LEGACY[id] ?? id
}

function migrate(raw: Partial<FileShape>): FileShape {
  const seedById = new Map(REPARTI_SEED.map((r) => [r.id, r]))
  const incoming = Array.isArray(raw.reparti) ? raw.reparti : []
  const byId = new Map<string, AmmReparto>()
  for (const r of incoming) {
    if (!r?.id) continue
    const id = remapRepartoId(String(r.id))
    const seed = seedById.get(id)
    byId.set(id, {
      id,
      codice: String(r.codice ?? seed?.codice ?? id),
      nome: seed?.nome ?? String(r.nome ?? id),
      tipo: seed?.tipo ?? (r.tipo === "struttura" ? "struttura" : "operativo"),
      livello: seed?.livello ?? (r.livello === "sotto" ? "sotto" : "macro"),
      macroId: seed?.macroId ?? (r.livello === "sotto" ? r.macroId : undefined),
      note: seed?.note ?? r.note,
      attivo: r.attivo !== false,
      ordine: seed?.ordine ?? (Number(r.ordine) || 99),
    })
  }
  for (const s of REPARTI_SEED) {
    const cur = byId.get(s.id)
    if (!cur) byId.set(s.id, { ...s })
    else {
      cur.livello = s.livello
      cur.macroId = s.macroId
      cur.tipo = s.tipo
      cur.ordine = s.ordine
      cur.codice = s.codice
      cur.nome = s.nome
      cur.note = s.note
      if (s.livello === "macro" || cur.attivo !== false) cur.attivo = true
    }
  }
  const spese: AmmSpesa[] = (Array.isArray(raw.spese) ? raw.spese : []).map((s) => {
    const origine: AmmOrigine = s.origine === "ocr" || s.origine === "excel" ? s.origine : "manuale"
    return {
      ...s,
      quote: (s.quote ?? []).map((q) => ({
        repartoId: remapRepartoId(String(q.repartoId ?? "")),
        percentuale: Number(q.percentuale) || 0,
      })),
      origine,
    }
  })
  const buste: AmmBusta[] = (Array.isArray(raw.buste) ? raw.buste : []).map((b) => ({
    ...b,
    mese: String(b.mese ?? "").slice(0, 7),
    quote: (b.quote ?? []).map((q) => ({
      repartoId: remapRepartoId(String(q.repartoId ?? "")),
      percentuale: Number(q.percentuale) || 0,
    })),
    origine: b.origine === "mastrino" ? "mastrino" : "manuale",
  }))
  return {
    reparti: [...byId.values()].filter((r) => SEED_IDS.has(r.id) || (r.livello === "sotto" && r.macroId && SEED_IDS.has(r.macroId))),
    fornitori: Array.isArray(raw.fornitori) ? raw.fornitori : [],
    spese,
    buste,
  }
}

function load(): FileShape {
  return migrate(readJson<Partial<FileShape>>(FILE, empty()))
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

export function macroIdOf(reparti: AmmReparto[], id: string): string {
  const r = reparti.find((x) => x.id === id)
  if (!r) return id
  return r.livello === "macro" ? r.id : (r.macroId ?? r.id)
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
    const livello: AmmLivello = body.livello === "sotto" || body.livello === "macro" ? body.livello : (cur?.livello ?? "sotto")
    const macroId = livello === "sotto" ? String(body.macroId ?? cur?.macroId ?? "").trim() || undefined : undefined
    if (livello === "sotto" && (!macroId || !d.reparti.some((r) => r.id === macroId && r.livello === "macro"))) {
      throw Object.assign(new Error("Sotto-reparto: scegli la macro-area"), { status: 400 })
    }
    const parent = macroId ? d.reparti.find((r) => r.id === macroId) : undefined
    const row: AmmReparto = {
      id,
      codice: (body.codice ?? cur?.codice ?? nome).trim().toLowerCase().replace(/\s+/g, "-"),
      nome,
      tipo: body.tipo === "struttura" || body.tipo === "operativo" ? body.tipo : (parent?.tipo ?? cur?.tipo ?? "operativo"),
      livello,
      macroId,
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
  findDuplicate(fornitore: string, numeroDocumento: string, dataDocumento: string, totale: number): AmmSpesa | undefined {
    const f = fornitore.trim().toLowerCase()
    const n = numeroDocumento.trim().toLowerCase()
    const t = Math.round(totale * 100) / 100
    return load().spese.find(
      (s) =>
        s.fornitore.trim().toLowerCase() === f &&
        s.dataDocumento === dataDocumento &&
        Math.abs(s.totale - t) < 0.01 &&
        (n ? s.numeroDocumento.trim().toLowerCase() === n : true)
    )
  },
  upsertSpesa(body: Partial<AmmSpesa> & { fornitore: string; dataDocumento: string; totale: number; quote: AmmQuota[] }): AmmSpesa {
    const d = load()
    const dataDocumento = String(body.dataDocumento ?? "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDocumento)) throw Object.assign(new Error("Data documento non valida"), { status: 400 })
    const totale = Number(String(body.totale).replace(",", "."))
    if (!Number.isFinite(totale) || totale < 0) throw Object.assign(new Error("Importo non valido"), { status: 400 })
    const quote = (body.quote ?? []).map((q) => ({
      repartoId: remapRepartoId(String(q.repartoId ?? "").trim()),
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
    const origine: AmmOrigine = body.origine === "ocr" || body.origine === "excel" || body.origine === "manuale" ? body.origine : (cur?.origine ?? "manuale")
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
      origine,
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
  listBuste(): AmmBusta[] {
    return load().buste.slice().sort((a, b) => b.mese.localeCompare(a.mese) || a.nominativo.localeCompare(b.nominativo, "it"))
  },
  getBusta(id: string): AmmBusta | undefined {
    return load().buste.find((b) => b.id === id)
  },
  findBustaDup(nominativo: string, mese: string, totale: number): AmmBusta | undefined {
    const n = nominativo.trim().toLowerCase()
    const t = Math.round(totale * 100) / 100
    return load().buste.find(
      (b) => b.nominativo.trim().toLowerCase() === n && b.mese === mese && Math.abs(b.totale - t) < 0.01
    )
  },
  upsertBusta(body: Partial<AmmBusta> & { nominativo: string; mese: string; totale: number; quote: AmmQuota[] }): AmmBusta {
    const d = load()
    const mese = String(body.mese ?? "").slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(mese)) throw Object.assign(new Error("Mese non valido"), { status: 400 })
    const totale = Number(String(body.totale).replace(",", "."))
    if (!Number.isFinite(totale) || totale < 0) throw Object.assign(new Error("Importo non valido"), { status: 400 })
    const quote = (body.quote ?? []).map((q) => ({
      repartoId: remapRepartoId(String(q.repartoId ?? "").trim()),
      percentuale: Number(String(q.percentuale).replace(",", ".")),
    }))
    if (!quoteValide(quote)) throw Object.assign(new Error("La ripartizione deve sommare 100%"), { status: 400 })
    const ids = new Set(d.reparti.map((r) => r.id))
    for (const q of quote) {
      if (!ids.has(q.repartoId)) throw Object.assign(new Error("Reparto sconosciuto nella ripartizione"), { status: 400 })
    }
    const nominativo = body.nominativo.trim()
    if (!nominativo) throw Object.assign(new Error("Nominativo obbligatorio"), { status: 400 })
    const id = String(body.id ?? "").trim() || randomUUID()
    const cur = d.buste.find((b) => b.id === id)
    const row: AmmBusta = {
      id,
      nominativo,
      mese,
      descrizione: String(body.descrizione ?? cur?.descrizione ?? "").trim(),
      totale: Math.round(totale * 100) / 100,
      quote,
      origine: body.origine === "mastrino" || body.origine === "manuale" ? body.origine : (cur?.origine ?? "manuale"),
      createdAt: cur?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    }
    if (cur) Object.assign(cur, row)
    else d.buste.push(row)
    save(d)
    return row
  },
  deleteBusta(id: string): void {
    const d = load()
    d.buste = d.buste.filter((b) => b.id !== id)
    save(d)
  },
}
