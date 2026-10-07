import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { authApi, type Role, type User } from "@/api/auth"
import { useAuth } from "@/contexts/AuthContext"

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  operatore: "Operatore",
  firme: "Firme / reception",
  corsi: "Corsi",
  istruttore: "Istruttore",
  campus: "Campus",
  scuola_nuoto: "Scuola nuoto",
  bagnini: "Bagnini",
  danza: "Danza",
  crm: "CRM vendita",
  calendari: "Calendari (solo lettura)",
}

const emptyForm = {
  username: "",
  nome: "",
  password: "",
  role: "operatore" as Role,
  consulenteNome: "",
  email: "",
  leadFilter: false,
  vedeTotaliCentro: false,
  pages: [] as string[],
}

type FormState = typeof emptyForm

function inputClass() {
  return "rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
}

export function Utenti() {
  const { role, user: me } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const usersQ = useQuery({
    queryKey: ["auth-users"],
    queryFn: () => authApi.listUsers(),
    enabled: role === "admin",
  })
  const pagesQ = useQuery({
    queryKey: ["auth-pages"],
    queryFn: () => authApi.pagesCatalog(),
    enabled: role === "admin",
    staleTime: 60_000,
  })

  const rolePages = pagesQ.data?.roleDefaults[form.role] ?? []
  const catalogByPath = useMemo(() => {
    const m = new Map<string, { label: string; group: string }>()
    for (const p of pagesQ.data?.catalog ?? []) m.set(p.path, p)
    return m
  }, [pagesQ.data?.catalog])

  const groupedPages = useMemo(() => {
    const groups = new Map<string, { path: string; label: string }[]>()
    for (const path of rolePages) {
      const meta = catalogByPath.get(path)
      const group = meta?.group ?? "Altri"
      const list = groups.get(group) ?? []
      list.push({ path, label: meta?.label ?? path })
      groups.set(group, list)
    }
    return [...groups.entries()]
  }, [rolePages, catalogByPath])

  const createMut = useMutation({
    mutationFn: () =>
      authApi.createUser({
        username: form.username.trim(),
        password: form.password,
        nome: form.nome.trim(),
        role: form.role,
        consulenteNome: form.consulenteNome.trim() || null,
        email: form.email.trim() || null,
        leadFilter: form.leadFilter ? "bambini" : "",
        vedeTotaliCentro: form.role === "operatore" ? form.vedeTotaliCentro : false,
        pages: form.pages,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-users"] })
      setCreating(false)
      setForm(emptyForm)
      setError("")
    },
    onError: (e: Error) => setError(e.message),
  })

  const updateMut = useMutation({
    mutationFn: async () => {
      await authApi.updateUser(editing!, {
        nome: form.nome.trim(),
        role: form.role,
        consulenteNome: form.consulenteNome.trim() || null,
        email: form.email.trim() || null,
        leadFilter: form.leadFilter ? "bambini" : "",
        vedeTotaliCentro: form.role === "operatore" ? form.vedeTotaliCentro : false,
        pages: form.pages,
      })
      if (form.password.trim()) {
        await authApi.setPassword(editing!, form.password)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-users"] })
      setEditing(null)
      setForm(emptyForm)
      setError("")
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (username: string) => authApi.deleteUser(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-users"] })
      setConfirmDelete(null)
      if (editing === confirmDelete) {
        setEditing(null)
        setForm(emptyForm)
      }
    },
    onError: (e: Error) => setError(e.message),
  })

  function startCreate() {
    setEditing(null)
    setCreating(true)
    setError("")
    const defaults = pagesQ.data?.roleDefaults.operatore ?? []
    setForm({ ...emptyForm, pages: [...defaults] })
  }

  function startEdit(u: User) {
    setCreating(false)
    setEditing(u.username)
    setError("")
    const defaults = pagesQ.data?.roleDefaults[u.role] ?? []
    setForm({
      username: u.username,
      nome: u.nome,
      password: "",
      role: u.role,
      consulenteNome: u.consulenteNome ?? "",
      email: u.email ?? "",
      leadFilter: u.leadFilter === "bambini",
      vedeTotaliCentro: u.vedeTotaliCentro === true,
      pages: u.pages?.length ? [...u.pages] : [...defaults],
    })
  }

  function togglePage(path: string) {
    setForm((prev) => {
      const has = prev.pages.includes(path)
      return { ...prev, pages: has ? prev.pages.filter((p) => p !== path) : [...prev.pages, path] }
    })
  }

  if (role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Utenti e accessi</h2>
          <p className="mt-2 text-sm text-zinc-500">Pagina disponibile solo per amministratori.</p>
          <Link to="/" className="mt-4 inline-block text-sm text-amber-400 hover:underline">
            Torna alla dashboard
          </Link>
        </div>
      </div>
    )
  }

  const users = usersQ.data?.users ?? []
  const busy = createMut.isPending || updateMut.isPending || deleteMut.isPending
  const showForm = creating || !!editing

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Utenti e accessi</h1>
          <p className="text-sm text-zinc-500">
            Crea e elimina login, imposta le password e scegli quali pagine vede ciascuno. Il ruolo
            determina anche i permessi sulle API.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
        >
          Nuovo utente
        </button>
      </div>

      {error ? (
        <p className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {usersQ.isLoading ? <p className="text-sm text-zinc-500">Caricamento…</p> : null}
      {usersQ.error ? (
        <p className="text-sm text-red-400">{(usersQ.error as Error).message}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Username</th>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Ruolo</th>
              <th className="px-3 py-2 font-medium">Pagine</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const defaults = pagesQ.data?.roleDefaults[u.role] ?? []
              const n = u.role === "admin" ? "tutte" : u.pages?.length ? `${u.pages.length}` : `${defaults.length}`
              return (
                <tr key={u.username} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-3 py-2 font-mono text-xs">{u.username}</td>
                  <td className="px-3 py-2">{u.nome}</td>
                  <td className="px-3 py-2">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-3 py-2 text-zinc-400">{n}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="mr-2 text-amber-400 hover:underline"
                      onClick={() => startEdit(u)}
                    >
                      Modifica
                    </button>
                    {u.username !== me?.username ? (
                      confirmDelete === u.username ? (
                        <span className="text-xs">
                          <button
                            type="button"
                            className="mr-2 text-red-400 hover:underline"
                            disabled={busy}
                            onClick={() => deleteMut.mutate(u.username)}
                          >
                            Conferma
                          </button>
                          <button type="button" className="text-zinc-500 hover:underline" onClick={() => setConfirmDelete(null)}>
                            Annulla
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-red-400 hover:underline"
                          onClick={() => setConfirmDelete(u.username)}
                        >
                          Elimina
                        </button>
                      )
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showForm ? (
        <form
          className="mt-6 max-w-3xl space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError("")
            if (creating) createMut.mutate()
            else updateMut.mutate()
          }}
        >
          <h2 className="text-lg font-medium text-zinc-100">
            {creating ? "Nuovo utente" : `Modifica ${editing}`}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Username
              <input
                className={inputClass()}
                value={form.username}
                disabled={!creating}
                autoComplete="off"
                onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Nome
              <input
                className={inputClass()}
                value={form.nome}
                onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              {creating ? "Password" : "Nuova password (vuoto = invariata)"}
              <input
                className={inputClass()}
                type="password"
                value={form.password}
                autoComplete="new-password"
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                required={creating}
                minLength={creating ? 8 : undefined}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Ruolo
              <select
                className={inputClass()}
                value={form.role}
                onChange={(e) => {
                  const role = e.target.value as Role
                  const defaults = pagesQ.data?.roleDefaults[role] ?? []
                  setForm((p) => ({ ...p, role, pages: [...defaults] }))
                }}
              >
                {(pagesQ.data?.roles ?? (Object.keys(ROLE_LABEL) as Role[])).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Email (OTP login, opzionale)
              <input
                className={inputClass()}
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </label>
            {form.role === "operatore" ? (
              <label className="flex flex-col gap-1 text-sm text-zinc-400">
                Nome consulente (filtro dati)
                <input
                  className={inputClass()}
                  value={form.consulenteNome}
                  onChange={(e) => setForm((p) => ({ ...p, consulenteNome: e.target.value }))}
                  placeholder="es. Carmen Severino"
                />
              </label>
            ) : null}
          </div>

          {form.role === "operatore" ? (
            <label className="flex items-start gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.vedeTotaliCentro}
                onChange={(e) => setForm((p) => ({ ...p, vedeTotaliCentro: e.target.checked }))}
              />
              <span>
                Vede Incassi e Andamento vendite di tutto il centro
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Solo per questo login (non filtra per consulente). Carmen, Serena e Ombretta restano sul proprio nominativo.
                </span>
              </span>
            </label>
          ) : null}

          {form.role === "operatore" || form.role === "crm" ? (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.leadFilter}
                onChange={(e) => setForm((p) => ({ ...p, leadFilter: e.target.checked }))}
              />
              Solo lead bambini (CRM)
            </label>
          ) : null}

          <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-200">Pagine visibili</p>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-amber-400 hover:underline"
                    onClick={() => setForm((p) => ({ ...p, pages: [...rolePages] }))}
                  >
                    Tutte
                  </button>
                  <button
                    type="button"
                    className="text-zinc-400 hover:underline"
                    onClick={() => setForm((p) => ({ ...p, pages: [] }))}
                  >
                    Nessuna
                  </button>
                </div>
              </div>
              <p className="mb-3 text-xs text-zinc-500">
                Togli la spunta per nascondere una voce dal menu. Se il ruolo è amministratore, Incassi e Andamento
                restano i totali di tutto il centro.
                {form.role === "calendari"
                  ? " Per un solo calendario (es. solo reception) lascia spuntata solo quella pagina."
                  : ""}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {groupedPages.map(([group, items]) => (
                  <fieldset key={group} className="rounded-lg border border-zinc-800 p-3">
                    <legend className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {group}
                    </legend>
                    <div className="flex flex-col gap-1.5">
                      {items.map((item) => (
                        <label key={item.path} className="flex items-center gap-2 text-sm text-zinc-300">
                          <input
                            type="checkbox"
                            checked={form.pages.includes(item.path)}
                            onChange={() => togglePage(item.path)}
                          />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || form.pages.length === 0}
              className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? "Salvataggio…" : "Salva"}
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              onClick={() => {
                setCreating(false)
                setEditing(null)
                setForm(emptyForm)
                setError("")
              }}
            >
              Annulla
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
