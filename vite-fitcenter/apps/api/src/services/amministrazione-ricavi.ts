import { isGestionaleConfigured, queryIncassiPerVoce } from "./gestionale-sql.js"

export const MACRO_COMMERCIALI = ["piscina", "fitness", "spa"] as const
export type MacroCommerciale = (typeof MACRO_COMMERCIALI)[number]

export const CORSI_IDS = ["scuola-nuoto-bambini", "scuola-nuoto-adulti", "corsi-acqua", "corsi-fitness"] as const
export type CorsoId = (typeof CORSI_IDS)[number]
export const CORSI_LABEL: Record<CorsoId, string> = {
  "scuola-nuoto-bambini": "Scuola nuoto bambini",
  "scuola-nuoto-adulti": "Scuola nuoto adulti",
  "corsi-acqua": "Corsi in acqua e attività di gruppo",
  "corsi-fitness": "Corsi fitness e attività di gruppo",
}
/** Centro di default se l'incasso è della macro ma non si riconosce il sotto-reparto. */
export const DEFAULT_SOTTO: Record<MacroCommerciale, string> = {
  piscina: "piscina-coperta",
  fitness: "palestra-sala-pesi",
  spa: "spa-benessere",
}

export const SOTTO_NOMI: Record<string, string> = {
  "piscina-coperta": "Piscina coperta",
  "piscina-estiva": "Piscina estiva e parco acquatico",
  "scuola-nuoto-bambini": "Scuola nuoto bambini",
  "scuola-nuoto-adulti": "Scuola nuoto adulti",
  "corsi-acqua": "Corsi in acqua e attività di gruppo",
  agonismo: "Agonismo",
  "palestra-sala-pesi": "Palestra e sala pesi",
  "corsi-fitness": "Corsi fitness e attività di gruppo",
  "pole-dance": "Pole Dance",
  "personal-training": "Personal Training",
  "spa-benessere": "SPA e benessere",
}
/** Solo questi due centri: la somma è il pool dei fissi di struttura da ripartire sui reparti. */
export const MACRO_STRUTTURA = ["gestione", "generali"] as const
/** Manutenzione, pulizie e personale condiviso: ripartiti sui tre reparti in base ai ricavi. */
export const MACRO_SERVIZI = ["servizi"] as const

export function isMacroStruttura(macroId: string): boolean {
  return (MACRO_STRUTTURA as readonly string[]).includes(macroId)
}

export function isMacroServizi(macroId: string): boolean {
  return (MACRO_SERVIZI as readonly string[]).includes(macroId)
}

