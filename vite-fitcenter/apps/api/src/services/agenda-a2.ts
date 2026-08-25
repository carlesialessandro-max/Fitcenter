/**
 * Agenda consulenti TeamSystem (A2Appuntamenti / A2Occupazioni / A2Iscrizioni).
 * Validato con INSERT di test (FitCenter AI).
 */
import sql from "mssql"
import { getPool, getPoolWrite } from "./gestionale-sql.js"

const IDA2_IMPEGNO_CONSULENZA = 51
const IDA2_RELAZIONE = 52
const SLOT_MINUTES = 30

export type ConsulenteAgenda = {
  nome: string
  idRisorsa: number
  idOperatore: number
}

/** Risorse agenda APPUNTAMENTI CONSULENTI (adulti). */
export const CONSULENTI_AGENDA: ConsulenteAgenda[] = [
  { nome: "Carmen Severino", idRisorsa: 28, idOperatore: 336 },
  { nome: "Serena Del Prete", idRisorsa: 57, idOperatore: 348 },
  { nome: "Ombretta Zenoni", idRisorsa: 76, idOperatore: 352 },
]

/** Solo pool WRITE (stesso di blocco prenotazioni). Mai fallback su lettura. */
async function poolRw(): Promise<sql.ConnectionPool | null> {
  return await getPoolWrite()
}

function phoneDigits(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "")
}

/** Confronta numeri IT (con/senza 39). */
export function phonesMatch(a: string, b: string): boolean {
  let x = phoneDigits(a)
  let y = phoneDigits(b)
  if (x.startsWith("39") && x.length > 10) x = x.slice(2)
  if (y.startsWith("39") && y.length > 10) y = y.slice(2)
  if (x.startsWith("0")) x = x.slice(1)
  if (y.startsWith("0")) y = y.slice(1)
  if (!x || !y) return false
  return x === y || x.endsWith(y) || y.endsWith(x)
}

