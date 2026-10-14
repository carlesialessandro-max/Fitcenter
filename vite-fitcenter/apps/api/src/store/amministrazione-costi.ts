import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { getDataDir, readJson, writeJson } from "./persist.js"
import {
  FORNITORI_QUOTE_SEED,
  isQuoteDumpDefault,
  normFornitoreKey,
  resolveQuoteFornitore,
  seedFornitore,
  type AmmStagionaleFornitore,
} from "../services/amministrazione-fornitori-quote.js"

export type AmmRepartoTipo = "operativo" | "struttura"
export type AmmLivello = "macro" | "sotto"
export type AmmTipoCosto = "fisso" | "variabile"
export type AmmOrigine = "manuale" | "ocr" | "excel" | "fattureincloud"
export type AmmBustaOrigine = "manuale" | "mastrino" | "pdf"
export type AmmCollabTipo = "sportivo" | "gestionale"
export type AmmCollabOrigine = "riepilogo" | "manuale" | "excel"

export type AmmCollabAudit = {
  id: string
  at: string
  user: string
  nominativo: string
  mese: string
  da: number | null
  a: number | null
  azione: "importo" | "aggiunto" | "eliminato"
}

export type AmmCollabRimanenza = {
  nominativo: string
  anno: number
  importo: number
  updatedAt: string
  modificatoDa?: string
}

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

