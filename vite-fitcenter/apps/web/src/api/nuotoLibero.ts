import { api } from "./client"

export type NuotoLiberoCells = Record<string, Record<string, number>>

export const nuotoLiberoApi = {
  getRange: (from: string, to: string) =>
    api.get<{ cells: NuotoLiberoCells }>(
      `/data/nuoto-libero?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  setCell: (giorno: string, ora: string, presenze: number | null) =>
    api.patch<{ ok: boolean }>("/data/nuoto-libero", { giorno, ora, presenze }),
}
