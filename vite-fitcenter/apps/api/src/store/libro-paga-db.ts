import crypto from "crypto"
import sql from "mssql"
import { getPool, getPoolWrite } from "../services/gestionale-sql.js"
import { readJson, writeJson } from "./persist.js"

const FILE = "libro-paga.json"

export type LpagaLivello = {
  id: string
  nome: string
  retribuzione: number
  fissa: boolean
  attivo: boolean
}

export type LpagaPersonale = {
  id: string
  nome: string
  iban?: string
  attivo: boolean
}

export type LpagaTurno = {
  id: string
  personaleId: string
  livelloId: string
  giorno: string
  quantita: number
  importo: number
  note?: string
  creatoDa: string
  createdAt: string
}

export type LpagaPresenza = {
  id: string
  turnoId: string
  valore: number
  controllatoDa: string
  controllatoAt: string
}

export type LpagaMensilita = {
  id: string
  personaleId: string
  mese: string
  bonifico: number
  nota?: string
  chiuso: boolean
}

type FileDb = {
  livelli: LpagaLivello[]
  personale: LpagaPersonale[]
  turni: LpagaTurno[]
  presenze: LpagaPresenza[]
  mensilita: LpagaMensilita[]
}

const EMPTY: FileDb = { livelli: [], personale: [], turni: [], presenze: [], mensilita: [] }

let sqlReady: boolean | null = null

function newId(): string {
  return crypto.randomUUID()
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."))
  return Number.isFinite(n) ? n : fallback
}

function bit(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true"
}

