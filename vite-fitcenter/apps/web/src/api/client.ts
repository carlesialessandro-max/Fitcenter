const API_BASE = import.meta.env.VITE_API_URL ?? "/api"

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  })
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
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
