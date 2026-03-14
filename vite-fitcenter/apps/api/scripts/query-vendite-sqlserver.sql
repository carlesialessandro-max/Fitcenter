-- =============================================================================
-- Query da eseguire su SQL Server per verificare i dati vendite / abbonamenti
-- Adatta i nomi tabelle se nel tuo DB sono diversi (es. MovimentiVenduto, AbbonamentiIscrizione, Utenti)
--
-- In app: si considerano SOLO movimenti con Importo > 0 (gli importi negativi sono esclusi).
-- Il venditore/consulente può essere in IDUtente, IDVenditore o IDOperatore a seconda del DB.
-- =============================================================================

-- 1) Movimenti con importo negativo (da escludere dai totali vendite)
SELECT 
  IDMovimento,
  IDUtente,
  IDVenditore,
  DataOperazione,
  Importo,
  TipoOperazione,
  TipoServizio,
  IDIscrizione
FROM MovimentiVenduto
WHERE Importo < 0
ORDER BY DataOperazione DESC;

-- 2) Totali per giorno (SOLO importi positivi, come in app) – ultimi 7 giorni
SELECT 
  CAST(DataOperazione AS DATE) AS Data,
  SUM(Importo) AS TotaleGiorno,
  COUNT(*) AS NumMovimentiGiorno
FROM MovimentiVenduto
WHERE Importo > 0
  AND DataOperazione >= DATEADD(DAY, -7, GETDATE())
GROUP BY CAST(DataOperazione AS DATE)
ORDER BY Data DESC;

-- 3) Totali per mese (SOLO importi positivi, come in app) – anno corrente
SELECT 
  YEAR(DataOperazione) AS Anno,
  MONTH(DataOperazione) AS Mese,
  SUM(Importo) AS TotaleMese,
  COUNT(*) AS NumMovimenti
FROM MovimentiVenduto
WHERE Importo > 0
  AND CAST(DataOperazione AS DATE) >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1)
  AND CAST(DataOperazione AS DATE) < DATEADD(YEAR, 1, DATEFROMPARTS(YEAR(GETDATE()), 1, 1))
GROUP BY YEAR(DataOperazione), MONTH(DataOperazione)
ORDER BY Anno, Mese;

-- 4) Totali per IDVenditore (solo Importo > 0) – mese corrente
SELECT 
  IDVenditore,
  COUNT(*) AS NumMovimenti,
  SUM(Importo) AS Totale
FROM MovimentiVenduto
WHERE Importo > 0
  AND YEAR(DataOperazione) = YEAR(GETDATE())
  AND MONTH(DataOperazione) = MONTH(GETDATE())
GROUP BY IDVenditore
ORDER BY Totale DESC;

-- 5) Totali per IDUtente (solo Importo > 0) – mese corrente
SELECT 
  IDUtente,
  COUNT(*) AS NumMovimenti,
  SUM(Importo) AS Totale
FROM MovimentiVenduto
WHERE Importo > 0
  AND CAST(DataOperazione AS DATE) >= @inizioMese
  AND CAST(DataOperazione AS DATE) < @fineMese
GROUP BY IDUtente
ORDER BY Totale DESC;

-- 6) Totali per IDOperatore (solo Importo > 0) – per confrontare con IDVenditore/IDUtente
SELECT 
  IDOperatore,
  COUNT(*) AS NumMovimenti,
  SUM(Importo) AS Totale
FROM MovimentiVenduto
WHERE Importo > 0
  AND YEAR(DataOperazione) = YEAR(GETDATE())
  AND MONTH(DataOperazione) = MONTH(GETDATE())
GROUP BY IDOperatore
ORDER BY Totale DESC;

-- 7) Valori distinti TipoOperazione / TipoServizio (per capire i tipi movimento)
SELECT DISTINCT TipoOperazione, TipoServizio
FROM MovimentiVenduto
ORDER BY TipoOperazione, TipoServizio;

-- 8) Abbonamenti in scadenza (da oggi a 60 giorni) con venditore
SELECT 
  a.IDIscrizione,
  a.IDUtente,
  a.IDVenditore,
  a.DataInizio,
  a.DataFine,
  a.Totale,
  a.NomeOperatore,
  u.Nome + ' ' + u.Cognome AS Cliente
FROM AbbonamentiIscrizione a
LEFT JOIN Utenti u ON u.IDUtente = a.IDUtente
WHERE a.DataFine >= CAST(GETDATE() AS DATE)
  AND a.DataFine <= DATEADD(DAY, 60, CAST(GETDATE() AS DATE))
ORDER BY a.DataFine;

-- 9) Mappa NomeOperatore -> IDVenditore (per verificare id consulenti)
SELECT DISTINCT 
  IDVenditore,
  NomeOperatore
FROM AbbonamentiIscrizione
WHERE NomeOperatore IS NOT NULL
ORDER BY NomeOperatore;

