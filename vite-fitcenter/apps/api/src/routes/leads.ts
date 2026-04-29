import { Router } from "express"
import {
  listLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  importFromSql,
} from "../handlers/leads.js"
import { requireAdmin, requireAuth } from "../middleware/auth.js"

export const leadsRouter = Router()

leadsRouter.get("/leads", requireAuth, requireAdmin, listLeads)
leadsRouter.post("/leads/import-sql", requireAuth, requireAdmin, importFromSql)
leadsRouter.get("/leads/:id", requireAuth, requireAdmin, getLead)
leadsRouter.post("/leads", requireAuth, requireAdmin, createLead)
// Update: consentito anche alle consulenti (solo sui lead assegnati a loro; enforcement nel handler).
leadsRouter.put("/leads/:id", requireAuth, updateLead)
leadsRouter.delete("/leads/:id", requireAuth, requireAdmin, deleteLead)
