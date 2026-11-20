import tls from "tls"
import { extractBounceEmails } from "../lib/mail-bounce.js"

function env(k: string): string | undefined {
  const v = process.env[k]
  return v && v.trim() ? v.trim() : undefined
}

function imapQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function extractImapLiteral(res: string, marker: RegExp): string | null {
  const m = marker.exec(res)
  if (!m || m.index == null) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  let start = m.index + m[0].length
  if (res.startsWith("\r\n", start)) start += 2
  else if (res.startsWith("\n", start)) start += 1
  return res.slice(start, start + n)
}

const BOUNCE_HEADER_HINT =
  /mailer-daemon|postmaster|mail[- ]delivery|mailer daemon|undeliver|delivery failed|delivery status|returned mail|failure notice|non recapitat|mancato recapito|impossibile recapitare|undeliverable|diagnostica|bounce|multipart\/report|delivery-status|final-recipient|dsn /i

function looksLikeBounceHeader(header: string): boolean {
  return BOUNCE_HEADER_HINT.test(header)
}

function bounceFolder(name: string): boolean {
  const n = name.replace(/^INBOX[./]/i, "")
  if (/^inbox$/i.test(n) || /^inbox$/i.test(name)) return true
  return /^(junk|spam|bulk|bounce|unwanted|posta indesiderata)$/i.test(n)
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

  private async waitData(timeoutMs: number) {
    if (this.buf.length) return
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout IMAP")), timeoutMs)
      this.wait = () => {
        clearTimeout(t)
        this.wait = null
        resolve()
      }
    })
  }

  private async readGreeting() {
    const started = Date.now()
    while (!this.buf.includes(Buffer.from("\n"))) {
      if (Date.now() - started > 20_000) throw new Error("Timeout greeting IMAP")
      await this.waitData(20_000)
    }
    const idx = this.buf.indexOf(Buffer.from("\n"))
    this.buf = this.buf.slice(idx + 1)
  }

  private nextTag() {
    this.tagN += 1
    return `A${this.tagN}`
  }

  async cmd(line: string): Promise<string> {
    const tag = this.nextTag()
    const sock = this.sock
    if (!sock) throw new Error("IMAP non connesso")
    sock.write(`${tag} ${line}\r\n`)
    const started = Date.now()
    while (!taggedComplete(this.buf, tag)) {
      if (Date.now() - started > 45_000) throw new Error("Timeout IMAP")
      await this.waitData(45_000)
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

  async selectInbox() {
    await this.select("INBOX")
  }

  async select(name: string) {
    await this.cmd(`SELECT ${imapQuote(name)}`)
  }

  async listFolders(): Promise<string[]> {
    const res = await this.cmd(`LIST ${imapQuote("")} ${imapQuote("*")}`)
    const names: string[] = []
    for (const line of res.split(/\r?\n/)) {
      const m = line.match(/^\* LIST \(([^)]*)\) "([^"]*)" (.+)$/)
      if (!m) continue
      if (/\\Noselect/i.test(m[1] ?? "")) continue
      let name = (m[3] ?? "").trim()
      if (name.startsWith('"') && name.endsWith('"')) {
        name = name.slice(1, -1).replace(/\\"/g, '"')
      }
      if (name) names.push(name)
    }
    return names
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

  async uidFetchPeek(uid: number): Promise<string> {
    const res = await this.cmd(`UID FETCH ${uid} BODY.PEEK[]`)
    return extractImapLiteral(res, /BODY\[\]\s*\{(\d+)\}/i) ?? extractImapLiteral(res, /RFC822\s*\{(\d+)\}/i) ?? res
  }

  async uidFetchHeaders(uids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>()
    if (!uids.length) return out
    const res = await this.cmd(
      `UID FETCH ${uids.join(",")} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT CONTENT-TYPE)])`,
    )
    const blocks = res.split(/\r?\n\* /)
    for (const block of blocks) {
      const uidM = /\bUID (\d+)\b/i.exec(block)
      if (!uidM) continue
      const header = extractImapLiteral(block, /BODY\[HEADER\.FIELDS[^\]]+\]\s*\{(\d+)\}/i)
      out.set(Number(uidM[1]), header ?? block)
    }
    return out
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

  const client = new ImapClient()
  const emails = new Set<string>()
  let messages = 0
  let scanned = 0
  let candidates = 0
  try {
    await client.connect(host, 993)
    await client.login(user, pass)
    const since = sinceToken(daysBack)
    let folders = ["INBOX"]
    try {
      const listed = await client.listFolders()
      const extra = listed.filter(bounceFolder)
      folders = [...new Set(["INBOX", ...extra])]
    } catch {
      /* solo INBOX */
    }

    const searches = [
      `SINCE ${since} FROM ${imapQuote("MAILER-DAEMON")}`,
      `SINCE ${since} FROM ${imapQuote("mailer-daemon")}`,
      `SINCE ${since} FROM ${imapQuote("postmaster")}`,
      `SINCE ${since} FROM ${imapQuote("Mail Delivery")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Mail delivery failed")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Undelivered")}`,
      `SINCE ${since} SUBJECT ${imapQuote("undeliverable")}`,
      `SINCE ${since} SUBJECT ${imapQuote("diagnostica")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Returned mail")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Delivery Status")}`,
      `SINCE ${since} SUBJECT ${imapQuote("failure notice")}`,
      `SINCE ${since} SUBJECT ${imapQuote("Non recapitat")}`,
      `SINCE ${since} SUBJECT ${imapQuote("mancato recapito")}`,
      `SINCE ${since} HEADER ${imapQuote("Content-Type")} ${imapQuote("multipart/report")}`,
    ]

    for (const folder of folders) {
      try {
        await client.select(folder)
      } catch {
        continue
      }
      const uids = new Set<number>()
      for (const q of searches) {
        try {
          for (const id of await client.uidSearch(q)) uids.add(id)
        } catch {
          /* criterio non supportato */
        }
      }
      try {
        const recent = (await client.uidSearch(`SINCE ${since}`)).sort((a, b) => a - b).slice(-800)
        scanned += recent.length
        for (let i = 0; i < recent.length; i += 25) {
          const chunk = recent.slice(i, i + 25)
          try {
            const headers = await client.uidFetchHeaders(chunk)
            for (const [uid, header] of headers) {
              if (looksLikeBounceHeader(header)) uids.add(uid)
            }
          } catch {
            /* batch header saltato */
          }
        }
      } catch {
        /* SEARCH SINCE non disponibile */
      }

      const list = [...uids].sort((a, b) => a - b).slice(-400)
      candidates += list.length
      for (const uid of list) {
        try {
          const body = await client.uidFetchPeek(uid)
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
  console.log("[IMAP-BOUNCE]", { scanned, candidates, found: emails.size, messages })
  return { emails: [...emails].sort(), messages, scanned, candidates }
}
