/*
  Verifica tabella/colonna "presentatore" per Referral (porta un amico).
  Esegui in SSMS sul database gestionale.

  Ipotesi app: dbo.Utenti + colonna IDPresentatore (FK verso IDUtente del presentatore).
  Se i nomi differiscono, vedi elenco colonne con %Present% sotto.

  --- Lettura schermata Extra / Altro ---
  "Presentato da" = IDPresentatore sulla RIGA dell'utente che stai modificando.
                    Se nel gestionale e' NESSUN UTENTE, in SQL su quella riga trovi NULL (corretto).

  "Ha presentato"   = NON e' un campo sulla riga del presentatore: sono gli ALTRI utenti che hanno
                    IDPresentatore = IDUtente di chi ha presentato.
                    Per Mazza Saverio: cercare righe dove IDPresentatore = ID di Mazza (es. 65846),
                    non guardare IDPresentatore sulla riga di Mazza.
*/

-- 0) Chi ha presentato qualcuno (lista "Ha presentato" nel gestionale) — es. Mazza Saverio
DECLARE @IdPresentatore INT = (
  SELECT TOP (1) u.IDUtente
  FROM dbo.Utenti AS u
  WHERE u.Cognome LIKE N'%Mazza%' AND u.Nome LIKE N'%Saverio%'
  ORDER BY u.IDUtente
);

SELECT @IdPresentatore AS IdUtente_del_presentatore;

SELECT u.IDUtente, u.Cognome, u.Nome, u.Email, u.SMS, u.IDPresentatore
FROM dbo.Utenti AS u
WHERE u.IDPresentatore = @IdPresentatore
ORDER BY u.Cognome, u.Nome;

-- Controllo incrociato sui nominativi mostrati in "Ha presentato"
SELECT u.IDUtente, u.Cognome, u.Nome, u.IDPresentatore,
       pres.Cognome AS PresentatoreCognome, pres.Nome AS PresentatoreNome
FROM dbo.Utenti AS u
LEFT JOIN dbo.Utenti AS pres ON pres.IDUtente = u.IDPresentatore
WHERE (u.Cognome LIKE N'%Acunzo%' AND u.Nome LIKE N'%Antonio%')
   OR (u.Cognome LIKE N'%Landini%' AND u.Nome LIKE N'%Mattia%');

-- 1) Colonne su dbo.Utenti che contengono "Present"
SELECT c.name AS column_name
FROM sys.columns c
INNER JOIN sys.tables t ON t.object_id = c.object_id
INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = N'dbo' AND t.name = N'Utenti' AND c.name LIKE N'%Present%'
ORDER BY c.name;

-- 2) Trova il tuo utente (es. Carlesi Alessandro)
SELECT u.IDUtente, u.Cognome, u.Nome, u.Email
FROM dbo.Utenti AS u
WHERE u.Cognome LIKE N'%Carlesi%' AND u.Nome LIKE N'%Alessandro%';

/*
  3) CASO TUO — Sei il cliente presentato: sul TUO record hai messo come presentatore l'utente "test prova".

  Deve risultare IDPresentatore valorizzato e il join su Utenti deve mostrare Cognome/Nome di "test prova".
*/
SELECT
  io.IDUtente AS MioClienteID,
  io.Cognome AS MioCognome,
  io.Nome AS MioNome,
  io.IDPresentatore,
  pres.IDUtente AS Presentatore_IDUtente,
  pres.Cognome AS PresentatoreCognome,
  pres.Nome AS PresentatoreNome
FROM dbo.Utenti AS io
LEFT JOIN dbo.Utenti AS pres ON pres.IDUtente = io.IDPresentatore
WHERE io.Cognome LIKE N'%Carlesi%' AND io.Nome LIKE N'%Alessandro%';

/*
  4) Trova l'IDUtente di "test prova" e tutti i clienti che lo hanno come presentatore
     (tu dovresti comparire nell'elenco se il punto 3 e' corretto).
*/
DECLARE @IdTestProva INT = (
  SELECT TOP (1) u.IDUtente
  FROM dbo.Utenti AS u
  WHERE (u.Cognome LIKE N'%test%' AND u.Nome LIKE N'%prova%')
     OR (u.Nome LIKE N'%test%' AND u.Cognome LIKE N'%prova%')
     OR ((u.Cognome + N' ' + u.Nome) LIKE N'%test%prova%')
  ORDER BY u.IDUtente
);

SELECT @IdTestProva AS IdUtente_Presentatore_TestProva;

SELECT u.IDUtente, u.Cognome, u.Nome, u.Email, u.SMS, u.IDPresentatore
FROM dbo.Utenti AS u
WHERE u.IDPresentatore = @IdTestProva
ORDER BY u.Cognome, u.Nome;

/*
  5) Pagina Referral FitCenter: clienti con porta-amico E abbonamento venduto dalla consulente.
     Verifica IDVenditore (o Abbonanditore) su Acunzo / Landini vs ID della consulente scelta nell'app.
*/
SELECT TOP (20)
  a.IDIscrizione,
  a.IDUtente,
  u.Cognome,
  u.Nome,
  u.IDPresentatore,
  a.IDVenditore,
  a.Abbonanditore,
  a.DataInizio,
  a.DataFine
FROM dbo.AbbonamentiIscrizione AS a
INNER JOIN dbo.Utenti AS u ON u.IDUtente = a.IDUtente
WHERE u.IDUtente IN (24, 16867)
ORDER BY u.Cognome, a.DataInizio DESC;

/*
  6) Clienti referral attesi per una consulente (un ID venditore; per piu' ID ripeti la query).
*/
DECLARE @IdVenditoreConsulente INT = 336; -- <<< ID consulente come in env / mapping app

SELECT DISTINCT u.IDUtente, u.Cognome, u.Nome, u.IDPresentatore
FROM dbo.Utenti AS u
WHERE u.IDPresentatore IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM dbo.AbbonamentiIscrizione AS a
    WHERE a.IDUtente = u.IDUtente
      AND (a.IDVenditore = @IdVenditoreConsulente OR TRY_CAST(a.Abbonanditore AS INT) = @IdVenditoreConsulente)
  );

-- Opzionale: colonne data su Utenti (per filtrare modifiche di oggi)
-- SELECT c.name FROM sys.columns c
-- INNER JOIN sys.tables t ON t.object_id = c.object_id
-- INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
-- WHERE s.name = N'dbo' AND t.name = N'Utenti' AND c.name LIKE N'%Data%';