function ymd(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, "0")
    const d = String(v.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  const s = String(v ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

function iso(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString()
  const s = String(v ?? "").trim()
  return s || new Date().toISOString()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function monthBounds(mese: string): { from: string; to: string } {
  const [ys, ms] = mese.split("-")
  const y = Number(ys)
  const m = Number(ms)
  const from = `${y}-${String(m).padStart(2, "0")}-01`
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
  return { from, to: next }
}

function readFile(): FileDb {
  const raw = readJson<Partial<FileDb>>(FILE, EMPTY)
  return {
    livelli: Array.isArray(raw.livelli) ? raw.livelli : [],
    personale: Array.isArray(raw.personale) ? raw.personale : [],
    turni: Array.isArray(raw.turni) ? raw.turni : [],
    presenze: Array.isArray(raw.presenze) ? raw.presenze : [],
    mensilita: Array.isArray(raw.mensilita) ? raw.mensilita : [],
  }
}

function writeFile(db: FileDb): void {
  writeJson(FILE, db)
}

async function pool(): Promise<sql.ConnectionPool | null> {
  return (await getPoolWrite()) ?? (await getPool())
}

const DDL = `
IF OBJECT_ID(N'dbo.FcLibroPagaLivelli', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaLivelli (
  Id NVARCHAR(64) NOT NULL PRIMARY KEY,
  Nome NVARCHAR(200) NOT NULL,
  Retribuzione DECIMAL(10,2) NOT NULL,
  Fissa BIT NOT NULL CONSTRAINT DF_FcLpLiv_Fissa DEFAULT 0,
  Attivo BIT NOT NULL CONSTRAINT DF_FcLpLiv_Attivo DEFAULT 1
);
IF OBJECT_ID(N'dbo.FcLibroPagaPersonale', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaPersonale (
  Id NVARCHAR(64) NOT NULL PRIMARY KEY,
  Nome NVARCHAR(200) NOT NULL,
  Iban NVARCHAR(34) NULL,
  Attivo BIT NOT NULL CONSTRAINT DF_FcLpPer_Attivo DEFAULT 1
);
IF OBJECT_ID(N'dbo.FcLibroPagaTurni', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaTurni (
  Id NVARCHAR(64) NOT NULL PRIMARY KEY,
  PersonaleId NVARCHAR(64) NOT NULL,
  LivelloId NVARCHAR(64) NOT NULL,
  Giorno DATE NOT NULL,
  Quantita DECIMAL(10,2) NOT NULL,
  Importo DECIMAL(10,2) NOT NULL,
  Note NVARCHAR(500) NULL,
  CreatoDa NVARCHAR(120) NOT NULL,
  CreatedAt DATETIME2 NOT NULL
);
IF OBJECT_ID(N'dbo.FcLibroPagaPresenze', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FcLibroPagaPresenze (
    Id NVARCHAR(64) NOT NULL PRIMARY KEY,
    TurnoId NVARCHAR(64) NOT NULL,
    Valore DECIMAL(10,2) NOT NULL,
    ControllatoDa NVARCHAR(120) NOT NULL,
    ControllatoAt DATETIME2 NOT NULL
  );
  CREATE UNIQUE INDEX UX_FcLibroPagaPresenze_Turno ON dbo.FcLibroPagaPresenze(TurnoId);
END
IF OBJECT_ID(N'dbo.FcLibroPagaMensilita', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FcLibroPagaMensilita (
    Id NVARCHAR(64) NOT NULL PRIMARY KEY,
    PersonaleId NVARCHAR(64) NOT NULL,
    Mese CHAR(7) NOT NULL,
    Bonifico DECIMAL(10,2) NOT NULL,
    Nota NVARCHAR(500) NULL,
    Chiuso BIT NOT NULL CONSTRAINT DF_FcLpMen_Chiuso DEFAULT 0
  );
  CREATE UNIQUE INDEX UX_FcLibroPagaMensilita ON dbo.FcLibroPagaMensilita(PersonaleId, Mese);
END
`

export async function ensureLibroPagaStorage(): Promise<"sql" | "json"> {
  if (sqlReady === true) return "sql"
  if (sqlReady === false) return "json"
  try {
    const p = await pool()
    if (!p) {
      sqlReady = false
      return "json"
    }
    await p.request().query(DDL)
    sqlReady = true
    return "sql"
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    console.warn("[libro-paga] SQL non disponibile, uso file JSON:", msg)
    sqlReady = false
    return "json"
  }
}

function mapLivello(r: Record<string, unknown>): LpagaLivello {
  return {
    id: String(r.Id ?? r.id ?? ""),
    nome: String(r.Nome ?? r.nome ?? ""),
    retribuzione: num(r.Retribuzione ?? r.retribuzione),
    fissa: bit(r.Fissa ?? r.fissa),
    attivo: bit(r.Attivo ?? r.attivo),
  }
}

function mapPersonale(r: Record<string, unknown>): LpagaPersonale {
  const iban = String(r.Iban ?? r.iban ?? "").trim()
  return {
    id: String(r.Id ?? r.id ?? ""),
    nome: String(r.Nome ?? r.nome ?? ""),
    ...(iban ? { iban } : {}),
    attivo: bit(r.Attivo ?? r.attivo),
  }
}

function mapTurno(r: Record<string, unknown>): LpagaTurno {
  const note = String(r.Note ?? r.note ?? "").trim()
  return {
    id: String(r.Id ?? r.id ?? ""),
    personaleId: String(r.PersonaleId ?? r.personaleId ?? ""),
    livelloId: String(r.LivelloId ?? r.livelloId ?? ""),
    giorno: ymd(r.Giorno ?? r.giorno),
    quantita: num(r.Quantita ?? r.quantita),
    importo: num(r.Importo ?? r.importo),
    ...(note ? { note } : {}),
    creatoDa: String(r.CreatoDa ?? r.creatoDa ?? ""),
    createdAt: iso(r.CreatedAt ?? r.createdAt),
  }
}

function mapPresenza(r: Record<string, unknown>): LpagaPresenza {
  return {
    id: String(r.Id ?? r.id ?? ""),
    turnoId: String(r.TurnoId ?? r.turnoId ?? ""),
    valore: num(r.Valore ?? r.valore),
    controllatoDa: String(r.ControllatoDa ?? r.controllatoDa ?? ""),
    controllatoAt: iso(r.ControllatoAt ?? r.controllatoAt),
  }
}

function mapMensilita(r: Record<string, unknown>): LpagaMensilita {
  const nota = String(r.Nota ?? r.nota ?? "").trim()
  return {
    id: String(r.Id ?? r.id ?? ""),
    personaleId: String(r.PersonaleId ?? r.personaleId ?? ""),
    mese: String(r.Mese ?? r.mese ?? "").trim(),
    bonifico: num(r.Bonifico ?? r.bonifico),
    ...(nota ? { nota } : {}),
    chiuso: bit(r.Chiuso ?? r.chiuso),
  }
}

export async function listLivelli(): Promise<LpagaLivello[]> {
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) return readFile().livelli
    const r = await p.request().query("SELECT Id, Nome, Retribuzione, Fissa, Attivo FROM dbo.FcLibroPagaLivelli ORDER BY Nome")
    return (r.recordset as Record<string, unknown>[]).map(mapLivello)
  }
  return [...readFile().livelli].sort((a, b) => a.nome.localeCompare(b.nome, "it"))
}

export async function upsertLivello(input: {
  id?: string
  nome: string
  retribuzione: number
  fissa: boolean
  attivo: boolean
}): Promise<LpagaLivello> {
  const row: LpagaLivello = {
    id: input.id?.trim() || newId(),
    nome: input.nome.trim(),
    retribuzione: round2(input.retribuzione),
    fissa: Boolean(input.fissa),
    attivo: input.attivo !== false,
  }
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const req = p.request()
    req.input("Id", sql.NVarChar(64), row.id)
    req.input("Nome", sql.NVarChar(200), row.nome)
    req.input("Retribuzione", sql.Decimal(10, 2), row.retribuzione)
    req.input("Fissa", sql.Bit, row.fissa)
    req.input("Attivo", sql.Bit, row.attivo)
    await req.query(`
      MERGE dbo.FcLibroPagaLivelli AS t
      USING (SELECT @Id AS Id) AS s ON t.Id = s.Id
      WHEN MATCHED THEN UPDATE SET Nome=@Nome, Retribuzione=@Retribuzione, Fissa=@Fissa, Attivo=@Attivo
      WHEN NOT MATCHED THEN INSERT (Id, Nome, Retribuzione, Fissa, Attivo)
      VALUES (@Id, @Nome, @Retribuzione, @Fissa, @Attivo);
    `)
    return row
  }
  const db = readFile()
  const i = db.livelli.findIndex((x) => x.id === row.id)
  if (i >= 0) db.livelli[i] = row
  else db.livelli.push(row)
  writeFile(db)
  return row
}

