/*
  Verifica tabella/colonna "presentatore" per Referral (porta un amico).
  Esegui in SSMS sul database gestionale.

  Ipotesi app: dbo.Utenti + colonna IDPresentatore (FK verso IDUtente del presentatore).
  Se i nomi differiscono, vedi elenco colonne con %Present% sotto.
*/

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
  5) Vista consulente (pagina Referral): clienti con IDPresentatore = ID della consulente.
*/
DECLARE @ConsultanteID INT = 0; -- <<< INSERISCI IDUtente consulente

SELECT u.IDUtente, u.Cognome, u.Nome, u.Email, u.SMS, u.IDPresentatore
FROM dbo.Utenti AS u
WHERE u.IDPresentatore = @ConsultanteID
ORDER BY u.Cognome, u.Nome;

-- 6) Opzionale: colonne data su Utenti (per filtrare modifiche di oggi)
-- SELECT c.name FROM sys.columns c
-- INNER JOIN sys.tables t ON t.object_id = c.object_id
-- INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
-- WHERE s.name = N'dbo' AND t.name = N'Utenti' AND c.name LIKE N'%Data%';
