import type { RinnovoCorsoRow } from "@/types/gestionale"

/** Un bambino può avere più abbonamenti (es. lunedì + venerdì): una riga in elenco. */
export type RinnovoCorsoGruppo = {
  clienteId: string
  nome: string
  email: string | null
  telefono: string | null
  piani: string[]
}

export function groupRinnoviByBambino(rows: RinnovoCorsoRow[]): RinnovoCorsoGruppo[] {
  const m = new Map<string, RinnovoCorsoGruppo>()
  for (const r of rows) {
    const prev = m.get(r.clienteId)
    if (!prev) {
      m.set(r.clienteId, {
        clienteId: r.clienteId,
        nome: r.nome,
        email: r.email,
        telefono: r.telefono,
        piani: [r.piano],
      })
      continue
    }
    if (!prev.piani.includes(r.piano)) prev.piani.push(r.piano)
    if (!prev.email && r.email) prev.email = r.email
    if (!prev.telefono && r.telefono) prev.telefono = r.telefono
  }
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "it"))
}
