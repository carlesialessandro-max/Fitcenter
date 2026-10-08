/**
 * Scrive sul CRM del gestionale (AppuntamentiStorico) le azioni
 * da Abbonamenti in scadenza: appuntamento, rinnovo, non rinnova, ecc.
 */
import sql from "mssql"
import { getPool, getPoolWrite } from "./gestionale-sql.js"
import { CONSULENTI_AGENDA_ADULTI, CONSULENTI_AGENDA_BAMBINI } from "./agenda-a2.js"
import type { RinnovoStato } from "../store/abbonamenti-follow-up.js"

export type CrmRinnovoResult =
  | { ok: true; idAppuntamento: number }
  | { ok: false; message: string }

const CAT_TELEFONICA = "3. Telefonica"
const TIPO_COMMERCIALE = "14. Commerciale"

const STATO_LABEL: Record<RinnovoStato, string> = {
  da_contattare: "Da contattare",
  contattato: "Contattato",
  appuntamento: "Appuntamento",
  rinnovo_confermato: "Rinnovo confermato",
  non_rinnova: "Non rinnova",
  chiuso: "Chiuso",
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

function sqlErrDetail(e: unknown): string {
  const any = e as {
    message?: string
    number?: number
    originalError?: { info?: { message?: string; number?: number } }
  }
  const info = any?.originalError?.info
  const msg = info?.message ?? any?.message ?? String(e)
  const num = info?.number ?? any?.number
  return num != null ? `SQL ${num}: ${msg}` : msg
}

async function lookupId(
  p: sql.ConnectionPool,
  table: string,
  idCol: string,
  descCol: string,
  like: string
): Promise<number | null> {
  const r = await p
    .request()
    .input("like", sql.NVarChar, like)
    .query(
      `SELECT TOP 1 ${idCol} AS id
       FROM ${table}
       WHERE LOWER(LTRIM(RTRIM(COALESCE(${descCol}, N'')))) LIKE LOWER(LTRIM(RTRIM(@like)))
       ORDER BY ${idCol}`
    )
  const id = Number((r.recordset?.[0] as { id?: number } | undefined)?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

async function resolveOperatoreId(p: sql.ConnectionPool, nome: string): Promise<number | null> {
  const n = nome.trim()
  if (!n) return null
  const known = [...CONSULENTI_AGENDA_ADULTI, ...CONSULENTI_AGENDA_BAMBINI]
  const hit = known.find((c) => {
    const a = norm(c.nome)
    const b = norm(n)
    return a === b || a.startsWith(b) || b.startsWith(a) || a.split(" ")[0] === b.split(" ")[0]
  })
  if (hit) return hit.idOperatore
  try {
    const r = await p
      .request()
      .input("nome", sql.NVarChar, n)
      .query(`
        SELECT TOP 1 IDOperatore AS id
        FROM dbo.Operatori
        WHERE ISNULL(Eliminato, 0) = 0
          AND (
            LOWER(LTRIM(RTRIM(COALESCE(NomeOperatore, N'')))) = LOWER(LTRIM(RTRIM(@nome)))
            OR LOWER(LTRIM(RTRIM(COALESCE(NomeOperatore, N'')))) LIKE LOWER(LTRIM(RTRIM(@nome))) + N'%'
            OR LOWER(LTRIM(RTRIM(@nome))) LIKE LOWER(LTRIM(RTRIM(COALESCE(NomeOperatore, N'')))) + N'%'
          )
        ORDER BY IDOperatore
      `)
    const id = Number((r.recordset?.[0] as { id?: number } | undefined)?.id)
    return Number.isFinite(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

async function resolveAzienda(p: sql.ConnectionPool, idUtente: number): Promise<number> {
  try {
    const r = await p.request().input("id", sql.Int, idUtente).query(`
      SELECT TOP 1 IDAzienda AS id FROM dbo.Utenti WHERE IDUtente = @id
    `)
    const id = Number((r.recordset?.[0] as { id?: number } | undefined)?.id)
    if (Number.isFinite(id) && id > 0) return id
  } catch {
    /* ignore */
  }
  return 2
}

function mappingStato(stato: RinnovoStato): {
  esitoLike: string | null
  statoLike: string | null
  evasione: boolean
} {
  if (stato === "da_contattare") return { esitoLike: null, statoLike: null, evasione: false }
  if (stato === "contattato") return { esitoLike: "08. Positivo", statoLike: null, evasione: true }
  if (stato === "appuntamento") return { esitoLike: "07. Appuntamento", statoLike: null, evasione: true }
  if (stato === "rinnovo_confermato") return { esitoLike: "08. Positivo", statoLike: "Iscritto", evasione: true }
  if (stato === "non_rinnova") return { esitoLike: "09. Negativo", statoLike: "Lost", evasione: true }
  return { esitoLike: "09. Negativo", statoLike: "Lost", evasione: true }
}

export async function insertCrmRinnovo(params: {
  idUtente: number
  stato: RinnovoStato
  note?: string
  operatoreNome?: string
}): Promise<CrmRinnovoResult> {
  const idUtente = Number(params.idUtente)
  if (!Number.isFinite(idUtente) || idUtente <= 0) {
    return { ok: false, message: "Cliente gestionale non trovato (IDUtente)" }
  }
  const pw = await getPoolWrite()
  const pr = (await getPool()) ?? pw
  if (!pw) {
    return { ok: false, message: "SQL write non configurato: imposta SQL_CONNECTION_STRING_WRITE" }
  }
  if (!pr) return { ok: false, message: "SQL gestionale non disponibile" }

  const map = mappingStato(params.stato)
  const descrizione = (params.note?.trim() || `FitCenter: ${STATO_LABEL[params.stato]}`).slice(0, 4000)

  try {
    const idCat =
      (await lookupId(pr, "dbo.AppuntamentiCategorie", "IDAppuntamentoCategoria", "Descrizione", `%${CAT_TELEFONICA}%`)) ??
      4
    const idTipo =
      (await lookupId(pr, "dbo.AppuntamentiTipo", "IDTipo", "Descrizione", `%${TIPO_COMMERCIALE}%`)) ?? 28
    const idEsito = map.esitoLike
      ? await lookupId(pr, "dbo.AppuntamentiEsito", "IDEsito", "Descrizione", `%${map.esitoLike}%`)
      : null
    const idStato = map.statoLike
      ? await lookupId(pr, "dbo.AppuntamentiStato", "IDStatoCommerciale", "NomeStato", `%${map.statoLike}%`)
      : null
    let idOp = await resolveOperatoreId(pr, params.operatoreNome ?? "")
    if (!idOp) {
      try {
        const vend = await pr.request().input("id", sql.Int, idUtente).query(`
          SELECT TOP 1 IDVenditore AS id FROM dbo.Utenti WHERE IDUtente = @id
        `)
        const vid = Number((vend.recordset?.[0] as { id?: number } | undefined)?.id)
        if (Number.isFinite(vid) && vid > 0) idOp = vid
      } catch {
        /* ignore */
      }
    }
    if (!idOp) {
      return { ok: false, message: `Operatore CRM non trovato per «${params.operatoreNome || "—"}»` }
    }
    const idAzienda = await resolveAzienda(pr, idUtente)

    let idAttivita = 0
    try {
      const existing = await pr
        .request()
        .input("idUtente", sql.Int, idUtente)
        .input("idCat", sql.Int, idCat)
        .query(`
          SELECT TOP 1 IDAppuntamentoCategoriaUtente AS id
          FROM dbo.AppuntamentiCategorieUtenti
          WHERE IDUtente = @idUtente
            AND IDAppuntamentoCategoria = @idCat
            AND DataChiusura IS NULL
          ORDER BY IDAppuntamentoCategoriaUtente DESC
        `)
      idAttivita = Number((existing.recordset?.[0] as { id?: number } | undefined)?.id)
    } catch {
      idAttivita = 0
    }

    const tx = new sql.Transaction(pw)
    await tx.begin()
    try {
      if (!Number.isFinite(idAttivita) || idAttivita <= 0) {
        const insAtt = await new sql.Request(tx)
          .input("idCat", sql.Int, idCat)
          .input("idUtente", sql.Int, idUtente)
          .input("azienda", sql.Int, idAzienda)
          .query(`
            INSERT INTO dbo.AppuntamentiCategorieUtenti
              (IDAppuntamentoCategoria, Descrizione, IDUtente, DataCreazione, IDAzienda)
            VALUES (@idCat, N'CRM', @idUtente, GETDATE(), @azienda);
            SELECT CAST(SCOPE_IDENTITY() AS int) AS id;
          `)
        idAttivita = Number((insAtt.recordset?.[0] as { id?: number } | undefined)?.id)
        if (!Number.isFinite(idAttivita) || idAttivita <= 0) {
          throw new Error("IDENTITY attività CRM non valido")
        }
      }

      const ins = await new sql.Request(tx)
        .input("dest", sql.Int, idOp)
        .input("autore", sql.Int, idOp)
        .input("azienda", sql.Int, idAzienda)
        .input("tipo", sql.Int, idTipo)
        .input("esito", sql.Int, idEsito)
        .input("descr", sql.VarChar(4000), descrizione)
        .input("stato", sql.Int, idStato)
        .input("attivita", sql.Int, idAttivita)
        .input("evaso", sql.Bit, map.evasione ? 1 : 0)
        .query(`
          INSERT INTO dbo.AppuntamentiStorico (
            IDOperatoreDest, IDOperatoreAutore, IDAzienda,
            DataAppuntamento, Tipo, Esito, Descrizione, DataEvasione,
            IDStatoCommerciale, IDAppuntamentoCategoriaUtente
          )
          VALUES (
            @dest, @autore, @azienda,
            GETDATE(), @tipo, @esito, @descr,
            CASE WHEN @evaso = 1 THEN GETDATE() ELSE NULL END,
            @stato, @attivita
          );
          SELECT CAST(SCOPE_IDENTITY() AS int) AS id;
        `)
      const idApp = Number((ins.recordset?.[0] as { id?: number } | undefined)?.id)
      if (!Number.isFinite(idApp) || idApp <= 0) {
        throw new Error("IDENTITY appuntamento CRM non valido")
      }
      await tx.commit()
      return { ok: true, idAppuntamento: idApp }
    } catch (e) {
      try {
        await tx.rollback()
      } catch {
        /* ignore */
      }
      throw e
    }
  } catch (e) {
    return { ok: false, message: sqlErrDetail(e) }
  }
}
