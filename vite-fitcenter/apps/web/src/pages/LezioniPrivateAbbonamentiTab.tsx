import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { lezioniPrivateApi, type LpAbbCheckEsito, type LpAbbCheckRow } from "@/api/lezioniPrivate"
import { fmtDateIt, isoToday, monthRangeFromDay } from "@/pages/Corsi"

const ESITO_LABEL: Record<LpAbbCheckEsito, string> = {
  ok: "Valido",
  incongruente: "Non congruente",
  mancante: "Senza abbonamento",
  non_anagrafato: "Non in anagrafica",
  prova_senza_abb: "Prova senza abb.",
}

const ESITO_CLASS: Record<LpAbbCheckEsito, string> = {
  ok: "text-emerald-300",
  incongruente: "text-amber-300",
  mancante: "text-red-300",
  non_anagrafato: "text-zinc-400",
  prova_senza_abb: "text-sky-300",
}

export function LezioniPrivateAbbonamentiTab() {
  const month = useMemo(() => monthRangeFromDay(isoToday()), [])
  const [from, setFrom] = useState(month.from)
  const [to, setTo] = useState(month.to)
  const [filtro, setFiltro] = useState<"tutti" | LpAbbCheckEsito>("tutti")
  const [giorno, setGiorno] = useState("")
  const [istruttore, setIstruttore] = useState("")
  const [nominativo, setNominativo] = useState("")
  const q = useQuery({
    queryKey: ["lezioni-private-abb-check", from, to],
    queryFn: () => lezioniPrivateApi.abbonamentiCheck(from, to),
    enabled: !!from && !!to && from <= to,
    staleTime: 15_000,
  })
  const istruttori = useMemo(() => {
    const set = new Set<string>()
    for (const r of q.data?.rows ?? []) {
      const n = r.istruttoreNome.trim()
      if (n) set.add(n)
    }
    return [...set].sort((a, b) => a.localeCompare(b, "it"))
  }, [q.data?.rows])
  const rows = useMemo(() => {
    const nomeQ = nominativo.trim().toLowerCase()
    const istrQ = istruttore.trim().toLowerCase()
    return (q.data?.rows ?? []).filter((r) => {
      if (filtro !== "tutti" && r.esito !== filtro) return false
      if (giorno && r.giorno !== giorno) return false
      if (istrQ && !r.istruttoreNome.toLowerCase().includes(istrQ)) return false
      if (
        nomeQ &&
        !r.clienteNome.toLowerCase().includes(nomeQ) &&
        !(r.clienteGestionale ?? "").toLowerCase().includes(nomeQ)
      ) {
        return false
      }
      return true
    })
  }, [q.data?.rows, filtro, giorno, istruttore, nominativo])
  return (
    <div className="mt-5 grid gap-4">
      <p className="text-sm text-zinc-400">
        Confronta le lezioni prenotate o svolte con gli abbonamenti private del gestionale (telefono, altrimenti
        nominativo). Basta un abbonamento private valido in quella data: prova o pacchetto 5/10 sono entrambi ok, anche
        se il pacchetto in gestionale è più grande.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm text-zinc-400">
          Dal
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="grid gap-1 text-sm text-zinc-400">
          Al
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="grid gap-1 text-sm text-zinc-400">
          Data lezione
          <input
            type="date"
            value={giorno}
            onChange={(e) => setGiorno(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="grid gap-1 text-sm text-zinc-400">
          Istruttore
          <input
            list="lp-abb-istr"
            value={istruttore}
            onChange={(e) => setIstruttore(e.target.value)}
            placeholder="Nome istruttore"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
          />
          <datalist id="lp-abb-istr">
            {istruttori.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className="grid gap-1 text-sm text-zinc-400">
          Nominativo
          <input
            value={nominativo}
            onChange={(e) => setNominativo(e.target.value)}
            placeholder="Cognome o nome"
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-zinc-100"
          />
        </label>
        {giorno || istruttore || nominativo ? (
          <button
            type="button"
            onClick={() => {
              setGiorno("")
              setIstruttore("")
              setNominativo("")
            }}
            className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Pulisci ricerca
          </button>
        ) : null}
      </div>
      {q.isError ? <p className="text-sm text-red-400">{String((q.error as Error).message)}</p> : null}
      {q.data ? (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["tutti", `Tutte (${q.data.totale})`],
              ["ok", `Valide (${q.data.ok})`],
              ["incongruente", `Non congruenti (${q.data.incongruente})`],
              ["mancante", `Senza abb. (${q.data.mancante})`],
              ["non_anagrafato", `Non in anagrafica (${q.data.nonAnagrafato})`],
              ["prova_senza_abb", `Prove senza abb. (${q.data.provaSenzaAbb})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltro(id)}
              className={`rounded-md px-3 py-1.5 text-sm ${filtro === id ? "bg-amber-500/20 text-amber-200" : "border border-zinc-700 text-zinc-400"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/50 text-zinc-400">
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Ora</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Tipo prenotato</th>
              <th className="px-3 py-2 font-medium">Istruttore</th>
              <th className="px-3 py-2 font-medium">Esito</th>
              <th className="px-3 py-2 font-medium">Abbonamento gestionale</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-zinc-500">
                  Controllo in corso…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-zinc-500">
                  Nessuna lezione con questi filtri.
                </td>
              </tr>
            ) : (
              rows.map((r) => <AbbRow key={r.lezioneId} row={r} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AbbRow({ row }: { row: LpAbbCheckRow }) {
  const abb = row.abbonamento
  return (
    <tr className="border-b border-zinc-800/60">
      <td className="whitespace-nowrap px-3 py-2 text-zinc-200">{fmtDateIt(row.giorno)}</td>
      <td className="px-3 py-2 text-zinc-300">{row.ora}</td>
      <td className="px-3 py-2">
        <div className="text-zinc-100">{row.clienteNome}</div>
        <div className="text-xs text-zinc-500">{row.telefono}</div>
        {row.clienteGestionale && row.clienteGestionale.toLowerCase() !== row.clienteNome.toLowerCase() ? (
          <div className="text-xs text-zinc-500">Gestionale: {row.clienteGestionale}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-zinc-300">{row.tipo === "prova" ? "Prova" : `Pacchetto ${row.tipo}`}</td>
      <td className="px-3 py-2 text-zinc-300">{row.istruttoreNome}</td>
      <td className={`px-3 py-2 font-medium ${ESITO_CLASS[row.esito]}`}>{ESITO_LABEL[row.esito]}</td>
      <td className="px-3 py-2 text-zinc-400">
        <div>{row.nota}</div>
        {abb ? (
          <div className="mt-0.5 text-xs text-zinc-500">
            {abb.descrizione || abb.categoria}
            {abb.dataInizio || abb.dataFine ? ` · ${fmtDateIt(abb.dataInizio)} – ${fmtDateIt(abb.dataFine)}` : ""}
          </div>
        ) : null}
      </td>
    </tr>
  )
}
