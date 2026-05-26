import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { chiamateApi, type Chiamata } from "@/api/chiamate"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import { ChiamaButton } from "@/components/ChiamaButton"
import { RegistraTelefonataButton } from "@/components/RegistraTelefonataButton"
import { InserisciTelefonataForm } from "@/components/InserisciTelefonataForm"
import { TELEFONATA_ATTIVITA, TELEFONATA_AZIONE, ESITI_TELEFONATA_CRM, ESITO_TELEFONATA_DEFAULT, type EsitoTelefonataCrm } from "@/lib/telefonate-crm"

function isoToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function fmtIsoIt(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ""
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

const dateInputClass =
  "mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 [color-scheme:dark]"

function DateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block text-sm text-zinc-300">
      <span className="font-medium">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs font-normal text-zinc-500">{hint}</span> : null}
      <input
        type="date"
        lang="it-IT"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Formato: gg/mm/aaaa"
        className={dateInputClass}
      />
      {value ? <span className="mt-1 block text-xs text-amber-400/90">{fmtIsoIt(value)}</span> : null}
    </label>
  )
}

export function Telefonate() {
  const { role, consulenteFilter, consulenteNome, consulenti } = useAuth()
  const [adminConsulente, setAdminConsulente] = useState("")
  const effectiveConsulente =
    role === "admin" ? (adminConsulente.trim() ? adminConsulente.trim() : "") : (consulenteFilter ?? consulenteNome ?? "")

  const oggi = isoToday()
  const [dal, setDal] = useState(oggi)
  const [al, setAl] = useState(oggi)
  const [esitiCrm, setEsitiCrm] = useState<Record<string, EsitoTelefonataCrm>>({})

  const crmReady = Boolean(effectiveConsulente.trim())

  const { data: chiamate = [], isLoading: loadingChiamate, error: errChiamate } = useQuery({
    queryKey: ["chiamate", "telefonate", role, effectiveConsulente, dal, al],
    queryFn: () => chiamateApi.list({ da: dal, a: al, consulenteId: role === "admin" ? (effectiveConsulente || undefined) : undefined }),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: crm, isLoading: loadingCrm, error: errCrm } = useQuery({
    queryKey: ["data", "crm-telefonate-operatore", role, effectiveConsulente, dal, al],
    queryFn: () =>
      dataApi.getCrmAppuntamentiOperatore({
        consulente: effectiveConsulente,
        from: dal,
        to: al,
        soloTelefonate: true,
        includeCompletate: true,
      }),
    enabled: crmReady,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const fmtDateShort = (iso: string) =>
    iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"

  function telDigits(tel: string): string {
    return tel.replace(/\D/g, "").slice(-9)
  }

  function sameCalendarDay(a: string, b: string): boolean {
    const da = new Date(a)
    const db = new Date(b)
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
  }

  const crmRows = useMemo(() => {
    const rows = crm?.rows ?? []
    return rows.filter((r) => {
      if (r.dataEvasione) return false
      const tel = telDigits(r.telefono ?? "")
      if (!tel) return true
      const doneLocally = chiamate.some((c) => {
        if (telDigits(c.telefono) !== tel) return false
        const when = c.evasoAt ?? c.dataOra
        return sameCalendarDay(when, r.dataAppuntamento)
      })
      return !doneLocally
    })
  }, [crm?.rows, chiamate])

  const crmCompletate = useMemo(() => {
    return (crm?.rows ?? []).filter((r) => Boolean(r.dataEvasione?.trim()))
  }, [crm?.rows])

  const chiamateEffettuate = useMemo(() => {
    type Row = {
      key: string
      sortAt: string
      dataLabel: string
      evasoLabel: string
      nomeContatto: string
      telefono: string
      descrizione: string
      consulente: string
      esito: string
      chiamata?: Chiamata
    }
    const out: Row[] = []

    for (const r of crmCompletate) {
      const nome = [r.nome, r.cognome].filter(Boolean).join(" ").trim()
      out.push({
        key: `crm-${r.crmId ?? r.dataEvasione}-${r.telefono ?? nome}`,
        sortAt: r.dataEvasione || r.dataAppuntamento,
        dataLabel: fmtDateShort(r.dataAppuntamento),
        evasoLabel: fmtDateShort(r.dataEvasione || r.dataAppuntamento),
        nomeContatto: nome || r.crmDescrizione || "CRM",
        telefono: r.telefono || "—",
        descrizione: r.crmDescrizione || "—",
        consulente: r.consulenteNome || effectiveConsulente || "—",
        esito: r.esitoDescrizione || "—",
      })
    }

    for (const c of chiamate) {
      out.push({
        key: `local-${c.id}`,
        sortAt: c.evasoAt ?? c.dataOra,
        dataLabel: fmtDateShort(c.dataOra),
        evasoLabel: c.evasoAt ? fmtDateShort(c.evasoAt) : fmtDateShort(c.dataOra),
        nomeContatto: c.nomeContatto,
        telefono: c.telefono,
        descrizione: c.note || "—",
        consulente: c.consulenteNome || effectiveConsulente || "—",
        esito: c.esitoCrm || c.esito || "—",
        chiamata: c,
      })
    }

    return out.sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime())
  }, [chiamate, crmCompletate, effectiveConsulente])

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
          <p className="text-xs text-zinc-500">Storico CRM filtrato per destinatario = consulente selezionata (come nel gestionale).</p>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900/50 p-4">
        <h2 className="text-sm font-medium text-zinc-200">Periodo</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Come nel CRM gestionale: per le evase usa la <strong className="font-medium text-zinc-400">data evasione</strong>; per quelle da fare la data appuntamento.
          Default: oggi ({fmtIsoIt(oggi)}).
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <DateField
            label="Dal"
            hint="Inizio periodo (gg/mm/aaaa)"
            value={dal}
            onChange={(v) => {
              setDal(v)
              if (v > al) setAl(v)
            }}
          />
          <DateField
            label="Al"
            hint="Fine periodo (gg/mm/aaaa)"
            value={al}
            onChange={(v) => {
              setAl(v)
              if (v < dal) setDal(v)
            }}
          />
        </div>
      </div>

      <InserisciTelefonataForm consulenteNomeOverride={effectiveConsulente || undefined} />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">Chiamate (range)</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-400">{chiamateEffettuate.length}</p>
          <p className="mt-1 text-xs text-zinc-500">
            CRM evase: {crmCompletate.length} · Registro app: {chiamate.length}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-sm text-zinc-400">Da chiamare (CRM)</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">{crmRows.length}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {TELEFONATA_ATTIVITA} · Destinatario {effectiveConsulente || "—"} · {fmtIsoIt(dal)} – {fmtIsoIt(al)}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Telefonate da effettuare (storico CRM)</h2>
          {!crmReady ? (
            <p className="mt-2 text-sm text-amber-300">Seleziona una consulente nel filtro per caricare le telefonate CRM.</p>
          ) : loadingCrm ? (
            <p className="mt-2 text-sm text-zinc-500">Caricamento...</p>
          ) : errCrm ? (
            <p className="mt-2 text-sm text-red-400">{(errCrm as Error).message}</p>
          ) : crmRows.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nessuna telefonata ({TELEFONATA_ATTIVITA}) da fare nel range.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-zinc-800">
              <table className="w-full min-w-[760px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[6.5rem]" />
                  <col className="w-[8rem]" />
                  <col className="w-[7rem]" />
                  <col />
                  <col className="w-[8rem]" />
                  <col className="w-[11.5rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="px-2 py-2 font-medium text-zinc-400">Data</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Nome</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Tel</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Descrizione</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Consulente</th>
                    <th className={stickyActionsHead}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {crmRows.map((r, i) => {
                    const rowKey = r.crmId ?? `${i}-${r.dataAppuntamento}-${r.telefono ?? ""}`
                    const esitoRow = esitiCrm[rowKey] ?? ESITO_TELEFONATA_DEFAULT
                    const nome = (r.nome ?? "").trim()
                    const cognome = (r.cognome ?? "").trim()
                    const cliente = [nome, cognome].filter(Boolean).join(" ") || "—"
                    const contatto = cliente !== "—" ? cliente : r.crmDescrizione || "CRM"
                    const descrizione = r.crmDescrizione || "—"
                    const consulente = r.consulenteNome || effectiveConsulente || "—"
                    const attivita = r.attivitaDescrizione || TELEFONATA_ATTIVITA
                    return (
                      <tr key={i} className="group border-b border-zinc-900 last:border-0">
                        <td className="whitespace-nowrap px-2 py-2 text-zinc-200">{fmtDateShort(r.dataAppuntamento)}</td>
                        <td className="truncate px-2 py-2 text-zinc-300" title={cliente !== "—" ? cliente : undefined}>
                          {cliente}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-zinc-300">{r.telefono || "—"}</td>
                        <td className="truncate px-2 py-2 text-zinc-300" title={descrizione !== "—" ? descrizione : undefined}>
                          {descrizione}
                        </td>
                        <td className="truncate px-2 py-2 text-zinc-300" title={consulente}>
                          {consulente}
                        </td>
                        <td className={stickyActionsCell}>
                          {r.telefono ? (
                            <div className="flex flex-col items-end gap-1">
                              <select
                                value={esitoRow}
                                onChange={(e) =>
                                  setEsitiCrm((prev) => ({
                                    ...prev,
                                    [rowKey]: e.target.value as EsitoTelefonataCrm,
                                  }))
                                }
                                className="w-full max-w-[9rem] rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-200"
                                title="Esito da registrare"
                              >
                                {ESITI_TELEFONATA_CRM.map((e) => (
                                  <option key={e} value={e}>
                                    {e}
                                  </option>
                                ))}
                              </select>
                              <ChiamaButton
                                telefono={r.telefono}
                                nomeContatto={contatto}
                                tipo="cliente"
                                registraAlClick
                                storico={r.crmDescrizione}
                                attivita={attivita}
                                azione={TELEFONATA_AZIONE}
                                esitoCrm={esitoRow}
                              />
                              <RegistraTelefonataButton
                                telefono={r.telefono}
                                nomeContatto={contatto}
                                tipo="cliente"
                                consulenteNomeOverride={effectiveConsulente || undefined}
                                storico={r.crmDescrizione}
                                attivita={attivita}
                                azione={TELEFONATA_AZIONE}
                                esitoCrm={esitoRow}
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
          ) : chiamateEffettuate.length === 0 ? (
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
                  <col className="w-[8rem]" />
                  <col className="w-[7.5rem]" />
                  <col className="w-[7rem]" />
                  <col className="w-[11.5rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="px-2 py-2 font-medium text-zinc-400">Data</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Nome</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Tel</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Descrizione</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Consulente</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Esito</th>
                    <th className="px-2 py-2 font-medium text-zinc-400">Evaso il</th>
                    <th className={stickyActionsHead}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {chiamateEffettuate.map((row) => {
                    const c = row.chiamata
                    return (
                    <tr key={row.key} className="group border-b border-zinc-900 last:border-0">
                      <td className="whitespace-nowrap px-2 py-2 text-zinc-200">{row.dataLabel}</td>
                      <td className="truncate px-2 py-2 text-zinc-300" title={row.nomeContatto || undefined}>
                        {row.nomeContatto}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-zinc-300">{row.telefono}</td>
                      <td className="truncate px-2 py-2 text-zinc-300" title={row.descrizione !== "—" ? row.descrizione : undefined}>
                        {row.descrizione}
                      </td>
                      <td className="truncate px-2 py-2 text-zinc-300">{row.consulente}</td>
                      <td className="truncate px-2 py-2 text-zinc-300">{row.esito}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-zinc-300">{row.evasoLabel}</td>
                      <td className={stickyActionsCell}>
                        {c && row.telefono !== "—" ? (
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
                        ) : (
                          <span className="text-xs text-zinc-500">CRM</span>
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
      </div>
    </div>
  )
}

