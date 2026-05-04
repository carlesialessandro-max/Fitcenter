/*
  Debug Referral FitCenter — confronto con GET /data/referral-presentati (admin «Tutti i venditori»).

  Imposta anno/mese qui sotto ed esegui in SSMS sul database gestionale.
  Tabella clienti default: dbo.Utenti | Abbonamenti: dbo.AbbonamentiIscrizione
  Colonna presentatore default: IDPresentatore (override env: GESTIONALE_UTENTI_COL_ID_PRESENTATORE)
*/

DECLARE @Anno INT = 2026;
DECLARE @Mese INT = 5;

DECLARE @Da DATE = DATEFROMPARTS(@Anno, @Mese, 1);
DECLARE @Al DATE = DATEADD(MONTH, 1, @Da); /* fine esclusa, come nell’API */

PRINT CONCAT(N'Periodo referral: da ', CONVERT(NVARCHAR(10), @Da, 120), N' a escluso ', CONVERT(NVARCHAR(10), @Al, 120));

/*-----------------------------------------------------------------------------
  1) Quanti clienti hanno un presentatore (IDPresentatore valorizzato)?
-----------------------------------------------------------------------------*/
SELECT COUNT(*) AS Utenti_con_presentatore
FROM dbo.Utenti AS u
WHERE u.IDPresentatore IS NOT NULL;

/*-----------------------------------------------------------------------------
  2) Righe abbonamento nel mese (qualsiasi cliente), senza altri filtri
-----------------------------------------------------------------------------*/
SELECT COUNT(*) AS Righe_abbonamenti_nel_mese
FROM dbo.AbbonamentiIscrizione AS x
WHERE CAST(x.DataInizio AS DATE) >= @Da
  AND CAST(x.DataInizio AS DATE) < @Al;

/*-----------------------------------------------------------------------------
  3) Stesso mese ma solo ImportoPagato/Pagato/… > 0 (formula come API)
-----------------------------------------------------------------------------*/
SELECT COUNT(*) AS Righe_nel_mese_con_importo_pagato_formula
FROM dbo.AbbonamentiIscrizione AS x
WHERE CAST(x.DataInizio AS DATE) >= @Da
  AND CAST(x.DataInizio AS DATE) < @Al
  AND COALESCE(x.ImportoPagato, x.Pagato, x.Versato, x.Incassato, x.Acconto, x.Importo, x.Totale, 0) > 0;

/*-----------------------------------------------------------------------------
  4) Clienti con presentatore che hanno ALMENO un abbonamento nel mese con formula > 0
     (ancora SENZA esclusioni tesseramenti — se qui è 0 il problema è date/pagato)
-----------------------------------------------------------------------------*/
SELECT COUNT(DISTINCT u.IDUtente) AS Clienti_presentatore_con_abb_mese_pagato
FROM dbo.Utenti AS u
WHERE u.IDPresentatore IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM dbo.AbbonamentiIscrizione AS x
    WHERE x.IDUtente = u.IDUtente
      AND CAST(x.DataInizio AS DATE) >= @Da
      AND CAST(x.DataInizio AS DATE) < @Al
      AND COALESCE(x.ImportoPagato, x.Pagato, x.Versato, x.Incassato, x.Acconto, x.Importo, x.Totale, 0) > 0
  );

/*-----------------------------------------------------------------------------
  5) QUERY FINALE come API (esclusioni «full» — se fallisce per colonne mancanti,
     usa il blocco 5b più sotto)
-----------------------------------------------------------------------------*/
SELECT
  u.IDUtente AS ClienteIDUtente,
  u.Cognome AS ClienteCognome,
  u.Nome AS ClienteNome,
  u.Email,
  u.IDPresentatore,
  pres.Cognome AS PresentatoreCognome,
  pres.Nome AS PresentatoreNome,
  a.IDIscrizione AS ReferralIDIscrizione,
  a.DataInizio AS ReferralDataInizio,
  a.DataFine AS ReferralDataFine,
  COALESCE(a.ImportoPagato, a.Pagato, a.Versato, a.Incassato, a.Acconto, a.Importo, a.Totale, 0) AS PagatoRiga,
  t.TotaleMese AS TotalePagatoMese,
  COALESCE(a.AbbonamentoDescrizione, a.DescrizioneAbbonamento, N'') AS DescAbbonamento
