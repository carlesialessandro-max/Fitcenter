import type { Lead, LeadSource, LeadStatus, InteresseLead } from "../types/lead.js"

function str(v: unknown): string {
  if (v == null) return ""
  return String(v)
}

const FONTI: LeadSource[] = ["website", "facebook", "google", "sql_server"]
const STATI: LeadStatus[] = ["nuovo", "contattato", "appuntamento", "tour", "proposta", "chiuso_vinto", "chiuso_perso"]
const INTERESSI: InteresseLead[] = ["palestra", "piscina", "spa", "corsi", "full_premium"]

function normalize<T extends string>(val: string, options: readonly T[]): T {
  const lower = val.toLowerCase().replace(/\s+/g, "_")
  const found = options.find((o) => lower.includes(o.replace("_", "")))
  return (found ?? options[0]) as T
}

export function rowToLead(row: Record<string, unknown>): Lead {
  const id = str(row.Id ?? row.id)
  const statoRaw = str(row.Stato ?? row.stato ?? row.Status ?? row.status)
  const fonteRaw = str(row.Fonte ?? row.fonte ?? row.Source ?? row.source)
  const interesseRaw = str(row.Interesse ?? row.interesse ?? row.Interest ?? row.interest)
  return {
    id: id || crypto.randomUUID(),
    nome: str(row.Nome ?? row.nome ?? row.Name ?? row.name),
    cognome: str(row.Cognome ?? row.cognome ?? row.Surname ?? row.surname),
    email: str(row.Email ?? row.email),
    telefono: str(row.Telefono ?? row.telefono ?? row.Phone ?? row.phone),
    fonte: normalize(fonteRaw, FONTI),
    fonteDettaglio: str(row.FonteDettaglio ?? row.fonteDettaglio) || undefined,
    stato: normalize(statoRaw, STATI),
    interesse: interesseRaw ? (normalize(interesseRaw, INTERESSI) as InteresseLead) : undefined,
    consulenteId: str(row.ConsulenteId ?? row.consulenteId) || undefined,
    consulenteNome: str(row.ConsulenteNome ?? row.consulenteNome ?? row.Consulente ?? row.consulente) || undefined,
    note: str(row.Note ?? row.note) || undefined,
    createdAt: str(row.DataCreazione ?? row.dataCreazione ?? row.CreatedAt ?? row.createdAt ?? new Date().toISOString()),
    updatedAt: str(row.DataAggiornamento ?? row.dataAggiornamento ?? row.UpdatedAt ?? row.updatedAt ?? new Date().toISOString()),
    abbonamentoId: str(row.AbbonamentoId ?? row.abbonamentoId) || undefined,
  }
}
