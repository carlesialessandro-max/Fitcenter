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

function toSqlDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  // Orario locale server (produzione Italia)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Cerca IDUtente da cellulare (SMS / Telefono_1 / Telefono_2). */
export async function findIdUtenteByPhone(phoneRaw: string): Promise<number | null> {
  const p = await getPool()
  if (!p) return null
  let digits = phoneDigits(phoneRaw)
  if (digits.startsWith("39") && digits.length >= 11) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  if (digits.length < 8) return null
  const tail = digits.slice(-9)

  const norm = (col: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${col},''),' ',''),'+',''),'-',''),'/',''),'.','')`

  try {
    const r = await p
      .request()
      .input("tail", sql.VarChar(16), tail)
      .query(`
        SELECT TOP 5 IDUtente
        FROM dbo.Utenti
        WHERE ${norm("SMS")} LIKE '%' + @tail
           OR ${norm("Telefono_1")} LIKE '%' + @tail
           OR ${norm("Telefono_2")} LIKE '%' + @tail
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
  const ini = toSqlDateTime(inizio)
  const fin = toSqlDateTime(fine)
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

export async function createConsulenzaAppuntamento(params: {
  idUtente: number
  inizio: Date
  consulente: ConsulenteAgenda
  note?: string
}): Promise<{ idAppuntamento: number; idOccupazione?: number }> {
  const p = await poolRw()
  if (!p) throw new Error("SQL gestionale non disponibile (write)")

  const fine = new Date(params.inizio.getTime() + SLOT_MINUTES * 60 * 1000)
  const ini = toSqlDateTime(params.inizio)
  const fin = toSqlDateTime(fine)
  const note = (params.note ?? "FitCenter WhatsApp").slice(0, 200)

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
        VALUES (@impegno, CONVERT(datetime, @inizio, 120), @note);
        SELECT SCOPE_IDENTITY() AS id;
      `)
    const idApp = Number((insApp.recordset?.[0] as { id?: number })?.id)
    if (!Number.isFinite(idApp) || idApp <= 0) throw new Error("SCOPE_IDENTITY appuntamento fallito")

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
    await req3
      .input("idUtente", sql.Int, params.idUtente)
      .input("idApp", sql.Int, idApp)
      .input("op", sql.Int, params.consulente.idOperatore)
      .input("note", sql.NVarChar(200), note)
      .query(`
        INSERT INTO dbo.A2Iscrizioni (IDUtente, IDA2Appuntamento, IDOperatore, DataOperazione, Annullato, Note)
        VALUES (@idUtente, @idApp, @op, GETDATE(), 0, @note);
      `)

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

export function slotEnd(inizio: Date): Date {
  return new Date(inizio.getTime() + SLOT_MINUTES * 60 * 1000)
}

export { SLOT_MINUTES }
