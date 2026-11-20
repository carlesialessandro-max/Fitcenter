import tls from "tls"
import { extractBounceEmails } from "../lib/mail-bounce.js"

function env(k: string): string | undefined {
  const v = process.env[k]
  return v && v.trim() ? v.trim() : undefined
}

function imapQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function imapMonth(d: Date): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]!
}

function sinceToken(daysBack: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysBack)
  return `${d.getUTCDate()}-${imapMonth(d)}-${d.getUTCFullYear()}`
}

/** True se il buffer contiene la risposta tagged, con i literal IMAP già completi. */
function taggedComplete(buf: Buffer, tag: string): boolean {
  let i = 0
  const needle = Buffer.from(`{`)
  while (i < buf.length) {
    const brace = buf.indexOf(needle, i)
    const crlf = buf.indexOf(Buffer.from("\r\n"), i)
    if (brace >= 0 && (crlf < 0 || brace < crlf)) {
      const endNum = buf.indexOf(Buffer.from("}"), brace)
      if (endNum < 0) return false
      const n = Number(buf.slice(brace + 1, endNum).toString("ascii"))
      if (!Number.isFinite(n)) return false
      let after = endNum + 1
      if (buf[after] === 13) after += 1
      if (buf[after] === 10) after += 1
      if (buf.length < after + n) return false
      i = after + n
      continue
    }
    if (crlf < 0) return false
    const line = buf.slice(i, crlf).toString("utf8")
    i = crlf + 2
    if (line.startsWith(`${tag} `)) return true
  }
  return false
}

class ImapClient {
  private sock: tls.TLSSocket | null = null
  private buf = Buffer.alloc(0)
  private tagN = 0
  private wait: (() => void) | null = null

  async connect(host: string, port: number) {
    await new Promise<void>((resolve, reject) => {
      const sock = tls.connect({ host, port, servername: host, timeout: 25_000 })
      this.sock = sock
      sock.on("data", (chunk: Buffer) => {
        this.buf = Buffer.concat([this.buf, chunk])
        this.wait?.()
      })
      sock.once("secureConnect", () => resolve())
      sock.once("error", reject)
    })
    await this.readGreeting()
  }

  private async readGreeting() {
    const started = Date.now()
    while (!this.buf.includes(Buffer.from("\n"))) {
      if (Date.now() - started > 12_000) throw new Error("Timeout greeting IMAP")
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          this.wait = null
          reject(new Error("Timeout greeting IMAP"))
        }, 12_000)
        this.wait = () => {
          clearTimeout(t)
          this.wait = null
          resolve()
        }
        if (this.buf.includes(Buffer.from("\n"))) {
          clearTimeout(t)
          this.wait = null
          resolve()
        }
      })
    }
    const idx = this.buf.indexOf(Buffer.from("\n"))
    this.buf = this.buf.slice(idx + 1)
  }

  private nextTag() {
    this.tagN += 1
    return `A${this.tagN}`
  }

  async cmd(line: string, timeoutMs = 12_000): Promise<string> {
    const tag = this.nextTag()
    const sock = this.sock
    if (!sock) throw new Error("IMAP non connesso")
    sock.write(`${tag} ${line}\r\n`)
    const started = Date.now()
    while (!taggedComplete(this.buf, tag)) {
      const left = timeoutMs - (Date.now() - started)
      if (left <= 0) throw new Error("Timeout IMAP")
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          this.wait = null
          reject(new Error("Timeout IMAP"))
        }, left)
        this.wait = () => {
          clearTimeout(t)
          this.wait = null
          resolve()
        }
        if (taggedComplete(this.buf, tag)) {
          clearTimeout(t)
          this.wait = null
          resolve()
        }
      })
    }
    const text = this.buf.toString("utf8")
    this.buf = Buffer.alloc(0)
    if (new RegExp(`^${tag} NO |^${tag} BAD |\\n${tag} NO |\\n${tag} BAD `, "m").test(text)) {
      const err = text.split(/\r?\n/).filter((l) => l.startsWith(`${tag} `)).pop() ?? "IMAP NO"
      throw new Error(err.replace(/^[A-Z0-9]+ /, ""))
    }
    return text
  }

  async login(user: string, pass: string) {
    const attempts = [
      `LOGIN ${imapQuote(user)} ${imapQuote(pass)}`,
      `LOGIN ${user} ${pass}`,
      `AUTHENTICATE PLAIN ${Buffer.from(`\u0000${user}\u0000${pass}`).toString("base64")}`,
    ]
    let last = "IMAP login fallito"
    for (const line of attempts) {
      try {
        await this.cmd(line)
        return
      } catch (e) {
        last = (e as Error).message || last
      }
    }
    throw new Error(last)
  }

  async select(name: string) {
    await this.cmd(`SELECT ${imapQuote(name)}`)
  }

  async uidSearch(criteria: string): Promise<number[]> {
    const res = await this.cmd(`UID SEARCH ${criteria}`)
    const line = res.split(/\r?\n/).find((l) => l.startsWith("* SEARCH")) ?? ""
    return line
      .replace("* SEARCH", "")
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
  }

  /** Solo header + prime 2 parti DSN, senza l'allegato originale della campagna. */
  async uidFetchDsn(uid: number): Promise<string> {
    const res = await this.cmd(
      `UID FETCH ${uid} (BODY.PEEK[HEADER] BODY.PEEK[1] BODY.PEEK[2])`,
      10_000,
    )
    const parts: string[] = []
    const re = /\{(\d+)\}\r?\n/g
    let m: RegExpExecArray | null
    while ((m = re.exec(res))) {
      const n = Number(m[1])
      if (!Number.isFinite(n) || n <= 0 || n > 200_000) continue
      parts.push(res.slice(m.index + m[0].length, m.index + m[0].length + n))
    }
    return parts.join("\n") || res.slice(0, 80_000)
  }

  end() {
    try {
      this.sock?.write("A99 LOGOUT\r\n")
    } catch {
      /* ignore */
    }
    this.sock?.destroy()
    this.sock = null
  }
}