export async function deleteLivello(id: string): Promise<void> {
  const turni = await listTurni()
  if (turni.some((t) => t.livelloId === id)) {
    throw Object.assign(new Error("Livello usato da turni esistenti"), { status: 409 })
  }
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const req = p.request()
    req.input("Id", sql.NVarChar(64), id)
    await req.query("DELETE FROM dbo.FcLibroPagaLivelli WHERE Id=@Id")
    return
  }
  const db = readFile()
  db.livelli = db.livelli.filter((x) => x.id !== id)
  writeFile(db)
}

export async function listPersonale(): Promise<LpagaPersonale[]> {
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) return readFile().personale
    const r = await p.request().query("SELECT Id, Nome, Iban, Attivo FROM dbo.FcLibroPagaPersonale ORDER BY Nome")
    return (r.recordset as Record<string, unknown>[]).map(mapPersonale)
  }
  return [...readFile().personale].sort((a, b) => a.nome.localeCompare(b.nome, "it"))
}

export async function upsertPersonale(input: {
  id?: string
  nome: string
  iban?: string
  attivo: boolean
}): Promise<LpagaPersonale> {
  const iban = (input.iban ?? "").trim()
  const row: LpagaPersonale = {
    id: input.id?.trim() || newId(),
    nome: input.nome.trim(),
    ...(iban ? { iban } : {}),
    attivo: input.attivo !== false,
  }
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const req = p.request()
    req.input("Id", sql.NVarChar(64), row.id)
    req.input("Nome", sql.NVarChar(200), row.nome)
    req.input("Iban", sql.NVarChar(34), iban || null)
    req.input("Attivo", sql.Bit, row.attivo)
    await req.query(`
      MERGE dbo.FcLibroPagaPersonale AS t
      USING (SELECT @Id AS Id) AS s ON t.Id = s.Id
      WHEN MATCHED THEN UPDATE SET Nome=@Nome, Iban=@Iban, Attivo=@Attivo
      WHEN NOT MATCHED THEN INSERT (Id, Nome, Iban, Attivo) VALUES (@Id, @Nome, @Iban, @Attivo);
    `)
    return row
  }
  const db = readFile()
  const i = db.personale.findIndex((x) => x.id === row.id)
  if (i >= 0) db.personale[i] = row
  else db.personale.push(row)
  writeFile(db)
  return row
}

