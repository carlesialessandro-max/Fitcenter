import {
  listLivelli,
  listPersonale,
  listTurni,
  mergePersonaleLivelli,
  setPersonaleLivelliBatch,
  type LpagaLivello,
  type LpagaPersonale,
  type LpagaTurno,
} from "../store/libro-paga-db.js"

type RepartoTarget = {
  key: string
  aliases: string[]
  fallbackAliases?: string[]
  ancestorAliases?: string[]
}

type AssignmentSuggestion = {
  personaleId: string
  nominativo: string
  livelloIdsAttuali: string[]
  livelloIdsSuggeriti: string[]
  repartiSuggeriti: string[]
  turniConsiderati: number
  modifiche: boolean
}

export type LibroPagaRepartiPreview = {
  mese: string
  turniConsiderati: number
  turniSenzaPersonale: number
  attivitaSenzaReparto: { attivita: string; turni: number }[]
  personale: AssignmentSuggestion[]
  personeConModifiche: number
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function hasAncestor(level: LpagaLivello, aliases: string[], levelsById: Map<string, LpagaLivello>): boolean {
  const wanted = new Set(aliases.map(normalize))
  const visited = new Set<string>()
  let current: LpagaLivello | undefined = level
  while (current && !visited.has(current.id)) {
    if (wanted.has(normalize(current.nome)) || wanted.has(normalize(current.id))) return true
    visited.add(current.id)
    current = current.parentId ? levelsById.get(current.parentId) : undefined
  }
  return false
}

function findLevel(
  levels: LpagaLivello[],
  aliases: string[],
  ancestorAliases: string[] = [],
): LpagaLivello | undefined {
  const levelsById = new Map(levels.map((level) => [level.id, level]))
  for (const alias of aliases) {
    const idMatch = levels.find(
      (level) =>
        normalize(level.id) === normalize(alias) &&
        (!ancestorAliases.length || hasAncestor(level, ancestorAliases, levelsById)),
    )
    if (idMatch) return idMatch
  }
  for (const alias of aliases) {
    const nameMatches = levels.filter(
      (level) =>
        normalize(level.nome) === normalize(alias) &&
        (!ancestorAliases.length || hasAncestor(level, ancestorAliases, levelsById)),
    )
    if (nameMatches.length === 1) return nameMatches[0]
    if (nameMatches.length > 1) return undefined
  }
  return undefined
}

function levelPath(levelId: string, levelsById: Map<string, LpagaLivello>): string[] {
  const path: string[] = []
  const visited = new Set<string>()
  let current = levelsById.get(levelId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current.nome)
    current = current.parentId ? levelsById.get(current.parentId) : undefined
  }
  return path
}

