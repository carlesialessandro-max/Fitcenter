/**
 * Base URL delle API.
 * In produzione su dominio pubblico, un build con VITE_API_URL verso localhost/LAN
 * rende le fetch rotte su mobile (4G): qui si torna a path relativo `/api` (stesso host di crm.h2sport.it).
 */
export function getApiBase(): string {
  const raw = import.meta.env.VITE_API_URL?.trim()
  if (!raw) return "/api"
  if (!/^https?:\/\//i.test(raw)) {
    return raw.startsWith("/") ? raw.replace(/\/$/, "") || "/" : `/${raw}`.replace(/\/$/, "")
  }
  try {
    const u = new URL(raw)
    const h = u.hostname
    const isLoopbackOrLan =
      h === "localhost" ||
      h === "127.0.0.1" ||
      /^192\.168\.\d+\.\d+$/.test(h) ||
      /^10\.\d+\.\d+\.\d+$/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)
    if (typeof window !== "undefined" && isLoopbackOrLan) {
      const pageHost = window.location.hostname
      if (pageHost !== h) {
        return "/api"
      }
    }
    return raw.replace(/\/$/, "")
  } catch {
    return "/api"
  }
}
