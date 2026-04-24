import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { scuolaNuotoApi, type ScuolaNuotoCorso } from "@/api/scuolaNuoto"
import { prenotazioniApi, type AccessoUtenteRow } from "@/api/prenotazioni"
import { useAuth } from "@/contexts/AuthContext"
import { Navigate } from "react-router-dom"

type WeekdayKey = "lun" | "mar" | "mer" | "gio" | "ven" | "sab" | "dom"

function weekdayKeyIt(d: Date): WeekdayKey {
  const map: WeekdayKey[] = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"]
  return map[d.getDay()] ?? "lun"
}

function fmtItDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim())
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

function isoTodayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function digitsPhone(s: unknown): string {
  return String(s ?? "")
    .replace(/[^\d+]/g, "")
    .replace(/^00/, "+")
    .trim()
}

function telHref(num: unknown): string | null {
  const d = digitsPhone(num)
  if (!d) return null
  return `tel:${d}`
}

function waHref(num: unknown): string | null {
  const d = digitsPhone(num).replace(/^\+/, "")
  if (!d) return null
  return `https://wa.me/${d}`
}

function normalizeText(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
}

function accessEmailKey(raw: any): string | null {
  const e = String(raw?.Email ?? raw?.email ?? raw?.Mail ?? raw?.E_mail ?? raw?.["E-mail"] ?? "").trim().toLowerCase()
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `email:${e}` : null
}

function accessNameKey(nome: unknown, cognome: unknown): string | null {
  // Allineata a `normalizeParticipantKey` lato API: "Nome Cognome"
  const n = normalizeText(`${String(nome ?? "").trim()} ${String(cognome ?? "").trim()}`.trim())
  return n ? `name:${n}` : null
}

function accessTelKey(raw: any): string | null {
  const tel = String(raw?.SMS ?? raw?.Sms ?? raw?.sms ?? raw?.Cellulare ?? raw?.Telefono ?? raw?.Tel ?? raw?.TelefonoCellulare ?? "").trim()
  return tel ? `tel:${tel}` : null
}

