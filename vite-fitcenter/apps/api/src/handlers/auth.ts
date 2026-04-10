import { Request, Response } from "express"
import { authStore } from "../store/auth.js"

export async function login(req: Request, res: Response) {
  try {
    const { username, password } = req.body as { username?: string; password?: string }
    if (!username || !password) {
      return res.status(400).json({ message: "Username e password obbligatori" })
    }
    const result = await authStore.loginWithPassword(username, password)
    if (result.kind === "invalid") {
      return res.status(401).json({ message: "Utente o password non validi" })
    }
    if (result.kind === "otp_mail_failed") {
      return res.status(503).json({ message: `Invio email non riuscito: ${result.message}` })
    }
    if (result.kind === "needs_otp") {
      return res.status(200).json({
        needsOtp: true,
        username: result.username,
        emailHint: result.emailHint,
      })
    }
    res.json({ token: result.token, user: result.user })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function loginOtp(req: Request, res: Response) {
  try {
    const { username, code } = req.body as { username?: string; code?: string }
    if (!username || !code) {
      return res.status(400).json({ message: "Username e codice obbligatori" })
    }
    const out = authStore.verifyOtp(username, code)
    if (!out) {
      return res.status(401).json({ message: "Codice non valido o scaduto" })
    }
    res.json({ token: out.token, user: out.user })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function me(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ message: "Token mancante" })
    }
    const user = authStore.me(token)
    if (!user) {
      return res.status(401).json({ message: "Sessione scaduta o non valida" })
    }
    res.json({ user })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function logout(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (token) authStore.logout(token)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
