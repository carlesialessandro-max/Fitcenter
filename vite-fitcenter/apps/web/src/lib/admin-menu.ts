export type AdminMenuItem = { to: string; label: string }
export type AdminMenuGroup = { title: string; items: AdminMenuItem[] }

/** Menu a pagina intera per admin FitCenter (allineato al catalogo pagine). */
export const ADMIN_MENU_GROUPS: AdminMenuGroup[] = [
  {
    title: "Vendite",
    items: [
      { to: "/dashboard", label: "Dashboard vendite" },
      { to: "/stampa-report", label: "Stampa report" },
      { to: "/referral", label: "Referral" },
      { to: "/convalide-consulenti", label: "Convalide" },
      { to: "/attivi-analisi", label: "Attivi" },
      { to: "/crm", label: "CRM vendita" },
      { to: "/crm/whatsapp-log", label: "Log WhatsApp" },
      { to: "/telefonate", label: "Telefonate" },
      { to: "/abbonamenti", label: "Abbonamenti in scadenza" },
      { to: "/andamento-vendite", label: "Andamento vendite" },
      { to: "/andamento-vendite-bambini", label: "Andamento vendite bambini" },
      { to: "/vendite-cross", label: "Cross" },
    ],
  },
  {
    title: "Lezioni private",
    items: [
      { to: "/lezioni-private/richieste", label: "Richieste" },
      { to: "/lezioni-private/calendario", label: "Calendario vasche" },
      { to: "/lezioni-private/istruttori", label: "Istruttori / regole" },
      { to: "/lezioni-private/abbonamenti", label: "Controllo abbonamenti" },
    ],
  },
  {
    title: "Piano operativo",
    items: [
      { to: "/calendario", label: "Piano operativo" },
      { to: "/calendario/corsi", label: "Calendario corsi" },
      { to: "/calendario/personale", label: "Personale" },
    ],
  },
  {
    title: "Corsi e piscina",
    items: [
      { to: "/corsi", label: "Corsi" },
      { to: "/corsi/presenze", label: "Presenze" },
      { to: "/corsi/nuoto-libero", label: "Nuoto libero" },
      { to: "/corsi/assenze", label: "Assenze (mese)" },
    ],
  },
  {
    title: "Altri",
    items: [
      { to: "/incassi", label: "Incassi" },
      { to: "/firme", label: "Firme" },
      { to: "/firma-cassa", label: "Firma cassa" },
      { to: "/scontrini", label: "Scontrini" },
      { to: "/piscina", label: "Mappa piscina" },
      { to: "/scuola-nuoto", label: "Scuola nuoto" },
      { to: "/scuola-nuoto/note", label: "Archivio note" },
      { to: "/calendario/scuola-nuoto", label: "Calendario scuola nuoto" },
      { to: "/calendario/acquaticita", label: "Calendario acquaticità" },
      { to: "/calendario/spogliatoi", label: "Calendario spogliatoi" },
      { to: "/calendario/piscina", label: "Calendario bagnini" },
      { to: "/calendario/reception", label: "Calendario reception" },
      { to: "/campus", label: "Campus" },
      { to: "/calendario/sala-fitness", label: "Calendario sala fitness" },
      { to: "/danza", label: "Danza" },
      { to: "/utenti", label: "Utenti e accessi" },
      { to: "/libro-paga", label: "Libro paga" },
    ],
  },
]
