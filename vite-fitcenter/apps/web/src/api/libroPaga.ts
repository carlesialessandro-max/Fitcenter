import { api } from "./client"

export type LpagaRuolo = "admin" | "manager" | "user"

export type LpagaLivello = {
  id: string
  nome: string
  parentId?: string
  parentNome?: string
  dominio?: string
  retribuzione: number
  fissa: boolean
  retribuibile: boolean
  statistica: boolean
  speciale: boolean
  attivo: boolean
}

export type LpagaPersonale = {
  id: string
  nome: string
  cognome?: string
  username?: string
  ruolo: LpagaRuolo
  livelloId?: string
  livelloIds?: string[]
  contratto?: string
  iban?: string
  email?: string
  tesseramento?: string
  tesseramentoScadenza?: string
  tesseramentoFonte?: "gestionale" | "calendario" | "manuale"
  visitaMedica?: string
  qualifiche?: { id: string; data?: string }[]
  attivo: boolean
  nominativo?: string
  repartoNome?: string
  gestionale?: {
    idUtente?: string
    codiceFiscale?: string
    email?: string
    cellulare?: string
    telefono?: string
    indirizzo?: string
    cap?: string
    citta?: string
    provincia?: string
    dataNascita?: string
    sesso?: string
    tesseramento?: string
    tesseramentoScadenza?: string
    certificatoMedico?: string
    certificatoMedicoScadenza?: string
    categoria?: string
  }
}

export type LpagaTurnoRow = {
  id: string
  personaleId: string
  livelloId: string
  giorno: string
  quantita: number
  importo: number
  note?: string
  creatoDa: string
  createdAt: string
  personaleNome: string
  livelloNome: string
  presenzaValore: number | null
  presenzaDa: string | null
  presenzaAt: string | null
  convalidaStato?: string | null
  convalidaDa?: string | null
  convalidaAt?: string | null
}

export type LpagaMensilitaRow = {
  personaleId: string
  personaleNome: string
  iban: string
  mese: string
  ore: number
  importo: number
  presenzaOre: number
  nTurni: number
  nControllati: number
  bonifico: number
  nota: string
  chiuso: boolean
  totAnno?: number
}

export type LpagaConvalida = {
  personaleId: string
  nominativo: string
  reparto: string
  ultima: string | null
  okIeri: boolean
  nTurni?: number
  nConfermati?: number
  nDaFare?: number
}

export type LpagaConvalideRiepilogo = {
  mese: string
  nTurni: number
  nConfermati: number
  nNonSvolte: number
  nDaFare: number
  ultima: string | null
  ultimaDa: string | null
  settimane: {
    id: string
    from: string
    to: string
    label: string
    nTurni: number
    nConfermati: number
    nNonSvolte: number
    nDaFare: number
    ultima: string | null
    ultimaDa: string | null
  }[]
  responsabili: {
    personaleId: string
    nominativo: string
    reparto: string
    nTurni: number
    nConfermati: number
    nNonSvolte: number
    nDaFare: number
    ultima: string | null
    ultimaDa: string | null
    scopes: {
      id: string
      nome: string
      nTurni: number
      nConfermati: number
      nDaFare: number
    }[]
    settimane: LpagaConvalideRiepilogo["settimane"]
  }[]
}

export type LpagaTreeNode = {
  id: string
  nome: string
  retribuibile?: boolean
  attivo?: boolean
  children?: LpagaTreeNode[]
}

export type LibroPagaSnapshot = {
  storage: "sql" | "json"
  mese: string
  livelli: LpagaLivello[]
  personale: LpagaPersonale[]
  turni: LpagaTurnoRow[]
  mensilita: LpagaMensilitaRow[]
  convalide: LpagaConvalida[]
  convalideRiepilogo?: LpagaConvalideRiepilogo
  tree: LpagaTreeNode[]
  reparti?: { id: string; nome: string }[]
  home: {
    admin: number
    manager: number
    user: number
    livelli: number
    turniOggi: number
    convalideOggi: number
    costiMesi: {
      mese: string
      totale: number
      piscina: number
      palestra: number
      ristorante: number
      miscellanea: number
    }[]
    donut: { label: string; value: number }[]
    miscDonut: { label: string; value: number }[]
    mioOre?: number
    mioImporto?: number
    mioTurni?: number
  }
  me?: { id: string; nominativo: string; ruolo: LpagaRuolo; repartoNome: string } | null
}

export type LibroPagaRepartiPreview = {
  mese: string
  turniConsiderati: number
  turniSenzaAbbinamento: number
  abbinamentiAmbigui: number
  attivitaSenzaReparto: { attivita: string; turni: number }[]
  personale: {
    personaleId: string
    nominativo: string
    livelloIdsAttuali: string[]
    livelloIdsSuggeriti: string[]
    repartiSuggeriti: string[]
    turniConsiderati: number
    modifiche: boolean
  }[]
  personeConModifiche: number
}