function toSqlDateTimeRome(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`
}

async function a2IscrizioniHasServizioCol(p: sql.ConnectionPool): Promise<boolean> {
  try {
    const r = await p.request().query(`
      SELECT 1 AS ok
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.A2Iscrizioni') AND name = 'IDA2Servizio'
    `)
    return (r.recordset?.length ?? 0) > 0
  } catch {
    return false
  }
}

function romeDateParts(d: Date): { y: number; m: number; day: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0")
  return { y: get("year"), m: get("month"), day: get("day"), h: get("hour"), min: get("minute"), s: get("second") }
}

function sqlErrDetail(e: unknown): string {
  const any = e as { message?: string; number?: number; code?: string; originalError?: { info?: { message?: string; number?: number } } }
  const info = any?.originalError?.info
  const msg = info?.message ?? any?.message ?? String(e)
  const num = info?.number ?? any?.number
  return num != null ? `SQL ${num}: ${msg}` : msg
}

export async function createConsulenzaAppuntamento(params: {
  idUtente: number
  inizio: Date
  consulente: ConsulenteAgenda
  note?: string
}): Promise<{ idAppuntamento: number; idOccupazione?: number }> {
  const p = await poolRw()
  if (!p) {
    throw new Error(
      "SQL write non configurato: imposta SQL_CONNECTION_STRING_WRITE (stessa usata per blocco prenotazioni) e GRANT INSERT su A2Appuntamenti/A2Occupazioni/A2Iscrizioni."
    )
  }

  const fine = new Date(params.inizio.getTime() + SLOT_MINUTES * 60 * 1000)
  const pi = romeDateParts(params.inizio)
  const pf = romeDateParts(fine)
  const note = (params.note ?? "FitCenter WhatsApp").slice(0, 200)
  const IDA2_SERVIZIO = 6 // APPUNTAMENTI CONSULENTI
  const hasServizio = await a2IscrizioniHasServizioCol(p)

  const tx = new sql.Transaction(p)
  await tx.begin()
  try {
    // Stesso percorso validato in SSMS: CONVERT style 120 + SCOPE_IDENTITY (no OUTPUT: fallisce con trigger).
    const req1 = new sql.Request(tx)
    const insApp = await req1
      .input("impegno", sql.Int, IDA2_IMPEGNO_CONSULENZA)
      .input("y", sql.Int, pi.y)
      .input("m", sql.Int, pi.m)
      .input("d", sql.Int, pi.day)
      .input("hh", sql.Int, pi.h)
      .input("mm", sql.Int, pi.min)
      .input("ss", sql.Int, pi.s)
      .input("note", sql.NVarChar(200), note)
      .query(`
        DECLARE @inizio datetime = CONVERT(datetime,
          RIGHT('0000'+CAST(@y AS varchar(4)),4)+'-'+RIGHT('00'+CAST(@m AS varchar(2)),2)+'-'+RIGHT('00'+CAST(@d AS varchar(2)),2)
          +' '+RIGHT('00'+CAST(@hh AS varchar(2)),2)+':'+RIGHT('00'+CAST(@mm AS varchar(2)),2)+':'+RIGHT('00'+CAST(@ss AS varchar(2)),2)
        , 120);
        INSERT INTO dbo.A2Appuntamenti (IDA2Impegno, DataOraInizio, Note)
        VALUES (@impegno, @inizio, @note);
        SELECT CAST(SCOPE_IDENTITY() AS int) AS id;
      `)
    const idApp = Number((insApp.recordset?.[0] as { id?: number })?.id)
    if (!Number.isFinite(idApp) || idApp <= 0) {
      throw new Error(`IDENTITY appuntamento non valido (${pi.y}-${pi.m}-${pi.day} ${pi.h}:${pi.min})`)
    }

    const req2 = new sql.Request(tx)
    await req2
      .input("idApp", sql.Int, idApp)
      .input("rel", sql.Int, IDA2_RELAZIONE)
      .input("risorsa", sql.Int, params.consulente.idRisorsa)
      .input("y", sql.Int, pi.y)
      .input("m", sql.Int, pi.m)
      .input("d", sql.Int, pi.day)
      .input("hh", sql.Int, pi.h)
      .input("mm", sql.Int, pi.min)
      .input("ss", sql.Int, pi.s)
      .input("yf", sql.Int, pf.y)
      .input("mf", sql.Int, pf.m)
      .input("df", sql.Int, pf.day)
      .input("hhf", sql.Int, pf.h)
      .input("mmf", sql.Int, pf.min)
      .input("ssf", sql.Int, pf.s)
      .query(`
        DECLARE @inizio datetime = CONVERT(datetime,
          RIGHT('0000'+CAST(@y AS varchar(4)),4)+'-'+RIGHT('00'+CAST(@m AS varchar(2)),2)+'-'+RIGHT('00'+CAST(@d AS varchar(2)),2)
          +' '+RIGHT('00'+CAST(@hh AS varchar(2)),2)+':'+RIGHT('00'+CAST(@mm AS varchar(2)),2)+':'+RIGHT('00'+CAST(@ss AS varchar(2)),2)
        , 120);
        DECLARE @fine datetime = CONVERT(datetime,
          RIGHT('0000'+CAST(@yf AS varchar(4)),4)+'-'+RIGHT('00'+CAST(@mf AS varchar(2)),2)+'-'+RIGHT('00'+CAST(@df AS varchar(2)),2)
          +' '+RIGHT('00'+CAST(@hhf AS varchar(2)),2)+':'+RIGHT('00'+CAST(@mmf AS varchar(2)),2)+':'+RIGHT('00'+CAST(@ssf AS varchar(2)),2)
        , 120);
        INSERT INTO dbo.A2Occupazioni (IDA2Appuntamento, IDA2Relazione, IDA2Risorsa, DataInizio, DataFine)
        VALUES (@idApp, @rel, @risorsa, @inizio, @fine);
      `)

    // Come test SSMS OK: senza IDA2Servizio; se la colonna c'è, UPDATE dopo.
    const req3 = new sql.Request(tx)
    await req3
      .input("idUtente", sql.Int, params.idUtente)
      .input("idApp", sql.Int, idApp)
      .input("op", sql.Int, params.consulente.idOperatore)
      .input("note", sql.NVarChar(200), note)
      .query(`
        INSERT INTO dbo.A2Iscrizioni (IDUtente, IDA2Appuntamento, IDOperatore, DataOperazione, Annullato, Note)
        VALUES (@idUtente, @idApp, @op, GETDATE(), 0, @note);
      `)

    if (hasServizio) {
      const req4 = new sql.Request(tx)
      await req4
        .input("idApp", sql.Int, idApp)
        .input("servizio", sql.Int, IDA2_SERVIZIO)
        .query(`
          UPDATE dbo.A2Iscrizioni
          SET IDA2Servizio = @servizio
          WHERE IDA2Appuntamento = @idApp AND Annullato = 0;
        `)
    }

    await tx.commit()
    return { idAppuntamento: idApp }
  } catch (e) {
    try {
      await tx.rollback()
    } catch {
      /* ignore */
    }
    throw new Error(sqlErrDetail(e))
  }
}

/** Anagrafica placeholder gestionale: Cognome=nuovo Nome=cliente. */
export const ID_UTENTE_NUOVO_CLIENTE_DEFAULT = 66218

/** ID anagrafica "nuovo cliente" (env o lookup Cognome/Nome, default 66218). */
export async function findIdUtenteNuovoCliente(): Promise<number> {
  const fromEnv = Number(process.env.WHATSAPP_BOOKING_FALLBACK_ID_UTENTE ?? "")
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv

  const p = await getPool()
  if (!p) return ID_UTENTE_NUOVO_CLIENTE_DEFAULT
  try {
    const r = await p.request().query(`
      SELECT TOP 1 IDUtente
      FROM dbo.Utenti
      WHERE LOWER(LTRIM(RTRIM(ISNULL(Cognome, N'')))) = N'nuovo'
        AND LOWER(LTRIM(RTRIM(ISNULL(Nome, N'')))) = N'cliente'
      ORDER BY IDUtente DESC
    `)
    const id = Number((r.recordset?.[0] as { IDUtente?: number } | undefined)?.IDUtente)
    return Number.isFinite(id) && id > 0 ? id : ID_UTENTE_NUOVO_CLIENTE_DEFAULT
  } catch (e) {
    console.warn("[agenda-a2] findIdUtenteNuovoCliente:", (e as Error)?.message ?? e)
    return ID_UTENTE_NUOVO_CLIENTE_DEFAULT
  }
}

export type UtentePhoneMatch = {
  idUtente: number
  nome: string
  cognome: string
}

function normPerson(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/** Tutti gli IDUtente con quel cellulare (escluso nuovo/cliente). */
export async function findUtentiByPhone(phoneRaw: string): Promise<UtentePhoneMatch[]> {
  const p = await getPool()
  if (!p) return []
  let digits = phoneDigits(phoneRaw)
  if (digits.startsWith("39") && digits.length >= 11) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  if (digits.length < 8) return []
  const tail = digits.slice(-9)
  const skipId = await findIdUtenteNuovoCliente()

  const norm = (col: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${col},''),' ',''),'+',''),'-',''),'/',''),'.','')`

  try {
    const r = await p
      .request()
      .input("tail", sql.VarChar(16), tail)
      .input("skipId", sql.Int, skipId)
      .query(`
        SELECT TOP 20 IDUtente, Nome, Cognome
        FROM dbo.Utenti
        WHERE IDUtente <> @skipId
          AND (
            ${norm("SMS")} LIKE '%' + @tail
            OR ${norm("Telefono_1")} LIKE '%' + @tail
            OR ${norm("Telefono_2")} LIKE '%' + @tail
          )
        ORDER BY IDUtente DESC
      `)
    return (r.recordset ?? [])
      .map((row) => {
        const idUtente = Number((row as { IDUtente?: number }).IDUtente)
        return {
          idUtente,
          nome: String((row as { Nome?: string }).Nome ?? "").trim(),
          cognome: String((row as { Cognome?: string }).Cognome ?? "").trim(),
        }
      })
      .filter((u) => Number.isFinite(u.idUtente) && u.idUtente > 0)
  } catch (e) {
    console.warn("[agenda-a2] findUtentiByPhone:", (e as Error)?.message ?? e)
    return []
  }
}

