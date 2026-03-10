import { Router } from "express"
import { getDashboard, getClienti, getAbbonamenti, getBudget, getLeadsFromGestionale } from "../handlers/data.js"

export const dataRouter = Router()

dataRouter.get("/dashboard", getDashboard)
dataRouter.get("/clienti", getClienti)
dataRouter.get("/abbonamenti", getAbbonamenti)
dataRouter.get("/budget", getBudget)
dataRouter.get("/leads", getLeadsFromGestionale)
