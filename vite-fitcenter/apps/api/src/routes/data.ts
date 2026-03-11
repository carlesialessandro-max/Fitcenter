import { Router } from "express"
import { getDashboard, getDettaglioMese, getVenditeStorico, getTotaliAnni, getClienti, getAbbonamenti, getBudget, setBudget, getLeadsFromGestionale } from "../handlers/data.js"

export const dataRouter = Router()

dataRouter.get("/dashboard", getDashboard)
dataRouter.get("/vendite-storico", getVenditeStorico)
dataRouter.get("/totali-anni", getTotaliAnni)
dataRouter.get("/dettaglio-mese", getDettaglioMese)
dataRouter.get("/clienti", getClienti)
dataRouter.get("/abbonamenti", getAbbonamenti)
dataRouter.get("/budget", getBudget)
dataRouter.post("/budget", setBudget)
dataRouter.get("/leads", getLeadsFromGestionale)