/**
 * Risolve anagrafica per prenotazione WA.
 * - 1 solo match sul tel → ok
 * - più match (es. padre/figlia stesso cell) → solo se nome/cognome lead coincidono
 * - altrimenti null → usare "nuovo cliente" + note
 */
export async function resolveIdUtenteForWaBooking(params: {
  phone: string
  nome?: string | null
  cognome?: string | null
}): Promise<{ idUtente: number | null; reason: string }> {
  const matches = await findUtentiByPhone(params.phone)
  if (matches.length === 0) return { idUtente: null, reason: "nessun match tel" }
  if (matches.length === 1) return { idUtente: matches[0]!.idUtente, reason: "match tel unico" }

  const wantNome = normPerson(params.nome ?? "")
  const wantCognome = normPerson(params.cognome ?? "")
  if (wantNome || wantCognome) {
    const full = matches.filter((m) => {
      const n = normPerson(m.nome)
      const c = normPerson(m.cognome)
      if (wantNome && wantCognome) return n === wantNome && c === wantCognome
      if (wantNome && wantCognome === "") return n === wantNome
      if (wantCognome && wantNome === "") return c === wantCognome
      return false
    })
    if (full.length === 1) {
      return { idUtente: full[0]!.idUtente, reason: "match tel+nome (numero condiviso)" }
    }
  }

  return {
    idUtente: null,
    reason: `tel ambiguo (${matches.map((m) => `${m.cognome} ${m.nome}`).join(", ")}) → nuovo cliente`,
  }
}

