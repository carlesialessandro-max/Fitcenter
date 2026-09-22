import { Router } from "express"
import { requireAuth, requireLezioniPrivate } from "../middleware/auth.js"
import {
  deleteLezioniPrivateIstruttore,
  deleteLezioniPrivateRichiesta,
  getLezioniPrivate,
  getLezioniPrivateOccupazione,
  patchLezioniPrivateIstruttore,
  patchLezioniPrivateLezione,
  postLezioniPrivateIstruttore,
  postLezioniPrivatePacchetto,
  postLezioniPrivatePrenota,
  postLezioniPrivatePrendi,
  postLezioniPrivateRiavvisa,
  postLezioniPrivateRichiesta,
  postLezioniPrivateSpostaPacchetto,
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
lezioniPrivateRouter.post("/richieste/:id/riavvisa", postLezioniPrivateRiavvisa)
lezioniPrivateRouter.delete("/richieste/:id", deleteLezioniPrivateRichiesta)
lezioniPrivateRouter.post("/richieste/:id/prendi", postLezioniPrivatePrendi)
lezioniPrivateRouter.post("/prenota", postLezioniPrivatePrenota)
lezioniPrivateRouter.post("/pacchetti", postLezioniPrivatePacchetto)
lezioniPrivateRouter.post("/pacchetti/:id/sposta", postLezioniPrivateSpostaPacchetto)
lezioniPrivateRouter.patch("/lezioni/:id", patchLezioniPrivateLezione)
