/*
  Debug Referral FitCenter — confronto con GET /data/referral-presentati.

  Imposta parametri qui sotto. Lo script usa SQL dinamico: legge sys.columns sulla
  tabella abbonamenti e costruisce COALESCE «pagato» + filtri esclusione solo per
  colonne che esistono (niente errore 207 se mancano ImportoPagato, macro, ecc.).

  Tabella clienti default: dbo.Utenti | Abbonamenti: dbo.AbbonamentiIscrizione
  Override come in .env API: @SchemaAbb, @TblAbb, @TblUtenti, @ColPres, @ColDataPres
  (GESTIONALE_UTENTI_COL_DATA_PRESENTAZIONE, default DataPresentazione).

  Query [8–9]: come l’API quando esiste DataPresentazione — il mese selezionato filtra quella data;
  i totali/abbonamento mostrato restano filtrati sul mese (DataInizio nel mese).
  Per aprile 2026: @Anno = 2026, @Mese = 4.

  SSMS — errore 137 «Dichiarare @Anno / @Da»:
  - Esegui l’intero file: Ctrl+A poi F5 (non solo un blocco in mezzo).
  - Le date sono inserite come testo nella SQL dinamica (niente @Da/@Al dentro sp_executesql).
*/

DECLARE @Anno INT = 2026;
DECLARE @Mese INT = 5;

DECLARE @SchemaAbb SYSNAME = N'dbo';
DECLARE @TblAbb SYSNAME = N'AbbonamentiIscrizione';
DECLARE @TblUtenti SYSNAME = N'Utenti';
DECLARE @ColPres SYSNAME = N'IDPresentatore';
DECLARE @ColDataPres SYSNAME = N'DataPresentazione';

DECLARE @Da DATE = DATEFROMPARTS(@Anno, @Mese, 1);
DECLARE @Al DATE = DATEADD(MONTH, 1, @Da);

-- Incorporate nella stringa dinamica (yyyy-mm-dd, stile ODBC 23 / ISO)
DECLARE @DaLit NCHAR(10) = CONVERT(NCHAR(10), @Da, 23);
DECLARE @AlLit NCHAR(10) = CONVERT(NCHAR(10), @Al, 23);

DECLARE @Oid INT = OBJECT_ID(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb));
DECLARE @Ou  INT = OBJECT_ID(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti));

IF @Oid IS NULL
BEGIN
  RAISERROR(N'Tabella abbonamenti non trovata: %s.%s', 16, 1, @SchemaAbb, @TblAbb);
  RETURN;
END

IF @Ou IS NULL
BEGIN
  RAISERROR(N'Tabella utenti non trovata: %s.%s', 16, 1, @SchemaAbb, @TblUtenti);
  RETURN;
END

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti), @ColPres) IS NULL
BEGIN
  RAISERROR(N'Colonna presentatore assente su %s.%s : %s', 16, 1, @SchemaAbb, @TblUtenti, @ColPres);
  RETURN;
END

DECLARE @HasDataPres BIT =
  CASE
    WHEN COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti), @ColDataPres) IS NOT NULL THEN 1
    ELSE 0
  END;

-- --- Ordine priorità colonne «pagato» / totale riga (come API + fallback gestionale) ---
DECLARE @PagatoPieces NVARCHAR(MAX);

SELECT @PagatoPieces = STUFF(
  (
    SELECT N', x.' + QUOTENAME(col.name)
    FROM
      (VALUES
        (1,  N'ImportoPagato'),
        (2,  N'Pagato'),
        (3,  N'Versato'),
        (4,  N'Incassato'),
        (5,  N'Acconto'),
        (6,  N'Importo'),
        (7,  N'Totale'),
        (8,  N'AbbonamentiIscrizioneTotale'),
        (9,  N'AbbonamentiIscrizionetotale'),
        (10, N'IscrizioneTotale'),
        (11, N'TotaleIscrizione'),
        (12, N'TotaleAbbonamento')
      ) AS pri(Ordine, ColName)
      INNER JOIN sys.columns AS col
        ON col.object_id = @Oid
       AND col.name = pri.ColName
    ORDER BY pri.Ordine
    FOR XML PATH(N''), TYPE
  ).value(N'.', N'NVARCHAR(MAX)'),
  1,
  2,
  N''
);

