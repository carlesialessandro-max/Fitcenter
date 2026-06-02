function env(k: string): string | undefined {
  const v = process.env[k]
  return v && v.trim() ? v.trim() : undefined
}

/** Normalizza cellulare italiano in E.164 (+39...). */
export function normalizeItPhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  let digits = s.replace(/[^\d+]/g, "")
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`
  if (digits.startsWith("+")) {
    const d = digits.slice(1).replace(/\D/g, "")
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null
  }
  digits = digits.replace(/\D/g, "")
  if (digits.startsWith("39") && digits.length >= 11) return `+${digits}`
  if (digits.startsWith("0")) digits = digits.slice(1)
  if (digits.length >= 9 && digits.length <= 10) return `+39${digits}`
  return null
}

export function maskPhone(e164: string | null | undefined): string {
  const s = String(e164 ?? "").trim()
  if (!s) return "—"
  if (s.length <= 4) return "***"
  return `${s.slice(0, 4)}***${s.slice(-2)}`
}

export function isSmsConfigured(): boolean {
  const provider = (env("SMS_PROVIDER") ?? "").toLowerCase()
  if (provider === "twilio") {
    return !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM"))
  }
  if (provider === "http") return !!env("SMS_HTTP_URL")
  return false
}

export async function sendSms(input: { to: string; text: string }): Promise<{ sent: boolean }> {
  const to = normalizeItPhone(input.to)
  if (!to) {
    console.log("[SMS][SKIP] numero non valido", input.to)
    return { sent: false }
  }
  const provider = (env("SMS_PROVIDER") ?? "").toLowerCase()
  if (!isSmsConfigured()) {
    console.log("[SMS][DRYRUN]", { to: maskPhone(to), text: input.text })
    return { sent: false }
  }

  try {
    if (provider === "twilio") {
      const sid = env("TWILIO_ACCOUNT_SID")!
      const token = env("TWILIO_AUTH_TOKEN")!
      const from = env("TWILIO_FROM")!
      const body = new URLSearchParams({ To: to, From: from, Body: input.text })
      const auth = Buffer.from(`${sid}:${token}`).toString("base64")
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        console.log("[SMS][TWILIO-ERROR]", res.status, errText.slice(0, 300))
        return { sent: false }
      }
      return { sent: true }
    }

    if (provider === "http") {
      const url = env("SMS_HTTP_URL")!
      const bearer = env("SMS_HTTP_BEARER")
      const res = await fetch(url, {
        method: env("SMS_HTTP_METHOD") ?? "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ to, message: input.text, text: input.text }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        console.log("[SMS][HTTP-ERROR]", res.status, errText.slice(0, 300))
        return { sent: false }
      }
      return { sent: true }
    }

    return { sent: false }
  } catch (e) {
    console.log("[SMS][ERROR]", (e as Error)?.message ?? String(e))
    return { sent: false }
  }
}
