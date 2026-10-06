import { Router } from "express"
import { requireAdmin, requireAuth } from "../middleware/auth.js"
import {
  getLibroPaga,
  patchLivello,
  patchPersonale,
  postImportDump,
  postLivello,
  postPersonale,
  postTurno,
  putMensilita,
  putPersonalePassword,
  putPresenza,
  getLibroPagaConvalida,
  putLibroPagaConvalidaTurno,
  getLibroPagaDeleghe,
  putLibroPagaDeleghe,
  removeLivello,
  removePersonale,
  removeTurno,
} from "../handlers/libroPaga.js"

export const libroPagaRouter = Router()
libroPagaRouter.use(requireAuth, requireAdmin)

libroPagaRouter.get("/", getLibroPaga)
libroPagaRouter.post("/import-dump", postImportDump)
libroPagaRouter.post("/livelli", postLivello)
libroPagaRouter.patch("/livelli/:id", patchLivello)
libroPagaRouter.delete("/livelli/:id", removeLivello)
libroPagaRouter.post("/personale", postPersonale)
libroPagaRouter.patch("/personale/:id", patchPersonale)
libroPagaRouter.put("/personale/:id/password", putPersonalePassword)
libroPagaRouter.delete("/personale/:id", removePersonale)
libroPagaRouter.post("/turni", postTurno)
libroPagaRouter.delete("/turni/:id", removeTurno)
libroPagaRouter.put("/turni/:id/presenza", putPresenza)
libroPagaRouter.put("/mensilita", putMensilita)
libroPagaRouter.get("/convalida", getLibroPagaConvalida)
libroPagaRouter.put("/convalida/turno", putLibroPagaConvalidaTurno)
libroPagaRouter.get("/deleghe", getLibroPagaDeleghe)
libroPagaRouter.put("/deleghe", putLibroPagaDeleghe)
