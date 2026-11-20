const EMAIL_ONLY = /^[a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
/** Solo casella inesistente / indirizzo morto — non casella piena, greylist, timeout. */
const PERMANENT_BOUNCE_HINT =
  /550\s*5\.1\.|status:\s*5\.1\.|[;\s]5\.1\.[0-3](?:\D|$)|does not exist|user unknown|nosuchuser|indirizzo inesistente|account that you tried to reach does not exist|unknown user|invalid recipient|no such user|mailbox does not exist|user not found|unknown mailbox|recipient not found/i
const TEMPORARY_FAIL_HINT =
  /mailbox full|over quota|insufficient storage|try again|greylist|temporar|deferred|timeout|econnrefused|etimedout|4\.2\.2|5\.2\.2/i
const FAIL_HINT = PERMANENT_BOUNCE_HINT

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

export function isPermanentBounceText(text: string): boolean {
  const s = String(text ?? "")
  if (!s.trim()) return false
  if (TEMPORARY_FAIL_HINT.test(s) && !PERMANENT_BOUNCE_HINT.test(s)) return false
  return PERMANENT_BOUNCE_HINT.test(s)
}

/** Nota del log invii: casella morta, non un down SMTP / errore temporaneo. */
export function isInvalidMailboxFromLogNote(nota?: string): boolean {
  const s = String(nota ?? "").trim()
  if (!s) return false
  if (/non blacklist|non messo in blacklist|indirizzo non messo in blacklist/i.test(s)) return false
  if (isPermanentBounceText(s)) return true
  if (/casella inesistente/i.test(s)) return true
  if (/SMTP ha rifiutato l'indirizzo/i.test(s)) return true
  return false
}

export function classifySmtpDest(
  email: string,
  out: { sent: boolean; detail?: string; rejected?: string[]; accepted?: string[] },
  normAddr: (s: string) => string,
): { esito: "sent" | "failed"; nota: string; blacklist: boolean } {
  const dest = normAddr(email)
  const rejected = new Set((out.rejected ?? []).map(normAddr))
  const refused = rejected.has(dest)
  const detail = String(out.detail ?? "").trim()
  const perm = isPermanentBounceText(detail)
  const slice = (t: string, n = 180) => t.slice(0, n)

  if (refused) {
    const othersAccepted = out.sent || (out.accepted?.length ?? 0) > 0
    if (perm || othersAccepted) {
      return {
        esito: "failed",
        nota: `Casella inesistente${detail ? `: ${slice(detail)}` : " (rifiuto SMTP)"}`,
        blacklist: true,
      }
    }
    return {
      esito: "failed",
      nota: `SMTP ha rifiutato l'indirizzo (non blacklist: errore non permanente)${detail ? `: ${slice(detail, 140)}` : ""}`,
      blacklist: false,
    }
  }
  if (out.sent) {
    return { esito: "sent", nota: "Server mail ha accettato", blacklist: false }
  }
  return {
    esito: "failed",
    nota: `Invio non riuscito (indirizzo non messo in blacklist): ${slice(detail || "SMTP non ha accettato")}`,
    blacklist: false,
  }
}

/** Estrae solo i destinatari respinti (550 / casella inesistente), non il To della campagna. */
export function extractBounceEmails(text: string): string[] {
  const src = String(text ?? "")
  if (!src.trim()) return []
  if (TEMPORARY_FAIL_HINT.test(src) && !isPermanentBounceText(src)) return []
  const out = new Set<string>()
  const dsnHeaders = isPermanentBounceText(src)

  if (dsnHeaders) {
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
