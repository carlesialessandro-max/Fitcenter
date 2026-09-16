/**
 * Lead dal form sito: il testo in note è la richiesta.
 * Il primo WhatsApp risponde a quello, non col benvenuto generico.
 */

export type AdultSiteTopic =
  | "nuoto_libero"
  | "palestra"
  | "spa"
  | "corsi_acqua"
  | "corsi_fitness"
  | "info_generica"

function foldIt(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

function firstName(nome?: string | null): string {
  const raw = String(nome ?? "").trim()
  if (!raw || /^ciao$/i.test(raw) || raw === "—") return "Ciao"
  return `Ciao ${raw.split(/\s+/)[0]}`
}

const FOOTER =
  `\n\nSe vuoi un appuntamento in sede, rispondi con giorno e ora (es. lunedì 18:30 o sabato mattina).\n` +
  `Oppure scrivi RICHIAMATEMI e ti chiamiamo noi.`

export function extractSiteCustomerText(note?: string | null): string {
  const n = String(note ?? "").trim()
  if (!n) return ""
  const lines = n
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^WA[ :]/i.test(l))
  const body = lines
    .map((l) => l.replace(/^(tipologia|oggetto)\s*:\s*/i, "").trim())
    .filter(Boolean)
  return (body.length ? body.join(" ") : n).trim()
}

export function classifyAdultSiteTopic(blob: string): AdultSiteTopic | null {
  const t = foldIt(blob)
  if (!t) return null
  if (
    /nuoto\s*libero/.test(t) ||
    /planning\s*cors/.test(t) ||
    (/\bcorsie\b/.test(t) && /\b(piscina|nuoto|pdf|orari)\b/.test(t)) ||
    (/\b(25\s*m|25mt|50\s*m|50mt)\b/.test(t) && /\b(nuoto|vasca|piscina|chius)\b/.test(t))
  ) {
    return "nuoto_libero"
  }
  if (/\bspa\b/.test(t) || /\bsauna\b/.test(t) || /\bidromassaggio\b/.test(t) || /\bbenessere\b/.test(t)) {
    return "spa"
  }
  if (/\bpalestra\b/.test(t) || /\bsala\s*pesi\b/.test(t) || /\battrezzi\b/.test(t)) return "palestra"
  if (
    /scuola\s*nuoto\s*adult/.test(t) ||
    /corsi?\s+(in\s+)?acqua/.test(t) ||
    /\baqua\s*fitness\b/.test(t) ||
    (/\bnuoto\b/.test(t) && !/nuoto\s*libero/.test(t) && !/\bbambin/.test(t))
  ) {
    return "corsi_acqua"
  }
  if (/\bfitness\b/.test(t) || /\bpilates\b/.test(t) || /\byoga\b/.test(t) || /\bzumba\b/.test(t)) {
    return "corsi_fitness"
  }
  if (
    /\b(informazion|vorrei\s+(avere\s+)?info|costi|prezzi|tariff|orari|abbomament|abbonament)\b/.test(t)
  ) {
    return "info_generica"
  }
  return null
}

export function adultTopicReplyMsg(opts: {
  nome?: string | null
  blob: string
  fromSite?: boolean
}): string | null {
  const topic = classifyAdultSiteTopic(opts.blob)
  if (!topic) return null
  const chi = firstName(opts.nome)
  const intro = opts.fromSite
    ? `${chi}, abbiamo letto la tua richiesta dal sito. 💙\n\n`
    : `${chi}, 💙\n\n`

  if (topic === "nuoto_libero") {
    return (
      intro +
      `Hai chiesto il nuoto libero (costi e/o orari).\n\n` +
      `Sì: gli orari in vasca sono quelli del planning pubblicato sul sito (è lo stesso PDF):\n` +
      `📄 https://h2sport.it/corsi/nuoto-libero-da-settembre-2026.pdf\n` +
      `🌊 Pagina nuoto libero: https://h2sport.it/piscina#nuoto-libero\n\n` +
      `I prezzi dipendono dalla formula (ingresso singolo o abbonamento): te li confermiamo in sede o al 0573 572649.` +
      FOOTER
    )
  }
  if (topic === "palestra") {
    return (
      intro +
      `Hai chiesto informazioni sulla palestra.\n\n` +
      `Programma e orari: https://h2sport.it/#attivita\n` +
      `Fitness a terra: https://h2sport.it/#orari-terra\n\n` +
      `Per costi e la formula più adatta ti confermiamo in sede o al 0573 572649.` +
      FOOTER
    )
  }
  if (topic === "spa") {
    return (
      intro +
      `Hai chiesto informazioni sulla SPA / area benessere.\n\n` +
      `Dettagli e orari: https://h2sport.it/#attivita\n` +
      `Mappa e contatti: https://h2sport.it/contatti\n\n` +
      `Per accesso, costi e disponibilità ti confermiamo in sede o al 0573 572649.` +
      FOOTER
    )
  }
  if (topic === "corsi_acqua") {
    return (
      intro +
      `Hai chiesto i corsi in acqua / scuola nuoto adulti.\n\n` +
      `Orari in acqua: https://h2sport.it/#orari-acqua\n` +
      `Attività: https://h2sport.it/#attivita\n\n` +
      `Per il corso più adatto e i costi ti confermiamo in sede o al 0573 572649.` +
      FOOTER
    )
  }
  if (topic === "corsi_fitness") {
    return (
      intro +
      `Hai chiesto i corsi fitness.\n\n` +
      `Orari a terra: https://h2sport.it/#orari-terra\n` +
      `Programma: https://h2sport.it/#attivita\n\n` +
      `Per costi e posti ti confermiamo in sede o al 0573 572649.` +
      FOOTER
    )
  }
  return (
    intro +
    `Abbiamo preso in carico la tua richiesta di informazioni.\n\n` +
    `🏋️ Corsi e programma: https://h2sport.it/#attivita\n` +
    `🌊 Acqua: https://h2sport.it/#orari-acqua\n` +
    `🧘 Fitness: https://h2sport.it/#orari-terra\n` +
    `🏊 Nuoto libero: https://h2sport.it/piscina#nuoto-libero\n` +
    `📄 Planning corsie: https://h2sport.it/corsi/nuoto-libero-da-settembre-2026.pdf\n\n` +
    `Per i costi della formula più adatta: 0573 572649.` +
    FOOTER
  )
}

export function welcomeTextFromWebsiteRequest(opts: {
  nome?: string | null
  fonte?: string | null
  note?: string | null
  interesse?: string | null
  interesseDettaglio?: string | null
}): { text: string; topic: AdultSiteTopic } | null {
  const fonte = String(opts.fonte ?? "").trim().toLowerCase()
  if (fonte !== "website") return null
  const blob = [extractSiteCustomerText(opts.note), opts.interesseDettaglio, opts.interesse]
    .filter((x) => x && String(x).trim() && String(x).trim() !== "—")
    .join(" ")
  if (!foldIt(blob)) return null
  const text = adultTopicReplyMsg({ nome: opts.nome, blob, fromSite: true })
  const topic = classifyAdultSiteTopic(blob)
  if (!text || !topic) return null
  return { text, topic }
}
