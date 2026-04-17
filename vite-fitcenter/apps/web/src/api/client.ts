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
    const err = await res.json().catch(() => ({ message: "Sessione scaduta" }))
    throw new Error((err as { message?: string }).message ?? "Sessione scaduta")
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message?: string }).message ?? "Errore di rete")
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
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
