-- =============================================================================
-- Query di controllo: primi 5 abbonamenti di Serena
-- View: [dbo].[RVW_AbbonamentiUtenti]
-- Verifica IDCategoria, IDAbbonamento, IDMacroCategoria e relative descrizioni
-- per impostare l'esclusione tesseramenti (VARIE, TESSERAMENTI, ASI+ISCRIZIONE).
-- Adatta i nomi colonna se nella tua view sono diversi (es. NomeOperatore invece di NomeVenditoreAbbonamento).
-- =============================================================================

-- Filtro per Serena: ID 348 (valore default in .env CONSULENTE_ID_SERENA)
-- Se la colonna venditore ha altro nome (es. IDVenditore, Abbonanditore), cambia nel WHERE.
SELECT TOP 5
    a.IDIscrizione,
    a.IDUtente,
    a.Cognome,
    a.Nome,
    a.IDCategoria,
    a.IDAbbonamento,
    a.IDMacroCategoria,
    a.CategoriaAbbonamentoDescrizione,
    a.MacroCategoriaAbbonamentoDescrizione,
    a.AbbonamentoDescrizione,
    a.DataInizio,
    a.DataFine,
    a.Importo,
    a.IDVenditoreAbbonamento,
    a.NomeVenditoreAbbonamento
FROM [dbo].[RVW_AbbonamentiUtenti] a
WHERE a.IDVenditoreAbbonamento = 348
ORDER BY a.DataFine DESC;

