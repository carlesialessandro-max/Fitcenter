import { Router } from "express"
import { requireAuth, requireLezioniPrivate } from "../middleware/auth.js"
import {
  deleteLezioniPrivateIstruttore,
  getLezioniPrivate,
  getLezioniPrivateOccupazione,
  patchLezioniPrivateIstruttore,
  patchLezioniPrivateLezione,
  postLezioniPrivateIstruttore,
  postLezioniPrivatePacchetto,
  postLezioniPrivatePrendi,
  postLezioniPrivateRichiesta,
  putLezioniPrivateRegole,
} from "../handlers/lezioniPrivate.js"

export const lezioniPrivateRouter = Router()
lezioniPrivateRouter.use(requireAuth, requireLezioniPrivate)

lezioniPrivateRouter.get("/", getLezioniPrivate)
lezioniPrivateRouter.get("/occupazione", getLezioniPrivateOccupazione)
lezioniPrivateRouter.put("/regole", putLezioniPrivateRegole)
lezioniPrivateRouter.post("/istruttori", postLezioniPrivateIstruttore)
lezioniPrivateRouter.patch("/istruttori/:id", patchLezioniPrivateIstruttore)
lezioniPrivateRouter.delete("/istruttori/:id", deleteLezioniPrivateIstruttore)
lezioniPrivateRouter.post("/richieste", postLezioniPrivateRichiesta)
lezioniPrivateRouter.post("/richieste/:id/prendi", postLezioniPrivatePrendi)
lezioniPrivateRouter.post("/pacchetti", postLezioniPrivatePacchetto)
lezioniPrivateRouter.patch("/lezioni/:id", patchLezioniPrivateLezione)
