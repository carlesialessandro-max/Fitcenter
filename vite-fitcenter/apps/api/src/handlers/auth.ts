import { Request, Response } from "express"
import { authStore } from "../store/auth.js"

export async function login(req: Request, res: Response) {
  try {
    const { username, password } = req.body as { username?: string; password?: string }
    if (!username || !password) {
      return res.status(400).json({ message: "Username e password obbligatori" })
    }
    const result = authStore.login(username, password)
    if (!result) {
      return res.status(401).json({ message: "Utente o password non validi" })
    }
    res.json(result)
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
