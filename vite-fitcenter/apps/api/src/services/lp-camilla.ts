/** Camilla Nardi e Patrizia Mangiavacchi possono prenotare vasche (ludica) anche fuori orario ufficiale. */
function norm(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
}

type FuoriOrarioMatch = { username?: string; tokens: string[] }

const FUORI_ORARIO: FuoriOrarioMatch[] = [
  { username: "camilla", tokens: ["camilla", "nardi"] },
  { username: "patrizia", tokens: ["patrizia", "mangiavacchi"] },
]

export const FUORI_ORARIO_LABEL = "Camilla Nardi o Patrizia Mangiavacchi"

function matchesFuoriOrario(raw?: string | null): boolean {
  const t = norm(raw ?? "")
  if (!t) return false
  return FUORI_ORARIO.some((m) => {
    if (m.username && (t === m.username || t.replace(/\s+/g, "") === m.username)) return true
    return m.tokens.every((tok) => t.includes(tok))
  })
}

export function isCamillaNome(raw?: string | null): boolean {
  const t = norm(raw ?? "")
  if (!t) return false
  if (t === "camilla") return true
  return t.includes("camilla") && t.includes("nardi")
}

export function isCamillaUser(u?: { username?: string; nome?: string } | null): boolean {
  if (!u) return false
  return isCamillaNome(u.username) || isCamillaNome(u.nome)
}

export function canBookClosedNome(raw?: string | null): boolean {
  return matchesFuoriOrario(raw)
}

export function canBookClosedUser(u?: { username?: string; nome?: string } | null): boolean {
  if (!u) return false
  return matchesFuoriOrario(u.username) || matchesFuoriOrario(u.nome)
}

export function allowClosedSlots(
  u?: { username?: string; nome?: string } | null,
  istruttoreNome?: string | null,
): boolean {
  return canBookClosedUser(u) || canBookClosedNome(istruttoreNome)
}
