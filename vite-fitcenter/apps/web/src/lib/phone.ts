/** Visualizza cellulare IT con prefisso +39 (anagrafica spesso senza prefisso). */
export function formatItPhoneE164(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  if (s.startsWith("+")) {
    const d = s.replace(/[^\d]/g, "")
    if (d.startsWith("39") && d.length >= 11) return `+${d}`
    return s
  }
  let digits = s.replace(/\D/g, "")
  if (!digits) return null
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (digits.startsWith("39") && digits.length >= 11 && digits.length <= 12) return `+${digits}`
  if (digits.startsWith("0")) digits = digits.slice(1)
  if (/^3\d{8,9}$/.test(digits)) return `+39${digits}`
  return null
}

export function displayItPhone(raw: string | null | undefined): string {
  return formatItPhoneE164(raw) ?? (String(raw ?? "").trim() || "—")
}

/** wa.me: msisdn senza + (es. 393471234567). */
export function waMeNumber(raw: string | null | undefined): string | null {
  const e164 = formatItPhoneE164(raw)
  if (e164) return e164.replace(/^\+/, "")
  const digits = String(raw ?? "").replace(/\D/g, "")
  if (!digits) return null
  if (digits.startsWith("39") && digits.length >= 11) return digits
  if (/^3\d{8,9}$/.test(digits)) return `39${digits}`
  return digits.length >= 8 ? digits : null
}

export function telHrefIt(raw: string | null | undefined): string | null {
  const e164 = formatItPhoneE164(raw)
  if (e164) return `tel:${e164}`
  const d = String(raw ?? "")
    .replace(/[^\d+]/g, "")
    .trim()
  return d ? `tel:${d}` : null
}

export function waHrefIt(raw: string | null | undefined, text?: string): string | null {
  const n = waMeNumber(raw)
  if (!n) return null
  const q = text ? `?text=${encodeURIComponent(text)}` : ""
  return `https://wa.me/${n}${q}`
}