export async function deletePersonale(id: string): Promise<void> {
  const turni = await listTurni()
  if (turni.some((t) => t.personaleId === id)) {
    throw Object.assign(new Error("Persona usata da turni esistenti"), { status: 409 })
  }
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const req = p.request()
    req.input("Id", sql.NVarChar(64), id)
    await req.query("DELETE FROM dbo.FcLibroPagaMensilita WHERE PersonaleId=@Id; DELETE FROM dbo.FcLibroPagaPersonale WHERE Id=@Id")
    return
  }
  const db = readFile()
  db.personale = db.personale.filter((x) => x.id !== id)
  db.mensilita = db.mensilita.filter((x) => x.personaleId !== id)
  writeFile(db)
}

export async function listTurni(mese?: string): Promise<LpagaTurno[]> {
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) return filterTurniFile(mese)
    const req = p.request()
    let q = `
      SELECT Id, PersonaleId, LivelloId, CONVERT(varchar(10), Giorno, 23) AS Giorno,
             Quantita, Importo, Note, CreatoDa, CreatedAt
      FROM dbo.FcLibroPagaTurni
    `
    if (mese && /^\d{4}-\d{2}$/.test(mese)) {
      const { from, to } = monthBounds(mese)
      req.input("From", sql.Date, from)
      req.input("To", sql.Date, to)
      q += " WHERE Giorno >= @From AND Giorno < @To"
    }
    q += " ORDER BY Giorno DESC, CreatedAt DESC"
    const r = await req.query(q)
    return (r.recordset as Record<string, unknown>[]).map(mapTurno)
  }
  return filterTurniFile(mese)
}

function filterTurniFile(mese?: string): LpagaTurno[] {
  const list = [...readFile().turni]
  const filtered =
    mese && /^\d{4}-\d{2}$/.test(mese) ? list.filter((t) => t.giorno.startsWith(mese)) : list
  return filtered.sort((a, b) => (a.giorno < b.giorno ? 1 : a.giorno > b.giorno ? -1 : 0))
}

export function calcolaImporto(livello: LpagaLivello, quantita: number): number {
  if (livello.fissa) return round2(livello.retribuzione)
  return round2(quantita * livello.retribuzione)
}

