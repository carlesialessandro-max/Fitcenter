import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@workspace/ui/components/button"
import { KpiRow, TabellaConsulenti } from "./DettaglioBloccoView"

type Props = {
  anno: number
  mese: number
  meseLabel: string
  onClose: () => void
}

export function DettaglioMeseModal({ anno, mese, meseLabel, onClose }: Props) {
  const { consulenteFilter, role, consulenteNome } = useAuth()
  const queryClient = useQueryClient()
  const [giorno, setGiorno] = useState(10)

  const { data, isLoading, error } = useQuery({
    queryKey: ["dettaglio-mese", anno, mese, giorno, consulenteFilter],
    queryFn: () => dataApi.getDettaglioMese(anno, mese, giorno, consulenteFilter),
  })

  const { data: convalidazioniData } = useQuery({
    queryKey: ["convalidazioni", anno, mese, consulenteNome],
    queryFn: () => dataApi.getConvalidazioni(anno, mese, consulenteNome ?? ""),
    enabled: role === "operatore" && !!consulenteNome,
  })
  const convalidati = convalidazioniData?.convalidati ?? []
  const giornoConvalidato = convalidati.includes(giorno)

  const setConvalidazioneMutation = useMutation({
    mutationFn: (convalidato: boolean) =>
      dataApi.setConvalidazione({
        anno,
        mese,
        giorno,
        convalidato,
        consulenteNome: consulenteNome ?? "",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convalidazioni", anno, mese, consulenteNome] })
    },
  })

  useEffect(() => {
    if (data?.giorniNelMese != null && giorno > data.giorniNelMese) {
      setGiorno(data.giorniNelMese)
    }
  }, [data?.giorniNelMese, giorno])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-8 w-full max-w-5xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
          <h2 className="text-xl font-semibold text-zinc-100">Dettaglio vendite e budget — {meseLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-8">
          {data?.giorniNelMese != null && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-zinc-500">Giorno:</label>
                <select
                  value={giorno}
                  onChange={(e) => setGiorno(Number(e.target.value))}
                  className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
                >
                  {Array.from({ length: data.giorniNelMese }, (_, i) => i + 1).map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              {role === "operatore" && consulenteNome && (
                <div className="flex items-center gap-2">
                  {giornoConvalidato ? (
                    <>
                      <span className="text-sm text-emerald-400">Giorno convalidato</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConvalidazioneMutation.mutate(false)}
                        disabled={setConvalidazioneMutation.isPending}
                      >
                        Rimuovi convalida
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setConvalidazioneMutation.mutate(true)}
                      disabled={setConvalidazioneMutation.isPending}
                    >
                      Convalida giorno lavorativo
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {isLoading && (
            <div className="py-12 text-center text-zinc-400">Caricamento...</div>
          )}
          {error && (
            <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {(error as Error).message}
            </div>
          )}

          {data && !error && (
            <>
              {/* Sezione giorno */}
              <section>
                <h3 className="mb-3 text-lg font-semibold text-zinc-100">
                  {data.giornoLabel ?? `${anno}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`}
                </h3>
                <KpiRow b={data.dettaglioGiorno} />
                <TabellaConsulenti rows={data.dettaglioGiorno.perConsulente} />
              </section>

              {/* Sezione mese */}
              <section>
                <h3 className="mb-3 text-lg font-semibold text-zinc-100">{data.meseLabel}</h3>
                <KpiRow b={data.dettaglioMese} />
                <TabellaConsulenti rows={data.dettaglioMese.perConsulente} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
