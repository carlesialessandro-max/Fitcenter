export type LpSesso = "M" | "F"

const MALE_GIVEN = new Set(
  `
  alessandro alessio alfredo andrea angelo antonio bruno carlo cesare claudio cristiano
  daniele davide diego domenico edoardo emanuele enrico enzo ettore ezio fabio federico
  filippo francesco fulvio gabriele gaetano giacomo gioele giorgio giovanni giulio giuseppe
  jacopo leonardo lorenzo luca luigi manuel marcello marco mario massimiliano massimo
  matteo mattia michele mirko nicola nicolo paolo piero pietro raffaele riccardo roberto
  salvatore samuele savio sergio simone stefano tommaso umberto valerio vincenzo vittorio
  andrea luca nicola mattia elia tobia battista attila gianluca gianmarco gianmaria
  pierluigi pierpaolo pierandrea nicolas kevin michael daniel david john
  `.split(/\s+/).filter(Boolean)
)

const FEMALE_GIVEN = new Set(
  `
  ada adele agnese alba alice amelia angela angelica anita anna annamaria antonella antonia
  aurora beatrice benedetta bianca camilla carla carlotta carmen caterina cecilia chiara
  cinzia claudia cristina daniela debora denise diana donatella elena eleonora elisa
  elisabetta elvira emanuela emma erica ester eva federica francesca gaia giada ginevra
  giorgia giovanna giulia giuliana gloria grazia greta ilaria irene isabella iside
  laura letizia lidia lina lisa loredana lorena lucia luciana luisa maddalena mara
  marcella margherita maria marianna marika marina marta martina marzia melissa michela
  mirella monica nadia noemi ombretta ornella paola patricia patrizia pia raffaella
  rebecca rita roberta rosa rosanna rossella sabrina sandra sara serena silvia simona
  sofia sonia stefania susanna tania tecla teresa tiziana valentina valeria vanessa
  vera veronica viola virginia viviana
  `.split(/\s+/).filter(Boolean)
)

const MALE_ENDING_A = new Set(["andrea", "luca", "nicola", "mattia", "elia", "tobia", "battista", "attila", "barnaba"])

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
}

function tokens(nome: string): string[] {
  return fold(nome).split(/\s+/).filter((t) => t.length >= 2)
}

function sessoDaGiven(given: string): LpSesso | null {
  if (!given) return null
  if (FEMALE_GIVEN.has(given)) return "F"
  if (MALE_GIVEN.has(given)) return "M"
  if (MALE_ENDING_A.has(given)) return "M"
  if (given.endsWith("a")) return "F"
  if (given.endsWith("o") || given.endsWith("i") || given.endsWith("e")) {
    if (given.endsWith("o")) return "M"
  }
  return null
}

/** Prende il nome di battesimo da «Nome Cognome» o «Cognome Nome». */
export function nomeBattesimo(nome: string): string {
  const t = tokens(nome)
  if (!t.length) return ""
  for (const x of t) {
    if (FEMALE_GIVEN.has(x) || MALE_GIVEN.has(x) || MALE_ENDING_A.has(x)) return x
  }
  return t.length >= 2 ? t[t.length - 1]! : t[0]!
}

export function inferSessoDaNome(nome: string): LpSesso | null {
  return sessoDaGiven(nomeBattesimo(nome))
}

export function parsePrefSessoIstruttore(pref?: string | null): LpSesso | null {
  const t = fold(String(pref ?? ""))
  if (!t) return null
  if (/\b(femmin|donna|istruttrice|ragazza)\b/.test(t) || t === "f") return "F"
  if (/\b(maschi|uomo|istruttore|ragazzo)\b/.test(t) || t === "m") return "M"
  return inferSessoDaNome(t)
}

export function sessoIstruttore(i: { nome: string; sesso?: LpSesso | null }): LpSesso | null {
  if (i.sesso === "M" || i.sesso === "F") return i.sesso
  return inferSessoDaNome(i.nome)
}

export function istruttoriPerPreferenza<T extends { nome: string; sesso?: LpSesso | null; attivo?: boolean; telefono?: string }>(
  instructors: T[],
  pref?: string | null
): T[] {
  const attivi = instructors.filter((i) => i.attivo !== false && String(i.telefono ?? "").trim())
  const want = parsePrefSessoIstruttore(pref)
  if (!want) return attivi
  const matched = attivi.filter((i) => {
    const s = sessoIstruttore(i)
    return s === want || s == null
  })
  return matched
}

export function labelSesso(s: LpSesso | null | undefined): string {
  if (s === "F") return "donna"
  if (s === "M") return "uomo"
  return "da confermare"
}
