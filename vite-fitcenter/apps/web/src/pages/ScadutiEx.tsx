import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import * as XLSX from "xlsx"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import type { AttiviContatto, AttiviProdotto } from "@/types/gestionale"

type SegmentoFiltro = "tutti" | "adulti" | "bambini"
type SessoFiltro = "tutti" | "M" | "F"
type Leaf = { key: string; gruppo: string; piano: string; n: number }

function localIsoDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function toggleSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function isStaffOrDanza(s: string): boolean {
  const n = s.toUpperCase()
  return n.includes("STAFF") || n.includes("DANZA")
}

function prodottiDi(c: AttiviContatto): AttiviProdotto[] {
  if (c.prodotti?.length) return c.prodotti
  return [{ macro: c.macro ?? "", categoria: c.categoria, piano: c.piano || c.categoria }]
}

function foldTesto(s: string): string {
  return s
    .toLowerCase()
    .replace(/h\s*2\s*0/g, "h2o")
    .replace(/h\s*2\s*o/g, "h2o")
}

function normPiano(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
}

function gruppoDi(p: AttiviProdotto): string {
  const macro = (p.macro ?? "").trim()
  const cat = (p.categoria ?? "").trim()
  const piano = (p.piano ?? "").trim()
  if (macro && /PACCHETT/i.test(macro) && !isStaffOrDanza(macro)) return macro
  if (cat && /PACCHETT/i.test(cat) && !isStaffOrDanza(cat)) return cat
  return cat || macro || piano || "Altro"
}

function prodottoMatchQ(p: AttiviProdotto, q: string): boolean {
  if (!q) return true
  const ql = foldTesto(q)
  return foldTesto(p.piano).includes(ql) || foldTesto(p.categoria).includes(ql) || foldTesto(p.macro ?? "").includes(ql)
}