DECLARE @PagatoExpr NVARCHAR(MAX) =
  CASE
    WHEN @PagatoPieces IS NULL OR LEN(@PagatoPieces) = 0 THEN N'CAST(0 AS FLOAT)'
    ELSE N'COALESCE(' + @PagatoPieces + N', CAST(0 AS FLOAT))'
  END;

-- --- Descrizione abbonamento in SELECT (solo colonne esistenti) ---
DECLARE @AbbDescrExpr NVARCHAR(MAX) = N'CAST(N'''' AS NVARCHAR(400))';

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'AbbonamentoDescrizione') IS NOT NULL
  SET @AbbDescrExpr = N'ISNULL(CAST(x.[AbbonamentoDescrizione] AS NVARCHAR(400)), N'''')';

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'DescrizioneAbbonamento') IS NOT NULL
  SET @AbbDescrExpr =
    CASE @AbbDescrExpr
      WHEN N'CAST(N'''' AS NVARCHAR(400))'
        THEN N'ISNULL(CAST(x.[DescrizioneAbbonamento] AS NVARCHAR(400)), N'''')'
      ELSE N'COALESCE(CAST(x.[AbbonamentoDescrizione] AS NVARCHAR(400)), CAST(x.[DescrizioneAbbonamento] AS NVARCHAR(400)), CAST(N'''' AS NVARCHAR(400)))'
    END;

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'Descrizione') IS NOT NULL
   AND COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'AbbonamentoDescrizione') IS NULL
   AND COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'DescrizioneAbbonamento') IS NULL
  SET @AbbDescrExpr = N'ISNULL(CAST(x.[Descrizione] AS NVARCHAR(400)), N'''')';