function parseAccessDateLocal(val: unknown): Date | null {
  if (val == null) return null
  const s = String(val).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})$/.exec(s)
  if (m) {
    const yyyy = Number(m[1])
    const mm = Number(m[2])
    const dd = Number(m[3])
    const hh = Number(m[4] ?? 0)
    const mi = Number(m[5] ?? 0)
    const ss = Number(m[6] ?? 0)
    const frac = String(m[7] ?? "0")
    const ms = Number(frac.slice(0, 3).padEnd(3, "0"))
    const d = new Date(yyyy, mm - 1, dd, hh, mi, ss, ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function localYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function buildPresentKeySet(rows: AccessoUtenteRow[], dayIso: string): Set<string> {
  const set = new Set<string>()
  for (const r of rows) {
    const raw = (r.raw ?? {}) as any
    const id = String(r.idUtente ?? raw?.IDUtente ?? raw?.IdUtente ?? raw?.UtenteId ?? "").trim()
    const dtIn = parseAccessDateLocal(raw?.AccessiDataOra ?? r.dataEntrata ?? raw?.AccessiData ?? raw?.AccessiOra)
    if (!dtIn || localYmd(dtIn) !== dayIso) continue
    if (id) set.add(`id:${id}`)
    const ek = accessEmailKey(raw)
    if (ek) set.add(ek)
    const nk = accessNameKey(r.nome, r.cognome)
    if (nk) {
      set.add(nk)
      const telKey = accessTelKey(raw)
      if (telKey) {
        set.add(telKey)
        set.add(`name_tel:${nk.slice("name:".length)}:${telKey.slice("tel:".length)}`)
      }
    } else {
      const telKey = accessTelKey(raw)
      if (telKey) set.add(telKey)
    }
  }
  return set
}

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

  const [date, setDate] = useState<string>(() => isoTodayLocal())
  const dayKey = useMemo<WeekdayKey>(() => weekdayKeyIt(new Date(`${date}T12:00:00`)), [date])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeChildKey, setActiveChildKey] = useState<string | null>(null)
  const [childNoteDraft, setChildNoteDraft] = useState<string>("")
  const [courseNoteDraft, setCourseNoteDraft] = useState<string>("")
  const [targetBaseKey, setTargetBaseKey] = useState<string>("")

  const q = useQuery({
    queryKey: ["scuola-nuoto", "today", dayKey, date],
    queryFn: () => scuolaNuotoApi.today({ day: dayKey, date }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const accessiQ = useQuery({
    queryKey: ["scuola-nuoto", "accessi", q.data?.today ?? date],
    queryFn: async () => {
      const dayIso = (q.data?.today ?? date) as string
      return prenotazioniApi.listAccessiRange({ from: dayIso, to: dayIso })
    },
    enabled: Boolean(q.data?.today),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  const presentKeys = useMemo(() => {
    return buildPresentKeySet(accessiQ.data?.rows ?? [], q.data?.today ?? date)
  }, [accessiQ.data, q.data?.today, date])

  const ovQ = useQuery({
    queryKey: ["scuola-nuoto", "overrides", dayKey],
    queryFn: () => scuolaNuotoApi.overrides(dayKey),
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

  const coursePresentCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of derivedCorsi) {
      let n = 0
      for (const u of c.utenti) if (presentKeys.has(u.key)) n += 1
      m.set(c.key, n)
    }
    return m
  }, [derivedCorsi, presentKeys])

  const selected = useMemo(() => {
    if (!derivedCorsi.length) return null
    const direct = selectedKey ? derivedCorsi.find((c) => c.key === selectedKey) : null
    return direct ?? derivedCorsi[0] ?? null
  }, [derivedCorsi, selectedKey])

  const availableTargets = useMemo(() => {
    const m = new Map<string, { baseKey: string; label: string }>()
    for (const c of corsi) {
      if (!c.baseKey) continue
      if (m.has(c.baseKey)) continue
      m.set(c.baseKey, { baseKey: c.baseKey, label: corsoTitle(c) })
    }
    return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [corsi])

  const activeChild = useMemo(() => {
    if (!selected || !activeChildKey) return null
    return selected.utenti.find((u) => u.key === activeChildKey) ?? null
  }, [selected, activeChildKey])

  const saveCourseNoteM = useMutation({
    mutationFn: async () => {
      if (!selected) return
      await scuolaNuotoApi.setCourseNote(selected.baseKey, courseNoteDraft, dayKey)
    },
    onSuccess: () => ovQ.refetch(),
  })
  const saveChildNoteM = useMutation({
    mutationFn: async () => {
      if (!selected || !activeChild) return
      await scuolaNuotoApi.setChildNote(activeChild.key, selected.baseKey, childNoteDraft, dayKey)
    },
    onSuccess: () => ovQ.refetch(),
  })
  const setLevelM = useMutation({
    mutationFn: async (input: { liv: string; baseKey: string }) => {
      if (!activeChild) return
      await scuolaNuotoApi.setLevelOverride(activeChild.key, input.baseKey, input.liv, dayKey)
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
                  {q.data.weekday} · {fmtItDate(q.data.today)} · corsi: {derivedCorsi.length} (righe: {q.data.countMatched}/{q.data.countRows})
                </>
              ) : (
                "Corsi del giorno della settimana (per periodo)"
              )}
            </p>
          </div>
          <div className="mt-3 flex w-full flex-col gap-2 sm:mt-0 sm:w-auto sm:flex-row sm:items-end">
            <label className="text-xs text-zinc-500">
              Data
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              />
            </label>
            <button
              type="button"
              onClick={() => setDate(isoTodayLocal())}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Oggi
            </button>
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
              const presentCount = coursePresentCount.get(c.key) ?? 0
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
                    {typeof c.maxPartecipanti === "number" ? (
                      <>
                        {" "}
                        / <span className="text-zinc-300">{c.maxPartecipanti}</span>
                      </>
                    ) : null}
                    {" "}
                    · Presenti: <span className="text-zinc-300">{presentCount}</span>
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
                    const present = presentKeys.has(u.key)
                    return (
                      <tr
                        key={`${u.key}-${idx}`}
                        className={"border-t border-zinc-800 text-sm " + (active ? "bg-amber-500/10" : "")}
                        onClick={() => setActiveChildKey(u.key)}
                        style={{ cursor: "pointer" }}
                        title="Clicca per note / livello"
                      >
                        <td className="px-3 py-2">
                          <span
                            className={
                              "mr-2 inline-block h-2.5 w-2.5 rounded-full " +
                              (present ? "bg-emerald-400" : "bg-zinc-500")
                            }
                            title={present ? "Presente (entrata registrata)" : "Assente"}
                          />
                          {u.nome ?? "—"}
                        </td>
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
              {activeChild ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {telHref(activeChild.cellulare) ? (
                    <a
                      href={telHref(activeChild.cellulare)!}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      Chiama
                    </a>
                  ) : null}
                  {waHref(activeChild.cellulare) ? (
                    <a
                      href={waHref(activeChild.cellulare)!}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      Messaggia
                    </a>
                  ) : null}
                </div>
              ) : null}
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
                <div className="mt-1 text-xs text-zinc-500">Seleziona il corso/orario di destinazione.</div>
                <select
                  className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                  disabled={!activeChild}
                  value={targetBaseKey || selected?.baseKey || ""}
                  onChange={(e) => setTargetBaseKey(e.target.value)}
                >
                  <option value="">(scegli corso/orario)</option>
                  {availableTargets.map((t) => (
                    <option key={t.baseKey} value={t.baseKey}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <select
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                  disabled={!activeChild}
                  onChange={(e) => {
                    const baseKey = (targetBaseKey || selected?.baseKey || "").trim()
                    if (!baseKey) return
                    setLevelM.mutate({ liv: e.target.value, baseKey })
                  }}
                  value={
                    activeChild
                      ? overrides.levelOverrides?.[`${activeChild.key}::${(targetBaseKey || selected?.baseKey || "").trim()}`] ?? ""
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

