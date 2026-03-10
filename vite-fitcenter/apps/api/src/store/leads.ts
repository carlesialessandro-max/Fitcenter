import type { Lead, LeadCreate, LeadUpdate, LeadFilters, LeadStatus } from "../types/lead.js"

const db = new Map<string, Lead>()

function id() {
  return crypto.randomUUID()
}

function now() {
  return new Date().toISOString()
}

function matchesFilters(lead: Lead, filters: LeadFilters): boolean {
  if (filters.fonte && lead.fonte !== filters.fonte) return false
  if (filters.stato && lead.stato !== filters.stato) return false
  if (filters.consulenteId && lead.consulenteId !== filters.consulenteId) return false
  if (filters.search) {
    const s = filters.search.toLowerCase()
    const full = `${lead.nome} ${lead.cognome} ${lead.email} ${lead.telefono}`.toLowerCase()
    if (!full.includes(s)) return false
  }
  return true
}

export const store = {
  list(filters: LeadFilters = {}): Lead[] {
    const all = Array.from(db.values())
    return all.filter((l) => matchesFilters(l, filters))
  },

  get(id: string): Lead | undefined {
    return db.get(id)
  },

  create(input: LeadCreate): Lead {
    const lead: Lead = {
      id: id(),
      ...input,
      stato: "nuovo",
      createdAt: now(),
      updatedAt: now(),
    }
    db.set(lead.id, lead)
    return lead
  },

  update(id: string, input: LeadUpdate): Lead | undefined {
    const lead = db.get(id)
    if (!lead) return undefined
    const updated: Lead = {
      ...lead,
      ...input,
      updatedAt: now(),
    }
    db.set(id, updated)
    return updated
  },

  delete(id: string): boolean {
    return db.delete(id)
  },

  createMany(leads: LeadCreate[]): Lead[] {
    return leads.map((l) => this.create(l))
  },
}

// Seed esempio: pipeline e interesse (riferimento UI)
const examples: LeadCreate[] = [
  { nome: "Marco", cognome: "Rossi", email: "marco.rossi@email.it", telefono: "333 1234567", fonte: "google", interesse: "palestra" },
  { nome: "Laura", cognome: "Bianchi", email: "laura.b@email.it", telefono: "340 9876543", fonte: "website", interesse: "full_premium" },
  { nome: "Giuseppe", cognome: "Verdi", email: "g.verdi@email.it", telefono: "328 5551234", fonte: "facebook", interesse: "spa" },
  { nome: "Anna", cognome: "Neri", email: "anna.neri@email.it", telefono: "347 7778899", fonte: "website", interesse: "corsi" },
  { nome: "Sara", cognome: "Fontana", email: "sara.f@email.it", telefono: "333 1112233", fonte: "google", interesse: "piscina" },
  { nome: "Luca", cognome: "Ferrari", email: "luca.ferrari@email.it", telefono: "340 4445566", fonte: "facebook", interesse: "palestra" },
  { nome: "Maria", cognome: "Romano", email: "maria.r@email.it", telefono: "328 7778899", fonte: "website", interesse: "corsi" },
  { nome: "Andrea", cognome: "Colombo", email: "andrea.c@email.it", telefono: "347 0001122", fonte: "google", interesse: "full_premium" },
  { nome: "Giulia", cognome: "Ricci", email: "giulia.ricci@email.it", telefono: "333 9998877", fonte: "facebook", interesse: "spa" },
  { nome: "Paolo", cognome: "Bruno", email: "paolo.b@email.it", telefono: "340 6655443", fonte: "website", interesse: "palestra" },
]
examples.forEach((e) => store.create(e))
const ids = Array.from(db.keys())
const statusi: LeadStatus[] = ["nuovo", "nuovo", "contattato", "contattato", "appuntamento", "tour", "proposta", "chiuso_vinto", "chiuso_vinto", "chiuso_perso"]
ids.forEach((id, i) => { if (id && statusi[i]) store.update(id, { stato: statusi[i], consulenteNome: i % 2 ? "Anna Bianchi" : "Luca Ferrari" }) })
