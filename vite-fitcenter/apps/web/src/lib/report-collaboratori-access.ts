/** Report COMP_SP collaboratori: nel libro paga, solo admin FitCenter e Alberto. */
export const REPORT_COLLABORATORI_PATH = "/libro-paga"

export function isAlberto(u: {
  username?: string
  nome?: string
  cognome?: string
  nominativo?: string
} | null | undefined): boolean {
  if (!u) return false
  const un = String(u.username ?? "")
    .trim()
    .toLowerCase()
  if (un === "alberto") return true
  const blob = `${u.nome ?? ""} ${u.cognome ?? ""} ${u.nominativo ?? ""}`.trim().toLowerCase()
  return /(^|[\s,])alberto($|[\s,])/.test(blob)
}

/** FitCenter: ruolo admin oppure utente Alberto. */
export function canVedereReportCollaboratori(u: {
  role?: string
  username?: string
  nome?: string
} | null | undefined): boolean {
  if (!u) return false
  if (u.role === "admin") return true
  return isAlberto(u)
}

/** Portale /lpaga: admin del libro paga (Alberto) oppure nominativo Alberto. */
export function canVedereReportCollaboratoriLpaga(u: {
  ruolo?: string
  username?: string
  nome?: string
  cognome?: string
  nominativo?: string
} | null | undefined): boolean {
  if (!u) return false
  if (u.ruolo === "admin") return true
  return isAlberto(u)
}