function targetForActivity(activity: string): RepartoTarget | null {
  const text = normalize(activity)

  if (/lez(?:ione|ioni)?\s*priv|privat/.test(text)) {
    const privateAliases = /disabil/.test(text)
      ? [
          "lezioni private disabili nardi",
          "lezioni private disabili",
          "lez private disabili",
          "lezione private disabili",
        ]
      : /bimb|bambin/.test(text)
        ? [
            "lezioni private bimbi",
            "lezione private bimbi super",
            "lezioni priv bimbi",
            "2 bimbi privata",
            "2 bimbi private super",
          ]
        : [
            "lez priv 30 min",
            "lezioni priv adulti",
            "lezioni priv adulti pro",
            "lezioni private",
          ]
    return {
      key: "lezioni private",
      aliases: [...privateAliases, "lezioni private", "lez private", "private acqua"],
      ancestorAliases: ["piscina"],
    }
  }
  if (/miscellanea.*manutenz|manutenz.*miscellanea/.test(text)) {
    return { key: "manutenzione", aliases: ["manutenzione"], ancestorAliases: ["miscellanea"] }
  }
  if (/miscellanea.*varie|varie.*miscellanea/.test(text)) {
    return { key: "varie", aliases: ["varie"], ancestorAliases: ["miscellanea"] }
  }
  if (/corsi terra|walking|spinning|spin\b|sbarra a terra/.test(text)) {
    return {
      key: "corsi fit terra",
      aliases: ["corsi fit terra", "corsi terra"],
      fallbackAliases: ["palestra"],
      ancestorAliases: ["palestra"],
    }
  }
  if (/inserimento libero fitness|p t fitness/.test(text)) {
    return { key: "palestra", aliases: ["palestra"] }
  }
  if (/controllo.*vasca|piano vasca|bagnin/.test(text)) {
    return {
      key: "controllo vasca",
      aliases: ["bagnini", "controllo piano vasca", "piano vasca"],
      fallbackAliases: ["piscina coperta", "piscina"],
      ancestorAliases: ["piscina"],
    }
  }
  if (/puliz|manutenz/.test(text) && /piscin|vasca|spogliato/.test(text)) {
    return { key: "manutenzione piscina", aliases: ["manutenzione piscina", "pulizie piscina", "pulizie"] }
  }
  if (/agonistic|squadra categoria/.test(text)) {
    return {
      key: "agonismo",
      aliases: ["squadra agonistica", "agonismo", "nuoto agonistico", "master piscina"],
      fallbackAliases: ["scuola nuoto"],
    }
  }
  if (/scuola nuoto|sn bambini|bimb|bambin|baby|junior|ragazz/.test(text)) {
    if (/adult|master/.test(text)) {
      return {
        key: "scuola nuoto adulti",
        aliases: ["scuola nuoto adulti", "scuola nuoto master", "nuoto adulti"],
        fallbackAliases: ["scuola nuoto"],
        ancestorAliases: ["piscina"],
      }
    }
    return {
      key: "scuola nuoto bambini",
      aliases: ["scuola nuoto bimbi", "scuola nuoto bambini", "scuola nuoto baby", "scuola nuoto"],
      ancestorAliases: ["piscina"],
    }
  }
  if (/master piscina/.test(text)) {
    return {
      key: "agonismo",
      aliases: ["squadra agonistica", "agonismo", "nuoto agonistico", "master piscina"],
      fallbackAliases: ["scuola nuoto"],
      ancestorAliases: ["piscina"],
    }
  }
  if (/\bh ?2 ?[o0]\b|\bacquagym\b|\bacquafitness\b|\bacqua fitness\b/.test(text)) {
    return {
      key: "corsi fit acqua",
      aliases: ["corsi fit acqua", "corsi fit h2o", "corsi fit h20", "corsi acqua", "acquaticita"],
    }
  }
  if (/acquaticita/.test(text)) {
    return { key: "acquaticita", aliases: ["acquaticita"] }
  }
  if (/sala pesi|sala fitness|sala attrezzi/.test(text)) {
    return {
      key: "sala pesi",
      aliases: ["sala pesi", "sala fitness", "sala attrezzi"],
      fallbackAliases: ["palestra"],
      ancestorAliases: ["palestra"],
    }
  }
  if (/corsi fit terra|corsi fit|corso fit|corsi fitness|corso fitness/.test(text)) {
    return {
      key: "corsi fit terra",
      aliases: ["corsi fit terra", "corsi fit", "corsi fitness"],
      fallbackAliases: ["palestra"],
      ancestorAliases: ["palestra"],
    }
  }
  if (/reception|desk|segreteri|accoglienza/.test(text)) {
    return {
      key: "reception",
      aliases: ["reception", "desk", "segreteria"],
      fallbackAliases: ["amministrazione", "uffici"],
    }
  }
  if (/spogliato/.test(text)) {
    return { key: "spogliatoi", aliases: ["spogliatoi"], fallbackAliases: ["servizi"] }
  }
  if (/campus/.test(text)) return { key: "campus", aliases: ["campus"] }
  if (/spa|benessere|wellness/.test(text)) {
    return { key: "spa", aliases: ["spa", "benessere", "wellness"] }
  }
  if (/danza|pole dance/.test(text)) {
    return { key: "danza", aliases: ["danza", "pole dance"], fallbackAliases: ["corsi fit terra", "palestra"] }
  }
  if (/bagn|piscin|vasca|nuoto libero/.test(text)) {
    return {
      key: "piscina",
      aliases: ["piscina coperta", "piscina", "bagnini"],
    }
  }
  if (/puliz/.test(text)) return { key: "pulizie", aliases: ["pulizie"] }
  return null
}

