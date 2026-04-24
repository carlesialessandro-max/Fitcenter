import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { scuolaNuotoApi, type ScuolaNuotoCorso } from "@/api/scuolaNuoto"
import { useAuth } from "@/contexts/AuthContext"
import { Navigate } from "react-router-dom"

type WeekdayKey = "lun" | "mar" | "mer" | "gio" | "ven" | "sab" | "dom"

function corsoTitle(c: ScuolaNuotoCorso): string {
  const orario = c.oraInizio && c.oraFine ? `${c.oraInizio}-${c.oraFine}` : c.oraInizio ? c.oraInizio : ""
  const parts = [
    orario,
    c.corso,
    c.livello ? `Livello ${c.livello}` : null,
    c.istruttore ? `Istr: ${c.istruttore}` : null,
    c.corsia ? `Corsia ${c.corsia}` : null,
    c.servizio,
    c.vasca,
  ].filter(Boolean)
  return parts.join(" · ")
}

export function ScuolaNuoto() {
  const { role } = useAuth()
  if (role === "firme") return <Navigate to="/firma-cassa" replace />
  if (role !== "admin" && role !== "scuola_nuoto") return <Navigate to="/" replace />

  const [day, setDay] = useState<WeekdayKey>("gio")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeChildKey, setActiveChildKey] = useState<string | null>(null)
  const [childNoteDraft, setChildNoteDraft] = useState<string>("")
  const [courseNoteDraft, setCourseNoteDraft] = useState<string>("")

  const q = useQuery({
    queryKey: ["scuola-nuoto", "today", day],
    queryFn: () => scuolaNuotoApi.today(day),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const ovQ = useQuery({
    queryKey: ["scuola-nuoto", "overrides"],
    queryFn: () => scuolaNuotoApi.overrides(),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })

  const overrides: { courseNotes: Record<string, string>; childNotes: Record<string, string>; levelOverrides: Record<string, string> } =
    ovQ.data ?? { courseNotes: {}, childNotes: {}, levelOverrides: {} }
  const corsi = q.data?.corsi ?? []

  const levels = useMemo(() => {
    const s = new Set<string>()
    for (const c of corsi) if (c.livello) s.add(String(c.livello))
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [corsi])

  // Deriva corsi applicando override livello per singolo bimbo.
  const derivedCorsi = useMemo(() => {
    const by = new Map<string, ScuolaNuotoCorso>()
    for (const c of corsi) {
      for (const u of c.utenti) {
        const ov = overrides.levelOverrides?.[`${u.key}::${c.baseKey}`]
        const livelloEff = String(ov ?? c.livello ?? "").trim() || null
        const k = `${c.baseKey}::${livelloEff ?? ""}`
        const existing = by.get(k)
        if (!existing) {
          by.set(k, { ...c, key: k, livello: livelloEff, utenti: [u] })
        } else {
          existing.utenti.push(u)
        }
      }
    }
    return Array.from(by.values()).sort((a, b) => {
      const la = String(a.livello ?? "")
      const lb = String(b.livello ?? "")
      if (la !== lb) return la.localeCompare(lb)
      const ta = String(a.oraInizio ?? "99:99").replace(":", "")
      const tb = String(b.oraInizio ?? "99:99").replace(":", "")
      if (ta !== tb) return ta.localeCompare(tb)
      return a.corso.localeCompare(b.corso)
    })
  }, [corsi, overrides.levelOverrides])

  const selected = useMemo(() => {
    if (!derivedCorsi.length) return null
    const direct = selectedKey ? derivedCorsi.find((c) => c.key === selectedKey) : null
    return direct ?? derivedCorsi[0] ?? null
  }, [derivedCorsi, selectedKey])

  const activeChild = useMemo(() => {
    if (!selected || !activeChildKey) return null
    return selected.utenti.find((u) => u.key === activeChildKey) ?? null
  }, [selected, activeChildKey])

  const saveCourseNoteM = useMutation({
    mutationFn: async () => {
      if (!selected) return
      await scuolaNuotoApi.setCourseNote(selected.baseKey, courseNoteDraft)
    },
    onSuccess: () => ovQ.refetch(),
  })
  const saveChildNoteM = useMutation({
    mutationFn: async () => {
      if (!selected || !activeChild) return
      await scuolaNuotoApi.setChildNote(activeChild.key, selected.baseKey, childNoteDraft)
    },
    onSuccess: () => ovQ.refetch(),
  })
  const setLevelM = useMutation({
    mutationFn: async (liv: string) => {
      if (!selected || !activeChild) return
      await scuolaNuotoApi.setLevelOverride(activeChild.key, selected.baseKey, liv)
    },
    onSuccess: () => {
      ovQ.refetch()
      q.refetch()
    },
  })

  // Sync drafts on selection changes
  useMemo(() => {
    if (selected) {
      setCourseNoteDraft(overrides.courseNotes?.[selected.baseKey] ?? "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.baseKey, overrides.courseNotes])

  useMemo(() => {
    if (selected && activeChild) {
      setChildNoteDraft(overrides.childNotes?.[`${activeChild.key}::${selected.baseKey}`] ?? "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.baseKey, activeChild?.key, overrides.childNotes])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Scuola Nuoto</h2>
            <p className="text-sm text-zinc-500">
              {q.data ? (
                <>
                  {q.data.weekday} · {q.data.today} · corsi: {derivedCorsi.length} (righe: {q.data.countMatched}/{q.data.countRows})
                </>
              ) : (
                "Corsi del giorno della settimana (per periodo)"
              )}
            </p>
          </div>
          <div className="mt-3 flex w-full flex-col gap-2 sm:mt-0 sm:w-auto sm:flex-row sm:items-end">
            <label className="text-xs text-zinc-500">
              Giorno
              <select
                value={day}
                onChange={(e) => setDay(e.target.value as WeekdayKey)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="lun">Lun</option>
                <option value="mar">Mar</option>
                <option value="mer">Mer</option>
                <option value="gio">Gio</option>
                <option value="ven">Ven</option>
                <option value="sab">Sab</option>
                <option value="dom">Dom</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                ovQ.refetch()
                q.refetch()
              }}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Aggiorna
            </button>
          </div>
        </div>
        {q.isError ? (
          <div className="mt-3 rounded-lg border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-200">
            Errore nel caricamento corsi.
          </div>
        ) : null}
        {q.isLoading ? <div className="mt-3 text-sm text-zinc-400">Caricamento...</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_320px]">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="mb-2 text-xs font-medium text-zinc-500">Corsi</div>
          <div className="flex flex-col gap-1">
            {derivedCorsi.length === 0 && !q.isLoading ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-500">Nessun corso trovato.</div>
            ) : null}
            {derivedCorsi.map((c) => {
              const active = selected?.key === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setSelectedKey(c.key)}
                  className={
                    "w-full rounded-lg border px-3 py-2 text-left transition-colors " +
                    (active
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-800/60")
                  }
                >
                  <div className="truncate text-sm font-medium">{corsoTitle(c)}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    Iscritti: <span className="text-zinc-300">{c.utenti.length}</span>
                    {c.periodo ? <span className="ml-2">· {c.periodo}</span> : null}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-medium text-zinc-500">Partecipanti</div>
              <div className="text-sm font-semibold text-zinc-100">{selected ? corsoTitle(selected) : "—"}</div>
            </div>
            <div className="text-xs text-zinc-500">
              Totale: <span className="text-zinc-200">{selected?.utenti.length ?? 0}</span>
            </div>
          </div>

          {selected?.utenti?.length ? (
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <table className="w-full table-auto">
                <thead className="bg-zinc-950/40">
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="px-3 py-2">Nome</th>
                    <th className="px-3 py-2">Cognome</th>
                    <th className="px-3 py-2">Età</th>
                    <th className="px-3 py-2">Cellulare</th>
                    <th className="px-3 py-2">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.utenti.map((u, idx) => {
                    const active = u.key === activeChildKey
                    return (
                      <tr
                        key={`${u.key}-${idx}`}
                        className={"border-t border-zinc-800 text-sm " + (active ? "bg-amber-500/10" : "")}
                        onClick={() => setActiveChildKey(u.key)}
                        style={{ cursor: "pointer" }}
                        title="Clicca per note / livello"
                      >
                        <td className="px-3 py-2">{u.nome ?? "—"}</td>
                        <td className="px-3 py-2">{u.cognome ?? "—"}</td>
                        <td className="px-3 py-2">{u.eta ?? "—"}</td>
                        <td className="px-3 py-2">{u.cellulare ?? "—"}</td>
                        <td className="px-3 py-2">{u.email ?? "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-500">
              Seleziona un corso per vedere gli utenti.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="mb-2 text-xs font-medium text-zinc-500">Note / Livello</div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="text-sm font-semibold text-zinc-100">{selected ? corsoTitle(selected) : "—"}</div>
            <div className="mt-2">
              <div className="text-xs font-medium text-zinc-500">Note corso</div>
              <textarea
                value={courseNoteDraft}
                onChange={(e) => setCourseNoteDraft(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-200"
                rows={4}
                placeholder="Scrivi note per questo corso..."
              />
              <button
                type="button"
                onClick={() => saveCourseNoteM.mutate()}
                className="mt-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                disabled={!selected}
              >
                Salva note corso
              </button>
            </div>

            <div className="mt-4">
              <div className="text-xs font-medium text-zinc-500">Bambino selezionato</div>
              <div className="mt-1 text-sm text-zinc-200">
                {activeChild ? `${activeChild.nome ?? ""} ${activeChild.cognome ?? ""}`.trim() || "—" : "Clicca un bambino nella lista"}
              </div>
              <div className="mt-2">
                <div className="text-xs font-medium text-zinc-500">Note bambino (per questo corso)</div>
                <textarea
                  value={childNoteDraft}
                  onChange={(e) => setChildNoteDraft(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-200"
                  rows={4}
                  placeholder="Scrivi note per questo bambino..."
                  disabled={!activeChild || !selected}
                />
                <button
                  type="button"
                  onClick={() => saveChildNoteM.mutate()}
                  className="mt-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                  disabled={!activeChild || !selected}
                >
                  Salva note bambino
                </button>
              </div>

              <div className="mt-3">
                <div className="text-xs font-medium text-zinc-500">Sposta di livello</div>
                <select
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                  disabled={!activeChild || !selected}
                  onChange={(e) => setLevelM.mutate(e.target.value)}
                  value={
                    activeChild && selected
                      ? overrides.levelOverrides?.[`${activeChild.key}::${selected.baseKey}`] ?? (selected.livello ?? "")
                      : ""
                  }
                >
                  <option value="">(nessun override)</option>
                  {levels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

