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

async function poolRw(): Promise<sql.ConnectionPool | null> {
  return (await getPoolWrite()) ?? (await getPool())
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

export async function createConsulenzaAppuntamento(params: {
  idUtente: number
  inizio: Date
  consulente: ConsulenteAgenda
  note?: string
}): Promise<{ idAppuntamento: number; idOccupazione?: number }> {
  const p = await poolRw()
  if (!p) throw new Error("SQL gestionale non disponibile (write)")

  const fine = new Date(params.inizio.getTime() + SLOT_MINUTES * 60 * 1000)
  const ini = toSqlDateTimeRome(params.inizio)
  const fin = toSqlDateTimeRome(fine)
  const note = (params.note ?? "FitCenter WhatsApp").slice(0, 200)
  const IDA2_SERVIZIO = 6 // APPUNTAMENTI CONSULENTI
  const hasServizio = await a2IscrizioniHasServizioCol(p)

  const tx = new sql.Transaction(p)
  await tx.begin()
  try {
    const req1 = new sql.Request(tx)
    const insApp = await req1
      .input("impegno", sql.Int, IDA2_IMPEGNO_CONSULENZA)
      .input("inizio", sql.VarChar(19), ini)
      .input("note", sql.NVarChar(200), note)
      .query(`
        INSERT INTO dbo.A2Appuntamenti (IDA2Impegno, DataOraInizio, Note)
        OUTPUT INSERTED.IDA2Appuntamento AS id
        VALUES (@impegno, CONVERT(datetime, @inizio, 120), @note);
      `)
    const idApp = Number((insApp.recordset?.[0] as { id?: number })?.id)
    if (!Number.isFinite(idApp) || idApp <= 0) {
      throw new Error(`IDENTITY appuntamento non valido (ini=${ini})`)
    }

    const req2 = new sql.Request(tx)
    await req2
      .input("idApp", sql.Int, idApp)
      .input("rel", sql.Int, IDA2_RELAZIONE)
      .input("risorsa", sql.Int, params.consulente.idRisorsa)
      .input("inizio", sql.VarChar(19), ini)
      .input("fine", sql.VarChar(19), fin)
      .query(`
        INSERT INTO dbo.A2Occupazioni (IDA2Appuntamento, IDA2Relazione, IDA2Risorsa, DataInizio, DataFine)
        VALUES (@idApp, @rel, @risorsa, CONVERT(datetime, @inizio, 120), CONVERT(datetime, @fine, 120));
      `)

    const req3 = new sql.Request(tx)
    if (hasServizio) {
      await req3
        .input("idUtente", sql.Int, params.idUtente)
        .input("idApp", sql.Int, idApp)
        .input("op", sql.Int, params.consulente.idOperatore)
        .input("servizio", sql.Int, IDA2_SERVIZIO)
        .input("note", sql.NVarChar(200), note)
        .query(`
          INSERT INTO dbo.A2Iscrizioni (IDUtente, IDA2Appuntamento, IDOperatore, IDA2Servizio, DataOperazione, Annullato, Note)
          VALUES (@idUtente, @idApp, @op, @servizio, GETDATE(), 0, @note);
        `)
    } else {
      await req3
        .input("idUtente", sql.Int, params.idUtente)
        .input("idApp", sql.Int, idApp)
        .input("op", sql.Int, params.consulente.idOperatore)
        .input("note", sql.NVarChar(200), note)
        .query(`
          INSERT INTO dbo.A2Iscrizioni (IDUtente, IDA2Appuntamento, IDOperatore, DataOperazione, Annullato, Note)
          VALUES (@idUtente, @idApp, @op, GETDATE(), 0, @note);
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
    throw e
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

/** Cerca IDUtente da cellulare (SMS / Telefono_1 / Telefono_2). Esclude placeholder nuovo/cliente. */
export async function findIdUtenteByPhone(phoneRaw: string): Promise<number | null> {
  const p = await getPool()
  if (!p) return null
  let digits = phoneDigits(phoneRaw)
  if (digits.startsWith("39") && digits.length >= 11) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  if (digits.length < 8) return null
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
        SELECT TOP 5 IDUtente
        FROM dbo.Utenti
        WHERE IDUtente <> @skipId
          AND (
            ${norm("SMS")} LIKE '%' + @tail
            OR ${norm("Telefono_1")} LIKE '%' + @tail
            OR ${norm("Telefono_2")} LIKE '%' + @tail
          )
        ORDER BY IDUtente DESC
      `)
    const id = Number((r.recordset?.[0] as { IDUtente?: number } | undefined)?.IDUtente)
    return Number.isFinite(id) && id > 0 ? id : null
  } catch (e) {
    console.warn("[agenda-a2] findIdUtenteByPhone:", (e as Error)?.message ?? e)
    return null
  }
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