export const libroPagaApi = {
  get: (mese: string, reparto?: string) => {
    const q = new URLSearchParams({ mese })
    if (reparto) q.set("reparto", reparto)
    return api.get<LibroPagaSnapshot>(`/libro-paga?${q.toString()}`)
  },
  previewRepartiDaTurni: (mese: string) => {
    const q = new URLSearchParams({ mese })
    return api.get<LibroPagaRepartiPreview>(`/libro-paga/reparti-da-turni/preview?${q.toString()}`)
  },
  applyRepartiDaTurni: (mese: string) =>
    api.post<{ preview: LibroPagaRepartiPreview; updated: number; snapshotId: string }>(
      "/libro-paga/reparti-da-turni",
      { mese },
    ),
  importDump: (file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    return api.post<{
      turni: number
      mode: string
      snapshotId: string
      storage: string
      dump: string
    }>("/libro-paga/import-dump", fd)
  },
  listSnapshots: () =>
    api.get<{ snapshots: { id: string; createdAt: string; label: string; personale: number; turni: number }[] }>(
      "/libro-paga/snapshots"
    ),
  snapshotNow: () => api.post<{ snapshot: { id: string } }>("/libro-paga/snapshots", {}),
  restoreSnapshot: (id: string) => api.post<{ ok: boolean; storage: string }>("/libro-paga/snapshots/restore", { id }),
  repairRuoli: (adminUsernames?: string[]) =>
    api.post<{ managers: number; admins: number; skipped: number }>("/libro-paga/repair-ruoli", {
      adminUsernames: adminUsernames ?? [],
    }),
  createLivello: (body: {
    nome: string
    parentId?: string
    retribuzione: number
    fissa: boolean
    retribuibile?: boolean
    statistica?: boolean
    attivo?: boolean
  }) => api.post<{ livello: LpagaLivello }>("/libro-paga/livelli", body),
  patchLivello: (id: string, body: Partial<LpagaLivello>) =>
    api.patch<{ livello: LpagaLivello }>(`/libro-paga/livelli/${encodeURIComponent(id)}`, body),
  deleteLivello: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/livelli/${encodeURIComponent(id)}`),
  createPersonale: (body: {
    nome: string
    cognome?: string
    username?: string
    password?: string
    ruolo?: LpagaRuolo
    livelloId?: string
    livelloIds?: string[]
    contratto?: string
    iban?: string
    email?: string
    tesseramento?: string
    tesseramentoScadenza?: string
    visitaMedica?: string
    qualifiche?: { id: string; data?: string }[]
    attivo?: boolean
  }) => api.post<{ personale: LpagaPersonale }>("/libro-paga/personale", body),
  setPersonalePassword: (id: string, password: string) =>
    api.put<{ ok: boolean }>(`/libro-paga/personale/${encodeURIComponent(id)}/password`, { password }),
  patchPersonale: (id: string, body: Partial<LpagaPersonale> & { password?: string }) =>
    api.patch<{ personale: LpagaPersonale }>(`/libro-paga/personale/${encodeURIComponent(id)}`, body),
  deletePersonale: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/personale/${encodeURIComponent(id)}`),
  createTurno: (body: { personaleId: string; livelloId: string; giorno: string; quantita: number; note?: string }) =>
    api.post<{ turno: unknown }>("/libro-paga/turni", body),
  deleteTurno: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/turni/${encodeURIComponent(id)}`),
  putPresenza: (turnoId: string, valore: number) =>
    api.put<{ presenza: unknown }>(`/libro-paga/turni/${encodeURIComponent(turnoId)}/presenza`, { valore }),
  putMensilita: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) =>
    api.put<{ mensilita: unknown }>("/libro-paga/mensilita", body),
  getConvalida: (mese: string, personaleId: string, reparto?: string) => {
    const q = new URLSearchParams({ mese, personaleId })
    if (reparto) q.set("reparto", reparto)
    return api.get<import("@/api/lpaga").LpagaConvalidaPayload>(`/libro-paga/convalida?${q.toString()}`)
  },
  getConvalidaMese: (mese: string, opts?: { scope?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams({ mese })
    if (opts?.scope) q.set("scope", opts.scope)
    if (opts?.from) q.set("from", opts.from)
    if (opts?.to) q.set("to", opts.to)
    return api.get<import("@/api/lpaga").LpagaConvalidaMesePayload>(`/libro-paga/convalida-mese?${q.toString()}`)
  },
  postConvalidaMese: (mese: string, opts?: { scope?: string; from?: string; to?: string }) =>
    api.post<import("@/api/lpaga").LpagaConvalidaMesePayload>("/libro-paga/convalida-mese", {
      mese,
      ...(opts?.scope ? { scope: opts.scope } : {}),
      ...(opts?.from ? { from: opts.from } : {}),
      ...(opts?.to ? { to: opts.to } : {}),
    }),
  putConvalidaTurno: (body: {
    turnoId: string
    stato: import("@/api/lpaga").TurnoConvalidaStato
    nota?: string
    sostitutoNome?: string
  }) => api.put<{ convalida: unknown }>("/libro-paga/convalida/turno", body),
  getDeleghe: (managerId: string) =>
    api.get<{ managerId: string; deleghe: string[] }>(`/libro-paga/deleghe?managerId=${encodeURIComponent(managerId)}`),
  putDeleghe: (managerId: string, ids: string[]) =>
    api.put<{ managerId: string; deleghe: string[] }>("/libro-paga/deleghe", { managerId, ids }),
}