function csvEscape(s: string): string {
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function listaRows(rows: AttiviContatto[]): string[][] {
  return rows.map((r) => [
    r.cognome ?? "",
    r.nomeProprio || r.nome,
    r.email ?? "",
    r.telefono ?? "",
  ])
}

function downloadCsv(rows: AttiviContatto[], asOf: string) {
  const header = ["Cognome", "Nome", "Email", "Cellulare"]
  const lines = [header.map(csvEscape).join(";"), ...listaRows(rows).map((c) => c.map(csvEscape).join(";"))]
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `scaduti-ex-${asOf}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadXlsx(rows: AttiviContatto[], asOf: string) {
  const aoa = [["Cognome", "Nome", "Email", "Cellulare"], ...listaRows(rows)]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Scaduti")
  XLSX.writeFile(wb, `scaduti-ex-${asOf}.xlsx`)
}

function fmtData(iso?: string | null): string {
  if (!iso) return "—"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function ScadutiEx() {
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const asOfParam = searchParams.get("asOf")?.trim()
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : localIsoDate()
  const [segmento, setSegmento] = useState<SegmentoFiltro>("adulti")
  const [sessoFiltro, setSessoFiltro] = useState<SessoFiltro>("tutti")
  const [gruppo, setGruppo] = useState("")
  const [pianiSel, setPianiSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const { data, isLoading, error } = useQuery({
    queryKey: ["abbonamenti-scaduti-contatti", asOf],
    queryFn: () => dataApi.getAbbonamentiScadutiContatti({ asOf }),
    enabled: role === "admin",
    staleTime: 60_000,
  })

  const allRows = data?.rows ?? []
  const ql = q.trim().toLowerCase()

  const bySegmento = useMemo(() => {
    return allRows.filter((c) => {
      if (segmento === "adulti" && c.segmento !== "adulti") return false
      if (segmento === "bambini" && c.segmento !== "bambini") return false
      if (sessoFiltro === "M" && c.sesso !== "M") return false
      if (sessoFiltro === "F" && c.sesso !== "F") return false
      return !isStaffOrDanza(c.categoria) && !isStaffOrDanza(c.macro ?? "") && !isStaffOrDanza(c.piano)
    })
  }, [allRows, segmento, sessoFiltro])

  const foglie = useMemo(() => {
    const m = new Map<string, Leaf>()
    for (const c of bySegmento) {
      for (const p of prodottiDi(c)) {
        const piano = normPiano(p.piano)
        const cat = normPiano(p.categoria)
        const macro = normPiano(p.macro ?? "")
        if (!piano || isStaffOrDanza(piano) || isStaffOrDanza(cat) || isStaffOrDanza(macro)) continue
        const g = gruppoDi({ ...p, piano, categoria: cat, macro })
        const key = `${g}|||${piano}`
        const prev = m.get(key)
        if (prev) prev.n += 1
        else m.set(key, { key, gruppo: g, piano, n: 1 })
      }
    }
    return Array.from(m.values()).sort((a, b) => a.gruppo.localeCompare(b.gruppo, "it") || a.piano.localeCompare(b.piano, "it"))
  }, [bySegmento])

  const gruppi = useMemo(() => {
    return Array.from(new Set(foglie.map((f) => f.gruppo))).sort((a, b) => a.localeCompare(b, "it"))
  }, [foglie])

  const foglieGruppo = useMemo(() => {
    if (!gruppo) return foglie
    return foglie.filter((f) => f.gruppo === gruppo)
  }, [foglie, gruppo])

  const prodottiSelect = useMemo(() => {
    const seen = new Set<string>()
    const out: { piano: string; n: number }[] = []
    for (const f of foglieGruppo) {
      if (seen.has(f.piano)) {
        const hit = out.find((x) => x.piano === f.piano)
        if (hit) hit.n += f.n
        continue
      }
      seen.add(f.piano)
      out.push({ piano: f.piano, n: f.n })
    }
    return out.sort((a, b) => a.piano.localeCompare(b.piano, "it"))
  }, [foglieGruppo])

  useEffect(() => {
    if (gruppo && !gruppi.includes(gruppo)) setGruppo("")
  }, [gruppi, gruppo])

  useEffect(() => {
    setPianiSel((prev) => {
      if (!prev.size) return prev
      const ok = new Set(prodottiSelect.map((p) => p.piano))
      const next = new Set([...prev].filter((x) => ok.has(x)))
      if (next.size === prev.size) return prev
      return next
    })
  }, [prodottiSelect])

  const rows = useMemo(() => {
    return bySegmento.filter((c) => {
      const prods = prodottiDi(c)
      const haFiltroTipo = Boolean(gruppo || pianiSel.size)
      const prodOk = prods.some((p) => {
        if (isStaffOrDanza(p.piano) || isStaffOrDanza(p.categoria) || isStaffOrDanza(p.macro ?? "")) return false
        if (gruppo && gruppoDi(p) !== gruppo) return false
        if (pianiSel.size && !pianiSel.has(normPiano(p.piano))) return false
        if (!haFiltroTipo && ql && !prodottoMatchQ(p, ql)) return false
        return true
      })
      if (prodOk) return true
      if (ql && !haFiltroTipo) {
        const hay = foldTesto(`${c.nome} ${c.cognome ?? ""} ${c.email ?? ""}`)
        if (hay.includes(foldTesto(ql))) return true
      }
      return false
    })
  }, [bySegmento, ql, gruppo, pianiSel])

  const rowKey = `${segmento}|${sessoFiltro}|${gruppo}|${[...pianiSel].sort().join(",")}|${ql}|${rows.length}|${rows[0]?.clienteId ?? ""}`
  useEffect(() => {
    setSelected(new Set(rows.map((r) => r.clienteId)))
  }, [rowKey])

  const selectedRows = useMemo(
    () =>
      rows
        .filter((r) => selected.has(r.clienteId))
        .sort((a, b) => {
          const c = (a.cognome || "").localeCompare(b.cognome || "", "it")
          if (c) return c
          return (a.nomeProprio || a.nome).localeCompare(b.nomeProprio || b.nome, "it")
        }),
    [rows, selected]
  )

  if (role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-lg font-semibold text-zinc-200">Scaduti / Ex</h2>
          <p className="mt-2 text-sm text-zinc-500">Disponibile solo per admin.</p>
          <Link to="/" className="mt-4 inline-block text-sm text-amber-400 hover:underline">
            Torna al menu
          </Link>
        </div>
      </div>
    )
  }

  const setAsOf = (v: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("asOf", v)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-zinc-500 hover:text-amber-400">
            ← Menu
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Scaduti / Ex</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Come nel gestionale: chi ha almeno un abbonamento già finito, togliendo chi ha ancora un abbonamento
            valido oggi (ha rinnovato). Niente invio mail: selezioni la lista e scarichi Cognome, Nome, Email,
            Cellulare. Staff e danza esclusi. Default: adulti.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Data riferimento
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Età</span>
        {(
          [
            ["tutti", "Tutti"],
            ["adulti", "Adulti"],
            ["bambini", "Bambini"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSegmento(id)}
            className={`rounded-full px-3 py-1 text-sm ${
              segmento === id ? "bg-amber-500 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-zinc-700 sm:block" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Sesso</span>
        {(
          [
            ["tutti", "Tutti"],
            ["M", "Maschi"],
            ["F", "Femmine"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={`sesso-${id}`}
            type="button"
            onClick={() => setSessoFiltro(id)}
            className={`rounded-full px-3 py-1 text-sm ${
              sessoFiltro === id ? "bg-sky-500 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cerca prodotto o nome: h2o, smile, gym, open…"
        className="mt-3 w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
      />

      <div className="mt-3 grid max-w-4xl gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-zinc-400">
          Gruppo (macro / categoria)
          <select
            value={gruppo}
            onChange={(e) => {
              setGruppo(e.target.value)
              setPianiSel(new Set())
            }}
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">Tutti i gruppi</option>
            {gruppi.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <div className="block text-xs font-medium text-zinc-400">
          <div className="flex items-center justify-between gap-2">
            <span>Prodotto (abbonamento scaduto)</span>
            <span className="font-normal text-zinc-500">
              {pianiSel.size ? `${pianiSel.size} selezionat${pianiSel.size === 1 ? "o" : "i"}` : gruppo ? "tutti del gruppo" : "tutti"}
            </span>
          </div>
          <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-zinc-600 bg-zinc-950 px-2 py-1">
            {prodottiSelect.length === 0 ? (
              <p className="py-2 text-zinc-500">Nessun prodotto in elenco.</p>
            ) : (
              prodottiSelect.map((p) => (
                <label
                  key={p.piano}
                  className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm text-zinc-100 hover:bg-zinc-800/70"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={pianiSel.has(p.piano)}
                    onChange={() => setPianiSel((prev) => toggleSet(prev, p.piano))}
                  />
                  <span className="min-w-0 flex-1 leading-snug">
                    {p.piano} <span className="text-zinc-500">({p.n})</span>
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 border-t border-zinc-800 pt-1.5 font-normal">
            <button
              type="button"
              className="text-[11px] text-amber-400 hover:underline"
              onClick={() => setPianiSel(new Set(prodottiSelect.map((p) => p.piano)))}
            >
              Tutti visibili
            </button>
            <button type="button" className="text-[11px] text-zinc-400 hover:underline" onClick={() => setPianiSel(new Set())}>
              Azzera selezione
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-400">
        <p>
          {isLoading
            ? "Caricamento elenco…"
            : `${rows.length} in lista · ${rows.filter((r) => r.email).length} con email · ${rows.filter((r) => r.telefono).length} con cellulare`}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="text-amber-400 hover:underline" onClick={() => setSelected(new Set(rows.map((r) => r.clienteId)))}>
            Seleziona tutti
          </button>
          <button type="button" className="text-zinc-400 hover:underline" onClick={() => setSelected(new Set())}>
            Nessuno
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-sm text-red-400">{(error as Error).message}</p> : null}

      <div className="mt-3 max-h-[40vh] overflow-auto rounded-lg border border-zinc-800">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500">
            <tr>
              <th className="w-8 px-2 py-1.5" />
              <th className="px-2 py-1.5 font-medium">Cognome</th>
              <th className="px-2 py-1.5 font-medium">Nome</th>
              <th className="px-2 py-1.5 font-medium">Email</th>
              <th className="px-2 py-1.5 font-medium">Cellulare</th>
              <th className="px-2 py-1.5 font-medium">Ultimo scaduto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.clienteId}
                className={`border-t border-zinc-800/70 ${selected.has(r.clienteId) ? "bg-zinc-800/30" : ""}`}
              >
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(r.clienteId)}
                    onChange={() => setSelected((prev) => toggleSet(prev, r.clienteId))}
                  />
                </td>
                <td className="px-2 py-1.5 text-zinc-100">{r.cognome || "—"}</td>
                <td className="px-2 py-1.5 text-zinc-100">{r.nomeProprio || r.nome}</td>
                <td className="px-2 py-1.5 text-xs text-zinc-300">{r.email || <span className="text-zinc-600">no email</span>}</td>
                <td className="px-2 py-1.5 text-xs text-zinc-300">{r.telefono || <span className="text-zinc-600">no tel</span>}</td>
                <td className="max-w-[280px] truncate px-2 py-1.5 text-xs text-zinc-500" title={r.piano}>
                  {fmtData(r.dataFine)} · {r.piano}
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
                  Nessuno scaduto / ex con questi filtri.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <section className="mt-5 rounded-2xl border border-amber-800/50 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Anteprima lista da scaricare</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Stesso contenuto del file: Cognome, Nome, Email, Cellulare. {selectedRows.length} righe spuntate.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!selectedRows.length}
              onClick={() => downloadCsv(selectedRows, asOf)}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Scarica CSV
            </button>
            <button
              type="button"
              disabled={!selectedRows.length}
              onClick={() => downloadXlsx(selectedRows, asOf)}
              className="rounded-lg border border-amber-600 px-3 py-1.5 text-sm text-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Scarica Excel
            </button>
          </div>
        </div>
        <div className="mt-3 max-h-[46vh] overflow-auto rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="sticky top-0 bg-zinc-800 text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Cognome</th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Cellulare</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((r) => (
                <tr key={`prev-${r.clienteId}`} className="border-t border-zinc-800/80">
                  <td className="px-3 py-1.5 text-zinc-100">{r.cognome || ""}</td>
                  <td className="px-3 py-1.5 text-zinc-100">{r.nomeProprio || r.nome}</td>
                  <td className="px-3 py-1.5 text-zinc-300">{r.email || ""}</td>
                  <td className="px-3 py-1.5 text-zinc-300">{r.telefono || ""}</td>
                </tr>
              ))}
              {!selectedRows.length ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                    Spunta le persone sopra: qui vedi l&apos;anteprima del file prima di scaricarlo.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
