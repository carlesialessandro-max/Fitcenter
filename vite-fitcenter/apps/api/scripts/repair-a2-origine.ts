/**
 * Ripara iscrizioni A2 create da FitCenter/WhatsApp incomplete
 * (rosse in agenda TeamSystem: OrigineTipi / Importo / DataPagato).
 *
 * Uso: npx tsx scripts/repair-a2-origine.ts
 * Dry-run default; passa --apply per scrivere.
 */
import "dotenv/config"
import { getPool, getPoolWrite } from "../src/services/gestionale-sql.js"

async function main() {
  const apply = process.argv.includes("--apply")
  const p = (await getPoolWrite()) || (await getPool())
  if (!p) throw new Error("Nessun pool SQL")

  const list = await p.request().query(`
    SELECT
      i.IDA2Iscrizione,
      i.IDA2Appuntamento,
      a.DataOraInizio,
      LEFT(ISNULL(a.Note, N''), 80) AS note,
      i.OrigineTipi,
      i.OrigineID,
      i.Importo,
      i.DataPagato,
      i.Annullato
    FROM dbo.A2Iscrizioni i
    JOIN dbo.A2Appuntamenti a ON a.IDA2Appuntamento = i.IDA2Appuntamento
    WHERE a.IDA2Impegno = 51
      AND (
        ISNULL(a.Note, N'') LIKE N'%FitCenter%'
        OR ISNULL(a.Note, N'') LIKE N'%WhatsApp%'
        OR ISNULL(a.Note, N'') LIKE N'%WA:%'
        OR ISNULL(i.Note, N'') LIKE N'%FitCenter%'
        OR ISNULL(i.Note, N'') LIKE N'%WhatsApp%'
        OR ISNULL(i.Note, N'') LIKE N'%WA:%'
      )
      AND (
        i.OrigineTipi IS NULL OR LTRIM(RTRIM(i.OrigineTipi)) = N''
        OR i.Importo IS NULL
        OR i.DataPagato IS NULL
      )
    ORDER BY a.DataOraInizio DESC
  `)
  console.log(`Trovate ${list.recordset.length} iscrizioni da riparare`)
  console.table(list.recordset)

  if (!apply) {
    console.log("Dry-run. Rilancia con --apply per OrigineTipi='B', OrigineID=0, Importo=0, DataPagato")
    await p.close()
    return
  }

  const r = await p.request().query(`
    UPDATE i
    SET
      OrigineTipi = COALESCE(NULLIF(LTRIM(RTRIM(i.OrigineTipi)), N''), N'B'),
      OrigineID = ISNULL(i.OrigineID, 0),
      Importo = ISNULL(i.Importo, 0),
      DataPagato = ISNULL(i.DataPagato, ISNULL(i.DataOperazione, GETDATE()))
    FROM dbo.A2Iscrizioni i
    JOIN dbo.A2Appuntamenti a ON a.IDA2Appuntamento = i.IDA2Appuntamento
    WHERE a.IDA2Impegno = 51
      AND (
        ISNULL(a.Note, N'') LIKE N'%FitCenter%'
        OR ISNULL(a.Note, N'') LIKE N'%WhatsApp%'
        OR ISNULL(a.Note, N'') LIKE N'%WA:%'
        OR ISNULL(i.Note, N'') LIKE N'%FitCenter%'
        OR ISNULL(i.Note, N'') LIKE N'%WhatsApp%'
        OR ISNULL(i.Note, N'') LIKE N'%WA:%'
      )
      AND (
        i.OrigineTipi IS NULL OR LTRIM(RTRIM(i.OrigineTipi)) = N''
        OR i.Importo IS NULL
        OR i.DataPagato IS NULL
      );
    SELECT @@ROWCOUNT AS updated;
  `)
  console.log("Aggiornate:", r.recordset?.[0] ?? r.rowsAffected)
  await p.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