-- =============================================================================
-- SERENA: totale ieri e totale mese (stessa logica report: solo RVW_AbbonamentiUtenti.Totale)
-- Se "ieri" non torna (es. report 894 vs query 1512): il report potrebbe usare in Temp_Stampe
-- solo le iscrizioni vendute quel giorno (es. prima attivazione), non tutti i movimenti del giorno.
-- Verificare in MovimentiVenduto se esiste TipoOperazione/TipoServizio per filtrare solo le vendite.
-- =============================================================================

-- A) Totale venduto IERI per Serena (stessa logica report: solo RVW_AbbonamentiUtenti.Totale)
--    Iscrizioni con movimento ieri (da MovimentiVenduto), poi somma Totale dalla view (una volta per IDIscrizione).
DECLARE @ieri DATE = DATEADD(DAY, -1, CAST(GETDATE() AS DATE));

SELECT 
  @ieri AS Data,
  SUM(X.Totale) AS TotaleGiorno,
  COUNT(*) AS NumAbbonamenti
FROM (
  SELECT R.IDIscrizione, MAX(R.Totale) AS Totale
  FROM RVW_AbbonamentiUtenti R
  INNER JOIN (
    SELECT DISTINCT M.IDIscrizione
    FROM MovimentiVenduto M
    WHERE M.Importo > 0
      AND CAST(M.DataOperazione AS DATE) = @ieri
  ) Giorno ON Giorno.IDIscrizione = R.IDIscrizione
  WHERE R.NomeVenditoreAbbonamento LIKE '%Serena%'
  GROUP BY R.IDIscrizione
) X;

-- A1) DETTAGLIO: righe della view che concorrono al totale ieri per Serena
--     (se la stessa IDIscrizione appare più volte il totale è sovrastimato)
SELECT 
  R.IDIscrizione,
  R.IDVenditoreAbbonamento,
  R.NomeVenditoreAbbonamento,
  R.Totale
FROM RVW_AbbonamentiUtenti R
INNER JOIN (
  SELECT DISTINCT M.IDIscrizione
  FROM MovimentiVenduto M
  WHERE M.Importo > 0
    AND CAST(M.DataOperazione AS DATE) = @ieri
) Giorno ON Giorno.IDIscrizione = R.IDIscrizione
WHERE R.NomeVenditoreAbbonamento LIKE '%Serena%'
ORDER BY R.IDIscrizione, R.IDVenditoreAbbonamento;

-- A2) Per capire perché ieri è 1512 invece di 894: tipi di movimento presenti il 12/03
--     (se il report conta solo un certo TipoOperazione/TipoServizio, filtra qui)
SELECT M.TipoOperazione, M.TipoServizio, COUNT(*) AS Num, SUM(M.Importo) AS SommaImporto
FROM MovimentiVenduto M
WHERE M.Importo > 0
  AND CAST(M.DataOperazione AS DATE) = CAST('2026-03-12' AS DATE)
GROUP BY M.TipoOperazione, M.TipoServizio
ORDER BY SommaImporto DESC;

-- B) Totale venduto dal 1 marzo a oggi per Serena (stessa logica report: solo RVW_AbbonamentiUtenti.Totale)
--    Come in A: iscrizioni con movimento nel periodo, poi somma Totale dalla view (una volta per IDIscrizione).
SELECT 
  SUM(X.Totale) AS TotaleMese,
  COUNT(*) AS NumAbbonamenti
FROM (
  SELECT R.IDIscrizione, MAX(R.Totale) AS Totale
  FROM RVW_AbbonamentiUtenti R
  INNER JOIN (
    SELECT DISTINCT M.IDIscrizione
    FROM MovimentiVenduto M
    WHERE M.Importo > 0
      AND M.DataOperazione >= DATEFROMPARTS(YEAR(GETDATE()), 3, 1)
      AND M.DataOperazione < CAST(GETDATE() AS DATE) + 1
  ) Periodo ON Periodo.IDIscrizione = R.IDIscrizione
  WHERE R.NomeVenditoreAbbonamento LIKE '%Serena%'
  GROUP BY R.IDIscrizione
) X;

-- C) Stessa logica del report di stampa: totale per venditore del giorno 12/03/2026
--    (usa Totale dalla view, abbonamenti con movimento in quel giorno)
--    Sostituisci la tabella Temp_Stampe con l’elenco IDIscrizione del giorno (es. da MovimentiVenduto).
SELECT 
  R.NomeVenditoreAbbonamento,
  R.IDVenditoreAbbonamento,
  SUM(R.Totale) AS Totale,
  COUNT(R.IDIscrizione) AS NumAbbonamenti
FROM RVW_AbbonamentiUtenti R
INNER JOIN (
  SELECT DISTINCT M.IDIscrizione
  FROM MovimentiVenduto M
  WHERE M.Importo > 0
    AND CAST(M.DataOperazione AS DATE) >= CAST('2026-03-12' AS DATE)
    AND CAST(M.DataOperazione AS DATE) < CAST('2026-03-13' AS DATE)
) Giorno ON Giorno.IDIscrizione = R.IDIscrizione
GROUP BY R.NomeVenditoreAbbonamento, R.IDVenditoreAbbonamento;
