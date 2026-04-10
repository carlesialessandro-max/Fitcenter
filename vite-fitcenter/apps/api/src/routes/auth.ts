import { Router } from "express"
import { login, loginOtp, me, logout } from "../handlers/auth.js"

export const authRouter = Router()

authRouter.post("/auth/login", login)
authRouter.post("/auth/login/otp", loginOtp)
authRouter.get("/auth/me", me)
authRouter.post("/auth/logout", logout)
