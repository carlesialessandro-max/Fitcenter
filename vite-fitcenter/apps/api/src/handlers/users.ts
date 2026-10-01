import { Request, Response } from "express"
import { AuthHttpError, VALID_ROLES, authStore } from "../store/auth.js"
import { PAGE_CATALOG, ROLE_DEFAULT_PAGES } from "../store/pages.js"
import type { Role } from "../types/auth.js"

function handleError(res: Response, e: unknown) {
  if (e instanceof AuthHttpError) {
    return res.status(e.status).json({ message: e.message })
  }
  return res.status(500).json({ message: (e as Error).message })
}

export async function listUsers(_req: Request, res: Response) {
  try {
    res.json({ users: authStore.listUsers() })
  } catch (e) {
    handleError(res, e)
  }
}

export async function listPages(_req: Request, res: Response) {
  try {
    res.json({ catalog: PAGE_CATALOG, roleDefaults: ROLE_DEFAULT_PAGES, roles: VALID_ROLES })
  } catch (e) {
    handleError(res, e)
  }
}

export async function createUser(req: Request, res: Response) {
  try {
    const body = req.body as {
      username?: string
      password?: string
      nome?: string
      role?: Role
      consulenteNome?: string
      leadFilter?: "bambini" | ""
      vedeTotaliCentro?: boolean
      email?: string
      pages?: string[]
    }
    if (!body.username || !body.password || !body.nome || !body.role) {
      return res.status(400).json({ message: "Username, password, nome e ruolo obbligatori" })
    }
    const user = await authStore.createUser({
      username: body.username,
      password: body.password,
      nome: body.nome,
      role: body.role,
      consulenteNome: body.consulenteNome,
      leadFilter: body.leadFilter,
      vedeTotaliCentro: body.vedeTotaliCentro,
      email: body.email,
      pages: body.pages,
    })
    res.status(201).json({ user })
  } catch (e) {
    handleError(res, e)
  }
}

export async function updateUser(req: Request, res: Response) {
  try {
    const username = String(req.params.username ?? "")
    const body = req.body as {
      nome?: string
      role?: Role
      consulenteNome?: string | null
      leadFilter?: "bambini" | "" | null
      vedeTotaliCentro?: boolean | null
      email?: string | null
      pages?: string[] | null
    }
    const user = await authStore.updateUser(username, body)
    res.json({ user })
  } catch (e) {
    handleError(res, e)
  }
}

export async function setUserPassword(req: Request, res: Response) {
  try {
    const username = String(req.params.username ?? "")
    const password = String((req.body as { password?: string })?.password ?? "")
    await authStore.setPassword(username, password)
    res.json({ ok: true })
  } catch (e) {
    handleError(res, e)
  }
}

export async function deleteUser(req: Request, res: Response) {
  try {
    const username = String(req.params.username ?? "")
    const actor = req.user?.username ?? ""
    authStore.deleteUser(username, actor)
    res.json({ ok: true })
  } catch (e) {
    handleError(res, e)
  }
}
