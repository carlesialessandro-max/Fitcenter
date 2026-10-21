import type { CalendarioComparto, CalendarioMergedEvent, CalendarioIstruttore } from "../types/calendario.js"
import { listCalendarioPerAssegnazione } from "../handlers/calendario.js"
import {
  listLivelli,
  listPersonale,
  mergePersonaleLivelli,
  setPersonaleLivelliBatch,
  type LpagaLivello,
  type LpagaPersonale,
} from "../store/libro-paga-db.js"
import { namesMatchPersonale } from "./libro-paga-convalida.js"

type CalendarAssignmentEvent = CalendarioMergedEvent & {
  comparto: CalendarioComparto
  staffDisplay: string
}

type RepartoTarget = {
  id: string
  labels: string[]
  fallbackLabels: string[]
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
  turniSenzaAbbinamento: number
  abbinamentiAmbigui: number
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

function personNameForms(person: LpagaPersonale): Set<string> {
  const nome = normalize(person.nome)
  const cognome = normalize(person.cognome ?? "")
  const forms = new Set<string>()
  if (nome && cognome) {
    forms.add(`${nome} ${cognome}`)
    forms.add(`${cognome} ${nome}`)
  }
  forms.add(normalize(person.nome))
  return forms
}

function staffNames(
  event: CalendarAssignmentEvent,
  instructorsById: Map<string, CalendarioIstruttore>,
): string[] {
  const names = [event.staffDisplay, event.staffOverride ?? ""]
  const instructor = event.istruttoreId ? instructorsById.get(event.istruttoreId) : undefined
  if (instructor) names.push(`${instructor.cognome} ${instructor.nome}`)
  names.push(event.staff)
  return [...new Set(names.map((x) => x.trim()).filter((x) => {
    const n = normalize(x)
    return n && n !== "-" && n !== "corso" && n !== "trainer" && n !== "training" && n !== "trainers"
  }))]
}

function findPerson(
  names: string[],
  people: LpagaPersonale[],
): { person?: LpagaPersonale; ambiguous: boolean } {
  for (const name of names) {
    const normalized = normalize(name)
    const exact = people.filter((person) => personNameForms(person).has(normalized))
    if (exact.length === 1) return { person: exact[0], ambiguous: false }
    if (exact.length > 1) return { ambiguous: true }
  }

  const matches = people.filter((person) => names.some((name) => namesMatchPersonale(person, name)))
  if (matches.length === 1) return { person: matches[0], ambiguous: false }
  return { ambiguous: matches.length > 1 }
}

function eventAppliesToDate(event: CalendarAssignmentEvent, dateIso: string, dow: number): boolean {
  if (event.dateIso) return event.dateIso === dateIso
  if (event.seasonal) {
    const mmdd = dateIso.slice(5)
    return event.seasonal.from <= event.seasonal.to
      ? mmdd >= event.seasonal.from && mmdd <= event.seasonal.to
      : mmdd >= event.seasonal.from || mmdd <= event.seasonal.to
  }
  return event.dow === dow
}

function eventsForMonth(events: CalendarAssignmentEvent[], month: string): CalendarAssignmentEvent[] {
  const [year, monthNumber] = month.split("-").map(Number)
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const relevant: CalendarAssignmentEvent[] = []
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day))
    const dateIso = `${month}-${String(day).padStart(2, "0")}`
    for (const event of events) {
      if (eventAppliesToDate(event, dateIso, date.getUTCDay())) relevant.push(event)
    }
  }
  return relevant
}