export type AmmFornitoreQuote = {
  key: string
  ragioneSociale: string
  quote: AmmQuota[]
  stagionale?: AmmStagionaleFornitore
  updatedAt: string
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
  /** true = ripartizione solo di questo documento, non diventa la regola del fornitore. */
  quoteEccezione?: boolean
  pathPdf?: string
  origine: AmmOrigine
  ficId?: number
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

export type AmmCollaboratore = {
  id: string
  nominativo: string
  mese: string
  descrizione: string
  totale: number
  tipo: AmmCollabTipo
  quote: AmmQuota[]
  origine: AmmCollabOrigine
  modificatoDa?: string
  createdAt: string
  updatedAt: string
}

type FileShape = {
  reparti: AmmReparto[]
  fornitori: AmmFornitore[]
  fornitoriQuote: AmmFornitoreQuote[]
  spese: AmmSpesa[]
  buste: AmmBusta[]
  collaboratori: AmmCollaboratore[]
  collaboratoriAudit: AmmCollabAudit[]
  collaboratoriRimanenze: AmmCollabRimanenza[]
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
  return {
    reparti: REPARTI_SEED.map((r) => ({ ...r })),
    fornitori: [],
    fornitoriQuote: [],
    spese: [],
    buste: [],
    collaboratori: [],
    collaboratoriAudit: [],
    collaboratoriRimanenze: [],
  }
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
    const origine: AmmOrigine =
      s.origine === "ocr" || s.origine === "excel" || s.origine === "fattureincloud" ? s.origine : "manuale"
    const ficId = Number(s.ficId)
    return {
      ...s,
      quote: (s.quote ?? []).map((q) => ({
        repartoId: remapRepartoId(String(q.repartoId ?? "")),
        percentuale: Number(q.percentuale) || 0,
      })),
      quoteEccezione: s.quoteEccezione === true ? true : undefined,
      origine,
      ficId: Number.isFinite(ficId) && ficId > 0 ? ficId : undefined,
    }
  })
  const buste: AmmBusta[] = (Array.isArray(raw.buste) ? raw.buste : []).map((b) => ({
    ...b,
    mese: String(b.mese ?? "").slice(0, 7),
    quote: (b.quote ?? []).map((q) => ({
      repartoId: remapRepartoId(String(q.repartoId ?? "")),
      percentuale: Number(q.percentuale) || 0,
    })),
    origine: b.origine === "mastrino" || b.origine === "pdf" ? b.origine : "manuale",
  }))
  const collaboratori: AmmCollaboratore[] = (Array.isArray(raw.collaboratori) ? raw.collaboratori : []).map((c) => ({
    ...c,
    mese: String(c.mese ?? "").slice(0, 7),
    quote: (c.quote ?? []).map((q) => ({
      repartoId: remapRepartoId(String(q.repartoId ?? "")),
      percentuale: Number(q.percentuale) || 0,
    })),
    tipo: c.tipo === "gestionale" ? "gestionale" : "sportivo",
    origine: c.origine === "manuale" || c.origine === "excel" ? c.origine : "riepilogo",
    modificatoDa: String(c.modificatoDa ?? "").trim() || undefined,
  }))
  const collaboratoriAudit: AmmCollabAudit[] = (Array.isArray(raw.collaboratoriAudit) ? raw.collaboratoriAudit : [])
    .map((a) => {
      const azione: AmmCollabAudit["azione"] =
        a.azione === "aggiunto" || a.azione === "eliminato" ? a.azione : "importo"
      return {
        id: String(a.id ?? ""),
        at: String(a.at ?? ""),
        user: String(a.user ?? ""),
        nominativo: String(a.nominativo ?? ""),
        mese: String(a.mese ?? "").slice(0, 7),
        da: a.da == null ? null : Number(a.da),
        a: a.a == null ? null : Number(a.a),
        azione,
      }
    })
    .filter((a) => a.id && a.at)
  const collaboratoriRimanenze: AmmCollabRimanenza[] = (
    Array.isArray(raw.collaboratoriRimanenze) ? raw.collaboratoriRimanenze : []
  )
    .map((r) => ({
      nominativo: String(r.nominativo ?? "").trim(),
      anno: Number(r.anno),
      importo: Math.round((Number(r.importo) || 0) * 100) / 100,
      updatedAt: String(r.updatedAt ?? ""),
      modificatoDa: String(r.modificatoDa ?? "").trim() || undefined,
    }))
    .filter((r) => r.nominativo && Number.isFinite(r.anno) && r.anno >= 1990 && r.importo > 0)
  let fornitoriQuote: AmmFornitoreQuote[] = (Array.isArray(raw.fornitoriQuote) ? raw.fornitoriQuote : [])
    .map((r) => ({
      key: normFornitoreKey(String(r.key ?? r.ragioneSociale ?? "")),
      ragioneSociale: String(r.ragioneSociale ?? "").trim(),
      quote: (r.quote ?? []).map((q) => ({
        repartoId: remapRepartoId(String(q.repartoId ?? "")),
        percentuale: Number(q.percentuale) || 0,
      })),
      stagionale: r.stagionale === "piscina-estate" ? ("piscina-estate" as const) : undefined,
      updatedAt: String(r.updatedAt ?? ""),
    }))
    .filter((r) => r.key && r.quote.length && !isQuoteDumpDefault(r.quote))
  if (!fornitoriQuote.length) {
    const latest = new Map<string, AmmFornitoreQuote>()
    for (const s of spese) {
      const key = normFornitoreKey(s.fornitore)
      if (!key || !s.quote?.length || isQuoteDumpDefault(s.quote) || s.quoteEccezione) continue
      const prev = latest.get(key)
      if (!prev || String(s.updatedAt ?? "") > prev.updatedAt) {
        latest.set(key, {
          key,
          ragioneSociale: s.fornitore,
          quote: s.quote.map((q) => ({ ...q })),
          updatedAt: String(s.updatedAt ?? s.createdAt ?? ""),
        })
      }
    }
    fornitoriQuote = [...latest.values()]
  }
  return {
    reparti: [...byId.values()].filter((r) => SEED_IDS.has(r.id) || (r.livello === "sotto" && r.macroId && SEED_IDS.has(r.macroId))),
    fornitori: Array.isArray(raw.fornitori) ? raw.fornitori : [],
    fornitoriQuote,
    spese,
    buste,
    collaboratori,
    collaboratoriAudit,
    collaboratoriRimanenze,
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
  rememberFornitoreQuote(nome: string, quote: AmmQuota[]): void {
    const key = normFornitoreKey(nome)
    if (!key || !quoteValide(quote) || isQuoteDumpDefault(quote)) return
    if (seedFornitore(nome)?.stagionale) return
    const d = load()
    const row: AmmFornitoreQuote = {
      key,
      ragioneSociale: nome.trim(),
      quote: quote.map((q) => ({ repartoId: remapRepartoId(q.repartoId), percentuale: Number(q.percentuale) })),
      updatedAt: nowIso(),
    }
    const i = d.fornitoriQuote.findIndex((x) => x.key === key)
    if (i >= 0) d.fornitoriQuote[i] = row
    else d.fornitoriQuote.push(row)
    save(d)
  },
  rememberedQuote(nome: string): AmmQuota[] | null {
    const key = normFornitoreKey(nome)
    if (!key) return null
    const d = load()
    const exact = d.fornitoriQuote.find((x) => x.key === key)
    if (exact?.quote?.length && !isQuoteDumpDefault(exact.quote)) return exact.quote.map((q) => ({ ...q }))
    const compactNome = key.replace(/ /g, "")
    const fuzzy = d.fornitoriQuote.find((x) => {
      const k = x.key.replace(/ /g, "")
      return k && (compactNome.includes(k) || k.includes(compactNome))
    })
    if (fuzzy?.quote?.length && !isQuoteDumpDefault(fuzzy.quote)) return fuzzy.quote.map((q) => ({ ...q }))
    return null
  },
  /** Spese finite su «Altri costi» dallo scarico: applica i default fornitore (Italpower → utenze, ecc.). */
  riapplicaQuoteFornitoriNoti(): number {
    const d = load()
    let n = 0
    for (const s of d.spese) {
      if (!isQuoteDumpDefault(s.quote)) continue
      const q = resolveQuoteFornitore({ nome: s.fornitore, dataDocumento: s.dataDocumento, remembered: null })
      if (!q?.length || isQuoteDumpDefault(q)) continue
      s.quote = q.map((x) => ({ ...x }))
      s.updatedAt = nowIso()
      n += 1
    }
    const before = d.fornitoriQuote.length
    d.fornitoriQuote = d.fornitoriQuote.filter((r) => !isQuoteDumpDefault(r.quote))
    if (n || d.fornitoriQuote.length !== before) save(d)
    return n
  },
  quoteForFornitore(nome: string, dataDocumento: string, fallbackRepartoId?: string): AmmQuota[] {
    const resolved = resolveQuoteFornitore({
      nome,
      dataDocumento,
      remembered: this.rememberedQuote(nome),
    })
    if (resolved?.length) return resolved
    const fb = String(fallbackRepartoId ?? "").trim() || "altri-costi"
    return [{ repartoId: fb, percentuale: 100 }]
  },
  listFornitoriQuoteMeta(): {
    chiave: string
    ragioneSociale: string
    quote: AmmQuota[]
    stagionale?: AmmStagionaleFornitore
  }[] {
    const remembered = load().fornitoriQuote
    const out: {
      chiave: string
      ragioneSociale: string
      quote: AmmQuota[]
      stagionale?: AmmStagionaleFornitore
    }[] = []
    const seen = new Set<string>()
    const mark = (k: string) => {
      const c = k.replace(/ /g, "")
      if (!c || seen.has(c)) return false
      seen.add(c)
      return true
    }
    for (const r of remembered) {
      if (!r.key || !mark(r.key)) continue
      out.push({
        chiave: r.key,
        ragioneSociale: r.ragioneSociale,
        quote: r.quote.map((q) => ({ ...q })),
        stagionale: r.stagionale,
      })
    }
    for (const s of FORNITORI_QUOTE_SEED) {
      const chiave = normFornitoreKey(s.match[0] ?? s.label)
      if (!chiave || !mark(chiave)) continue
      out.push({
        chiave,
        ragioneSociale: s.label,
        quote: s.quote.map((q) => ({ ...q })),
        stagionale: s.stagionale,
      })
    }
    return out
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
  findByFicId(ficId: number): AmmSpesa | undefined {
    if (!Number.isFinite(ficId) || ficId <= 0) return undefined
    return load().spese.find((s) => s.ficId === ficId)
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
  upsertSpesa(
    body: Partial<AmmSpesa> & {
      fornitore: string
      dataDocumento: string
      totale: number
      quote: AmmQuota[]
      rememberQuote?: boolean
    }
  ): AmmSpesa {
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
    const origine: AmmOrigine =
      body.origine === "ocr" || body.origine === "excel" || body.origine === "manuale" || body.origine === "fattureincloud"
        ? body.origine
        : (cur?.origine ?? "manuale")
    const ficNum = Number(body.ficId ?? cur?.ficId)
    const eccezione = body.rememberQuote === false || body.quoteEccezione === true
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
      quoteEccezione: eccezione ? true : undefined,
      pathPdf: body.pathPdf ?? cur?.pathPdf,
      origine,
      ficId: Number.isFinite(ficNum) && ficNum > 0 ? ficNum : undefined,
      createdAt: cur?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    }
    if (cur) {
      Object.assign(cur, row)
      if (!eccezione) delete cur.quoteEccezione
    } else d.spese.push(row)
    save(d)
    if (!eccezione) this.rememberFornitoreQuote(fornitore, quote)
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
      origine:
        body.origine === "mastrino" || body.origine === "manuale" || body.origine === "pdf"
          ? body.origine
          : (cur?.origine ?? "manuale"),
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
  listCollaboratori(): AmmCollaboratore[] {
    return load()
      .collaboratori.slice()
      .sort((a, b) => b.mese.localeCompare(a.mese) || a.nominativo.localeCompare(b.nominativo, "it"))
  },
  findCollabDup(nominativo: string, mese: string, totale: number): AmmCollaboratore | undefined {
    const n = nominativo.trim().toLowerCase()
    const t = Math.round(totale * 100) / 100
    return load().collaboratori.find(
      (c) => c.nominativo.trim().toLowerCase() === n && c.mese === mese && Math.abs(c.totale - t) < 0.01
    )
  },
  upsertCollaboratore(
    body: Partial<AmmCollaboratore> & { nominativo: string; mese: string; totale: number; quote: AmmQuota[] }
  ): AmmCollaboratore {
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
    const cur = d.collaboratori.find((c) => c.id === id)
    const row: AmmCollaboratore = {
      id,
      nominativo,
      mese,
      descrizione: String(body.descrizione ?? cur?.descrizione ?? "").trim(),
      totale: Math.round(totale * 100) / 100,
      tipo: body.tipo === "gestionale" || cur?.tipo === "gestionale" ? "gestionale" : "sportivo",
      quote,
      origine:
        body.origine === "manuale" || body.origine === "riepilogo" || body.origine === "excel"
          ? body.origine
          : (cur?.origine ?? "riepilogo"),
      modificatoDa: (body.modificatoDa ?? cur?.modificatoDa)?.trim() || undefined,
      createdAt: cur?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    }
    if (cur) Object.assign(cur, row)
    else d.collaboratori.push(row)
    save(d)
    return row
  },
  deleteCollaboratore(id: string): void {
    const d = load()
    d.collaboratori = d.collaboratori.filter((c) => c.id !== id)
    save(d)
  },
  listCollaboratoriAudit(limit = 80): AmmCollabAudit[] {
    return load()
      .collaboratoriAudit.slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, Math.max(1, Math.min(limit, 300)))
  },
  setImportoCollaboratore(body: {
    nominativo: string
    mese: string
    totale: number
    tipo?: AmmCollabTipo
    user: string
  }): AmmCollaboratore {
    const nominativo = body.nominativo.trim()
    const mese = String(body.mese ?? "").slice(0, 7)
    const totale = Number(String(body.totale).replace(",", "."))
    if (!nominativo) throw Object.assign(new Error("Nominativo obbligatorio"), { status: 400 })
    if (!/^\d{4}-\d{2}$/.test(mese)) throw Object.assign(new Error("Mese non valido"), { status: 400 })
    if (!Number.isFinite(totale) || totale < 0) throw Object.assign(new Error("Importo non valido"), { status: 400 })
    const d = load()
    const key = nominativo.toLowerCase()
    const cur =
      d.collaboratori.find((c) => c.nominativo.trim().toLowerCase() === key && c.mese === mese) ??
      d.collaboratori.find((c) => c.nominativo.trim().toLowerCase() === key)
    const tipo: AmmCollabTipo =
      body.tipo === "gestionale" || body.tipo === "sportivo"
        ? body.tipo
        : (cur?.tipo === "gestionale" ? "gestionale" : "sportivo")
    const quote =
      d.collaboratori.find((c) => c.nominativo.trim().toLowerCase() === key && c.mese === mese)?.quote ??
      (tipo === "gestionale"
        ? [{ repartoId: "amministrazione-uffici", percentuale: 100 }]
        : [{ repartoId: "personale-condiviso", percentuale: 100 }])
    const same = d.collaboratori.find((c) => c.nominativo.trim().toLowerCase() === key && c.mese === mese)
    const prevTot = same ? same.totale : null
    const row = this.upsertCollaboratore({
      id: same?.id,
      nominativo,
      mese,
      totale: Math.round(totale * 100) / 100,
      tipo,
      quote,
      origine: "manuale",
      modificatoDa: body.user.trim() || undefined,
      descrizione: same?.descrizione ?? "",
    })
    const audit: AmmCollabAudit = {
      id: randomUUID(),
      at: nowIso(),
      user: body.user.trim() || "sconosciuto",
      nominativo,
      mese,
      da: prevTot,
      a: row.totale,
      azione: same ? "importo" : "aggiunto",
    }
    const d2 = load()
    d2.collaboratoriAudit = [audit, ...d2.collaboratoriAudit].slice(0, 400)
    save(d2)
    return row
  },
  /** Sostituisce tutto il mese: il riepilogo Mattonai è la fonte, libro paga e import precedenti non restano. */
  replaceCollaboratoriMese(
    mese: string,
    righe: (Partial<AmmCollaboratore> & { nominativo: string; totale: number; quote: AmmQuota[] })[]
  ): { inserite: number; sostituite: number } {
    if (!/^\d{4}-\d{2}$/.test(mese)) throw Object.assign(new Error("Mese non valido"), { status: 400 })
    const d = load()
    const prev = d.collaboratori.filter((c) => c.mese === mese)
    const prevQuote = new Map(prev.map((c) => [c.nominativo.trim().toLowerCase(), c.quote]))
    d.collaboratori = d.collaboratori.filter((c) => c.mese !== mese)
    save(d)
    let inserite = 0
    for (const raw of righe) {
      const nominativo = String(raw.nominativo ?? "").trim()
      const key = nominativo.toLowerCase()
      this.upsertCollaboratore({
        ...raw,
        nominativo,
        mese,
        quote: prevQuote.get(key) ?? raw.quote,
      })
      inserite += 1
    }
    return { inserite, sostituite: prev.length }
  },
  listRimanenze(anno: number): AmmCollabRimanenza[] {
    return load().collaboratoriRimanenze.filter((r) => r.anno === anno)
  },
  setRimanenzaCollaboratore(body: {
    nominativo: string
    anno: number
    importo: number
    user: string
  }): AmmCollabRimanenza | null {
    const nominativo = body.nominativo.trim()
    const anno = Number(body.anno)
    const importo = Math.round((Number(String(body.importo).replace(",", ".")) || 0) * 100) / 100
    if (!nominativo) throw Object.assign(new Error("Nominativo obbligatorio"), { status: 400 })
    if (!Number.isFinite(anno) || anno < 1990 || anno > 2100) {
      throw Object.assign(new Error("Anno non valido"), { status: 400 })
    }
    if (!Number.isFinite(importo) || importo < 0) throw Object.assign(new Error("Importo non valido"), { status: 400 })
    const d = load()
    const key = nominativo.toLowerCase()
    const prev = d.collaboratoriRimanenze.find((r) => r.nominativo.trim().toLowerCase() === key && r.anno === anno)
    d.collaboratoriRimanenze = d.collaboratoriRimanenze.filter(
      (r) => !(r.nominativo.trim().toLowerCase() === key && r.anno === anno)
    )
    const row: AmmCollabRimanenza | null =
      importo > 0
        ? {
            nominativo: prev?.nominativo ?? nominativo,
            anno,
            importo,
            updatedAt: nowIso(),
            modificatoDa: body.user.trim() || undefined,
          }
        : null
    if (row) d.collaboratoriRimanenze.push(row)
    const audit: AmmCollabAudit = {
      id: randomUUID(),
      at: nowIso(),
      user: body.user.trim() || "sconosciuto",
      nominativo,
      mese: String(anno),
      da: prev?.importo ?? null,
      a: row?.importo ?? 0,
      azione: "importo",
    }
    d.collaboratoriAudit = [audit, ...d.collaboratoriAudit].slice(0, 400)
    save(d)
    return row
  },
  /** Sostituisce l'anno del report COMP_SP (Excel REPORT GENERALE). */
  importCollaboratoriReport(
    anno: number,
    righe: { nominativo: string; mese: string; totale: number; tipo?: AmmCollabTipo }[],
    user: string,
    rimanenze: { nominativo: string; importo: number }[] = []
  ): { inserite: number; sostituite: number; nPersone: number } {
    if (!Number.isFinite(anno) || anno < 1990 || anno > 2100) {
      throw Object.assign(new Error("Anno non valido"), { status: 400 })
    }
    const prefix = `${anno}-`
    const d = load()
    const prev = d.collaboratori.filter((c) => c.mese.startsWith(prefix))
    const prevQuote = new Map(prev.map((c) => [c.nominativo.trim().toLowerCase(), c.quote]))
    d.collaboratori = d.collaboratori.filter((c) => !c.mese.startsWith(prefix))
    save(d)
    const persone = new Set<string>()
    let inserite = 0
    for (const raw of righe) {
      const nominativo = String(raw.nominativo ?? "").trim()
      const mese = String(raw.mese ?? "").slice(0, 7)
      const totale = Number(String(raw.totale ?? "").replace(",", "."))
      if (!nominativo || !/^\d{4}-\d{2}$/.test(mese) || !mese.startsWith(prefix)) continue
      if (!Number.isFinite(totale) || totale <= 0) continue
      const key = nominativo.toLowerCase()
      persone.add(key)
      const tipo: AmmCollabTipo = raw.tipo === "gestionale" ? "gestionale" : "sportivo"
      this.upsertCollaboratore({
        nominativo,
        mese,
        totale,
        tipo,
        origine: "excel",
        modificatoDa: user.trim() || undefined,
        quote: prevQuote.get(key) ?? [
          { repartoId: tipo === "gestionale" ? "amministrazione-uffici" : "personale-condiviso", percentuale: 100 },
        ],
      })
      inserite += 1
    }
    const d2 = load()
    d2.collaboratoriRimanenze = d2.collaboratoriRimanenze.filter((r) => r.anno !== anno)
    for (const raw of rimanenze) {
      const nominativo = String(raw.nominativo ?? "").trim()
      const importo = Math.round((Number(raw.importo) || 0) * 100) / 100
      if (!nominativo || importo <= 0) continue
      persone.add(nominativo.toLowerCase())
      d2.collaboratoriRimanenze.push({
        nominativo,
        anno,
        importo,
        updatedAt: nowIso(),
        modificatoDa: user.trim() || undefined,
      })
    }
    const audit: AmmCollabAudit = {
      id: randomUUID(),
      at: nowIso(),
      user: user.trim() || "sconosciuto",
      nominativo: "Import Excel",
      mese: String(anno),
      da: prev.length,
      a: inserite,
      azione: "importo",
    }
    d2.collaboratoriAudit = [audit, ...d2.collaboratoriAudit].slice(0, 400)
    save(d2)
    return { inserite, sostituite: prev.length, nPersone: persone.size }
  },
}
