import { Link } from "react-router-dom"

export function InformativaPrivacy() {
  return (
    <div className="min-h-svh bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-zinc-100">Informativa Privacy</h1>
          <Link to="/" className="text-sm text-amber-400 hover:underline">
            Torna alla home
          </Link>
        </div>

        <p className="mt-2 text-sm text-zinc-300">
          Informativa sul trattamento dei dati personali ai sensi del Regolamento (UE) 2016/679 (GDPR) e del D.Lgs. 196/2003
          (Codice privacy italiano) come modificato dal D.Lgs. 101/2018.
        </p>

        <div className="mt-5 space-y-4 text-sm text-zinc-300">
          <section>
            <h2 className="font-semibold text-zinc-100">1. Titolare del trattamento</h2>
            <p className="mt-1">
              Il titolare del trattamento dei dati personali è:
              <br />
              <span className="font-medium">H2Sport / Aqua Sport SSD a r.l.</span>
              <br />
              Via Provinciale Lucchese 139, 51100 Pistoia (PT) — Tel. 0573 572649 — Email: info@h2sport.it.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-100">2. Finalità e base giuridica del trattamento</h2>
            <p className="mt-1">
              I dati personali da Lei forniti (nome, cognome, email, telefono, indirizzo e altri dati eventualmente comunicati) sono
              trattati per le seguenti finalità:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>gestione dell’iscrizione ai servizi (palestra, piscina, SPA, corsi) e delle prenotazioni;</li>
              <li>adempimento di obblighi contrattuali e precontrattuali;</li>
              <li>invio di comunicazioni relative ai servizi richiesti e ad eventuali aggiornamenti di orari o attività;</li>
              <li>adempimento di obblighi di legge (contabilità, fiscali, sanitari o sportivi);</li>
              <li>con il Suo consenso esplicito: invio di newsletter o promozioni commerciali.</li>
            </ul>
            <p className="mt-2">
              La base giuridica del trattamento è l’esecuzione del contratto, l’obbligo di legge o, per le attività di marketing, il
              consenso facoltativo revocabile in qualsiasi momento.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-100">3. Categorie di dati e modalità di trattamento</h2>
            <p className="mt-1">
              Sono trattati dati identificativi (nome, cognome, codice fiscale, indirizzo), di contatto (email, telefono), eventuali
              dati sanitari o sportivi strettamente necessari per l’erogazione del servizio, e dati di navigazione sul sito ove
              applicabile (si veda la Cookie Policy).
            </p>
            <p className="mt-2">
              I dati sono trattati con strumenti elettronici e/o cartacei, con logiche strettamente correlate alle finalità indicate
              e con misure di sicurezza adeguate a ridurre i rischi di accesso non autorizzato, perdita o distruzione illecita.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-100">4. Conservazione e destinatari</h2>
            <p className="mt-1">
              I dati sono conservati per il tempo necessario a perseguire le finalità indicate e, in ogni caso, per il periodo
              richiesto dalla legge (ad es. dieci anni per obblighi civilistici e fiscali, salvo diversa disposizione).
            </p>
            <p className="mt-2">
              I dati possono essere comunicati a soggetti che svolgono attività collegate e strumentali (gestione piattaforme di
              prenotazione, consulenti, commercialisti) nel rispetto della normativa applicabile. Non vengono effettuate cessioni a
              fini di marketing a terzi senza un Suo consenso esplicito.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-100">5. Diritti dell’interessato</h2>
            <p className="mt-1">
              Ai sensi degli artt. 15–22 GDPR e art. 7 D.Lgs. 196/2003, Lei ha diritto a:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>ottenere conferma dell’esistenza di dati che La riguardano e riceverne copia (accesso);</li>
              <li>ottenere la rettifica dei dati inesatti o incompleti;</li>
              <li>ottenere la cancellazione dei dati (diritto all’oblio), nei limiti di legge;</li>
              <li>ottenere la limitazione del trattamento in determinate circostanze;</li>
              <li>opporsi al trattamento per motivi legittimi;</li>
              <li>
                revocare il consenso dove previsto, senza pregiudicare la liceità del trattamento basato sul consenso prima della
                revoca;
              </li>
              <li>proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).</li>
            </ul>
            <p className="mt-2">
              Per esercitare i diritti può rivolgersi al Titolare ai recapiti indicati al punto 1 (email: info@h2sport.it).
            </p>
          </section>
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          Ultimo aggiornamento: febbraio 2025. La presente informativa può essere modificata per adeguamento normativo o alle modalità
          del servizio; in caso di modifiche sostanziali verrà fornita adeguata comunicazione.
        </p>
      </div>
    </div>
  )
}

