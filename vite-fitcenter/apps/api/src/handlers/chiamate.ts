import { Request, Response } from "express"
import { store } from "../store/chiamate.js"
import type { ChiamataCreate } from "../types/chiamata.js"

export async function listChiamate(req: Request, res: Response) {
  try {
    const { consulenteId, da, a, tipo, clienteId, leadId } = req.query
    const list = store.list({
      consulenteId: consulenteId as string | undefined,
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
  res.json(c)
}

export async function createChiamata(req: Request, res: Response) {
  try {
    const body = req.body as ChiamataCreate
    if (!body.consulenteNome || !body.telefono || !body.nomeContatto || !body.tipo) {
      return res.status(400).json({
        message: "consulenteNome, telefono, nomeContatto e tipo sono obbligatori",
      })
    }
    const created = store.create({
      ...body,
      consulenteId: body.consulenteId || body.consulenteNome,
    })
    res.status(201).json(created)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}

export async function getChiamateStats(req: Request, res: Response) {
  try {
    const stats = store.stats()
    res.json(stats)
  } catch (e) {
    res.status(500).json({ message: (e as Error).message })
  }
}