/** Cerca IDUtente da cellulare. Se più anagrafiche condividono il numero, ritorna null. */
export async function findIdUtenteByPhone(phoneRaw: string): Promise<number | null> {
  const matches = await findUtentiByPhone(phoneRaw)
  if (matches.length === 1) return matches[0]!.idUtente
  return null
}

/** Slot libero se nessuna occupazione (appuntamento o blocco) si sovrappone. */
export async function isRisorsaSlotFree(idRisorsa: number, inizio: Date, fine: Date): Promise<boolean> {
  const p = await getPool()
  if (!p) return false
  const ini = toSqlDateTimeRome(inizio)
  const fin = toSqlDateTimeRome(fine)
  try {
    const r = await p
      .request()
      .input("risorsa", sql.Int, idRisorsa)
      .input("ini", sql.VarChar(19), ini)
      .input("fin", sql.VarChar(19), fin)
      .query(`
        SELECT TOP 1 o.IDA2Occupazione
        FROM dbo.A2Occupazioni o
        WHERE o.IDA2Risorsa = @risorsa
          AND o.DataInizio < CONVERT(datetime, @fin, 120)
          AND o.DataFine > CONVERT(datetime, @ini, 120)
      `)
    return (r.recordset?.length ?? 0) === 0
  } catch (e) {
    console.warn("[agenda-a2] isRisorsaSlotFree:", (e as Error)?.message ?? e)
    return false
  }
}

export async function pickFreeConsulente(inizio: Date, fine: Date): Promise<ConsulenteAgenda | null> {
  for (const c of CONSULENTI_AGENDA) {
    if (await isRisorsaSlotFree(c.idRisorsa, inizio, fine)) return c
  }
  return null
}

export function slotEnd(inizio: Date): Date {
  return new Date(inizio.getTime() + SLOT_MINUTES * 60 * 1000)
}

export { SLOT_MINUTES }
