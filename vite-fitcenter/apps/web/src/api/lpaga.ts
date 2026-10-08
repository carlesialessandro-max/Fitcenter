import { getApiBase } from "./baseUrl"
import type { LibroPagaSnapshot, LpagaLivello, LpagaRuolo } from "./libroPaga"

const API_BASE = getApiBase()
const TOKEN_KEY = "lpaga-token"

export type LpagaMe = {
  id: string
  username: string
  nome: string
  cognome?: string
  ruolo: LpagaRuolo
  livelloId?: string
  nominativo: string
}

export type LpagaPortalSnapshot = LibroPagaSnapshot & {
  me: { id: string; nominativo: string; ruolo: LpagaRuolo; repartoNome: string; livelloId?: string } | null
  livelliInseribili: LpagaLivello[]
  livelliAssegnabili?: LpagaLivello[]
  canValidate?: boolean
  deleghe?: string[]
}

export type TurnoConvalidaStato = "ok" | "sostituzione" | "non_svolta" | "da_verificare"

export type LpagaConvalidaMatch = {
  comparto: string
  date: string
  start: string
  title: string
  staff: string
  note?: string
}

export type LpagaConvalidaPayload = {
  mese: string
  personaleId: string
  personaleNome: string
  rows: {
    turnoId: string
    personaleId?: string
    giorno: string
    livelloNome: string
    personaleNome: string
    quantita: number
    importo: number
    note?: string
    proposto: TurnoConvalidaStato
    calendariAttesi?: string[]
    match?: LpagaConvalidaMatch
    sostitutiPossibili: LpagaConvalidaMatch[]
    salvato?: { stato: TurnoConvalidaStato; nota?: string; sostitutoNome?: string }
    tornello?: { disponibile: boolean; ok: boolean; orario?: string }
  }[]
  fogli: { bagnini: string; desk: string }
}

export type LpagaConvalidaMesePayload = {
  mese: string
  nTurni: number
  nConfermabili: number
  nAnomalie: number
  nConfermati: number
  confermatiOra?: number
  anomalie: LpagaConvalidaPayload["rows"]
  fogli: { bagnini: string; desk: string }
}

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setLpagaToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

async function lpagaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const text = await res.text().catch(() => "")
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (res.status === 401) {
    setLpagaToken(null)
    const msg =
      body && typeof body === "object" && "message" in body ? String((body as { message?: string }).message) : "Sessione scaduta"
    throw new Error(msg)
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "message" in body ? String((body as { message?: string }).message) : null) ??
      res.statusText ??
      "Errore"
    throw new Error(msg)
  }
  if (body == null) throw new Error("Risposta vuota")
  return body as T
}

export const lpagaApi = {
  hasToken: () => Boolean(getToken()),
  login: (username: string, password: string) =>
    lpagaRequest<{ token: string; user: LpagaMe }>("/lpaga/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => lpagaRequest<{ ok: boolean }>("/lpaga/logout", { method: "POST", body: "{}" }),
  me: () => lpagaRequest<{ user: LpagaMe }>("/lpaga/me"),
  get: (mese: string, reparto?: string) => {
    const q = new URLSearchParams({ mese })
    if (reparto) q.set("reparto", reparto)
    return lpagaRequest<LpagaPortalSnapshot>(`/lpaga?${q.toString()}`, { method: "GET", cache: "no-store" })
  },
  createTurno: (body: { personaleId: string; livelloId: string; giorno: string; quantita: number; note?: string }) =>
    lpagaRequest<{ turno: unknown }>("/lpaga/turni", { method: "POST", body: JSON.stringify(body) }),
  deleteTurno: (id: string) => lpagaRequest<{ ok: boolean }>(`/lpaga/turni/${encodeURIComponent(id)}`, { method: "DELETE" }),
  putMensilita: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) =>
    lpagaRequest<{ mensilita: unknown }>("/lpaga/mensilita", { method: "PUT", body: JSON.stringify(body) }),
  createPersonale: (body: {
    nome: string
    cognome?: string
    username: string
    password: string
    ruolo?: LpagaRuolo
    livelloId?: string
    contratto?: string
    iban?: string
    tesseramento?: string
    tesseramentoScadenza?: string
    qualifiche?: { id: string; data?: string }[]
  }) => lpagaRequest<{ personale: unknown }>("/lpaga/personale", { method: "POST", body: JSON.stringify(body) }),
  patchPersonale: (id: string, body: Record<string, unknown>) =>
    lpagaRequest<{ personale: unknown }>(`/lpaga/personale/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  setPersonalePassword: (id: string, password: string) =>
    lpagaRequest<{ ok: boolean }>(`/lpaga/personale/${encodeURIComponent(id)}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),
  getConvalida: (mese: string, personaleId: string) =>
    lpagaRequest<LpagaConvalidaPayload>(
      `/lpaga/convalida?mese=${encodeURIComponent(mese)}&personaleId=${encodeURIComponent(personaleId)}`
    ),
  getConvalidaMese: (mese: string) =>
    lpagaRequest<LpagaConvalidaMesePayload>(`/lpaga/convalida-mese?mese=${encodeURIComponent(mese)}`),
  postConvalidaMese: (mese: string) =>
    lpagaRequest<LpagaConvalidaMesePayload>("/lpaga/convalida-mese", {
      method: "POST",
      body: JSON.stringify({ mese }),
    }),
  putConvalidaTurno: (body: { turnoId: string; stato: TurnoConvalidaStato; nota?: string; sostitutoNome?: string }) =>
    lpagaRequest<{ convalida: unknown }>("/lpaga/convalida/turno", { method: "PUT", body: JSON.stringify(body) }),
  getDeleghe: (managerId?: string) => {
    const q = managerId ? `?managerId=${encodeURIComponent(managerId)}` : ""
    return lpagaRequest<{ managerId: string; deleghe: string[] }>(`/lpaga/deleghe${q}`)
  },
  putDeleghe: (ids: string[], managerId?: string) =>
    lpagaRequest<{ managerId: string; deleghe: string[] }>("/lpaga/deleghe", {
      method: "PUT",
      body: JSON.stringify({ ids, managerId }),
    }),
}
