function norm(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
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