-- --- Esclusioni «full» (solo AND per colonne presenti) ---
DECLARE @ExFull NVARCHAR(MAX) = N'( 1 = 1';

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'IDCategoria') IS NOT NULL
  SET @ExFull += N' AND ISNULL(x.[IDCategoria], 0) <> 19';

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'AbbonamentoDurataDescrizione') IS NOT NULL
  SET @ExFull += N' AND UPPER(ISNULL(x.[AbbonamentoDurataDescrizione], N'''')) <> N''TESSERAMENTO GARE''';

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'CategoriaAbbonamentoDescrizione') IS NOT NULL
  SET @ExFull += N' AND UPPER(ISNULL(x.[CategoriaAbbonamentoDescrizione], N'''')) NOT LIKE N''%TESSERAMENTI%''';

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'MacroCategoriaAbbonamentoDescrizione') IS NOT NULL
BEGIN
  SET @ExFull +=
    N' AND UPPER(LTRIM(RTRIM(ISNULL(x.[MacroCategoriaAbbonamentoDescrizione], N'''')))) <> N''VARIE'''
    + N' AND NOT (UPPER(ISNULL(x.[MacroCategoriaAbbonamentoDescrizione], N'''')) LIKE N''%ASI%'''
    + N' AND UPPER(ISNULL(x.[MacroCategoriaAbbonamentoDescrizione], N'''')) LIKE N''%ISCRIZIONE%'')';
END

DECLARE @AbbDescPred NVARCHAR(MAX) = NULL;
IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'AbbonamentoDescrizione') IS NOT NULL
  SET @AbbDescPred = N'CAST(x.[AbbonamentoDescrizione] AS NVARCHAR(400))';
ELSE IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'DescrizioneAbbonamento') IS NOT NULL
  SET @AbbDescPred = N'CAST(x.[DescrizioneAbbonamento] AS NVARCHAR(400))';
ELSE IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'Descrizione') IS NOT NULL
  SET @AbbDescPred = N'CAST(x.[Descrizione] AS NVARCHAR(400))';

IF @AbbDescPred IS NOT NULL
BEGIN
  SET @ExFull +=
      N' AND UPPER(ISNULL(' + @AbbDescPred + N', N'''')) NOT LIKE N''%TESSERAMENTI%'''
    + N' AND UPPER(ISNULL(' + @AbbDescPred + N', N'''')) NOT LIKE N''%ATTIVAZIONE%'''
    + N' AND UPPER(ISNULL(' + @AbbDescPred + N', N'''')) NOT LIKE N''%PHON ATTIVA%'''
    + N' AND NOT (UPPER(ISNULL(' + @AbbDescPred + N', N'''')) LIKE N''%ASI%'''
    + N' AND UPPER(ISNULL(' + @AbbDescPred + N', N'''')) LIKE N''%ISC%'')';
END

SET @ExFull += N' )';

-- --- Variante «min» esclusioni ---
DECLARE @ExMin NVARCHAR(MAX) = N'( 1 = 1';

IF COL_LENGTH(QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb), N'IDCategoria') IS NOT NULL
  SET @ExMin += N' AND ISNULL(x.[IDCategoria], 0) <> 19';

IF @AbbDescPred IS NOT NULL
BEGIN
  SET @ExMin +=
      N' AND UPPER(ISNULL(' + @AbbDescPred + N', N'''')) NOT LIKE N''%TESSERAMENTI%'''
    + N' AND UPPER(ISNULL(' + @AbbDescPred + N', N'''')) NOT LIKE N''%ATTIVAZIONE%'''
    + N' AND NOT (UPPER(ISNULL(' + @AbbDescPred + N', N'''')) LIKE N''%ASI%'''
    + N' AND UPPER(ISNULL(' + @AbbDescPred + N', N'''')) LIKE N''%ISC%'')';
END

SET @ExMin += N' )';

PRINT CONCAT(N'Periodo: ', CONVERT(NVARCHAR(10), @Da, 120), N' .. escluso ', CONVERT(NVARCHAR(10), @Al, 120));
PRINT CONCAT(N'PagatoExpr: ', @PagatoExpr);
PRINT CONCAT(N'DataPresentazione su Utenti: ', CASE WHEN @HasDataPres = 1 THEN N'SÌ (' + @ColDataPres + N')' ELSE N'NO — query [5–6] usano solo DataInizio abbonamento nel mese' END);

-- --- 1) Clienti con presentatore ---
DECLARE @Sql1 NVARCHAR(MAX) = N'
SELECT COUNT(*) AS Utenti_con_presentatore
FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti) + N' AS u
WHERE u.' + QUOTENAME(@ColPres) + N' IS NOT NULL;';

EXEC sys.sp_executesql @Sql1;

-- --- 2) Righe abbonamento nel mese (DataInizio nel range) ---
DECLARE @Sql2 NVARCHAR(MAX) = N'
SELECT COUNT(*) AS Righe_abbonamenti_nel_mese
FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb) + N' AS x
WHERE CAST(x.[DataInizio] AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
  AND CAST(x.[DataInizio] AS DATE) < CAST(N''' + @AlLit + N''' AS DATE);';

EXEC sys.sp_executesql @Sql2;

-- --- 3) Stesso mese + importo «effettivo» > 0 ---
DECLARE @Sql3 NVARCHAR(MAX) = N'
SELECT COUNT(*) AS Righe_nel_mese_con_importo_formula
FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb) + N' AS x
WHERE CAST(x.[DataInizio] AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
  AND CAST(x.[DataInizio] AS DATE) < CAST(N''' + @AlLit + N''' AS DATE)
  AND (' + @PagatoExpr + N') > 0;';

EXEC sys.sp_executesql @Sql3;

-- --- 4) Clienti con presentatore + abbonamento nel mese con pagato > 0 ---
DECLARE @Sql4 NVARCHAR(MAX) = N'
SELECT COUNT(DISTINCT u.[IDUtente]) AS Clienti_presentatore_con_abb_mese_pagato
FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti) + N' AS u
WHERE u.' + QUOTENAME(@ColPres) + N' IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb) + N' AS x
    WHERE x.[IDUtente] = u.[IDUtente]
      AND CAST(x.[DataInizio] AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
      AND CAST(x.[DataInizio] AS DATE) < CAST(N''' + @AlLit + N''' AS DATE)
      AND (' + @PagatoExpr + N') > 0
  );';

EXEC sys.sp_executesql @Sql4;

-- --- 5) Lista — mese su DataInizio abbonamento (diagnostica legacy se non usate [8–9]) ---
PRINT N'--- [5–6] Filtro mese su DataInizio abbonamento ---';

DECLARE @PagatoXInner NVARCHAR(MAX) = @PagatoExpr;

DECLARE @Sql5 NVARCHAR(MAX) = N'
SELECT
  u.[IDUtente] AS ClienteIDUtente,
  u.[Cognome] AS ClienteCognome,
  u.[Nome] AS ClienteNome,
  u.[Email],
  u.' + QUOTENAME(@ColPres) + N' AS IDPresentatore,
  pres.[Cognome] AS PresentatoreCognome,
  pres.[Nome] AS PresentatoreNome,
  a.[IDIscrizione] AS ReferralIDIscrizione,
  a.[DataInizio] AS ReferralDataInizio,
  a.[DataFine] AS ReferralDataFine,
  a.[PagatoEff] AS PagatoRiga,
  t.[TotaleMese] AS TotalePagatoMese,
  a.[AbbDescrCombined] AS DescAbbonamento
FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti) + N' AS u
LEFT JOIN ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti) + N' AS pres ON pres.[IDUtente] = u.' + QUOTENAME(@ColPres) + N'
OUTER APPLY (
  SELECT SUM((' + @PagatoXInner + N')) AS TotaleMese
  FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb) + N' AS x
  WHERE x.[IDUtente] = u.[IDUtente]
    AND CAST(x.[DataInizio] AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
    AND CAST(x.[DataInizio] AS DATE) < CAST(N''' + @AlLit + N''' AS DATE)
    AND (' + @PagatoXInner + N') > 0
    AND ' + @ExFull + N'
) AS t
CROSS APPLY (
  SELECT TOP 1
    x.[IDIscrizione],
    x.[DataInizio],
    x.[DataFine],
    (' + @PagatoXInner + N') AS PagatoEff,
    (' + @AbbDescrExpr + N') AS AbbDescrCombined
  FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb) + N' AS x
  WHERE x.[IDUtente] = u.[IDUtente]
    AND CAST(x.[DataInizio] AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
    AND CAST(x.[DataInizio] AS DATE) < CAST(N''' + @AlLit + N''' AS DATE)
    AND (' + @PagatoXInner + N') > 0
    AND ' + @ExFull + N'
  ORDER BY (' + @PagatoXInner + N') DESC, x.[DataInizio] DESC
) AS a
WHERE u.' + QUOTENAME(@ColPres) + N' IS NOT NULL
ORDER BY u.[Cognome], u.[Nome];';

EXEC sys.sp_executesql @Sql5;

-- --- 6) Stesso elenco con esclusioni «min» ---
PRINT N'--- Ripetizione query lista con esclusioni MIN ---';

DECLARE @Sql6 NVARCHAR(MAX) = REPLACE(@Sql5, @ExFull, @ExMin);

EXEC sys.sp_executesql @Sql6;

-- --- 8–9) Come FitCenter: mese su DataPresentazione; abbonamenti utili senza filtro DataInizio ---
IF @HasDataPres = 0
BEGIN
  PRINT N'--- [8–9] Saltate: aggiungi la colonna DataPresentazione su Utenti o imposta @ColDataPres al nome reale. ---';
END
ELSE
BEGIN
  DECLARE @PresBr SYSNAME = QUOTENAME(@ColDataPres);

  DECLARE @Sql8 NVARCHAR(MAX) = N'
SELECT
  u.[IDUtente] AS ClienteIDUtente,
  u.[Cognome] AS ClienteCognome,
  u.[Nome] AS ClienteNome,
  u.[Email],
  CAST(u.' + @PresBr + N' AS DATE) AS DataPresentazione,
  u.' + QUOTENAME(@ColPres) + N' AS IDPresentatore,
  pres.[Cognome] AS PresentatoreCognome,
  pres.[Nome] AS PresentatoreNome,
  a.[IDIscrizione] AS ReferralIDIscrizione,
  a.[DataInizio] AS ReferralDataInizio,
  a.[DataFine] AS ReferralDataFine,
  a.[PagatoEff] AS PagatoRiga,
  t.[TotaleMese] AS TotalePagatoMese,
  a.[AbbDescrCombined] AS DescAbbonamento
FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti) + N' AS u
LEFT JOIN ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblUtenti) + N' AS pres ON pres.[IDUtente] = u.' + QUOTENAME(@ColPres) + N'
OUTER APPLY (
  SELECT SUM((' + @PagatoXInner + N')) AS TotaleMese
  FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb) + N' AS x
  WHERE x.[IDUtente] = u.[IDUtente]
    AND CAST(x.[DataInizio] AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
    AND CAST(x.[DataInizio] AS DATE) < CAST(N''' + @AlLit + N''' AS DATE)
    AND (' + @PagatoXInner + N') > 0
    AND ' + @ExFull + N'
) AS t
CROSS APPLY (
  SELECT TOP 1
    x.[IDIscrizione],
    x.[DataInizio],
    x.[DataFine],
    (' + @PagatoXInner + N') AS PagatoEff,
    (' + @AbbDescrExpr + N') AS AbbDescrCombined
  FROM ' + QUOTENAME(@SchemaAbb) + N'.' + QUOTENAME(@TblAbb) + N' AS x
  WHERE x.[IDUtente] = u.[IDUtente]
    AND CAST(x.[DataInizio] AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
    AND CAST(x.[DataInizio] AS DATE) < CAST(N''' + @AlLit + N''' AS DATE)
    AND (' + @PagatoXInner + N') > 0
    AND ' + @ExFull + N'
  ORDER BY (' + @PagatoXInner + N') DESC, x.[DataInizio] DESC
) AS a
WHERE u.' + QUOTENAME(@ColPres) + N' IS NOT NULL
  AND CAST(u.' + @PresBr + N' AS DATE) >= CAST(N''' + @DaLit + N''' AS DATE)
  AND CAST(u.' + @PresBr + N' AS DATE) < CAST(N''' + @AlLit + N''' AS DATE)
ORDER BY u.[Cognome], u.[Nome];';

  PRINT N'--- [8] Lista referral — DataPresentazione nel periodo (FULL exclude) ---';
  EXEC sys.sp_executesql @Sql8;

  DECLARE @Sql9 NVARCHAR(MAX) = REPLACE(@Sql8, @ExFull, @ExMin);

  PRINT N'--- [9] Stesso elenco — esclusioni MIN ---';
  EXEC sys.sp_executesql @Sql9;
END

-- --- 7) Colonne della tabella abbonamenti ---
SELECT c.name AS ColumnName, t.name AS TypeName
FROM sys.columns AS c
JOIN sys.types AS t ON c.user_type_id = t.user_type_id
WHERE c.object_id = @Oid
ORDER BY c.column_id;
