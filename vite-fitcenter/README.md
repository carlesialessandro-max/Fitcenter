# FitCenter – Piattaforma gestione centro fitness e benessere

Piattaforma web modulare per la gestione di un centro fitness (palestra, piscine, spa, corsi, abbonamenti) con **CRM di vendita**, **abbonamenti & vendite** e **anagrafica clienti**. I dati possono essere letti dal **gestionale esistente** su Microsoft SQL Server.

## Moduli

- **Dashboard** – KPI (lead, abbonamenti attivi, entrate, conversione), grafici Vendite vs Budget, Lead per fonte, Abbonamenti per categoria, elenco in scadenza
- **CRM Vendita** – Pipeline lead (Nuovo → Contattato → Appuntamento → Tour → Proposta → Chiuso Vinto/Perso), filtri per fonte e consulente, colonna Interesse (Palestra, Piscina, Spa, Corsi, Full Premium)
- **Abbonamenti** – Abbonamenti attivi/scaduti, entrate e budget mese, tab Abbonamenti / Catalogo Piani / Andamento Vendite
- **Clienti** – Anagrafica clienti, totale/attivi/inattivi, abbonamenti attivi per cliente

## Lead e storico

I **lead** restano tutti nello **storico** (store locale): non si importano dal gestionale. Le fonti sono:

- **Sito web** – moduli di contatto
- **Facebook Ads** – campagne
- **Google Ads** – campagne
- **Tour spontaneo** – inserimento manuale (solo per walk-in dal pulsante “Aggiungi lead (tour spontanei)”)

In filtro “Tutte le fonti” non compaiono SQL Server né Amministratore (solo consulenti operativi).

## Integrazione lead: Zapier, campagne FB/Google, email/SMS

I lead da **sito**, **Facebook**, **Google** (e in futuro email/SMS) possono arrivare tramite **Zapier** (o Make, n8n, webhook custom) chiamando l’API.

### Endpoint per creare un lead

```http
POST /api/leads
Content-Type: application/json

{
  "nome": "Mario",
  "cognome": "Rossi",
  "email": "mario.rossi@email.it",
  "telefono": "+39 333 1234567",
  "fonte": "website",
  "interesse": "palestra"
}
```

- **fonte** obbligatorio: `"website"` | `"facebook"` | `"google"` (per Zapier/campagne; i tour spontanei usano `"tour_spontaneo"` e si inseriscono solo da interfaccia).
- **interesse** opzionale: `"palestra"` | `"piscina"` | `"spa"` | `"corsi"` | `"full_premium"`.
- **fonteDettaglio**, **note** opzionali.

### Esempio Zapier

1. Trigger: “Form Submit” (sito) / “Facebook Lead Ads” / “Google Ads – New Lead”.
2. Action: “Webhooks by Zapier” → **POST** all’URL `https://tuo-dominio/api/leads` (o `http://localhost:3001/api/leads` in test).
3. Body: mappa i campi del trigger su `nome`, `cognome`, `email`, `telefono`, `fonte` (es. `"website"` o `"facebook"` o `"google"`), eventualmente `interesse`.

Per **email** o **SMS** puoi usare lo stesso endpoint: uno Zap che al ricevere l’email/SMS invia la POST con i dati estratti e `fonte` appropriato (es. un valore custom se in futuro lo supporti, oppure `"website"` come generico).

## Dati da SQL Server (gestionale)

Dal gestionale si leggono **solo**:

- **Anagrafiche clienti** – tabella (es. `Clienti`): nome, cognome, email, telefono, ecc.
- **Abbonamenti** – tabella (es. `Abbonamenti`): tipologia, prezzo, scadenza, collegamento cliente.

**Non** si importano da SQL: Lead (arrivano da sito/FB/Google/Zapier), Budget (assegnato ogni mese dall’admin), Piani/Catalogo.

Se `SQL_CONNECTION_STRING` non è impostata, l’app usa **dati mock** in memoria.

### Autenticazione e permessi (come da team gestionale)

Il database è su **Microsoft SQL Server**. Il team che gestisce il gestionale **non fornisce utenti o password SQL** (non svolgono amministrazione sull’infrastruttura). L’accesso avviene così:

- **Autenticazione Windows**: potete accedere tramite autenticazione Windows e **creare in autonomia** l’utente (o account di servizio) necessario con **permessi di sola lettura** sul database.
- **Supporto dati**: una volta connessi, la consultazione e l’estrazione dei dati è in autonomia; non viene fornito supporto sulla conformità dei dati letti.

In pratica: eseguite l’API FitCenter con un **account Windows** (utente di dominio o account di servizio) a cui sia stato garantito accesso in **sola lettura** al database del gestionale. Nessun User Id / Password SQL da configurare se usate Windows Auth.

### Configurazione

1. Copia `apps/api/.env.example` in `apps/api/.env`.
2. **Autenticazione Windows** (consigliata):
   - Connection string con `Integrated Security=true`, es.:  
     `Server=nomehost;Database=NomeDatabase;Integrated Security=true;Encrypt=true;TrustServerCertificate=true`
   - Su **Windows**, per l’integrated security installa il driver opzionale:  
     `pnpm add msnodesqlv8` (nella cartella `apps/api`).
   - Esegui l’app con l’account Windows che ha accesso in sola lettura al DB.
3. **Autenticazione SQL** (solo se avete un login SQL con sola lettura):  
   `Server=host;Database=db;User Id=lettura;Password=***;Encrypt=true;TrustServerCertificate=true`
4. Opzionale: `GESTIONALE_TABLE_CLIENTI`, `GESTIONALE_TABLE_ABBONAMENTI` per i nomi delle tabelle.

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

## Uso in rete locale (stesso PC o più PC in LAN)

Per usare FitCenter **sul tuo PC** o su **più PC della stessa rete** (senza pubblicare su internet):

1. **Un solo programma da avviare**: l’API serve anche il frontend, così non serve aprire due processi.

2. Dalla cartella **vite-fitcenter**:
   ```bash
   pnpm install
   pnpm build
   pnpm start
   ```

3. **Sul PC dove gira l’app** apri il browser su:  
   `http://localhost:3001`  
   (login e uso come in sviluppo.)

4. **Da altri PC della stessa rete**: apri il browser su  
   `http://<IP-del-PC-dove-gira-FitCenter>:3001`  
   (es. `http://192.168.1.50:3001`).  
   L’IP lo vedi in Windows con `ipconfig` (IPv4), su Mac/Linux con `ip addr` o `ifconfig`.

5. Opzionale: in `apps/api/.env` puoi impostare `PORT=3001` (o un’altra porta) e `HOST=0.0.0.0` (default: l’app è già in ascolto su tutte le interfacce).

**Riassunto**: `pnpm build` poi `pnpm start`; un solo indirizzo per tutti (locale o IP in LAN). Non serve pubblicare online: funziona solo in rete locale.

## Struttura progetto

- `apps/web` – React (Vite), React Router, TanStack Query, Recharts (grafici)
- `apps/api` – Express, CORS, lettura da SQL Server (mssql) o mock
- `packages/ui` – Componenti UI condivisi

## Variabili d’ambiente

- **API**: `PORT` (default `3001`), `SQL_CONNECTION_STRING`, `GESTIONALE_TABLE_*`
- **Web**: `VITE_API_URL` (opzionale; in dev si usa il proxy)
