import { Router } from "express"
import { login, me, logout } from "../handlers/auth.js"

export const authRouter = Router()

authRouter.post("/auth/login", login)
authRouter.get("/auth/me", me)
authRouter.post("/auth/logout", logout)