export async function insertTurno(input: {
  personaleId: string
  livelloId: string
  giorno: string
  quantita: number
  note?: string
  creatoDa: string
}): Promise<LpagaTurno> {
  const livelli = await listLivelli()
  const livello = livelli.find((x) => x.id === input.livelloId)
  if (!livello) throw Object.assign(new Error("Livello non trovato"), { status: 400 })
  const personale = (await listPersonale()).find((x) => x.id === input.personaleId)
  if (!personale) throw Object.assign(new Error("Persona non trovata"), { status: 400 })
  const row: LpagaTurno = {
    id: newId(),
    personaleId: input.personaleId,
    livelloId: input.livelloId,
    giorno: input.giorno,
    quantita: round2(input.quantita),
    importo: calcolaImporto(livello, input.quantita),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    creatoDa: input.creatoDa,
    createdAt: new Date().toISOString(),
  }
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const req = p.request()
    req.input("Id", sql.NVarChar(64), row.id)
    req.input("PersonaleId", sql.NVarChar(64), row.personaleId)
    req.input("LivelloId", sql.NVarChar(64), row.livelloId)
    req.input("Giorno", sql.Date, row.giorno)
    req.input("Quantita", sql.Decimal(10, 2), row.quantita)
    req.input("Importo", sql.Decimal(10, 2), row.importo)
    req.input("Note", sql.NVarChar(500), row.note ?? null)
    req.input("CreatoDa", sql.NVarChar(120), row.creatoDa)
    req.input("CreatedAt", sql.DateTime2, new Date(row.createdAt))
    await req.query(`
      INSERT INTO dbo.FcLibroPagaTurni (Id, PersonaleId, LivelloId, Giorno, Quantita, Importo, Note, CreatoDa, CreatedAt)
      VALUES (@Id, @PersonaleId, @LivelloId, @Giorno, @Quantita, @Importo, @Note, @CreatoDa, @CreatedAt)
    `)
    return row
  }
  const db = readFile()
  db.turni.push(row)
  writeFile(db)
  return row
}

export async function deleteTurno(id: string): Promise<void> {
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const req = p.request()
    req.input("Id", sql.NVarChar(64), id)
    await req.query("DELETE FROM dbo.FcLibroPagaPresenze WHERE TurnoId=@Id; DELETE FROM dbo.FcLibroPagaTurni WHERE Id=@Id")
    return
  }
  const db = readFile()
  db.turni = db.turni.filter((x) => x.id !== id)
  db.presenze = db.presenze.filter((x) => x.turnoId !== id)
  writeFile(db)
}

export async function listPresenze(turnoIds?: string[]): Promise<LpagaPresenza[]> {
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) return filterPresenzeFile(turnoIds)
    const r = await p.request().query(
      "SELECT Id, TurnoId, Valore, ControllatoDa, ControllatoAt FROM dbo.FcLibroPagaPresenze"
    )
    const all = (r.recordset as Record<string, unknown>[]).map(mapPresenza)
    if (!turnoIds) return all
    const set = new Set(turnoIds)
    return all.filter((x) => set.has(x.turnoId))
  }
  return filterPresenzeFile(turnoIds)
}

function filterPresenzeFile(turnoIds?: string[]): LpagaPresenza[] {
  const all = readFile().presenze
  if (!turnoIds) return all
  const set = new Set(turnoIds)
  return all.filter((x) => set.has(x.turnoId))
}

