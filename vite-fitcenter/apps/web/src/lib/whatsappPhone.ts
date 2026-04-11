/** Normalizza un numero italiano per `https://wa.me/<digits>` (senza +). */
export function digitsForWhatsApp(raw: string): string | null {
  const d = raw.replace(/\D/g, "")
  if (!d) return null
  let x = d
  if (x.startsWith("00")) x = x.slice(2)
  if (x.startsWith("39") && x.length >= 11) return x
  if ((x.length === 9 || x.length === 10) && x.startsWith("3")) return `39${x}`
  if (x.length >= 12 && x.startsWith("39")) return x
  return x.length >= 10 ? x : null
}

export function whatsAppMeUrl(phoneRaw: string, message: string): string | null {
  const w = digitsForWhatsApp(phoneRaw)
  if (!w) return null
  const q = message.trim() ? `?text=${encodeURIComponent(message)}` : ""
  return `https://wa.me/${w}${q}`
}
