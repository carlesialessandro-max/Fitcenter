export type AdminMenuItem = { to: string; label: string }
export type AdminMenuGroup = { title: string; items: AdminMenuItem[]; tone?: "main" | "other" }

/** Menu a pagina intera per admin FitCenter (allineato al catalogo pagine). */
export const ADMIN_MENU_GROUPS: AdminMenuGroup[] = [
  {
    title: "Vendite",
    tone: "main",
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
    tone: "main",
    items: [
      { to: "/lezioni-private/richieste", label: "Richieste" },
      { to: "/lezioni-private/calendario", label: "Calendario vasche" },
      { to: "/lezioni-private/istruttori", label: "Istruttori / regole" },
      { to: "/lezioni-private/abbonamenti", label: "Controllo abbonamenti" },
    ],
  },
  {
    title: "Corsi e piscina",
    tone: "main",
    items: [
      { to: "/corsi", label: "Corsi" },
      { to: "/corsi/presenze", label: "Presenze" },
      { to: "/corsi/nuoto-libero", label: "Nuoto libero" },
      { to: "/corsi/assenze", label: "Assenze (mese)" },
    ],
  },
  {
    title: "Reception",
    tone: "main",
    items: [
      { to: "/incassi", label: "Incassi" },
      { to: "/firme", label: "Firme" },
      { to: "/firma-cassa", label: "Firma cassa" },
      { to: "/scontrini", label: "Scontrini" },
    ],
  },
  {
    title: "Scuola nuoto",
    tone: "main",
    items: [
      { to: "/scuola-nuoto", label: "Scuola nuoto" },
      { to: "/scuola-nuoto/note", label: "Archivio note" },
    ],
  },
  {
    title: "Calendari",
    tone: "main",
    items: [
      { to: "/calendario", label: "Piano operativo" },
      { to: "/calendario/corsi", label: "Calendario corsi" },
      { to: "/calendario/scuola-nuoto", label: "Calendario scuola nuoto" },
      { to: "/calendario/piscina", label: "Calendario bagnini" },
      { to: "/calendario/reception", label: "Calendario reception" },
      { to: "/calendario/sala-fitness", label: "Calendario sala fitness" },
      { to: "/calendario/acquaticita", label: "Calendario acquaticità" },
      { to: "/calendario/spogliatoi", label: "Calendario spogliatoi" },
      { to: "/calendario/personale", label: "Personale" },
    ],
  },
  {
    title: "Altri",
    tone: "other",
    items: [
      { to: "/piscina", label: "Mappa piscina" },
      { to: "/campus", label: "Campus" },
      { to: "/danza", label: "Danza" },
      { to: "/utenti", label: "Utenti e accessi" },
      { to: "/libro-paga", label: "Libro paga" },
    ],
  },
]
