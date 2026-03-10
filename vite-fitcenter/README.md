# FitCenter – Piattaforma gestione centro fitness e benessere

Piattaforma web modulare per la gestione di un centro fitness (palestra, piscine, spa, corsi, abbonamenti) con **CRM di vendita**, **abbonamenti & vendite** e **anagrafica clienti**. I dati possono essere letti dal **gestionale esistente** su Microsoft SQL Server.

## Moduli

- **Dashboard** – KPI (lead, abbonamenti attivi, entrate, conversione), grafici Vendite vs Budget, Lead per fonte, Abbonamenti per categoria, elenco in scadenza
- **CRM Vendita** – Pipeline lead (Nuovo → Contattato → Appuntamento → Tour → Proposta → Chiuso Vinto/Perso), filtri per fonte e consulente, colonna Interesse (Palestra, Piscina, Spa, Corsi, Full Premium)
- **Abbonamenti** – Abbonamenti attivi/scaduti, entrate e budget mese, tab Abbonamenti / Catalogo Piani / Andamento Vendite
- **Clienti** – Anagrafica clienti, totale/attivi/inattivi, abbonamenti attivi per cliente

## Dati da SQL Server (gestionale)

Configurando la **connection string** al database del gestionale, l’API legge tutti i dati da lì:

- **Anagrafiche clienti** – tabella/vista (es. `Clienti`)
- **Abbonamenti venduti** – tabella (es. `Abbonamenti`)
- **Lead/CRM** – tabella (es. `Lead`)
- **Budget mensile** – tabella (es. `BudgetMensile`)

Se `SQL_CONNECTION_STRING` non è impostata, l’app usa **dati mock** in memoria (lead, clienti, abbonamenti, budget) per sviluppo e demo.

### Configurazione

1. Copia `apps/api/.env.example` in `apps/api/.env`.
2. Imposta `SQL_CONNECTION_STRING` con la connection string al tuo SQL Server (es. `Server=...;Database=...;User Id=...;Password=...;Encrypt=true;TrustServerCertificate=true`).
3. Opzionale: imposta i nomi tabelle con `GESTIONALE_TABLE_CLIENTI`, `GESTIONALE_TABLE_ABBONAMENTI`, `GESTIONALE_TABLE_LEAD`, `GESTIONALE_TABLE_PIANI`, `GESTIONALE_TABLE_BUDGET` (default: Clienti, Abbonamenti, Lead, PianiAbbonamento, BudgetMensile).

L’API mappa colonne italiane/inglesi (Id, Nome, Cognome, Email, Telefono, Fonte, Stato, Categoria, DataInizio, DataFine, ecc.) ai modelli dell’app.

## Avvio in sviluppo

### 1. Installazione

```bash
pnpm install
```

(Oppure dalla root FitCenter: `cd vite-fitcenter` e poi `npx pnpm install`.)

### 2. Backend API

```bash
cd apps/api && pnpm install && pnpm dev
```

L’API è in ascolto su `http://localhost:3001`.

### 3. Frontend

Da root del monorepo (`vite-fitcenter`):

```bash
pnpm dev
```

Il frontend usa il proxy `/api` → `http://localhost:3001`.

## Struttura progetto

- `apps/web` – React (Vite), React Router, TanStack Query, Recharts (grafici)
- `apps/api` – Express, CORS, lettura da SQL Server (mssql) o mock
- `packages/ui` – Componenti UI condivisi

## Variabili d’ambiente

- **API**: `PORT` (default `3001`), `SQL_CONNECTION_STRING`, `GESTIONALE_TABLE_*`
- **Web**: `VITE_API_URL` (opzionale; in dev si usa il proxy)