export function isImapConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"))
}

export type MailboxBounceScan = {
  emails: string[]
  messages: number
  scanned: number
  candidates: number
}

export async function fetchMailboxBounceEmails(daysBack = 14): Promise<MailboxBounceScan> {
  const host = env("IMAP_HOST") ?? env("SMTP_HOST")
  const user = env("SMTP_USER")
  const pass = env("SMTP_PASS")
  if (!host || !user || !pass) throw Object.assign(new Error("Casella mail non configurata"), { status: 503 })

  const deadline = Date.now() + 18_000
  const client = new ImapClient()
  const emails = new Set<string>()
  let messages = 0
  let scanned = 0
  let candidates = 0
  const timeLeft = () => deadline - Date.now()

  try {
    await client.connect(host, 993)
    await client.login(user, pass)
    const since = sinceToken(daysBack)
    const folders = ["INBOX", "Junk", "Spam", "INBOX.Junk", "INBOX.Spam"]
    const searches = [
      `SINCE ${since} FROM ${imapQuote("MAILER-DAEMON")}`,
      `SINCE ${since} FROM ${imapQuote("postmaster")}`,
      `SINCE ${since} FROM ${imapQuote("Mail Delivery")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Undelivered")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Mail delivery failed")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Delivery Status")}`,
      `SINCE ${since} SUBJECT ${imapQuote("diagnostica")}`,
      `SINCE ${since} SUBJECT ${imapQuote("undeliverable")}`,
      `SINCE ${since} SUBJECT ${imapQuote("mancato recapito")}`,
      `SINCE ${since} HEADER ${imapQuote("Content-Type")} ${imapQuote("multipart/report")}`,
    ]

    for (const folder of folders) {
      if (timeLeft() < 3_000) break
      try {
        await client.select(folder)
      } catch {
        continue
      }
      const uids = new Set<number>()
      for (const q of searches) {
        if (timeLeft() < 2_000) break
        try {
          for (const id of await client.uidSearch(q)) uids.add(id)
        } catch {
          /* criterio non supportato */
        }
      }
      scanned += uids.size
      const list = [...uids].sort((a, b) => a - b).slice(-40)
      candidates += list.length
      for (const uid of list) {
        if (timeLeft() < 1_500) break
        try {
          const body = await client.uidFetchDsn(uid)
          const found = extractBounceEmails(body)
          if (found.length) {
            messages += 1
            for (const e of found) emails.add(e)
          }
        } catch {
          /* messaggio saltato */
        }
      }
    }
  } finally {
    client.end()
  }
  console.log("[IMAP-BOUNCE]", { scanned, candidates, found: emails.size, messages, ms: 18_000 - timeLeft() })
  return { emails: [...emails].sort(), messages, scanned, candidates }
}
