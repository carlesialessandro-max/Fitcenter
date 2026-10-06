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
  contratto?: string
  iban?: string
  attivo: boolean
  nominativo?: string
  repartoNome?: string
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
}

export type LpagaTreeNode = {
  id: string
  nome: string
  retribuibile?: boolean
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

export const libroPagaApi = {
  get: (mese: string, reparto?: string) => {
    const q = new URLSearchParams({ mese })
    if (reparto) q.set("reparto", reparto)
    return api.get<LibroPagaSnapshot>(`/libro-paga?${q.toString()}`)
  },
  importDump: () => api.post<Record<string, unknown>>("/libro-paga/import-dump", {}),
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
    contratto?: string
    iban?: string
    attivo?: boolean
  }) => api.post<{ personale: LpagaPersonale }>("/libro-paga/personale", body),
  setPersonalePassword: (id: string, password: string) =>
    api.put<{ ok: boolean }>(`/libro-paga/personale/${encodeURIComponent(id)}/password`, { password }),
  patchPersonale: (id: string, body: Partial<LpagaPersonale>) =>
    api.patch<{ personale: LpagaPersonale }>(`/libro-paga/personale/${encodeURIComponent(id)}`, body),
  deletePersonale: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/personale/${encodeURIComponent(id)}`),
  createTurno: (body: { personaleId: string; livelloId: string; giorno: string; quantita: number; note?: string }) =>
    api.post<{ turno: unknown }>("/libro-paga/turni", body),
  deleteTurno: (id: string) => api.delete<{ ok: boolean }>(`/libro-paga/turni/${encodeURIComponent(id)}`),
  putPresenza: (turnoId: string, valore: number) =>
    api.put<{ presenza: unknown }>(`/libro-paga/turni/${encodeURIComponent(turnoId)}/presenza`, { valore }),
  putMensilita: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) =>
    api.put<{ mensilita: unknown }>("/libro-paga/mensilita", body),
  getConvalida: (mese: string, personaleId: string) =>
    api.get<import("@/api/lpaga").LpagaConvalidaPayload>(
      `/libro-paga/convalida?mese=${encodeURIComponent(mese)}&personaleId=${encodeURIComponent(personaleId)}`
    ),
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
