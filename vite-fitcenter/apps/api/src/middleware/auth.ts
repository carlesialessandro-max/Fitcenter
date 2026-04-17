import type { NextFunction, Request, Response } from "express"
import { authStore } from "../store/auth.js"
import type { User } from "../store/auth.js"

function bearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader) return null
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req)
  if (!token) return res.status(401).json({ message: "Token mancante" })
  const user = authStore.me(token)
  if (!user) return res.status(401).json({ message: "Sessione scaduta o non valida" })
  req.user = user
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = req.user
  if (!u) return res.status(401).json({ message: "Token mancante" })
  if (u.role !== "admin") return res.status(403).json({ message: "Permessi insufficienti" })
  next()
}

export function requireAdminOrCorsi(req: Request, res: Response, next: NextFunction) {
  const u = req.user
  if (!u) return res.status(401).json({ message: "Token mancante" })
  if (u.role !== "admin" && u.role !== "corsi") return res.status(403).json({ message: "Permessi insufficienti" })
  next()
}

export function requireAdminOrCorsiOrIstruttore(req: Request, res: Response, next: NextFunction) {
  const u = req.user
  if (!u) return res.status(401).json({ message: "Token mancante" })
  if (u.role !== "admin" && u.role !== "corsi" && u.role !== "istruttore") {
    return res.status(403).json({ message: "Permessi insufficienti" })
  }
  next()
}

export function requireAdminOrCampus(req: Request, res: Response, next: NextFunction) {
  const u = req.user
  if (!u) return res.status(401).json({ message: "Token mancante" })
  if (u.role !== "admin" && u.role !== "campus") return res.status(403).json({ message: "Permessi insufficienti" })
  next()
}

export function getScopedUser(req: Request): User {
  const u = req.user
  if (!u) {
    const err = new Error("User not set on request (missing requireAuth)")
    ;(err as Error & { status?: number }).status = 401
    throw err
  }
  return u
}

/** Per operatore: nome consulente della sessione; per admin: null. */
export function getOperatoreConsulenteNome(req: Request): string | null {
  const u = getScopedUser(req)
  if (u.role === "admin") return null
  return u.consulenteNome ?? u.nome ?? null
}

