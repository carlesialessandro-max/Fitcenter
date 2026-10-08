-- Permessi CRM FitCenter (Abbonamenti in scadenza → gestionale).
-- Eseguire in SSMS sul server FitCenter (192.168.1.200), database dbgym, da un login amministratore.
--
-- USE [dbgym];
-- GO

GRANT SELECT ON dbo.AppuntamentiCategorieUtenti TO [fitcenter_lettura];
GRANT SELECT ON dbo.AppuntamentiStorico TO [fitcenter_lettura];

GRANT SELECT, INSERT ON dbo.AppuntamentiCategorieUtenti TO [fitcenter_api_write];
GRANT SELECT, INSERT ON dbo.AppuntamentiStorico TO [fitcenter_api_write];
GRANT SELECT ON dbo.AppuntamentiCategorie TO [fitcenter_api_write];
GRANT SELECT ON dbo.AppuntamentiTipo TO [fitcenter_api_write];
GRANT SELECT ON dbo.AppuntamentiEsito TO [fitcenter_api_write];
GRANT SELECT ON dbo.AppuntamentiStato TO [fitcenter_api_write];
GRANT SELECT ON dbo.Operatori TO [fitcenter_api_write];
GO
