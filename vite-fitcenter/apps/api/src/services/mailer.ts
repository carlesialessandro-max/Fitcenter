import nodemailer from "nodemailer"

type SendMailInput = {
  to: string
  bcc?: string
  subject: string
  text: string
  attachments?: { filename: string; path: string; contentType?: string }[]
}

function env(k: string): string | undefined {
  const v = process.env[k]
  return v && v.trim() ? v.trim() : undefined
}

function asBool(v: string | undefined): boolean | undefined {
  if (!v) return undefined
  const x = v.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(x)) return true
  if (["0", "false", "no", "off"].includes(x)) return false
  return undefined
}

export function isSmtpConfigured(): boolean {
  return createTransportOrNull() !== null
}

function createTransportOrNull() {
  const host = env("SMTP_HOST")
  const port = Number(env("SMTP_PORT") ?? "587")
  const user = env("SMTP_USER")
  const pass = env("SMTP_PASS")
  const authEnabled = asBool(env("SMTP_AUTH"))
  const secureRaw = env("SMTP_SECURE")?.toLowerCase()
  const secure =
    secureRaw === "none"
      ? false
      : secureRaw === "starttls"
        ? false
        : (asBool(secureRaw) ?? port === 465)
  const needsAuth = authEnabled ?? true
  if (!host) return null
  if (needsAuth && (!user || !pass)) return null
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: secureRaw === "starttls",
    auth: needsAuth ? { user, pass } : undefined,
  })
}

export async function sendMail(input: SendMailInput): Promise<{ sent: boolean }> {
  const from = env("SMTP_FROM") ?? env("SMTP_USER") ?? "noreply@fitcenter.local"
  const transport = createTransportOrNull()
  if (!transport) {
    console.log("[SIGNATURE][MAIL-DRYRUN]", {
      to: input.to,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      attachments: input.attachments?.map((a) => a.filename) ?? [],
    })
    return { sent: false }
  }
  try {
    await transport.sendMail({
      from,
      to: input.to,
      ...(input.bcc ? { bcc: input.bcc } : {}),
      subject: input.subject,
      text: input.text,
      attachments: input.attachments,
    })
    return { sent: true }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    const stack = (e as Error)?.stack
    console.log("[SIGNATURE][MAIL-ERROR]", {
      to: input.to,
      subject: input.subject,
      error: msg,
      stack,
    })
    return { sent: false }
  }
}

