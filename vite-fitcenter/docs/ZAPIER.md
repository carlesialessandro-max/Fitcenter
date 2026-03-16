# Far arrivare i lead da Zapier in FitCenter

I trigger di Zapier (Facebook Lead Ads, Google Ads, form sul sito, ecc.) spesso creano il lead su un altro servizio. Per far finire **tutti** i lead qui in FitCenter, aggiungi un’**azione** che invia i dati al nostro webhook.

## URL del webhook FitCenter

- **Metodo:** `POST`
- **URL:** `https://TUO-DOMINIO/api/webhook/zapier`

Sostituisci `TUO-DOMINIO` con l’indirizzo reale della tua API (es. `https://api.fitcenter.it` o l’URL del server dove gira l’app).

### Test in locale con ngrok

Zapier non può chiamare `localhost`. Con **ngrok** esponi l'API in modo che Zapier possa inviare i lead al webhook:

1. Avvia l'API in locale (es. su porta 3001 o 80).
2. Avvia ngrok: `ngrok http 3001` (o la porta dell'API). Se l'API è in ascolto su porta 80: `ngrok http 80`.
3. Copia l'URL **HTTPS** che ngrok mostra (es. `https://xxx.ngrok-free.dev`).
4. In Zapier usa come URL del webhook: `https://TUO-SOTTODOMINIO.ngrok-free.dev/api/webhook/zapier`.

**Nota:** con piano Free ngrok l'URL cambia a ogni avvio; per uno Zap stabile conviene un deploy dell'API (Railway, Render, ecc.) o un dominio ngrok a pagamento.

**Sito su Netlify:** va bene per testare il sito. L’API FitCenter però deve essere raggiungibile da Zapier: se hai il frontend su Netlify e l’API su un altro servizio (es. Railway, Render), usa l’URL di quell’API per il webhook. Se deployi anche l’API su Netlify (es. come funzione o servizio), l’URL del webhook sarà quello del progetto Netlify (es. `https://tuo-progetto.netlify.app/api/webhook/zapier` se hai configurato le rewrite verso l’API).

---

## Come configurare lo Zap

1. **Trigger:** lascia il tuo trigger com’è (es. “Facebook Lead Ads”, “Google Ads - New Lead”, “Webhooks by Zapier” per il form del sito).
2. **Azione:** aggiungi **Webhooks by Zapier** → **POST**.
3. **URL:** incolla l’URL qui sopra (`https://TUO-DOMINIO/api/webhook/zapier`).
4. **Payload Type:** `json`.
5. **Data:** mappa i campi del trigger ai nomi sotto.

### Campi da inviare (body JSON)

| Campo FitCenter | Obbligatorio | Cosa mappare da Zapier |
|-----------------|-------------|-------------------------|
| `nome`          | sì          | Nome / First Name       |
| `cognome`       | sì          | Cognome / Last Name     |
| `email`         | sì          | Email                   |
| `telefono`      | sì          | Telefono / Phone        |
| `fonte`         | no          | `"facebook"` \| `"google"` \| `"website"` \| `"zapier"` |
| `fonte_dettaglio` | no        | Nome campagna / form    |
| `interesse`     | no          | `palestra` \| `piscina` \| `spa` \| `corsi` \| `full_premium` |
| `note`          | no          | Note                    |

- Se non invii `fonte`, il lead viene salvato con fonte `"zapier"`.
- Per avere in CRM “Facebook”, “Google”, “Sito” imposta `fonte` in base allo Zap (es. in uno Zap che parte da Facebook Lead Ads metti `fonte` = **facebook**).

### Esempio body (un lead)

```json
{
  "nome": "Mario",
  "cognome": "Rossi",
  "email": "mario@example.com",
  "telefono": "+39 333 1234567",
  "fonte": "website"
}
```

### Più lead in una volta

Puoi inviare un array:

```json
{
  "data": [
    { "nome": "Mario", "cognome": "Rossi", "email": "mario@example.com", "telefono": "3331234567", "fonte": "facebook" },
    { "nome": "Laura", "cognome": "Bianchi", "email": "laura@example.com", "telefono": "3339876543", "fonte": "google" }
  ]
}
```

---

## Riassunto

- **Non** cambiare dove il trigger crea il lead (se lo fa su un altro URL): aggiungi **un passo in più**.
- Aggiungi l’azione **Webhooks by Zapier** → **POST** verso `https://TUO-DOMINIO/api/webhook/zapier` con il JSON sopra.
- Così ogni lead del trigger viene **anche** salvato in FitCenter e compare in CRM vendita.
