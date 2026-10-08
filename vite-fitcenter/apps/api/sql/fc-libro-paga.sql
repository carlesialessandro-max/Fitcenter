-- Libro paga FitCenter — tabelle SQL Server (stesso database del gestionale, es. dbgym).
-- Lanciare in SSMS sul server FitCenter (192.168.1.200), NON su phpMyAdmin Aruba (quello è MySQL).
-- Le tabelle Fc* non toccano anagrafiche/abbonamenti del gestionale.

-- USE [dbgym];
-- GO

IF OBJECT_ID(N'dbo.FcLibroPagaLivelli', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaLivelli (
  Id NVARCHAR(64) NOT NULL PRIMARY KEY,
  Nome NVARCHAR(200) NOT NULL,
  ParentId NVARCHAR(64) NULL,
  Retribuzione DECIMAL(10,2) NOT NULL CONSTRAINT DF_FcLpLiv_Pay DEFAULT 0,
  Fissa BIT NOT NULL CONSTRAINT DF_FcLpLiv_Fissa DEFAULT 0,
  Retribuibile BIT NOT NULL CONSTRAINT DF_FcLpLiv_Ret DEFAULT 1,
  Statistica BIT NOT NULL CONSTRAINT DF_FcLpLiv_Stat DEFAULT 0,
  Speciale BIT NOT NULL CONSTRAINT DF_FcLpLiv_Spec DEFAULT 0,
  SpecialeId NVARCHAR(64) NULL,
  Attivo BIT NOT NULL CONSTRAINT DF_FcLpLiv_Attivo DEFAULT 1
);
GO

IF OBJECT_ID(N'dbo.FcLibroPagaPersonale', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaPersonale (
  Id NVARCHAR(64) NOT NULL PRIMARY KEY,
  Nome NVARCHAR(200) NOT NULL,
  Cognome NVARCHAR(200) NULL,
  Username NVARCHAR(120) NULL,
  Ruolo NVARCHAR(20) NOT NULL CONSTRAINT DF_FcLpPer_Ruolo DEFAULT N'user',
  LivelloId NVARCHAR(64) NULL,
  Contratto DATE NULL,
  Iban NVARCHAR(34) NULL,
  Tesseramento NVARCHAR(120) NULL,
  TesseramentoScadenza DATE NULL,
  Qualifiche NVARCHAR(400) NULL,
  Attivo BIT NOT NULL CONSTRAINT DF_FcLpPer_Attivo DEFAULT 1
);
GO
IF COL_LENGTH('dbo.FcLibroPagaPersonale','Tesseramento') IS NULL ALTER TABLE dbo.FcLibroPagaPersonale ADD Tesseramento NVARCHAR(120) NULL;
IF COL_LENGTH('dbo.FcLibroPagaPersonale','TesseramentoScadenza') IS NULL ALTER TABLE dbo.FcLibroPagaPersonale ADD TesseramentoScadenza DATE NULL;
IF COL_LENGTH('dbo.FcLibroPagaPersonale','Qualifiche') IS NULL ALTER TABLE dbo.FcLibroPagaPersonale ADD Qualifiche NVARCHAR(400) NULL;
GO

IF OBJECT_ID(N'dbo.FcLibroPagaTurni', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaTurni (
  Id NVARCHAR(64) NOT NULL PRIMARY KEY,
  PersonaleId NVARCHAR(64) NOT NULL,
  LivelloId NVARCHAR(64) NOT NULL,
  Giorno DATE NOT NULL,
  Quantita DECIMAL(10,2) NOT NULL,
  Importo DECIMAL(10,2) NOT NULL,
  Note NVARCHAR(500) NULL,
  CreatoDa NVARCHAR(120) NOT NULL,
  CreatedAt DATETIME2 NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_FcLibroPagaTurni_Giorno' AND object_id = OBJECT_ID(N'dbo.FcLibroPagaTurni'))
CREATE INDEX IX_FcLibroPagaTurni_Giorno ON dbo.FcLibroPagaTurni (Giorno, PersonaleId);
GO

IF OBJECT_ID(N'dbo.FcLibroPagaPresenze', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FcLibroPagaPresenze (
    Id NVARCHAR(64) NOT NULL PRIMARY KEY,
    TurnoId NVARCHAR(64) NOT NULL,
    Valore DECIMAL(10,2) NOT NULL,
    ControllatoDa NVARCHAR(120) NOT NULL,
    ControllatoAt DATETIME2 NOT NULL
  );
  CREATE UNIQUE INDEX UX_FcLibroPagaPresenze_Turno ON dbo.FcLibroPagaPresenze (TurnoId);
END
GO

IF OBJECT_ID(N'dbo.FcLibroPagaMensilita', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FcLibroPagaMensilita (
    Id NVARCHAR(64) NOT NULL PRIMARY KEY,
    PersonaleId NVARCHAR(64) NOT NULL,
    Mese CHAR(7) NOT NULL,
    Bonifico DECIMAL(10,2) NOT NULL,
    Nota NVARCHAR(500) NULL,
    Chiuso BIT NOT NULL CONSTRAINT DF_FcLpMen_Chiuso DEFAULT 0
  );
  CREATE UNIQUE INDEX UX_FcLibroPagaMensilita ON dbo.FcLibroPagaMensilita (PersonaleId, Mese);
END
GO

IF OBJECT_ID(N'dbo.FcLibroPagaValidazioni', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaValidazioni (
  Id NVARCHAR(64) NOT NULL PRIMARY KEY,
  PersonaleId NVARCHAR(64) NOT NULL,
  Giorno DATE NOT NULL,
  Stamp DATETIME2 NOT NULL
);
GO

IF OBJECT_ID(N'dbo.FcLibroPagaTotaliReparto', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaTotaliReparto (
  Mese CHAR(7) NOT NULL PRIMARY KEY,
  Piscina DECIMAL(12,2) NOT NULL,
  Palestra DECIMAL(12,2) NOT NULL,
  Ristorante DECIMAL(12,2) NOT NULL,
  Miscellanea DECIMAL(12,2) NOT NULL,
  Totale DECIMAL(12,2) NOT NULL
);
GO

IF OBJECT_ID(N'dbo.FcLibroPagaMacroQuote', N'U') IS NULL
CREATE TABLE dbo.FcLibroPagaMacroQuote (
  LivelloId NVARCHAR(64) NOT NULL PRIMARY KEY,
  Nome NVARCHAR(120) NOT NULL,
  Piscina DECIMAL(6,4) NOT NULL,
  Palestra DECIMAL(6,4) NOT NULL,
  Ristorante DECIMAL(6,4) NOT NULL
);
GO
