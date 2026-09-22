import { api } from "./client"

export type VascaId = "v25" | "ludica"
export type LpLezioneStato = "prenotata" | "svolta" | "annullata_istruttore" | "annullata_cliente"

export type LpSesso = "M" | "F"
export type LpIstruttore = { id: string; nome: string; telefono: string; attivo: boolean; sesso?: LpSesso }
export type LpRichiesta = {
  id: string
  createdAt: string
  createdBy: string
  clienteNome: string
  eta?: string
  telefono: string
  tutore?: string
  quando?: string
  prefIstruttore?: string
  note?: string
  status: "aperta" | "assegnata" | "annullata"
  istruttoreId?: string
  istruttoreNome?: string
  waNotifiedAt?: string
  waSkipped?: string
  waDestinations?: string[]
}
export type LpLezioneFlat = {
  lezioneId: string
  pacchettoId: string
  richiestaId: string
  clienteNome: string
  telefono: string
  tipo: "prova" | "5" | "10"
  istruttoreId: string
  istruttoreNome: string
  giorno: string
  ora: string
  durataMin: number
  vasca: VascaId
  corsia: number
  stato: LpLezioneStato
}
export type LpRegole = Record<string, { v25: number; ludica: number }>

export type LpSlot = { giorno: string; ora: string; vasca: VascaId; corsia: number }

export const lezioniPrivateApi = {
  getAll: () =>
    api.get<{
      instructors: LpIstruttore[]
      richieste: LpRichiesta[]
      lezioni: LpLezioneFlat[]
      regole: LpRegole
      ore: string[]
    }>("/lezioni-private"),
  occupazione: (from: string, to: string) =>
    api.get<{
      ore: string[]
      regole: LpRegole
      byDay: Record<string, { totali: number; occupati: number; v25: number; ludica: number }>
      booked: LpLezioneFlat[]
    }>(`/lezioni-private/occupazione?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  createRichiesta: (body: {
    clienteNome: string
    eta?: string
    telefono: string
    tutore?: string
    quando?: string
    prefIstruttore?: string
    note?: string
    createdBy: string
  }) =>
    api.post<{
      ok: boolean
      richiesta: LpRichiesta
      wa: { sent: number; errors: string[]; destinations: string[]; skipped?: string }
    }>("/lezioni-private/richieste", body),
  deleteRichiesta: (id: string) => api.delete<{ ok: boolean }>(`/lezioni-private/richieste/${encodeURIComponent(id)}`),
  riavvisa: (id: string) =>
    api.post<{
      ok: boolean
      wa: { sent: number; errors: string[]; destinations: string[]; skipped?: string }
    }>(`/lezioni-private/richieste/${encodeURIComponent(id)}/riavvisa`, {}),
  prenota: (body: {
    clienteNome: string
    telefono: string
    istruttoreId: string
    giorno: string
    ora: string
    vasca: VascaId
    corsia: number
    durataMin?: number
    eta?: string
    createdBy?: string
  }) => api.post<{ ok: boolean }>("/lezioni-private/prenota", body),
  prendi: (
    id: string,
    body: { istruttoreId?: string; giorno: string; ora: string; vasca: VascaId; corsia: number; durataMin?: number },
  ) => api.post<{ ok: boolean }>(`/lezioni-private/richieste/${encodeURIComponent(id)}/prendi`, body),
  pacchetto: (body: {
    richiestaId: string
    tipo: "5" | "10"
    lezioni: Array<{ giorno: string; ora: string; vasca: VascaId; corsia: number; durataMin?: number }>
  }) => api.post<{ ok: boolean }>("/lezioni-private/pacchetti", body),
  patchLezione: (id: string, stato: LpLezioneStato) => api.patch<{ ok: boolean }>(`/lezioni-private/lezioni/${encodeURIComponent(id)}`, { stato }),
  addIstruttore: (nome: string, telefono: string) => api.post<{ ok: boolean }>("/lezioni-private/istruttori", { nome, telefono }),
  patchIstruttore: (id: string, body: Partial<Pick<LpIstruttore, "nome" | "telefono" | "attivo" | "sesso">>) =>
    api.patch<{ ok: boolean }>(`/lezioni-private/istruttori/${encodeURIComponent(id)}`, body),
  deleteIstruttore: (id: string) => api.delete<{ ok: boolean }>(`/lezioni-private/istruttori/${encodeURIComponent(id)}`),
  putRegole: (regole: LpRegole) => api.put<{ ok: boolean; regole: LpRegole }>("/lezioni-private/regole", { regole }),
}
