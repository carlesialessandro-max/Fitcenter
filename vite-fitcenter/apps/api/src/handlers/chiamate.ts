import { Request, Response } from "express"
import { store } from "../store/chiamate.js"
import type { ChiamataCreate } from "../types/chiamata.js"
import { getOperatoreConsulenteNome, getScopedUser } from "../middleware/auth.js"
import { bumpMetaVersion } from "../services/persistent-cache.js"

export async function listChiamate(req: Request, res: Response) {
  try {
    const operatoreNome = getOperatoreConsulenteNome(req)
    const { consulenteId, da, a, tipo, clienteId, leadId } = req.query
    const list = store.list({
      consulenteId: (operatoreNome ?? (consulenteId as string | undefined)) || undefined,
      da: da as string | undefined,
      a: a as string | undefined,
      tipo: tipo as string | undefined,
      clienteId: clienteId as string | undefined,
      leadId: leadId as string | undefined,
    })
    res.json(list)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getChiamata(req: Request, res: Response) {
  const c = store.get(String(req.params.id))
  if (!c) return res.status(404).json({ message: "Chiamata non trovata" })
  const operatoreNome = getOperatoreConsulenteNome(req)
  if (operatoreNome && c.consulenteId !== operatoreNome && c.consulenteNome !== operatoreNome) {
    return res.status(403).json({ message: "Permessi insufficienti" })
  }
  res.json(c)
}

export async function createChiamata(req: Request, res: Response) {
  try {
    const u = getScopedUser(req)
    const operatoreNome = getOperatoreConsulenteNome(req)
    const body = req.body as ChiamataCreate
    const consulenteNome = (operatoreNome ?? body.consulenteNome)?.trim()
    if (!consulenteNome || !body.telefono || !body.nomeContatto || !body.tipo) {
      return res.status(400).json({
        message: "consulenteNome, telefono, nomeContatto e tipo sono obbligatori",
      })
    }
    if (u.role !== "admin" && operatoreNome && consulenteNome !== operatoreNome) {
      return res.status(403).json({ message: "Permessi insufficienti" })
    }
    const created = store.create({
      ...body,
      consulenteNome,
      consulenteId: consulenteNome,
    })
    await bumpMetaVersion("chiamate")
    res.status(201).json(created)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getChiamateStats(req: Request, res: Response) {
  try {
    const operatoreNome = getOperatoreConsulenteNome(req)
    if (!operatoreNome) {
      const stats = store.stats()
      return res.json(stats)
    }
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const startOfWeek = new Date(startOfToday)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())

    const allMine = store.list({ consulenteId: operatoreNome })
    const oggi = allMine.filter((c) => new Date(c.dataOra) >= startOfToday).length
    const settimana = allMine.filter((c) => new Date(c.dataOra) >= startOfWeek).length
    res.json({ oggi, settimana, perConsulente: [{ consulenteNome: operatoreNome, count: allMine.length }] })
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
