import { Router } from "express"
import { login, loginOtp, me, logout } from "../handlers/auth.js"
import { createUser, deleteUser, listPages, listUsers, setUserPassword, updateUser } from "../handlers/users.js"
import { requireAdmin, requireAuth } from "../middleware/auth.js"

export const authRouter = Router()

authRouter.post("/auth/login", login)
authRouter.post("/auth/login/otp", loginOtp)
authRouter.get("/auth/me", me)
authRouter.post("/auth/logout", logout)

authRouter.get("/auth/users", requireAuth, requireAdmin, listUsers)
authRouter.post("/auth/users", requireAuth, requireAdmin, createUser)
authRouter.get("/auth/pages", requireAuth, requireAdmin, listPages)
authRouter.patch("/auth/users/:username", requireAuth, requireAdmin, updateUser)
authRouter.put("/auth/users/:username/password", requireAuth, requireAdmin, setUserPassword)
authRouter.delete("/auth/users/:username", requireAuth, requireAdmin, deleteUser)