export function isMacroCommerciale(id: string): id is MacroCommerciale {
  return (MACRO_COMMERCIALI as readonly string[]).includes(id)
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function blob(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
}

export type DestRicavo = { macro: MacroCommerciale | "altro"; peso: number }
export type DestSotto = { id: string; macro: MacroCommerciale; peso: number }

function skipRicavoCommerciale(u: string): boolean {
  return (
    /\bDANZA\b/.test(u) ||
    /\bPROFESSIONALE\b/.test(u) ||
    /\b1\s*M MENSILE 2VS\b/.test(u) ||
    (/\b3 GRADO\b/.test(u) && /\b1\s*M MENSILE\b/.test(u)) ||
    /\bCONVENZION/.test(u) ||
    /AFFITT|LOCAZION|NOLEGGIO SPAZ|NOLEGGIO SALA/.test(u)
  )
}

function dest(id: string, macro: MacroCommerciale, peso: number): DestSotto {
  return { id, macro, peso }
}

function scaleSotto(rows: DestSotto[], fattore: number): DestSotto[] {
  return rows.map((r) => ({ id: r.id, macro: r.macro, peso: r.peso * fattore }))
}

function mergeSotto(rows: DestSotto[]): DestSotto[] {
  const map = new Map<string, DestSotto>()
  for (const r of rows) {
    const cur = map.get(r.id)
    if (cur) cur.peso += r.peso
    else map.set(r.id, { id: r.id, macro: r.macro, peso: r.peso })
  }
  return [...map.values()].filter((r) => Math.abs(r.peso) > 0.0001)
}

function isVoceAccessoriaTesto(u: string): boolean {
  return (
    /TESSERAMENT/.test(u) ||
    (/BADGE/.test(u) && /MERCHANDISING/.test(u)) ||
    /BE ?ACTIVE|SOSPENSIONI AGGIUNT|QUOTA ASSOCIATIVA|GYMPAY/.test(u) ||
    (/\bASI\b/.test(u) && /ISCRIZIONE|STAFF/.test(u)) ||
    /\bUISP\b/.test(u) ||
    /\bFITRI\b/.test(u) ||
    (/\bFIN\b/.test(u) && /(ISCRIZIONE|QUOTA)/.test(u)) ||
    /\bPHON\b/.test(u) ||
    /BORSELLINO|RICARICA/.test(u)
  )
}

/**
 * SMILE FIT = palestra + corsi terra; SMILE H2O = piscina coperta + corsi acqua.
 * Quote modificabili: il 70% resta sull'accesso, il 30% va sui corsi di gruppo.
 */
export const SMILE_PESO_ACCESSO = 0.7
export const SMILE_PESO_CORSI = 0.3

/** OPEN 50/50, SMILE FIT/H2O con quota corsi, GYM palestra, NUOTO LIBERO coperta. */
function tipoAbbonamento(u: string): DestSotto[] | null {
  if (/\bOPEN\b/.test(u)) {
    return [dest("piscina-coperta", "piscina", 0.5), dest("palestra-sala-pesi", "fitness", 0.5)]
  }
  if (/\bSMILE FIT\b/.test(u)) {
    return [
      dest("palestra-sala-pesi", "fitness", SMILE_PESO_ACCESSO),
      dest("corsi-fitness", "fitness", SMILE_PESO_CORSI),
    ]
  }
  if (/\bSMILE H2O\b|\bSMILE H20\b/.test(u)) {
    return [
      dest("piscina-coperta", "piscina", SMILE_PESO_ACCESSO),
      dest("corsi-acqua", "piscina", SMILE_PESO_CORSI),
    ]
  }
  if (/\bGYM\b/.test(u)) return [dest("palestra-sala-pesi", "fitness", 1)]
  if (/NUOTO LIBERO/.test(u)) return [dest("piscina-coperta", "piscina", 1)]
  return null
}

function defaultAdulti(): DestSotto[] {
  return [dest("piscina-coperta", "piscina", 0.5), dest("palestra-sala-pesi", "fitness", 0.5)]
}

/** PREMIUM / GOLD PREMIUM: 10% SPA + 10% piscina estiva + 80% tipologia. */
function wrapPremium(base: DestSotto[]): DestSotto[] {
  return mergeSotto([dest("spa-benessere", "spa", 0.1), dest("piscina-estiva", "piscina", 0.1), ...scaleSotto(base, 0.8)])
}

/** GOLD: 10% SPA + 90% tipo. GOLD ESTIVO (Excel: piscina esterna, senza SPA): 10% estiva + 90% tipo. */
function wrapGold(base: DestSotto[], conEstiva: boolean): DestSotto[] {
  if (conEstiva) return mergeSotto([dest("piscina-estiva", "piscina", 0.1), ...scaleSotto(base, 0.9)])
  return mergeSotto([dest("spa-benessere", "spa", 0.1), ...scaleSotto(base, 0.9)])
}

function etichettaTipo(u: string): string {
  if (/\bOPEN\b/.test(u)) return "OPEN"
  if (/\bSMILE FIT\b/.test(u)) return "SMILE FIT"
  if (/\bSMILE H2O\b|\bSMILE H20\b/.test(u)) return "SMILE H2O"
  if (/\bGYM\b/.test(u)) return "GYM"
  if (/NUOTO LIBERO/.test(u)) return "NUOTO LIBERO"
  return ""
}

function isVoceTicketing(u: string): boolean {
  return /TICKETING/.test(u) || (/\bTICKET\b/.test(u) && !/TESSERAMENT/.test(u))
}

function isMerceTicketing(u: string): boolean {
  return /CUFFIE|\bCUFFIA\b|CUFFIETT|OCCHIAL|CIABATT|ASCIUGAMAN|BORRACCIA|CALZIN|BRACCIAL|MERCHAND|ABBIGLIAMENT|\bSHOP\b/.test(
    u,
  )
}

/** Causale «TICKETING: acquistati 5 INGRESSO PISCINA ADULTI € 80,00 .» → prodotto. */
function testoTicketing(voce: string, contesto: string): string {
  const raw = `${voce} ${contesto}`.trim()
  const m = /TICKETING\s*:?\s*(?:acquistat[ieo]\s+\d+\s+)?(.+)/i.exec(raw)
  let body = (m?.[1] ?? raw).trim()
  body = body.replace(/\s*€\s*[\d.,]+\s*\.?\s*$/g, "").trim()
  body = body.replace(/\s+\.\s*$/, "").trim()
  return body
}

/**
 * Ticket da banco: non è un blocco unico.
 * Ingresso piscina → coperta (estiva solo se parco/esterna); corsi → corsi fitness o acqua;
 * fitness/gym → palestra; gestanti → corsi in acqua; SPA → spa; cuffie e merce → altri incassi.
 */
function classificaTicketing(u: string): DestSotto[] {
  if (isMerceTicketing(u)) return []
  if (/GESTANTI/.test(u)) return [dest("corsi-acqua", "piscina", 1)]
  if (/POLE/.test(u)) return [dest("pole-dance", "fitness", 1)]
  if (/PERSONAL/.test(u)) return [dest("personal-training", "fitness", 1)]
  if (/SPA|BENESSER|SAUNA|IDROMASSAGGIO/.test(u)) return [dest("spa-benessere", "spa", 1)]
  if (/ACQUAGYM|ACQUA FITNESS|IDROBIKE|CORSI IN ACQUA/.test(u)) return [dest("corsi-acqua", "piscina", 1)]
  if (/SCUOLA NUOTO ADULTI/.test(u)) return [dest("scuola-nuoto-adulti", "piscina", 1)]
  if (/ACQUATICIT|\bAQ\b|SCUOLA NUOTO|\bBAMBINI\b|\bKIDS\b/.test(u)) {
    return [dest("scuola-nuoto-bambini", "piscina", 1)]
  }
  if (/INGRESSO CORSI|INGRESSI CORSI|\bCORSI\b/.test(u)) {
    if (/ACQUA|\bH2O\b|\bH20\b|NUOTO/.test(u)) return [dest("corsi-acqua", "piscina", 1)]
    return [dest("corsi-fitness", "fitness", 1)]
  }
  if (/FITNESS|PALESTR|\bGYM\b|SALA PESI|MAMME FIT/.test(u)) {
    return [dest("palestra-sala-pesi", "fitness", 1)]
  }
  if (/ESTIVA|PARCO ACQU|PISCINA ESTERNA/.test(u)) return [dest("piscina-estiva", "piscina", 1)]
  if (/PISCIN|NUOTO LIBERO|VASCA|\bH2O\b|\bH20\b/.test(u)) return [dest("piscina-coperta", "piscina", 1)]
  if (/\bOPEN\b/.test(u)) return defaultAdulti()
  return [dest("piscina-coperta", "piscina", 1)]
}

function etichettaTicketing(u: string): string {
  if (isMerceTicketing(u)) return "TICKETING · Shop / merce"
  if (/GESTANTI/.test(u)) return "TICKETING · Gestanti"
  if (/INGRESSO CORSI|INGRESSI CORSI|\bCORSI\b/.test(u)) return "TICKETING · Ingressi corsi"
  if (/FITNESS|PALESTR|\bGYM\b/.test(u)) return "TICKETING · Ingressi fitness"
  if (/SPA|BENESSER/.test(u)) return "TICKETING · SPA"
  if (/ESTIVA|PARCO ACQU|PISCINA ESTERNA/.test(u)) return "TICKETING · Piscina estiva"
  if (/PISCIN|NUOTO/.test(u)) return "TICKETING · Ingressi piscina"
  if (/\bBAMBINI\b|\bKIDS\b/.test(u)) return "TICKETING · Ingressi bambini"
  return "TICKETING"
}

/**
 * Regole da servizi.xlsx + quote adulti:
 * PREMIUM 10 SPA / 10 estiva / 80 tipo (OPEN, SMILE FIT, SMILE H2O, GYM, NUOTO LIBERO).
 * SMILE FIT 70% palestra + 30% corsi terra; SMILE H2O 70% piscina coperta + 30% corsi acqua.
 * GOLD ESTIVO 10 estiva / 90 tipo (in Excel non include SPA).
 * GOLD 10 SPA / 90 tipo.
 * ESTIVO ADD-ON 100% piscina estiva.
 * Pacchetti ingressi per natura (FIT/corsi palestra, H2O/nuoto coperta, scuola nuoto adulti, OPEN 50/50, SPA).
 * Ticket da banco spezzati per prodotto (piscina, corsi, fitness, gestanti, SPA, merce).
 * Tesseramenti / badge / quote seguono l'abbonamento nello stesso blob (già agganciato per cliente).
 */
export function classificaSotto(voce: string, contesto = ""): DestSotto[] {
  const u = blob(`${voce} ${contesto}`)
  if (!u || skipRicavoCommerciale(u)) return []

  if (isVoceTicketing(u)) return classificaTicketing(blob(testoTicketing(voce, contesto)))
  if (/ABBIGLIAMENTO|\bSHOP\b/.test(u)) return []
  if (/ESTIVO ADD-ON/.test(u) || (/PISCINA ESTERNA/.test(u) && /ADD-ON/.test(u) && !/\bGOLD\b|\bPREMIUM\b/.test(u))) {
    return [dest("piscina-estiva", "piscina", 1)]
  }
  if (/SPA ADD-ON|PERCORSO SPA|PACCHETTI PERCORSO SPA/.test(u)) {
    return [dest("spa-benessere", "spa", 1)]
  }
  if (/PACCHETTI INGRESSI|PACCHETTI CORSI|PACCHETTI NUOTO/.test(u)) {
    if (/SCUOLA NUOTO ADULTI/.test(u)) return [dest("scuola-nuoto-adulti", "piscina", 1)]
    if (/NUOTO LIBERO|\bH2O\b|\bH20\b/.test(u)) return [dest("piscina-coperta", "piscina", 1)]
    if (/\bOPEN\b/.test(u)) return defaultAdulti()
    return [dest("palestra-sala-pesi", "fitness", 1)]
  }
  if (/\bPREMIUM\b|TUTTO INCLUSO/.test(u)) {
    return wrapPremium(tipoAbbonamento(u) ?? defaultAdulti())
  }
  if (/\bGOLD\b/.test(u) && /ESTIVO|ESTERNA|ESTIVA/.test(u)) {
    return wrapGold(tipoAbbonamento(u) ?? defaultAdulti(), true)
  }
  if (/\bGOLD\b/.test(u)) {
    return wrapGold(tipoAbbonamento(u) ?? defaultAdulti(), false)
  }
  if (/SCUOLA NUOTO ADULTI|MASTER ADULTI|SN ADULTI|AGONISMO MASTER/.test(u)) {
    return [dest("scuola-nuoto-adulti", "piscina", 1)]
  }
  if (/\bAGONISM/.test(u) && !/TESSERAMENT|FITRI|\bFIN\b/.test(u)) {
    return [dest("agonismo", "piscina", 1)]
  }
  if (
    /ACQUATICIT|\bAQ\b/.test(u) ||
    /SCUOLA NUOTO ESTIVA/.test(u) ||
    /GESTANTI/.test(u) ||
    (/SCUOLA NUOTO/.test(u) && !/ADULTI/.test(u)) ||
    (/\bBAMBINI\b/.test(u) && !isVoceAccessoriaTesto(u)) ||
    (/\bKIDS\b/.test(u) && !/TESSERAMENT/.test(u))
  ) {
    return [dest("scuola-nuoto-bambini", "piscina", 1)]
  }
  if (/ACQUAGYM|ACQUA FITNESS|CORSI IN ACQUA|IDROBIKE|ACQUA CYCLE|\bIDRO\b/.test(u)) {
    return [dest("corsi-acqua", "piscina", 1)]
  }
  if (/POLE DANCE|\bPOLE\b/.test(u)) return [dest("pole-dance", "fitness", 1)]
  if (/PERSONAL TRAINER/.test(u)) return [dest("personal-training", "fitness", 1)]
  if (/LEZIONI PRIVATE|PACCHETTO PRIVATE/.test(u)) {
    if (/\bBAMBINI\b/.test(u)) return [dest("scuola-nuoto-bambini", "piscina", 1)]
    return [dest("personal-training", "fitness", 1)]
  }
  if (/JUJITSU|JU JITSU|JUJITZO/.test(u)) return [dest("corsi-fitness", "fitness", 1)]
  if (/MAMME FIT/.test(u)) return [dest("corsi-fitness", "fitness", 1)]
  if (
    /PILATES|YOGA|SPINNING|TRX|FUNCTIONAL|ZUMBA|TOTAL BODY|\bGAG\b|\bSTEP\b|CORSI FITNESS|ATTIVITA DI GRUPPO|ATTIVITÀ DI GRUPPO/.test(
      u,
    )
  ) {
    return [dest("corsi-fitness", "fitness", 1)]
  }
  if (/CAMPUS/.test(u)) {
    if (/ACCOMPAGNATORE/.test(u)) return []
    return [dest("scuola-nuoto-bambini", "piscina", 1)]
  }
  const tipo = tipoAbbonamento(u)
  if (tipo) return tipo
  if (/SPA|BENESSER|MASSAGG|ESTETIC|SAUNA|IDROMASSAGGIO/.test(u) && !isVoceAccessoriaTesto(u)) {
    return [dest("spa-benessere", "spa", 1)]
  }
  if (/ESTIVA|PARCO ACQU|PISCINA ESTERNA/.test(u) && !/\bGOLD\b|\bPREMIUM\b/.test(u)) {
    return [dest("piscina-estiva", "piscina", 1)]
  }
  if (/PISCIN|NUOTO|VASCA|BAGNIN|\bH2O\b|\bH20\b/.test(u) && !isVoceAccessoriaTesto(u)) {
    return [dest("piscina-coperta", "piscina", 1)]
  }
  if (/PALESTR|FITNESS|SALA PESI/.test(u) && !isVoceAccessoriaTesto(u)) {
    return [dest("palestra-sala-pesi", "fitness", 1)]
  }
  if (/\bCLIENTE\b/.test(u) && !isVoceAccessoriaTesto(u)) {
    return [dest("personal-training", "fitness", 1)]
  }
  if (/TESSERAMENTO KIDS/.test(u)) return [dest("scuola-nuoto-bambini", "piscina", 1)]
  if (/\bFITRI\b/.test(u) || (/\bFIN\b/.test(u) && /(ISCRIZIONE|QUOTA|TESSER)/.test(u))) {
    return [dest("agonismo", "piscina", 0.6), dest("palestra-sala-pesi", "fitness", 0.4)]
  }
  return []
}

/** Aggrega i sotto-centri sulla macro, così byMacro e bySotto restano allineati. */
export function classificaRicavo(voce: string, contesto = ""): DestRicavo[] {
  const u = blob(`${voce} ${contesto}`)
  if (!u) return [{ macro: "altro", peso: 1 }]
  if (skipRicavoCommerciale(u)) return []
  const sotto = classificaSotto(voce, contesto)
  if (!sotto.length) return [{ macro: "altro", peso: 1 }]
  const pesi = new Map<MacroCommerciale, number>()
  for (const d of sotto) pesi.set(d.macro, (pesi.get(d.macro) ?? 0) + d.peso)
  return [...pesi.entries()].map(([macro, peso]) => ({ macro, peso }))
}

export function isCorsoId(id: string): id is CorsoId {
  return (CORSI_IDS as readonly string[]).includes(id)
}

export type AmmRicavoVoce = {
  voce: string
  macro: string
  importo: number
  n: number
  ripartizione?: { macro: string; importo: number }[]
  ripartizioneSotto?: { id: string; nome: string; importo: number }[]
}
type RicavoVoceGestionale = { voce: string; contesto: string; euro: number; n: number; danza: boolean }

function titoloVocePerRaggruppamento(voce: string, contesto: string): string {
  const v = voce.trim()
  const rata = /^PAGAMENTO\s+RATA\s+del\s+\d{1,2}\/\d{1,2}\/\d{4}\s*:\s*(.+)$/i.exec(v)
  if (rata?.[1]) {
    return rata[1].replace(/\s+dal\s+\d{1,2}\/\d{1,2}\/\d{4}\s+al\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/i, "").trim()
  }
  if (v && v !== "Altro") return v
  const ctx = contesto.trim()
  if (!ctx) return v || "Altro"
  const senzaRata = ctx.replace(/^PAGAMENTO\s+RATA\s+del\s+\d{1,2}\/\d{1,2}\/\d{4}\s*:\s*/i, "").trim()
  return senzaRata.split(/\s{2,}/)[0]?.trim() || ctx.slice(0, 120)
}

function chiaveRaggruppamento(voce: string, contesto = ""): string {
  const titolo = titoloVocePerRaggruppamento(voce, contesto)
  const u = blob(`${titolo} ${contesto}`)
  const tipo = etichettaTipo(u)
  if (!u) return "Altro"
  if (isVoceTicketing(blob(titolo)) || isVoceTicketing(u)) {
    return etichettaTicketing(blob(testoTicketing(voce, contesto)))
  }
  if (/ESTIVO ADD-ON/.test(u)) return "ESTIVO ADD-ON"
  if (/PACCHETTI INGRESSI|PACCHETTI CORSI|PACCHETTI NUOTO|PACCHETTI PERCORSO/.test(u)) {
    if (/PACCHETTI PERCORSO SPA|PERCORSO SPA/.test(u)) return "Pacchetti ingressi · SPA"
    if (/SCUOLA NUOTO ADULTI/.test(u)) return "Pacchetti ingressi · Scuola nuoto adulti"
    if (/NUOTO LIBERO/.test(u)) return "Pacchetti ingressi · Nuoto libero"
    if (/\bOPEN\b/.test(u)) return "Pacchetti ingressi · OPEN"
    if (/CORSI|\bFIT\b/.test(u)) return "Pacchetti ingressi · Corsi / FIT"
    return "Pacchetti ingressi"
  }
  if (/\bPREMIUM\b/.test(u)) return tipo ? `PREMIUM · ${tipo}` : "PREMIUM"
  if (/\bGOLD\b/.test(u) && /ESTIVO|ESTERNA|ESTIVA/.test(u)) return tipo ? `GOLD ESTIVO · ${tipo}` : "GOLD ESTIVO"
  if (/\bGOLD\b/.test(u)) return tipo ? `GOLD · ${tipo}` : "GOLD"
  if (
    /TESSERAMENT|QUOTA ASSOCIATIVA|BE ?ACTIVE|SOSPENSIONI AGGIUNT|GYMPAY/.test(blob(titolo)) ||
    (/BADGE/.test(blob(titolo)) && /MERCHANDISING/.test(u)) ||
    (/\bASI\b/.test(blob(titolo)) && /ISCRIZIONE|STAFF/.test(u)) ||
    /\bUISP\b/.test(blob(titolo))
  ) {
    if (/\bPREMIUM\b/.test(u)) return tipo ? `Tesseramenti / quote · PREMIUM ${tipo}` : "Tesseramenti / quote · PREMIUM"
    if (/\bGOLD\b/.test(u) && /ESTIVO|ESTERNA|ESTIVA/.test(u)) {
      return tipo ? `Tesseramenti / quote · GOLD ESTIVO ${tipo}` : "Tesseramenti / quote · GOLD ESTIVO"
    }
    if (/\bGOLD\b/.test(u)) return tipo ? `Tesseramenti / quote · GOLD ${tipo}` : "Tesseramenti / quote · GOLD"
    if (tipo) return `Tesseramenti / quote · ${tipo}`
    if (/\bFITRI\b|\bFIN\b/.test(u)) return "Tesseramenti / quote · FIN/FITRI"
    if (/TESSERAMENTO KIDS/.test(u)) return "Tesseramenti / quote · Kids"
    return "Tesseramenti / quote"
  }
  if (tipo) return tipo
  const normalized = blob(titolo)
  if (/^SCUOLA NUOTO\b/.test(normalized)) return "SCUOLA NUOTO"
  if (/^GYM\b/.test(normalized) || /\bGIN\b/.test(normalized)) return "GYM"
  if (/\b1\s*M MENSILE 3VS\b/.test(normalized)) return "1 M MENSILE 3VS"
  if (/\b1\s*M MENSILE 2VS\b/.test(normalized)) return "1 M MENSILE 2VS"
  if (/\bLEZIONI PRIVATE\b/.test(normalized)) return "Lezioni private"
  if (/^CAMPUS\b/.test(normalized)) return "Campus"
  if (/^ACQUATICIT/.test(normalized)) return "Acquaticità"
  if (/^POLE/.test(normalized)) return "Pole Dance"
  if (/PERSONAL TRAINER/.test(normalized)) return "Personal trainer"
  if (/PERCORSO SPA|SPA ADD-ON/.test(normalized)) return "Percorso SPA"
  return titolo.length > 96 ? `${titolo.slice(0, 93)}…` : titolo
}

const ORDINE_MACRO_DETTAGLIO = ["piscina", "fitness", "spa", "altro"] as const

export function macroPrimarioDettaglioRicavo(row: {
  macro: string
  ripartizione?: { macro: string; importo: number }[]
}): string {
  if (row.ripartizione?.length === 1) return row.ripartizione[0]!.macro
  if (row.ripartizione?.length) {
    return row.ripartizione.reduce((best, q) => (q.importo > best.importo ? q : best)).macro
  }
  const first = row.macro.split("+")[0]?.trim().toLowerCase()
  return first || "altro"
}

export function ordinaDettaglioRicavi(rows: AmmRicavoVoce[]): AmmRicavoVoce[] {
  const rank = (m: string) => {
    const i = ORDINE_MACRO_DETTAGLIO.indexOf(m as (typeof ORDINE_MACRO_DETTAGLIO)[number])
    return i >= 0 ? i : ORDINE_MACRO_DETTAGLIO.length
  }
  return [...rows].sort((a, b) => {
    const ma = macroPrimarioDettaglioRicavo(a)
    const mb = macroPrimarioDettaglioRicavo(b)
    const dr = rank(ma) - rank(mb)
    if (dr !== 0) return dr
    return b.importo - a.importo
  })
}

export function raggruppaDettaglioRicavi(voci: RicavoVoceGestionale[]): AmmRicavoVoce[] {
  const grouped = new Map<
    string,
    {
      voce: string
      importo: number
      n: number
      ripartizione: Map<string, number>
      ripartizioneSotto: Map<string, number>
    }
  >()
  for (const v of voci) {
    if (v.danza) continue
    const destMacro = classificaRicavo(v.voce, v.contesto)
    if (destMacro.length === 0) continue
    const destSotto = classificaSotto(v.voce, v.contesto)
    const key = chiaveRaggruppamento(v.voce, v.contesto)
    const current = grouped.get(key) ?? {
      voce: key,
      importo: 0,
      n: 0,
      ripartizione: new Map<string, number>(),
      ripartizioneSotto: new Map<string, number>(),
    }
    current.n += v.n
    const euro = Number(v.euro || 0)
    for (const d of destMacro) {
      const quota = round2(euro * d.peso)
      current.importo = round2(current.importo + quota)
      current.ripartizione.set(d.macro, round2((current.ripartizione.get(d.macro) ?? 0) + quota))
    }
    for (const d of destSotto) {
      const quota = round2(euro * d.peso)
      current.ripartizioneSotto.set(d.id, round2((current.ripartizioneSotto.get(d.id) ?? 0) + quota))
    }
    grouped.set(key, current)
  }
  return [...grouped.values()].map((row) => ({
    voce: row.voce,
    macro: [...row.ripartizione.keys()].join(" + "),
    importo: row.importo,
    n: row.n,
    ripartizione: [...row.ripartizione.entries()].map(([macro, importo]) => ({ macro, importo })),
    ripartizioneSotto: [...row.ripartizioneSotto.entries()].map(([id, importo]) => ({
      id,
      nome: SOTTO_NOMI[id] ?? id,
      importo,
    })),
  }))
}

export type AmmRicaviPeriodo = {
  from: string
  to: string
  tot: number
  totCommerciali: number
  totAltri: number
  totCorsi: number
  byMacro: Record<MacroCommerciale, number>
  bySotto: Record<string, number>
  dettaglio: AmmRicavoVoce[]
  disponibile: boolean
}

function emptyRicavi(from: string, to: string): AmmRicaviPeriodo {
  return {
    from,
    to,
    tot: 0,
    totCommerciali: 0,
    totAltri: 0,
    totCorsi: 0,
    byMacro: { piscina: 0, fitness: 0, spa: 0 },
    bySotto: {},
    dettaglio: [],
    disponibile: false,
  }
}

export function periodoIso(anno: number, mese?: string): { from: string; to: string } {
  if (mese && /^\d{4}-\d{2}$/.test(mese)) {
    const y = Number(mese.slice(0, 4))
    const m = Number(mese.slice(5, 7))
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    return { from: `${mese}-01`, to }
  }
  return { from: `${anno}-01-01`, to: `${anno}-12-31` }
}

export async function queryRicaviAmm(anno: number, mese?: string): Promise<AmmRicaviPeriodo> {
  const { from, to } = periodoIso(anno, mese)
  if (!isGestionaleConfigured()) return emptyRicavi(from, to)
  try {
    const voci = await queryIncassiPerVoce({ from, to })
    const byMacro: Record<MacroCommerciale, number> = { piscina: 0, fitness: 0, spa: 0 }
    const bySotto: Record<string, number> = {}
    let totAltri = 0
    for (const v of voci) {
      if (v.danza) continue
      const euro = Number(v.euro) || 0
      const destSotto = classificaSotto(v.voce, v.contesto)
      if (destSotto.length) {
        for (const d of destSotto) {
          const quota = round2(euro * d.peso)
          bySotto[d.id] = round2((bySotto[d.id] ?? 0) + quota)
          byMacro[d.macro] += quota
        }
      } else {
        const dest = classificaRicavo(v.voce, v.contesto)
        if (dest.length === 0) continue
        for (const d of dest) {
          const quota = round2(euro * d.peso)
          if (d.macro === "altro") totAltri += quota
          else byMacro[d.macro] += quota
        }
      }
    }
    const dettaglio = ordinaDettaglioRicavi(raggruppaDettaglioRicavi(voci))
    for (const k of MACRO_COMMERCIALI) byMacro[k] = round2(byMacro[k])
    for (const k of Object.keys(bySotto)) bySotto[k] = round2(bySotto[k])
    totAltri = round2(totAltri)
    const totCommerciali = round2(MACRO_COMMERCIALI.reduce((s, k) => s + byMacro[k], 0))
    const totCorsi = round2(CORSI_IDS.reduce((s, k) => s + (bySotto[k] ?? 0), 0))
    return {
      from,
      to,
      tot: round2(totCommerciali + totAltri),
      totCommerciali,
      totAltri,
      totCorsi,
      byMacro,
      bySotto,
      dettaglio,
      disponibile: true,
    }
  } catch (e) {
    console.warn("[amm] ricavi gestionale:", (e as Error)?.message ?? e)
    return emptyRicavi(from, to)
  }
}

/** Spezza `totale` in euro sui pesi (ultima riga con peso > 0 prende il resto, così la somma torna esatta). */
export function splitEuro(totale: number, pesi: number[]): number[] {
  const n = pesi.length
  if (n === 0) return []
  const out = pesi.map(() => 0)
  if (Math.abs(totale) <= 0.009) return out
  const totPesi = pesi.reduce((s, p) => s + (Number(p) || 0), 0)
  let lastPos = -1
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(pesi[i]) > 0.009) {
      lastPos = i
      break
    }
  }
  if (totPesi <= 0.009 || lastPos < 0) {
    out[n - 1] = round2(totale)
    return out
  }
  let acc = 0
  for (let i = 0; i < n; i++) {
    if (i === lastPos) {
      out[i] = round2(totale - acc)
    } else {
      out[i] = round2((totale * pesi[i]) / totPesi)
      acc = round2(acc + out[i])
    }
  }
  return out
}

export function quoteRipartoFissi(ricavi: Record<MacroCommerciale, number>): Record<MacroCommerciale, number> {
  const tot = MACRO_COMMERCIALI.reduce((s, k) => s + (ricavi[k] || 0), 0)
  if (tot > 0.009) {
    const out = { piscina: 0, fitness: 0, spa: 0 } as Record<MacroCommerciale, number>
    let acc = 0
    MACRO_COMMERCIALI.forEach((k, i) => {
      const last = i === MACRO_COMMERCIALI.length - 1
      const q = last ? round2(100 - acc) : round2(((ricavi[k] || 0) / tot) * 100)
      acc = round2(acc + q)
      out[k] = q
    })
    return out
  }
  return { piscina: round2(100 / 3), fitness: round2(100 / 3), spa: round2(100 - 2 * round2(100 / 3)) }
}
