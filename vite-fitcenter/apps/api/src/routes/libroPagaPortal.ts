import { Router } from "express"
import rateLimit from "express-rate-limit"
import {
  getLpagaMe,
  getLpagaSnapshot,
  getLpagaConvalida,
  getLpagaDeleghe,
  postLpagaLogin,
  postLpagaLogout,
  postLpagaPersonale,
  postLpagaTurno,
  putLpagaConvalidaTurno,
  putLpagaDeleghe,
  putLpagaMensilita,
  putLpagaPersonalePassword,
  removeLpagaTurno,
  requireLpaga,
} from "../handlers/libroPagaPortal.js"

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
})

export const libroPagaPortalRouter = Router()
libroPagaPortalRouter.post("/login", loginLimiter, postLpagaLogin)
libroPagaPortalRouter.post("/logout", postLpagaLogout)
libroPagaPortalRouter.get("/me", requireLpaga, getLpagaMe)
libroPagaPortalRouter.get("/", requireLpaga, getLpagaSnapshot)
libroPagaPortalRouter.post("/turni", requireLpaga, postLpagaTurno)
libroPagaPortalRouter.delete("/turni/:id", requireLpaga, removeLpagaTurno)
libroPagaPortalRouter.put("/mensilita", requireLpaga, putLpagaMensilita)
libroPagaPortalRouter.post("/personale", requireLpaga, postLpagaPersonale)
libroPagaPortalRouter.put("/personale/:id/password", requireLpaga, putLpagaPersonalePassword)
libroPagaPortalRouter.get("/convalida", requireLpaga, getLpagaConvalida)
libroPagaPortalRouter.put("/convalida/turno", requireLpaga, putLpagaConvalidaTurno)
libroPagaPortalRouter.get("/deleghe", requireLpaga, getLpagaDeleghe)
libroPagaPortalRouter.put("/deleghe", requireLpaga, putLpagaDeleghe)
