import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { chiamateApi, type Chiamata } from "@/api/chiamate"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import { ChiamaButton } from "@/components/ChiamaButton"
import { RegistraTelefonataButton } from "@/components/RegistraTelefonataButton"
import { InserisciTelefonataForm } from "@/components/InserisciTelefonataForm"
import { TELEFONATA_ATTIVITA, TELEFONATA_AZIONE } from "@/lib/telefonate-crm"

function isoToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function isoAddDays(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T12:00:00`)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function Telefonate() {
  const { role, consulenteFilter, consulenteNome, consulenti } = useAuth()
  const [adminConsulente, setAdminConsulente] = useState("")
  const effectiveConsulente =
    role === "admin" ? (adminConsulente.trim() ? adminConsulente.trim() : "") : (consulenteFilter ?? consulenteNome ?? "")

  const [da, setDa] = useState(() => isoAddDays(isoToday(), -7))
  const [a, setA] = useState(() => isoToday())
  const [crmTo, setCrmTo] = useState(() => isoAddDays(isoToday(), 14))

  const { data: chiamate = [], isLoading: loadingChiamate, error: errChiamate } = useQuery({
    queryKey: ["chiamate", "telefonate", role, effectiveConsulente, da, a],
    queryFn: () => chiamateApi.list({ da, a, consulenteId: role === "admin" ? (effectiveConsulente || undefined) : undefined }),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: crm, isLoading: loadingCrm, error: errCrm } = useQuery({
    queryKey: ["data", "crm-telefonate-operatore", role, effectiveConsulente, a, crmTo],
    queryFn: () =>
      dataApi.getCrmAppuntamentiOperatore({
        consulente: role === "admin" ? (effectiveConsulente || undefined) : undefined,
        from: a,
        to: crmTo,
        soloTelefonate: true,
      }),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const chiamateCliente = useMemo(() => chiamate.filter((c) => c.tipo === "cliente"), [chiamate])
  const chiamateLead = useMemo(() => chiamate.filter((c) => c.tipo === "lead"), [chiamate])

  const fmtDateShort = (iso: string) =>
    iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"

  const stickyActionsHead =
    "sticky right-0 z-10 bg-zinc-900/95 px-2 py-2 text-right font-medium text-zinc-400 shadow-[-8px_0_12px_rgba(0,0,0,0.35)]"
  const stickyActionsCell =
    "sticky right-0 z-10 bg-zinc-900/95 px-2 py-2 text-right shadow-[-8px_0_12px_rgba(0,0,0,0.35)] group-hover:bg-zinc-900"

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Telefonate</h1>
          <p className="text-sm text-zinc-400">Telefonate commerciali da CRM e registro chiamate effettuate.</p>
        </div>
      </div>

      {role === "admin" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3">
          <span className="text-sm font-medium text-zinc-300">Filtro consulente</span>
          <select
            value={adminConsulente}
            onChange={(e) => setAdminConsulente(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">Tutte le consulenti</option>
            {(consulenti ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">Se vuoto: per le chiamate mostra tutte; per lo storico CRM mostra quelle assegnate all’operatore selezionato.</p>
        </div>
      )}

      <InserisciTelefonataForm consulenteNomeOverride={effectiveConsulente || undefined} />

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">Chiamate (range)</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-400">{chiamate.length}</p>
          <p className="mt-1 text-xs text-zinc-500">Clienti: {chiamateCliente.length} · Lead: {chiamateLead.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">Da chiamare (CRM)</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">{crm?.rows?.length ?? 0}</p>
          <p className="mt-1 text-xs text-zinc-500">Attività telefonica · Azione commerciale · Da {a} a {crmTo}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">Filtri</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-500">
              Da
              <input value={da} onChange={(e) => setDa(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100" />
            </label>
            <label className="text-xs text-zinc-500">
              A
              <input value={a} onChange={(e) => setA(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100" />
            </label>
            <label className="col-span-2 text-xs text-zinc-500">
              Storico CRM fino a
              <input value={crmTo} onChange={(e) => setCrmTo(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100" />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Telefonate da effettuare (storico CRM)</h2>
          {loadingCrm ? (
            <p className="mt-2 text-sm text-zinc-500">Caricamento...</p>
          ) : errCrm ? (
            <p className="mt-2 text-sm text-red-400">{(errCrm as Error).message}</p>
          ) : (crm?.rows?.length ?? 0) === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nessuna telefonata commerciale nel range.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-zinc-800">
              <table className="w-full min-w-[760px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[6.5rem]" />
                  <col className="w-[8rem]" />
                  <col className="w-[7rem]" />
                  <col />
                  <col className="w-[7.5rem]" />
                  <col className="w-[8.5rem]" />
                  <col className="w-[11.5rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="px-2 py-2 font-medium text-zinc-400">Data</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Nome</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Tel</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Storico</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Attività</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Azione</th>
                    <th className={stickyActionsHead}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {(crm?.rows ?? []).map((r, i) => {
                    const nome = (r.nome ?? "").trim()
                    const cognome = (r.cognome ?? "").trim()
                    const cliente = [nome, cognome].filter(Boolean).join(" ") || "—"
                    const contatto = cliente !== "—" ? cliente : r.crmDescrizione || "CRM"
                    const storico = r.crmDescrizione || "—"
                    const attivita = r.attivitaDescrizione || TELEFONATA_ATTIVITA
                    const azione = r.tipoDescrizione || TELEFONATA_AZIONE
                    return (
                      <tr key={i} className="group border-b border-zinc-900 last:border-0">
                        <td className="whitespace-nowrap px-2 py-2 text-zinc-200">{fmtDateShort(r.dataAppuntamento)}</td>
                        <td className="truncate px-2 py-2 text-zinc-300" title={cliente !== "—" ? cliente : undefined}>
                          {cliente}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-zinc-300">{r.telefono || "—"}</td>
                        <td className="truncate px-2 py-2 text-zinc-300" title={storico !== "—" ? storico : undefined}>
                          {storico}
                        </td>
                        <td className="truncate px-2 py-2 text-zinc-300" title={attivita}>
                          {attivita}
                        </td>
                        <td className="truncate px-2 py-2 text-zinc-300" title={azione}>
                          {azione}
                        </td>
                        <td className={stickyActionsCell}>
                          {r.telefono ? (
                            <div className="flex flex-col items-end gap-1">
                              <ChiamaButton
                                telefono={r.telefono}
                                nomeContatto={contatto}
                                tipo="cliente"
                                registraAlClick
                                storico={r.crmDescrizione}
                                attivita={attivita}
                                azione={azione}
                              />
                              <RegistraTelefonataButton
                                telefono={r.telefono}
                                nomeContatto={contatto}
                                tipo="cliente"
                                consulenteNomeOverride={effectiveConsulente || undefined}
                                storico={r.crmDescrizione}
                                attivita={attivita}
                                azione={azione}
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-500">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Chiamate effettuate</h2>
          {loadingChiamate ? (
            <p className="mt-2 text-sm text-zinc-500">Caricamento...</p>
          ) : errChiamate ? (
            <p className="mt-2 text-sm text-red-400">{(errChiamate as Error).message}</p>
          ) : chiamate.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">
              Nessuna chiamata nel range. Usa il modulo <strong className="font-medium text-zinc-400">Inserisci telefonata</strong> sopra.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-zinc-800">
              <table className="w-full min-w-[900px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[6.5rem]" />
                  <col className="w-[8rem]" />
                  <col className="w-[7rem]" />
                  <col />
                  <col className="w-[7.5rem]" />
                  <col className="w-[8.5rem]" />
                  <col className="w-[5rem]" />
                  <col className="w-[11.5rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="px-2 py-2 font-medium text-zinc-400">Data</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Nome</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Tel</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Storico</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Attività</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Azione</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Esito</th>
                    <th className={stickyActionsHead}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {chiamate.map((c: Chiamata) => (
                    <tr key={c.id} className="group border-b border-zinc-900 last:border-0">
                      <td className="whitespace-nowrap px-2 py-2 text-zinc-200">{fmtDateShort(c.dataOra)}</td>
                      <td className="truncate px-2 py-2 text-zinc-300" title={c.nomeContatto || undefined}>
                        {c.nomeContatto}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-zinc-300">{c.telefono}</td>
                      <td className="truncate px-2 py-2 text-zinc-300" title={c.note || undefined}>
                        {c.note || "—"}
                      </td>
                      <td className="truncate px-2 py-2 text-zinc-300">{c.attivita || TELEFONATA_ATTIVITA}</td>
                      <td className="truncate px-2 py-2 text-zinc-300">{c.azione || TELEFONATA_AZIONE}</td>
                      <td className="truncate px-2 py-2 text-zinc-300">{c.esito || "—"}</td>
                      <td className={stickyActionsCell}>
                        <div className="flex flex-col items-end gap-1">
                          <ChiamaButton
                            telefono={c.telefono}
                            nomeContatto={c.nomeContatto}
                            tipo={c.tipo}
                            leadId={c.leadId}
                            clienteId={c.clienteId}
                            registraAlClick={false}
                            storico={c.note}
                            attivita={c.attivita}
                            azione={c.azione}
                          />
                          <RegistraTelefonataButton
                            telefono={c.telefono}
                            nomeContatto={c.nomeContatto}
                            tipo={c.tipo}
                            leadId={c.leadId}
                            clienteId={c.clienteId}
                            consulenteNomeOverride={effectiveConsulente || c.consulenteNome}
                            storico={c.note}
                            attivita={c.attivita}
                            azione={c.azione}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

