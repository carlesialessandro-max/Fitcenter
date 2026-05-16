/** Reparto / comparto (URL e persistenza). */
export type CalendarioComparto =
  | "corsi"
  | "scuola_nuoto"
  | "piscina"
  | "reception"
  | "danza"
  | "campus"
  | "sala_fitness"
  | "acquaticita"
  | "spogliatoi"
  | "consulenti"

export type CalendarioIstruttore = {
  id: string
  nome: string
  cognome: string
  telefono: string
  email: string
  createdAt: string
  updatedAt: string
}

/** Riga base da planning Excel (solo comparto corsi). */
export type CalendarioBaseEvent = {
  id: string
  zona: string
  sheet: string
  dow: number
  start: string
  title: string
  staff: string
}

export type CalendarioSlotRevision = {
  comparto: CalendarioComparto
  stableKey: string
  dow: number
  /** Se valorizzato (YYYY-MM-DD), lo slot vale solo per quel giorno di calendario. */
  dateIso?: string | null
  start: string
  title: string
  zona?: string
  /** Se valorizzato, prevale sul testo Excel / staffOverride. */
  istruttoreId?: string | null
  /** Nome libero se non si usa anagrafica istruttori. */
  staffOverride?: string | null
  note?: string | null
  /** Nasconde lo slot del planning Excel (solo corsi con revisione su stableKey originale). */
  removed?: boolean
  updatedAt: string
  updatedBy: string
}

export type CalendarioDb = {
  instructors: CalendarioIstruttore[]
  revisions: CalendarioSlotRevision[]
}

export type CalendarioMergedEvent = CalendarioBaseEvent & {
  stableKey: string
  dateIso?: string | null
  istruttoreId?: string | null
  staffOverride?: string | null
  note?: string | null
  updatedAt?: string
  updatedBy?: string
}
