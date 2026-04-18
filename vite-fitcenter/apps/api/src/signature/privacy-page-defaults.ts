/** Testo usato per generare la pagina Privacy/Clausole nei PDF firme (sostituzione/append ultima pagina). */
export type PrivacyPageText = {
  title1: string
  body1: string
  sig1: string
  title2: string
  body2: string
  sig2: string
}

export const PRIVACY_PAGE_TEXT_DEFAULT: PrivacyPageText = {
  title1: "1. INFORMATIVA E CONSENSO PRIVACY (GDPR 2016/679)",
  body1:
    "Il sottoscritto dichiara di aver ricevuto l’informativa ai sensi dell’art. 13 del Regolamento UE 679/2016. " +
    "Prende atto che il trattamento dei propri dati personali (e del minore rappresentato) per le finalità connesse all’iscrizione, " +
    "alla gestione del rapporto sportivo, alla copertura assicurativa e all’adempimento degli obblighi previsti dalla legge e dall’ordinamento sportivo " +
    "(comunicazione a Federazioni/Enti/Registro Nazionale Attività Sportive) è necessario all'esecuzione del contratto.\n\n" +
    "Consensi facoltativi: Il sottoscritto esprime altresì il proprio consenso specifico per l'invio di comunicazioni commerciali (Marketing) " +
    "e per l'utilizzo/pubblicazione della propria immagine (Art. 11) sui canali social e web della Società per fini divulgativi e promozionali.",
  sig1: "Firma per il trattamento dati : ________________________________________",
  title2: "2. APPROVAZIONE CLAUSOLE VESSATORIE (Art. 1341 e 1342 c.c.)",
  body2:
    "Il sottoscritto dichiara di aver letto e di approvare specificamente, ai sensi e per gli effetti degli artt. 1341 e 1342 del Codice Civile, " +
    "le seguenti clausole contrattuali contenute nel Regolamento a tergo:\n" +
    "• Art. 2: Risoluzione immediata del contratto e penale per uso indebito del braccialetto d'accesso;\n" +
    "• Art. 3: Limitazioni alla sospensione dell'abbonamento e rinuncia a pretese per chiusure imposte da Autorità o manutenzione;\n" +
    "• Art. 4 e 5: Esonero di responsabilità della Società per infortuni derivanti da comportamenti del cliente o terzi e limitazione responsabilità danni;\n" +
    "• Art. 6: Divieto di attività di personal training esterno e facoltà di sospensione/risoluzione per violazione norme di condotta;\n" +
    "• Art. 10: Facoltà della Società di modifica unilaterale di strutture, orari, corsi e servizi;\n" +
    "• Art. 11: Disciplina in caso di cessazione attività/forza maggiore e cessione diritti d'immagine.",
  sig2: "Firma per clausole specifiche  _______________________________________",
}
