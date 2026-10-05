import { Router } from "express"
import { requireAdmin, requireAuth } from "../middleware/auth.js"
import {
  getLibroPaga,
  patchLivello,
  patchPersonale,
  postLivello,
  postPersonale,
  postTurno,
  putMensilita,
  putPresenza,
  removeLivello,
  removePersonale,
  removeTurno,
} from "../handlers/libroPaga.js"

export const libroPagaRouter = Router()
libroPagaRouter.use(requireAuth, requireAdmin)

libroPagaRouter.get("/", getLibroPaga)
libroPagaRouter.post("/livelli", postLivello)
libroPagaRouter.patch("/livelli/:id", patchLivello)
libroPagaRouter.delete("/livelli/:id", removeLivello)
libroPagaRouter.post("/personale", postPersonale)
libroPagaRouter.patch("/personale/:id", patchPersonale)
libroPagaRouter.delete("/personale/:id", removePersonale)
libroPagaRouter.post("/turni", postTurno)
libroPagaRouter.delete("/turni/:id", removeTurno)
libroPagaRouter.put("/turni/:id/presenza", putPresenza)
libroPagaRouter.put("/mensilita", putMensilita)
