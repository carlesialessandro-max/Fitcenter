/**
 * Regole minime password (solo per documentazione / futuro cambio password).
 * Login: non blocchiamo utenti legacy; per nuove password usare queste regole.
 */
export function validatePasswordStrength(password: string): string | null {
  const min = Math.max(8, Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 12) || 12)
  if (password.length < min) {
    return `La password deve essere di almeno ${min} caratteri`
  }
  if (!/[A-Z]/.test(password)) {
    return "La password deve contenere almeno una lettera maiuscola"
  }
  if (!/[a-z]/.test(password)) {
    return "La password deve contenere almeno una lettera minuscola"
  }
  if (!/[0-9]/.test(password)) {
    return "La password deve contenere almeno una cifra"
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "La password deve contenere almeno un carattere speciale"
  }
  return null
}