export async function upsertPresenza(input: {
  turnoId: string
  valore: number
  controllatoDa: string
}): Promise<LpagaPresenza> {
  const existing = (await listPresenze([input.turnoId]))[0]
  const row: LpagaPresenza = {
    id: existing?.id || newId(),
    turnoId: input.turnoId,
    valore: round2(input.valore),
    controllatoDa: input.controllatoDa,
    controllatoAt: new Date().toISOString(),
  }
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const check = p.request()
    check.input("Id", sql.NVarChar(64), input.turnoId)
    const found = await check.query("SELECT Id FROM dbo.FcLibroPagaTurni WHERE Id=@Id")
    if (!found.recordset.length) throw Object.assign(new Error("Turno non trovato"), { status: 404 })
    const req = p.request()
    req.input("Id", sql.NVarChar(64), row.id)
    req.input("TurnoId", sql.NVarChar(64), row.turnoId)
    req.input("Valore", sql.Decimal(10, 2), row.valore)
    req.input("ControllatoDa", sql.NVarChar(120), row.controllatoDa)
    req.input("ControllatoAt", sql.DateTime2, new Date(row.controllatoAt))
    await req.query(`
      MERGE dbo.FcLibroPagaPresenze AS t
      USING (SELECT @TurnoId AS TurnoId) AS s ON t.TurnoId = s.TurnoId
      WHEN MATCHED THEN UPDATE SET Valore=@Valore, ControllatoDa=@ControllatoDa, ControllatoAt=@ControllatoAt
      WHEN NOT MATCHED THEN INSERT (Id, TurnoId, Valore, ControllatoDa, ControllatoAt)
      VALUES (@Id, @TurnoId, @Valore, @ControllatoDa, @ControllatoAt);
    `)
    return row
  }
  const db = readFile()
  if (!db.turni.some((t) => t.id === input.turnoId)) {
    throw Object.assign(new Error("Turno non trovato"), { status: 404 })
  }
  const i = db.presenze.findIndex((x) => x.turnoId === row.turnoId)
  if (i >= 0) db.presenze[i] = { ...row, id: db.presenze[i]!.id }
  else db.presenze.push(row)
  writeFile(db)
  return i >= 0 ? db.presenze[i]! : row
}

export async function listMensilita(mese: string): Promise<LpagaMensilita[]> {
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) return readFile().mensilita.filter((x) => x.mese === mese)
    const req = p.request()
    req.input("Mese", sql.Char(7), mese)
    const r = await req.query(
      "SELECT Id, PersonaleId, Mese, Bonifico, Nota, Chiuso FROM dbo.FcLibroPagaMensilita WHERE Mese=@Mese"
    )
    return (r.recordset as Record<string, unknown>[]).map(mapMensilita)
  }
  return readFile().mensilita.filter((x) => x.mese === mese)
}

export async function upsertMensilita(input: {
  personaleId: string
  mese: string
  bonifico: number
  nota?: string
  chiuso: boolean
}): Promise<LpagaMensilita> {
  const existing = (await listMensilita(input.mese)).find((x) => x.personaleId === input.personaleId)
  const row: LpagaMensilita = {
    id: existing?.id || newId(),
    personaleId: input.personaleId,
    mese: input.mese,
    bonifico: round2(input.bonifico),
    ...(input.nota?.trim() ? { nota: input.nota.trim() } : {}),
    chiuso: Boolean(input.chiuso),
  }
  if ((await ensureLibroPagaStorage()) === "sql") {
    const p = await pool()
    if (!p) throw new Error("SQL non disponibile")
    const req = p.request()
    req.input("Id", sql.NVarChar(64), row.id)
    req.input("PersonaleId", sql.NVarChar(64), row.personaleId)
    req.input("Mese", sql.Char(7), row.mese)
    req.input("Bonifico", sql.Decimal(10, 2), row.bonifico)
    req.input("Nota", sql.NVarChar(500), row.nota ?? null)
    req.input("Chiuso", sql.Bit, row.chiuso)
    await req.query(`
      MERGE dbo.FcLibroPagaMensilita AS t
      USING (SELECT @PersonaleId AS PersonaleId, @Mese AS Mese) AS s
      ON t.PersonaleId = s.PersonaleId AND t.Mese = s.Mese
      WHEN MATCHED THEN UPDATE SET Bonifico=@Bonifico, Nota=@Nota, Chiuso=@Chiuso
      WHEN NOT MATCHED THEN INSERT (Id, PersonaleId, Mese, Bonifico, Nota, Chiuso)
      VALUES (@Id, @PersonaleId, @Mese, @Bonifico, @Nota, @Chiuso);
    `)
    return row
  }
  const db = readFile()
  const i = db.mensilita.findIndex((x) => x.personaleId === row.personaleId && x.mese === row.mese)
  if (i >= 0) db.mensilita[i] = { ...row, id: db.mensilita[i]!.id }
  else db.mensilita.push(row)
  writeFile(db)
  return i >= 0 ? db.mensilita[i]! : row
}