function resolveLevel(levels: LpagaLivello[], target: RepartoTarget): LpagaLivello | undefined {
  return (
    findLevel(levels, target.aliases, target.ancestorAliases) ??
    (target.fallbackAliases?.length
      ? findLevel(levels, target.fallbackAliases, target.ancestorAliases)
      : undefined)
  )
}

function isCoveredByCurrent(
  targetId: string,
  currentIds: string[],
  levelsById: Map<string, LpagaLivello>,
): boolean {
  const current = new Set(currentIds)
  let target = levelsById.get(targetId)
  const visited = new Set<string>()
  while (target && !visited.has(target.id)) {
    if (current.has(target.id)) return true
    visited.add(target.id)
    target = target.parentId ? levelsById.get(target.parentId) : undefined
  }
  return false
}

export async function previewLibroPagaRepartiDaTurni(month: string): Promise<LibroPagaRepartiPreview> {
  const [people, levels, shifts] = await Promise.all([
    listPersonale(),
    listLivelli(),
    listTurni(month),
  ])
  return buildLibroPagaRepartiPreview(month, people, levels, shifts)
}

export function buildLibroPagaRepartiPreview(
  month: string,
  allPeople: LpagaPersonale[],
  levels: LpagaLivello[],
  shifts: LpagaTurno[],
): LibroPagaRepartiPreview {
  const peopleById = new Map(allPeople.filter((person) => person.attivo).map((person) => [person.id, person]))
  const levelsById = new Map(levels.map((level) => [level.id, level]))
  const suggestionByPerson = new Map<
    string,
    { person: LpagaPersonale; current: string[]; targets: Set<string>; count: number }
  >()
  const unmapped = new Map<string, number>()
  let unmatched = 0

  for (const shift of shifts) {
    const person = peopleById.get(shift.personaleId)
    if (!person) {
      unmatched += 1
      continue
    }

    const activity = levelPath(shift.livelloId, levelsById).join(" ")
    const target = targetForActivity(activity)
    const level = target ? resolveLevel(levels, target) : undefined
    if (!target || !level) {
      const label = target ? `${activity} -> ${target.key}` : activity || "Mansione senza nome"
      unmapped.set(label, (unmapped.get(label) ?? 0) + 1)
      continue
    }

    const current = mergePersonaleLivelli(person.livelloId, person.livelloIds).livelloIds ?? []
    const suggestion = suggestionByPerson.get(person.id) ?? {
      person,
      current,
      targets: new Set<string>(),
      count: 0,
    }
    suggestion.count += 1
    if (!isCoveredByCurrent(level.id, current, levelsById)) suggestion.targets.add(level.id)
    suggestionByPerson.set(person.id, suggestion)
  }

  const suggestions = [...suggestionByPerson.values()]
    .map(({ person, current, targets, count }): AssignmentSuggestion => {
      const suggested = [...new Set([...current, ...targets])]
      return {
        personaleId: person.id,
        nominativo: person.cognome ? `${person.cognome} ${person.nome}` : person.nome,
        livelloIdsAttuali: current,
        livelloIdsSuggeriti: suggested,
        repartiSuggeriti: suggested.map((id) => levelsById.get(id)?.nome ?? id),
        turniConsiderati: count,
        modifiche: suggested.some((id) => !current.includes(id)),
      }
    })
    .sort((a, b) => a.nominativo.localeCompare(b.nominativo, "it"))

  return {
    mese: month,
    turniConsiderati: shifts.length,
    turniSenzaPersonale: unmatched,
    attivitaSenzaReparto: [...unmapped.entries()]
      .map(([attivita, turni]) => ({ attivita, turni }))
      .sort((a, b) => a.attivita.localeCompare(b.attivita, "it")),
    personale: suggestions,
    personeConModifiche: suggestions.filter((suggestion) => suggestion.modifiche).length,
  }
}

export async function applyLibroPagaRepartiDaTurni(
  month: string,
): Promise<{ preview: LibroPagaRepartiPreview; updated: number }> {
  const preview = await previewLibroPagaRepartiDaTurni(month)
  const updated = await setPersonaleLivelliBatch(
    preview.personale
      .filter((suggestion) => suggestion.modifiche)
      .map((suggestion) => ({
        id: suggestion.personaleId,
        livelloIds: suggestion.livelloIdsSuggeriti,
      })),
  )
  return { preview, updated }
}
