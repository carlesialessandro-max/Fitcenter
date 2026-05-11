import { getApiBase } from "./baseUrl"

const API_BASE = getApiBase()
const TOKEN_KEY = "fitcenter-token"

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`
  const bodyIsFormData = typeof FormData !== "undefined" && options.body instanceof FormData
  const baseHeaders = (options.headers as Record<string, string> | undefined) ?? {}
  // Se il body è multipart (FormData), NON impostare Content-Type: lo gestisce il browser (boundary).
  const headers: Record<string, string> = bodyIsFormData
    ? { ...baseHeaders }
    : { "Content-Type": "application/json", ...baseHeaders }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, { ...options, headers })
  if (res.status === 401) {
    setAuthToken(null)
    const text = await res.text().catch(() => "")
    let msg = "Sessione scaduta"
    try {
      const j = text ? JSON.parse(text) : null
      msg = (j as any)?.message ?? msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }

  // Leggi testo prima: alcune risposte possono essere vuote o non-JSON (proxy/html).
  const text = await res.text().catch(() => "")
  const parseBody = (): unknown => {
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const body = parseBody()

  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && (body as any).message ? String((body as any).message) : null) ??
      (typeof body === "string" && body.trim() ? body.trim().slice(0, 220) : null) ??
      res.statusText ??
      "Errore di rete"
    throw new Error(msg)
  }

  // Se la risposta è "null" o vuota, è un'anomalia: rendiamola visibile.
  if (body == null) {
    throw new Error(`Risposta vuota dal server (HTTP ${res.status})`)
  }

  return body as T
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, { method: "GET", cache: "no-store", ...init }),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "POST",
      body: typeof FormData !== "undefined" && body instanceof FormData ? body : JSON.stringify(body),
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: typeof FormData !== "undefined" && body instanceof FormData ? body : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: typeof FormData !== "undefined" && body instanceof FormData ? body : JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
