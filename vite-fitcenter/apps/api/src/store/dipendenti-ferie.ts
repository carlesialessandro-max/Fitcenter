import { randomUUID } from "crypto"
import { readJson, writeJson } from "./persist.js"
import { stessoNominativo } from "../lib/nominativo-match.js"
import { isNominativoPersona } from "../services/amministrazione-ferie-pdf.js"

export type FerieTipo = "ferie" | "permessi"

export type FerieSaldo = {
  nominativo: string
  mese: string
  ferieResidue: number
  ferieAnnoPrec?: number
  ferieGodute?: number
  ferieMaturate?: number
  permessiResidue?: number
  unita?: "h" | "gg"
  fonte: "pdf" | "mastrino"
  updatedAt: string
}

export type FerieGiorno = {
  id: string
  nominativo: string
  data: string
  tipo: FerieTipo
  createdAt: string
}

type FileShape = {
  saldi: FerieSaldo[]
  giorni: FerieGiorno[]
}

const FILE = "dipendenti-ferie.json"

function nowIso(): string {
  return new Date().toISOString()
}

function empty(): FileShape {
  return { saldi: [], giorni: [] }
}

function load(): FileShape {
  const raw = readJson<Partial<FileShape>>(FILE, empty())
  return {
    saldi: Array.isArray(raw.saldi) ? raw.saldi : [],
    giorni: Array.isArray(raw.giorni) ? raw.giorni : [],
  }
}

function save(d: FileShape) {
  writeJson(FILE, d)
}

export const ferieStore = {
  listSaldi(): FerieSaldo[] {
    return load().saldi.slice()
  },
  listGiorni(anno?: number): FerieGiorno[] {
    const all = load().giorni.slice()
    if (!anno) return all.sort((a, b) => a.data.localeCompare(b.data))
    const prefix = `${anno}-`
    return all.filter((g) => g.data.startsWith(prefix)).sort((a, b) => a.data.localeCompare(b.data))
  },
  upsertSaldi(rows: Omit<FerieSaldo, "updatedAt">[]): FerieSaldo[] {
    const d = load()
    const out: FerieSaldo[] = []
    for (const row of rows) {
      const nominativo = String(row.nominativo ?? "").trim()
      const mese = String(row.mese ?? "").slice(0, 7)
      if (!nominativo || !/^\d{4}-\d{2}$/.test(mese)) continue
      const next: FerieSaldo = {
        nominativo,
        mese,
        ferieResidue: Math.round(Number(row.ferieResidue || 0) * 100) / 100,
        ferieAnnoPrec: row.ferieAnnoPrec != null ? Math.round(Number(row.ferieAnnoPrec) * 100) / 100 : undefined,
        ferieGodute: row.ferieGodute != null ? Math.round(Number(row.ferieGodute) * 100) / 100 : undefined,
        ferieMaturate: row.ferieMaturate != null ? Math.round(Number(row.ferieMaturate) * 100) / 100 : undefined,
        permessiResidue: row.permessiResidue != null ? Math.round(Number(row.permessiResidue) * 100) / 100 : undefined,
        unita: row.unita === "gg" ? "gg" : row.unita === "h" ? "h" : undefined,
        fonte: row.fonte === "mastrino" ? "mastrino" : "pdf",
        updatedAt: nowIso(),
      }
      const idx = d.saldi.findIndex((s) => stessoNominativo(s.nominativo, nominativo))
      if (idx >= 0) d.saldi[idx] = { ...next, nominativo: d.saldi[idx]!.nominativo }
      else d.saldi.push(next)
      out.push(next)
    }
    save(d)
    return out
  },
  replaceFonteSaldi(fonte: FerieSaldo["fonte"], rows: Omit<FerieSaldo, "updatedAt">[]): FerieSaldo[] {
    const d = load()
    d.saldi = d.saldi.filter((s) => s.fonte !== fonte)
    save(d)
    return ferieStore.upsertSaldi(rows)
  },
  pruneNonPersone(): void {
    const d = load()
    const next = d.saldi.filter((s) => isNominativoPersona(s.nominativo))
    if (next.length !== d.saldi.length) {
      d.saldi = next
      save(d)
    }
  },
  toggleGiorno(nominativo: string, data: string, tipo: FerieTipo): { giorno: FerieGiorno | null; removed: boolean } {
    const nome = nominativo.trim()
    const day = data.slice(0, 10)
    if (!nome || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw Object.assign(new Error("Nominativo o data non validi"), { status: 400 })
    }
    const d = load()
    const hit = d.giorni.find((g) => g.data === day && stessoNominativo(g.nominativo, nome))
    if (hit) {
      d.giorni = d.giorni.filter((g) => g.id !== hit.id)
      save(d)
      return { giorno: null, removed: true }
    }
    const row: FerieGiorno = { id: randomUUID(), nominativo: nome, data: day, tipo, createdAt: nowIso() }
    d.giorni.push(row)
    save(d)
    return { giorno: row, removed: false }
  },
  addPeriodo(nominativo: string, dal: string, al: string, tipo: FerieTipo): FerieGiorno[] {
    const nome = nominativo.trim()
    const a = dal.slice(0, 10)
    const b = al.slice(0, 10)
    if (!nome || !/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b < a) {
      throw Object.assign(new Error("Periodo non valido"), { status: 400 })
    }
    const d = load()
    const added: FerieGiorno[] = []
    let cur = a
    while (cur <= b) {
      const exists = d.giorni.some((g) => g.data === cur && stessoNominativo(g.nominativo, nome))
      if (!exists) {
        const row: FerieGiorno = { id: randomUUID(), nominativo: nome, data: cur, tipo, createdAt: nowIso() }
        d.giorni.push(row)
        added.push(row)
      }
      const [yy, mm, dd] = cur.split("-").map(Number)
      const dt = new Date(yy!, (mm ?? 1) - 1, (dd ?? 1) + 1)
      cur = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
    }
    save(d)
    return added
  },
  deleteGiorno(id: string): void {
    const d = load()
    const before = d.giorni.length
    d.giorni = d.giorni.filter((g) => g.id !== id)
    if (d.giorni.length === before) throw Object.assign(new Error("Giorno non trovato"), { status: 404 })
    save(d)
  },
}
