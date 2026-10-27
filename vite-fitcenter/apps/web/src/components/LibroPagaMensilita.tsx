import { useEffect, useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import type {
  LibroPagaSnapshot,
  LpagaLivello,
  LpagaMensilitaRow,
  LpagaPersonale,
  LpagaRuolo,
  LpagaTurnoRow,
} from "@/api/libroPaga"
import { qualificheForDisplay, visitaMedicaFromQualifiche, type QualificaConData } from "@/lib/personale-qualifiche"
import { QualificheCorsiFields } from "@/components/LibroPagaSlot"
import { LibroPagaRepartiMulti, livelloIdsFromPersona } from "@/components/LibroPagaRepartiMulti"
import { ruoloLabel } from "@/lib/lpaga-ruolo"

const inputCls =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
const btnAmber = "rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
const btnGhost = "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"

function eur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n || 0))
}

function isoDateInput(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ""
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  if (y < 1990 || m < 1 || m > 12 || d < 1 || d > 31) return ""
  return s
}

function fmtDateIt(iso: string | null | undefined): string {
  const s = isoDateInput(iso)
  if (!s) return "—"
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function currentIsoDate(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function meseLabel(mese: string): string {
  const [ys, ms] = mese.split("-")
  const y = Number(ys)
  const m = Number(ms)
  if (!y || !m) return mese
  return new Date(y, m - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" })
}

function fonteTessera(f?: string): string {
  if (f === "gestionale") return "da anagrafica gestionale (non modificabile)"
  if (f === "calendario") return "da personale calendari"
  if (f === "manuale") return "inserito in libro paga"
  return ""
}

function fmtIndirizzo(g: NonNullable<LpagaPersonale["gestionale"]>): string {
  const via = [g.indirizzo, g.cap, g.citta, g.provincia].filter(Boolean).join(" · ")
  return via
}

export function GestionaleAnagraficaBlock({ persona }: { persona?: LpagaPersonale | null }) {
  const g = persona?.gestionale
  const tess = persona?.tesseramento || g?.tesseramento
  const tessScad = persona?.tesseramentoScadenza || g?.tesseramentoScadenza
  const rows: { k: string; v: string }[] = [
    { k: "Categoria", v: g?.categoria || (g ? "STAFF" : "") },
    { k: "Codice fiscale", v: g?.codiceFiscale ?? "" },
    { k: "Email gestionale", v: g?.email ?? "" },
    { k: "Cellulare", v: g?.cellulare ?? "" },
    { k: "Telefono", v: g?.telefono ?? "" },
    { k: "Indirizzo", v: g ? fmtIndirizzo(g) : "" },
    { k: "Data di nascita", v: g?.dataNascita ? fmtDateIt(g.dataNascita) : "" },
    { k: "Tesseramento ASI", v: tess ? `${tess}${tessScad ? ` · scad. ${fmtDateIt(tessScad)}` : ""}` : "" },
    {
      k: "Certificato medico",
      v: (() => {
        const desc = (g?.certificatoMedico ?? "").trim()
        const scad = (g?.certificatoMedicoScadenza ?? "").trim()
        if (!desc && !scad) return ""
        const today = currentIsoDate()
        const scaduto = scad && today && scad < today
        const bits = [
          desc,
          scad ? `scad. ${fmtDateIt(scad)}` : "",
          scaduto ? "scaduto" : "",
        ].filter(Boolean)
        return bits.join(" · ")
      })(),
    },
  ]
  return (
    <div className="sm:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Anagrafica gestionale (STAFF)</p>
      <p className="mt-1 text-[11px] text-zinc-500">
        Dati presi dall’anagrafica del gestionale, categoria STAFF. Non si modificano dal libro paga.
        {fonteTessera(persona?.tesseramentoFonte) ? ` ${fonteTessera(persona?.tesseramentoFonte)}.` : ""}
      </p>
      {g ? (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-3 sm:justify-start">
              <dt className="text-zinc-500">{r.k}</dt>
              <dd className="text-zinc-200">{r.v.trim() ? r.v : "—"}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">Nessun nominativo STAFF trovato nel gestionale per questa persona.</p>
      )}
    </div>
  )
}

type Pannello = { kind: "dettaglio" | "modifica"; personaleId: string }

export function LibroPagaMensilitaTab({
  data,
  mese,
  canEdit,
  hideIban,
  onSave,
  onError,
  onDone,
  onConvalida,
  onConvalidaMese,
  perimetroReparto,
}: {
  data: LibroPagaSnapshot
  mese: string
  canEdit: (personaleId: string) => boolean
  hideIban?: boolean
  onSave: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) => Promise<unknown>
  onError: (s: string) => void
  onDone: () => void
  onConvalida?: (personaleId: string) => void
  onConvalidaMese?: () => void
  perimetroReparto?: boolean
}) {
  const [pannello, setPannello] = useState<Pannello | null>(null)
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return data.mensilita.filter((r) => !n || r.personaleNome.toLowerCase().includes(n))
  }, [data.mensilita, q])
  const visibleIds = useMemo(() => rows.map((r) => r.personaleId), [rows])
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.personaleId)), [rows, selected])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const nSel = selectedRows.length
  const only = nSel === 1 ? selectedRows[0] : undefined

  function toggleId(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  const sel = pannello ? data.mensilita.find((r) => r.personaleId === pannello.personaleId) : undefined
  const persona = pannello ? data.personale.find((p) => p.id === pannello.personaleId) : undefined
  const lezioni = pannello
    ? data.turni.filter((t) => t.personaleId === pannello.personaleId).sort((a, b) => b.giorno.localeCompare(a.giorno))
    : []

  return (
    <div className="mt-4 space-y-4">
      {pannello?.kind === "modifica" && sel && canEdit(sel.personaleId) && (
        <ModificaMese
          row={sel}
          mese={mese}
          onClose={() => setPannello(null)}
          onSave={onSave}
          onError={onError}
          onDone={() => {
            setPannello(null)
            onDone()
          }}
        />
      )}
      {pannello?.kind === "dettaglio" && sel && (
        <DettaglioMese
          row={sel}
          persona={persona}
          mese={mese}
          lezioni={lezioni}
          hideIban={hideIban}
          onClose={() => setPannello(null)}
          soloTurni
        />
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {onConvalida && (
            <button
              type="button"
              className={btnGhost}
              disabled={nSel < 1 || (nSel > 1 && !onConvalidaMese)}
              title={nSel > 1 ? "Apre il controllo del mese per i selezionati" : "Convalida il nominativo selezionato"}
              onClick={() => {
                if (nSel === 1 && only) onConvalida(only.personaleId)
                else onConvalidaMese?.()
              }}
            >
              Convalida
            </button>
          )}
          <button
            type="button"
            className={btnGhost}
            disabled={!only || !canEdit(only.personaleId)}
            title={nSel === 1 ? "Modifica" : "Seleziona un solo nominativo"}
            onClick={() => {
              if (only && canEdit(only.personaleId)) setPannello({ kind: "modifica", personaleId: only.personaleId })
            }}
          >
            Modifica
          </button>
          <button
            type="button"
            className={btnGhost}
            disabled={!only}
            title={nSel === 1 ? "Dettagli" : "Seleziona un solo nominativo"}
            onClick={() => {
              if (only) setPannello({ kind: "dettaglio", personaleId: only.personaleId })
            }}
          >
            Dettagli
          </button>
          {onConvalidaMese && (
            <button type="button" className={btnAmber} onClick={onConvalidaMese}>
              Convalida tutto il mese
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          Seleziona uno o più nominativi, poi usa i pulsanti in alto.
          {nSel > 0 ? ` ${nSel} selezionat${nSel === 1 ? "o" : "i"}.` : ""}
          {perimetroReparto
            ? " Importo totale e bonifico riguardano solo i turni del tuo reparto."
            : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca nominativo…"
            className={`${inputCls} min-w-[12rem] flex-1`}
          />
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Seleziona tutti"
                  className="accent-amber-500"
                />
              </th>
              <th className="px-3 py-2">Nominativo</th>
              <th className="px-3 py-2 text-right">Importo totale</th>
              <th className="px-3 py-2">Note correzione</th>
              <th className="px-3 py-2 text-right">Importo bonifico</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.personaleId}
                className={`border-t border-zinc-800 text-zinc-200 ${selected.has(r.personaleId) ? "bg-amber-500/5" : ""}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.personaleId)}
                    onChange={() => toggleId(r.personaleId)}
                    aria-label={`Seleziona ${r.personaleNome}`}
                    className="accent-amber-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <button type="button" className="text-left hover:text-amber-200" onClick={() => toggleId(r.personaleId)}>
                    {r.personaleNome}
                  </button>
                  {r.chiuso && (
                    <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300">
                      Chiuso
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{eur(r.importo)}</td>
                <td className="px-3 py-2 text-zinc-400">{r.nota || "—"}</td>
                <td className="px-3 py-2 text-right">{eur(r.bonifico)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={5}>
                  Nessuna mensilità in questo mese.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function LibroPagaPersonaleDettaglio({
  persona,
  mese,
  mensilita,
  lezioni,
  onClose,
  canEdit,
  livelli,
  onSavePersonale,
  allowAdminRole,
  onError,
  onDone,
}: {
  persona: LpagaPersonale
  mese: string
  mensilita?: LpagaMensilitaRow
  lezioni: LpagaTurnoRow[]
  onClose: () => void
  canEdit?: boolean
  livelli?: LpagaLivello[]
  onSavePersonale?: (id: string, body: Partial<LpagaPersonale> & { password?: string }) => Promise<unknown>
  allowAdminRole?: boolean
  onError?: (s: string) => void
  onDone?: () => void
}) {
  const nominativo = persona.nominativo ?? `${persona.cognome ?? ""} ${persona.nome}`.trim()
  return (
    <DettaglioMese
      row={
        mensilita ?? {
          personaleId: persona.id,
          personaleNome: nominativo,
          iban: persona.iban ?? "",
          mese,
          ore: lezioni.reduce((s, t) => s + t.quantita, 0),
          importo: lezioni.reduce((s, t) => s + t.importo, 0),
          presenzaOre: 0,
          nTurni: lezioni.length,
          nControllati: 0,
          bonifico: 0,
          nota: "",
          chiuso: false,
        }
      }
      persona={persona}
      mese={mese}
      lezioni={lezioni}
      onClose={onClose}
      canEdit={canEdit}
      livelli={livelli}
      onSavePersonale={onSavePersonale}
      allowAdminRole={allowAdminRole}
      onError={onError}
      onDone={onDone}
    />
  )
}

function DettaglioMese({
  row,
  persona,
  mese,
  lezioni,
  hideIban,
  onClose,
  canEdit,
  livelli,
  onSavePersonale,
  allowAdminRole,
  onError,
  onDone,
  soloTurni,
}: {
  row: LpagaMensilitaRow
  persona?: LpagaPersonale
  mese: string
  lezioni: LpagaTurnoRow[]
  hideIban?: boolean
  onClose: () => void
  canEdit?: boolean
  livelli?: LpagaLivello[]
  onSavePersonale?: (id: string, body: Partial<LpagaPersonale> & { password?: string }) => Promise<unknown>
  allowAdminRole?: boolean
  onError?: (s: string) => void
  onDone?: () => void
  soloTurni?: boolean
}) {
  const year = mese.slice(0, 4)
  const iban = hideIban ? "" : persona?.iban || row.iban
  const editable = Boolean(
    !soloTurni && canEdit && persona && onSavePersonale && (allowAdminRole || persona.ruolo !== "admin")
  )
  const [cognome, setCognome] = useState(persona?.cognome ?? "")
  const [nome, setNome] = useState(persona?.nome ?? "")
  const [username, setUsername] = useState(persona?.username ?? "")
  const [ruolo, setRuolo] = useState<LpagaRuolo>(persona?.ruolo ?? "user")
  const [livelloIds, setLivelloIds] = useState<string[]>(() => livelloIdsFromPersona(persona))
  const [contratto, setContratto] = useState(isoDateInput(persona?.contratto))
  const [ibanEdit, setIbanEdit] = useState(persona?.iban ?? "")
  const [emailEdit, setEmailEdit] = useState(persona?.email ?? "")
  const [password, setPassword] = useState("")
  const [qualifiche, setQualifiche] = useState<QualificaConData[]>(() => qualificheForDisplay(persona))
  useEffect(() => {
    setCognome(persona?.cognome ?? "")
    setNome(persona?.nome ?? "")
    setUsername(persona?.username ?? "")
    setRuolo(persona?.ruolo ?? "user")
    setLivelloIds(livelloIdsFromPersona(persona))
    setContratto(isoDateInput(persona?.contratto))
    setIbanEdit(persona?.iban ?? "")
    setEmailEdit(persona?.email ?? "")
    setPassword("")
    setQualifiche(qualificheForDisplay(persona))
  }, [persona])
  const [filtroMansione, setFiltroMansione] = useState("")
  useEffect(() => {
    setFiltroMansione("")
  }, [persona?.id, mese])
  const saveMut = useMutation({
    mutationFn: () => {
      if (!persona || !onSavePersonale) throw new Error("Salvataggio non disponibile")
      if (!nome.trim()) throw new Error("Nome obbligatorio")
      return onSavePersonale(persona.id, {
        cognome: cognome.trim(),
        nome: nome.trim(),
        username: username.trim(),
        ruolo,
        livelloIds,
        livelloId: livelloIds[0] ?? "",
        contratto,
        iban: ibanEdit.trim(),
        email: emailEdit.trim(),
        ...(allowAdminRole
          ? { qualifiche, visitaMedica: visitaMedicaFromQualifiche(qualifiche) }
          : {}),
        ...(password.trim() ? { password: password.trim() } : {}),
      })
    },
    onSuccess: () => {
      setPassword("")
      onDone?.()
    },
    onError: (e: Error) => onError?.(e.message),
  })
  const reparti = livelli ?? []
  const mansioniMese = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of lezioni) {
      if (!t.livelloId || map.has(t.livelloId)) continue
      map.set(t.livelloId, t.livelloNome || "—")
    }
    return [...map.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
  }, [lezioni])
  const lezioniFiltrate = useMemo(
    () => (filtroMansione ? lezioni.filter((t) => t.livelloId === filtroMansione) : lezioni),
    [lezioni, filtroMansione]
  )
  const totFiltrato = useMemo(
    () => ({
      n: lezioniFiltrate.length,
      quantita: lezioniFiltrate.reduce((s, t) => s + t.quantita, 0),
      importo: lezioniFiltrate.reduce((s, t) => s + t.importo, 0),
    }),
    [lezioniFiltrate]
  )
  const filtroMansioneEl =
    mansioniMese.length > 0 ? (
      <label className="grid min-w-[16rem] gap-1 text-xs text-zinc-400">
        Filtro mansione
        <select value={filtroMansione} onChange={(e) => setFiltroMansione(e.target.value)} className={inputCls}>
          <option value="">Tutte le mansioni</option>
          {mansioniMese.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </label>
    ) : null
  return (
    <div className="max-w-4xl space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">
            {editable ? "Modifica utente" : "Dettaglio mese"} · {meseLabel(mese)}
          </h2>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{row.personaleNome}</p>
          {soloTurni ? (
            <p className="mt-1 text-sm text-zinc-400">
              Tot. progr. {year}: {eur(row.totAnno ?? row.importo)} · Importo mese: {eur(row.importo)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {filtroMansioneEl}
          <button type="button" className={btnGhost} onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
      {!soloTurni && (editable ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            saveMut.mutate()
          }}
        >
          <label className="grid gap-1 text-xs text-zinc-500">
            Cognome
            <input value={cognome} onChange={(e) => setCognome(e.target.value)} className={inputCls} />
          </label>
          <label className="grid gap-1 text-xs text-zinc-500">
            Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} required />
          </label>
          <label className="grid gap-1 text-xs text-zinc-500">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} autoComplete="off" />
          </label>
          <label className="grid gap-1 text-xs text-zinc-500">
            Ruolo
            <select value={ruolo} onChange={(e) => setRuolo(e.target.value as LpagaRuolo)} className={inputCls}>
              <option value="user">Istruttore</option>
              <option value="manager">Responsabile</option>
              {allowAdminRole && <option value="admin">Amministratore</option>}
            </select>
          </label>
          <div className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
            <span>Reparti / sotto-reparti</span>
            <p className="text-[11px] text-zinc-600">
              Spunta il reparto per tutte le mansioni, poi deseleziona i sotto-reparti da escludere.
            </p>
            <LibroPagaRepartiMulti reparti={reparti} value={livelloIds} onChange={setLivelloIds} />
          </div>
          <label className="grid gap-1 text-xs text-zinc-500">
            Scad. contratto
            <input type="date" value={contratto} onChange={(e) => setContratto(e.target.value)} className={inputCls} />
          </label>
          <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
            IBAN
            <input value={ibanEdit} onChange={(e) => setIbanEdit(e.target.value)} className={inputCls} autoComplete="off" />
          </label>
          <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
            Email di accesso libro paga
            <input
              type="email"
              value={emailEdit}
              onChange={(e) => setEmailEdit(e.target.value)}
              className={inputCls}
              autoComplete="email"
            />
          </label>
          <GestionaleAnagraficaBlock persona={persona} />
          <QualificheCorsiFields
            value={qualifiche}
            onChange={allowAdminRole ? setQualifiche : undefined}
            inputCls={inputCls}
            readOnly={!allowAdminRole}
          />
          <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
            Nuova password (vuoto = invariata)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              autoComplete="new-password"
              minLength={6}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className={btnAmber} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvataggio…" : "Salva modifiche"}
            </button>
            <span className="text-sm text-zinc-400">Tot. progr. {year}: {eur(row.totAnno ?? row.importo)}</span>
            <span className="text-sm text-zinc-400">Importo mese: {eur(row.importo)}</span>
          </div>
        </form>
      ) : (
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Cognome</dt>
          <dd>{persona?.cognome ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Nome</dt>
          <dd>{persona?.nome ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Username</dt>
          <dd className="font-mono text-xs text-zinc-400">{persona?.username ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Ruolo</dt>
          <dd>{ruoloLabel(persona?.ruolo ?? "user")}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Tot. progr. {year}</dt>
          <dd>{eur(row.totAnno ?? row.importo)}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Scad. contratto</dt>
          <dd>{fmtDateIt(persona?.contratto)}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">IBAN</dt>
          <dd className="font-mono text-xs">{iban?.trim() ? iban : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Email accesso</dt>
          <dd className="text-xs">{persona?.email?.trim() ? persona.email : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:justify-start">
          <dt className="text-zinc-500">Importo mese</dt>
          <dd>{eur(row.importo)}</dd>
        </div>
        <div className="sm:col-span-2">
          <GestionaleAnagraficaBlock persona={persona} />
        </div>
        <QualificheCorsiFields value={qualificheForDisplay(persona)} readOnly />
      </dl>
      ))}
      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-300">Lezioni / turni del mese</h3>
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Mansione</th>
                <th className="px-3 py-2">Creazione</th>
                <th className="px-3 py-2 text-right">Valore</th>
                <th className="px-3 py-2 text-right">Importo</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {lezioniFiltrate.map((t) => (
                <tr key={t.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateIt(t.giorno)}</td>
                  <td className="px-3 py-2">{t.livelloNome}</td>
                  <td className="px-3 py-2 text-zinc-400">{fmtDateIt(t.createdAt)}</td>
                  <td className="px-3 py-2 text-right">{t.quantita}</td>
                  <td className="px-3 py-2 text-right">{eur(t.importo)}</td>
                  <td className="px-3 py-2 text-zinc-400">{t.note ?? ""}</td>
                </tr>
              ))}
              {!lezioniFiltrate.length && (
                <tr>
                  <td className="px-3 py-6 text-zinc-500" colSpan={6}>
                    {lezioni.length
                      ? "Nessuna lezione per la mansione selezionata."
                      : "Nessuna lezione in questo mese."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {lezioniFiltrate.length > 0 && (
          <p className="mt-2 text-xs text-zinc-400">
            {totFiltrato.n} turn{totFiltrato.n === 1 ? "o" : "i"}
            {filtroMansione ? (totFiltrato.n === 1 ? " filtrato" : " filtrati") : ""} · valore{" "}
            {totFiltrato.quantita} · {eur(totFiltrato.importo)}
          </p>
        )}
      </div>
    </div>
  )
}

function ModificaMese({
  row,
  mese,
  onClose,
  onSave,
  onError,
  onDone,
}: {
  row: LpagaMensilitaRow
  mese: string
  onClose: () => void
  onSave: (body: { personaleId: string; mese: string; bonifico: number; nota?: string; chiuso: boolean }) => Promise<unknown>
  onError: (s: string) => void
  onDone: () => void
}) {
  const [bonifico, setBonifico] = useState(String(row.bonifico))
  const [nota, setNota] = useState(row.nota)
  const mut = useMutation({
    mutationFn: () =>
      onSave({
        personaleId: row.personaleId,
        mese,
        bonifico: Number(String(bonifico).replace(",", ".")),
        nota,
        chiuso: row.chiuso,
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  })
  return (
    <form
      className="max-w-xl space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        mut.mutate()
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Correzione mensilità</h2>
        <button type="button" className={btnGhost} onClick={onClose}>
          Annulla
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-zinc-400">
          Nominativo
          <input value={row.personaleNome} disabled className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Data
          <input value={meseLabel(mese)} disabled className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Importo totale
          <input value={eur(row.importo)} disabled className={inputCls} />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Importo bonifico
          <input value={bonifico} onChange={(e) => setBonifico(e.target.value)} className={inputCls} required />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400 sm:col-span-2">
          Note correzione
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={40}
            placeholder="Info correzione"
            className={inputCls}
          />
        </label>
      </div>
      <button type="submit" className={btnAmber} disabled={mut.isPending}>
        {mut.isPending ? "Salvataggio…" : "Salva"}
      </button>
    </form>
  )
}