function targetForEvent(
  event: CalendarAssignmentEvent,
  activityText: string,
): RepartoTarget | null {
  const text = normalize(activityText)
  const zona = normalize(event.zona)
  if (/\bspa\b|benessere|wellness/.test(text)) {
    return { id: "spa-benessere", labels: ["spa benessere", "spa", "benessere"], fallbackLabels: ["spa"] }
  }
  if (/pole dance/.test(text)) {
    return { id: "pole-dance", labels: ["pole dance", "pole"], fallbackLabels: ["palestra", "fitness"] }
  }
  if (event.comparto === "piscina") {
    if (/esterna|estiva|vasca esterna/.test(zona)) {
      return {
        id: "piscina-estiva",
        labels: ["piscina estiva", "piscina esterna", "vasca esterna"],
        fallbackLabels: ["piscina"],
      }
    }
    return {
      id: "piscina-coperta",
      labels: ["piscina coperta", "piscina interna", "vasca interna", "bagnini"],
      fallbackLabels: ["piscina"],
    }
  }
  if (event.comparto === "acquaticita" || /acquagym|acquafitness|acqua fitness|corsi in acqua/.test(text) || zona === "acqua") {
    return {
      id: "corsi-fit-acqua",
      labels: ["corsi fit acqua", "corsi acqua", "acquaticita", "acqua fitness", "acquagym"],
      fallbackLabels: ["piscina", "fitness", "palestra"],
    }
  }
  if (event.comparto === "scuola_nuoto") {
    if (/adult|master/.test(text)) {
      return {
        id: "scuola-nuoto-adulti",
        labels: ["scuola nuoto adulti", "scuola nuoto master", "nuoto adulti"],
        fallbackLabels: ["scuola nuoto", "piscina"],
      }
    }
    if (/bamb|bimb|baby|junior|ragazz/.test(text)) {
      return {
        id: "scuola-nuoto-bambini",
        labels: ["scuola nuoto bambini", "scuola nuoto bimbi", "scuola nuoto baby", "scuola nuoto"],
        fallbackLabels: ["piscina"],
      }
    }
    return {
      id: "scuola-nuoto",
      labels: ["scuola nuoto"],
      fallbackLabels: ["piscina"],
    }
  }
  if (event.comparto === "sala_fitness") {
    return {
      id: "sala-pesi",
      labels: ["sala pesi", "sala fitness", "sala attrezzi", "palestra sala pesi"],
      fallbackLabels: ["palestra", "fitness"],
    }
  }
  if (event.comparto === "corsi" || event.comparto === "danza") {
    if (event.comparto === "danza" || zona === "terra") {
      return {
        id: "corsi-fit-terra",
        labels: ["corsi fit terra", "corsi fitness", "corsi fit", "danza"],
        fallbackLabels: ["palestra", "fitness"],
      }
    }
    return {
      id: "corsi-fit-terra",
      labels: ["corsi fit terra", "corsi fitness", "corsi fit"],
      fallbackLabels: ["palestra", "fitness"],
    }
  }
  if (event.comparto === "pulizie") {
    return { id: "pulizie", labels: ["pulizie"], fallbackLabels: ["servizi", "gestione"] }
  }
  if (event.comparto === "reception") {
    return {
      id: "reception",
      labels: ["reception", "desk", "segreteria", "amministrazione uffici"],
      fallbackLabels: ["gestione", "amministrazione"],
    }
  }
  if (event.comparto === "spogliatoi") {
    return {
      id: "spogliatoi",
      labels: ["spogliatoi", "servizi", "custodia"],
      fallbackLabels: ["servizi", "gestione"],
    }
  }
  if (event.comparto === "campus") {
    return { id: "campus", labels: ["campus"], fallbackLabels: [] }
  }
  return null
}

function findLevel(levels: LpagaLivello[], aliases: string[]): LpagaLivello | undefined {
  const active = levels.filter((level) => level.attivo)
  for (const alias of aliases) {
    const idMatch = active.find((level) => normalize(level.id) === normalize(alias))
    if (idMatch) return idMatch
  }
  for (const alias of aliases) {
    const nameMatches = active.filter((level) => normalize(level.nome) === normalize(alias))
    if (nameMatches.length === 1) return nameMatches[0]
    if (nameMatches.length > 1) return undefined
  }
  return undefined
}

function resolveLevel(levels: LpagaLivello[], target: RepartoTarget): LpagaLivello | undefined {
  return findLevel(levels, [target.id, ...target.labels]) ?? findLevel(levels, target.fallbackLabels)
}

function isCoveredByCurrent(
  targetId: string,
  currentIds: string[],
  levelsById: Map<string, LpagaLivello>,
): boolean {
  return currentIds.some((id) => {
    let current = levelsById.get(id)
    while (current) {
      if (current.id === targetId) return true
      current = current.parentId ? levelsById.get(current.parentId) : undefined
    }
    return false
  })
}

export async function previewLibroPagaRepartiDaTurni(month: string): Promise<LibroPagaRepartiPreview> {
  const [people, levels, calendar] = await Promise.all([
    listPersonale(),
    listLivelli(),
    Promise.resolve(listCalendarioPerAssegnazione()),
  ])
  return buildLibroPagaRepartiPreview(month, people, levels, calendar.events, calendar.instructors)
}

export function buildLibroPagaRepartiPreview(
  month: string,
  allPeople: LpagaPersonale[],
  levels: LpagaLivello[],
  calendarEvents: CalendarAssignmentEvent[],
  instructors: CalendarioIstruttore[],
): LibroPagaRepartiPreview {
  const activePeople = allPeople.filter((person) => person.attivo)
  const instructorsById = new Map(instructors.map((instructor) => [instructor.id, instructor]))
  const levelsById = new Map(levels.map((level) => [level.id, level]))
  const suggestionByPerson = new Map<string, {
    person: LpagaPersonale
    current: string[]
    targets: Set<string>
    count: number
  }>()
  const unmapped = new Map<string, number>()
  let unmatched = 0
  let ambiguous = 0
  let considered = 0

  for (const event of eventsForMonth(calendarEvents, month)) {
    considered += 1
    const names = staffNames(event, instructorsById)
    const match = findPerson(names, activePeople)
    if (!match.person) {
      if (match.ambiguous) ambiguous += 1
      else unmatched += 1
      continue
    }

    const instructorActivity = event.istruttoreId
      ? instructorsById.get(event.istruttoreId)?.attivitaSvolta ?? ""
      : ""
    const activity = [event.title, event.zona, instructorActivity].join(" ")
    const target = targetForEvent(event, activity)
    const level = target ? resolveLevel(levels, target) : undefined
    if (!target || !level) {
      const key = target?.id ?? event.comparto
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1)
      continue
    }

    const person = match.person
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
    turniConsiderati: considered,
    turniSenzaAbbinamento: unmatched,
    abbinamentiAmbigui: ambiguous,
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
