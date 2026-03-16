const API_BASE = import.meta.env.VITE_API_URL ?? "/api"
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
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
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
