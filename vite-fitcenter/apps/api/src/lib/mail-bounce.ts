const EMAIL_ONLY = /^[a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
const FAIL_HINT =
  /550\s*5\.[0-9]\.[0-9]|does not exist|user unknown|nosuchuser|mailbox unavailable|recipient rejected|indirizzo inesistente|account that you tried to reach does not exist|unknown user|invalid recipient/i

const SKIP_HOST = /(^|\.)(h2sport\.it|crm\.h2sport\.it|macrolabserver\.com|google\.com|googleapis\.com|gstatic\.com)$/i

export function normalizeBounceEmail(raw: string): string {
  const t = String(raw ?? "").trim().toLowerCase()
  const m = t.match(/<([^>]+)>/)
  return (m?.[1] ?? t).replace(/^mailto:/i, "").trim()
}

function keepAddr(email: string): boolean {
  const e = normalizeBounceEmail(email)
  if (!e || !EMAIL_ONLY.test(e)) return false
  if (e.includes("mailer-daemon")) return false
  if (e.startsWith("postmaster@")) return false
  const host = e.split("@")[1] ?? ""
  if (SKIP_HOST.test(host)) return false
  if (host.includes("gmail-smtp-in")) return false
  return true
}

function add(out: Set<string>, raw: string) {
  const e = normalizeBounceEmail(raw)
  if (keepAddr(e)) out.add(e)
}

/** Estrae solo i destinatari respinti (550 / casella inesistente), non il To della campagna. */
export function extractBounceEmails(text: string): string[] {
  const src = String(text ?? "")
  if (!src.trim()) return []
  const out = new Set<string>()

  for (const re of [
    /Final-Recipient:\s*(?:rfc822;)?\s*([^\s;]+)/gi,
    /Original-Recipient:\s*(?:rfc822;)?\s*([^\s;]+)/gi,
    /X-Failed-Recipients:\s*([^\n\r]+)/gi,
  ]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      for (const part of String(m[1] ?? "").split(/[,\s;]+/)) add(out, part)
    }
  }

  const lines = src.split(/\r?\n/)
  const trimmed = lines.map((l) => l.trim()).filter(Boolean)
  const emailLines = trimmed.filter((l) => EMAIL_ONLY.test(l.replace(/^<|>$/g, "")))
  if (trimmed.length >= 5 && emailLines.length / trimmed.length >= 0.7) {
    for (const l of emailLines) add(out, l.replace(/^<|>$/g, ""))
    return [...out].sort()
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim().replace(/^<|>$/g, "")
    const only = EMAIL_ONLY.test(line) ? line : ""
    const angled = /<([a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,})>/i.exec(lines[i] ?? "")
    const candidate = only || angled?.[1] || ""
    if (!candidate) continue
    const nearby = lines.slice(i, i + 7).join("\n")
    if (FAIL_HINT.test(nearby)) add(out, candidate)
  }

  return [...out].sort()
}
