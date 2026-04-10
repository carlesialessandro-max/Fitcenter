import nodemailer from "nodemailer"

function smtpConfigured(): boolean {
  return !!(process.env.AUTH_SMTP_HOST?.trim() && process.env.AUTH_SMTP_FROM?.trim())
}

export function isEmailOtpEnabled(): boolean {
  return (process.env.AUTH_LOGIN_EMAIL_OTP ?? "").toLowerCase() === "true" && smtpConfigured()
}

export async function sendLoginOtpEmail(to: string, code: string): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error("SMTP non configurato (AUTH_SMTP_HOST / AUTH_SMTP_FROM)")
  }
  const host = process.env.AUTH_SMTP_HOST!.trim()
  const port = Number(process.env.AUTH_SMTP_PORT ?? "587") || 587
  const secure = (process.env.AUTH_SMTP_SECURE ?? "").toLowerCase() === "true"
  const user = process.env.AUTH_SMTP_USER?.trim()
  const pass = process.env.AUTH_SMTP_PASS?.trim()
  const from = process.env.AUTH_SMTP_FROM!.trim()

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  })

  await transporter.sendMail({
    from,
    to,
    subject: "FitCenter — codice di accesso",
    text: `Il tuo codice di verifica è: ${code}\n\nValido per 10 minuti. Se non hai richiesto tu l'accesso, ignora questo messaggio.`,
    html: `<p>Il tuo codice di verifica è: <strong>${code}</strong></p><p>Valido per 10 minuti.</p>`,
  })
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return "***"
  const vis = local.slice(0, 2)
  return `${vis}***@${domain}`
}