FROM dbo.Utenti AS u
LEFT JOIN dbo.Utenti AS pres ON pres.IDUtente = u.IDPresentatore
OUTER APPLY (
  SELECT SUM(COALESCE(x.ImportoPagato, x.Pagato, x.Versato, x.Incassato, x.Acconto, x.Importo, x.Totale, 0)) AS TotaleMese
  FROM dbo.AbbonamentiIscrizione AS x
  WHERE x.IDUtente = u.IDUtente
    AND CAST(x.DataInizio AS DATE) >= @Da
    AND CAST(x.DataInizio AS DATE) < @Al
    AND COALESCE(x.ImportoPagato, x.Pagato, x.Versato, x.Incassato, x.Acconto, x.Importo, x.Totale, 0) > 0
    AND (
      ISNULL(x.IDCategoria, 0) <> 19
      AND UPPER(ISNULL(x.AbbonamentoDurataDescrizione, N'')) <> N'TESSERAMENTO GARE'
      AND UPPER(ISNULL(x.CategoriaAbbonamentoDescrizione, N'')) NOT LIKE N'%TESSERAMENTI%'
      AND UPPER(LTRIM(RTRIM(ISNULL(x.MacroCategoriaAbbonamentoDescrizione, N'')))) <> N'VARIE'
      AND NOT (
        UPPER(ISNULL(x.MacroCategoriaAbbonamentoDescrizione, N'')) LIKE N'%ASI%'
        AND UPPER(ISNULL(x.MacroCategoriaAbbonamentoDescrizione, N'')) LIKE N'%ISCRIZIONE%'
      )
      AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) NOT LIKE N'%TESSERAMENTI%'
      AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) NOT LIKE N'%ATTIVAZIONE%'
      AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) NOT LIKE N'%PHON ATTIVA%'
      AND NOT (
        UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) LIKE N'%ASI%'
        AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) LIKE N'%ISC%'
      )
    )
) AS t
CROSS APPLY (
  SELECT TOP 1
    x.IDIscrizione,
    x.DataInizio,
    x.DataFine,
    x.ImportoPagato,
    x.Pagato,
    x.Importo,
    x.Totale,
    COALESCE(x.AbbonamentoDescrizione, x.DescrizioneAbbonamento, N'') AS AbbonamentoDescrizione
  FROM dbo.AbbonamentiIscrizione AS x
  WHERE x.IDUtente = u.IDUtente
    AND CAST(x.DataInizio AS DATE) >= @Da
    AND CAST(x.DataInizio AS DATE) < @Al
    AND COALESCE(x.ImportoPagato, x.Pagato, x.Versato, x.Incassato, x.Acconto, x.Importo, x.Totale, 0) > 0
    AND (
      ISNULL(x.IDCategoria, 0) <> 19
      AND UPPER(ISNULL(x.AbbonamentoDurataDescrizione, N'')) <> N'TESSERAMENTO GARE'
      AND UPPER(ISNULL(x.CategoriaAbbonamentoDescrizione, N'')) NOT LIKE N'%TESSERAMENTI%'
      AND UPPER(LTRIM(RTRIM(ISNULL(x.MacroCategoriaAbbonamentoDescrizione, N'')))) <> N'VARIE'
      AND NOT (
        UPPER(ISNULL(x.MacroCategoriaAbbonamentoDescrizione, N'')) LIKE N'%ASI%'
        AND UPPER(ISNULL(x.MacroCategoriaAbbonamentoDescrizione, N'')) LIKE N'%ISCRIZIONE%'
      )
      AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) NOT LIKE N'%TESSERAMENTI%'
      AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) NOT LIKE N'%ATTIVAZIONE%'
      AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) NOT LIKE N'%PHON ATTIVA%'
      AND NOT (
        UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) LIKE N'%ASI%'
        AND UPPER(ISNULL(x.AbbonamentoDescrizione, N'')) LIKE N'%ISC%'
      )
    )
  ORDER BY COALESCE(x.ImportoPagato, x.Pagato, x.Versato, x.Incassato, x.Acconto, x.Importo, x.Totale, 0) DESC,
           x.DataInizio DESC
) AS a
WHERE u.IDPresentatore IS NOT NULL
ORDER BY u.Cognome, u.Nome;

/*
-----------------------------------------------------------------------------
  5b) FALLBACK se la query 5 dà errore (colonne macro/categoria assenti):
      stesse date e pagato, solo IDCategoria + AbbonamentoDescrizione
-----------------------------------------------------------------------------
SELECT
  u.IDUtente,
  u.Cognome,
  u.Nome,
  u.IDPresentatore,
  a.IDIscrizione,
  a.DataInizio,
  COALESCE(a.ImportoPagato, a.Pagato, a.Importo, a.Totale, 0) AS PagatoRiga
FROM dbo.Utenti AS u
CROSS APPLY (
  SELECT TOP 1 x.*
  FROM dbo.AbbonamentiIscrizione AS x
  WHERE x.IDUtente = u.IDUtente
    AND CAST(x.DataInizio AS DATE) >= @Da
    AND CAST(x.DataInizio AS DATE) < @Al
    AND COALESCE(x.ImportoPagato, x.Pagato, x.Versato, x.Incassato, x.Acconto, x.Importo, x.Totale, 0) > 0
    AND ISNULL(x.IDCategoria, 0) <> 19
    AND UPPER(ISNULL(CAST(x.AbbonamentoDescrizione AS NVARCHAR(400)), N'')) NOT LIKE N'%TESSERAMENTI%'
    AND UPPER(ISNULL(CAST(x.AbbonamentoDescrizione AS NVARCHAR(400)), N'')) NOT LIKE N'%ATTIVAZIONE%'
    AND NOT (
      UPPER(ISNULL(CAST(x.AbbonamentoDescrizione AS NVARCHAR(400)), N'')) LIKE N'%ASI%'
      AND UPPER(ISNULL(CAST(x.AbbonamentoDescrizione AS NVARCHAR(400)), N'')) LIKE N'%ISC%'
    )
  ORDER BY COALESCE(x.ImportoPagato, x.Pagato, x.Importo, x.Totale, 0) DESC, x.DataInizio DESC
) AS a
WHERE u.IDPresentatore IS NOT NULL
ORDER BY u.Cognome, u.Nome;
*/

/*-----------------------------------------------------------------------------
  6) Opzionale — filtro consulente come nell’app quando NON è «Tutti»:
     decommentare e impostare @IdVenditore (es. 336 Carmen)
-----------------------------------------------------------------------------
DECLARE @IdVenditore INT = 336;

SELECT ...
-- aggiungere nella WHERE interna sugli x:
-- AND x.IDVenditore = @IdVenditore
-- (oppure Abbonanditore se usate quella colonna)
-----------------------------------------------------------------------------*/
