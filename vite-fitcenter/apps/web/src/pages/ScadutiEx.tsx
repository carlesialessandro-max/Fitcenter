import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import * as XLSX from "xlsx"
import { dataApi } from "@/api/data"
import { useAuth } from "@/contexts/AuthContext"
import type { AttiviContatto, AttiviProdotto } from "@/types/gestionale"

type SegmentoFiltro = "tutti" | "adulti" | "bambini"
type SessoFiltro = "tutti" | "M" | "F"
type ContattoFiltro = "tutti" | "email" | "soloCellulare"
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

function foldTesto(s: string): string {
  return s
    .toLowerCase()
    .replace(/h\s*2\s*0/g, "h2o")
    .replace(/h\s*2\s*o/g, "h2o")
}

function normPiano(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
}

function normCat(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

function gruppoDi(p: AttiviProdotto): string {
  const macro = (p.macro ?? "").trim()
  const cat = (p.categoria ?? "").trim()
  const piano = (p.piano ?? "").trim()
  const m = normCat(macro)
  if (m.includes("GOLD") || m === "RINNOVI" || m.startsWith("RINNOVI ")) return macro || cat
  if (macro && /PACCHETT/i.test(macro) && !isStaffOrDanza(macro)) return macro
  if (cat && /PACCHETT/i.test(cat) && !isStaffOrDanza(cat)) return cat
  return cat || macro || piano || "Altro"
}

function blobProdotto(p: AttiviProdotto): string {
  return normCat(`${p.macro ?? ""} ${p.categoria ?? ""} ${p.piano ?? ""}`)
}

/** Stesso listino adulti spuntato nel gestionale. */
function isProdottoAdultiListino(p: AttiviProdotto): boolean {
  const t = blobProdotto(p)
  const cat = normCat(p.categoria)
  const macro = normCat(p.macro ?? "")
  if (isStaffOrDanza(t) || t.includes("TESSERAMENT") || t.includes("INVITO") || t.includes("BEACTIVE") || t.includes("GYMPAY")) {
    return false
  }
  if (t.includes("PERSONAL TRAINER") || t.includes("PERSONAL TRAINING") || t.includes("EVENTI") || t.includes("VARIE") || t.includes("PROMOZION")) return false
  if (t.includes("MAMME FIT") || t.includes("PISCINA ESTERNA") || cat.includes("ESTATE")) return false
  if (t.includes("ACQUATIC") || t.includes("CAMPUS") || t.includes("JUJITSU") || t.includes("GESTANTI")) return false
  if (t.includes("AGONISMO CATEGORIE") || t.includes("PRIVATE BAMBINI") || t.includes("PRIVATE SPECIAL COPPIA")) return false
  if (t.includes("POLE DANCE") || t.includes("PERCORSO SPA")) return false
  const scuolaNuoto = t.includes("SCUOLA NUOTO")
  if (scuolaNuoto && !t.includes("ADULT")) return false
  if (macro.includes("GOLD") || macro === "RINNOVI" || macro.startsWith("RINNOVI ")) return true
  if (macro.includes("RINNOVO AUTOMATIC")) return true
  if (cat.includes("GYM") && !cat.includes("GYMPAY")) return true
  if (t.includes("NUOTO LIBERO")) return true
  if (t.includes("PACCHETTI CORSI")) return true
  if (scuolaNuoto && t.includes("ADULT")) return true
  if (cat.includes("ROSSI") && cat.includes("ORARIO LIBERO")) return true
  if (cat.includes("VERDI") && cat.includes("ORARIO RIDOTTO")) return true
  if (t.includes("AGONISMO MASTER")) return true
  if (t.includes("PRIVATE ADULTI")) return true
  if (/\bOPEN\b/.test(t) || t.includes("SMILE")) return true
  return false
}

function isProdottoBambini(p: AttiviProdotto): boolean {
  const t = blobProdotto(p)
  if (isProdottoAdultiListino(p)) return false
  if (/\bNUOTO ADULTI\b/.test(t)) return false
  if (/\bAGONISMO\b/.test(t) && /\b(MASTER|SENIOR)\b/.test(t)) return false
  if (t.includes("DANZA") || t.includes("GIOCODANZA") || t.includes("TEATRO")) return false
  if (/PRIVATE/.test(t) && !/\bADULT/.test(t) && !/\bMASTER/.test(t) && !/\bSENIOR/.test(t)) return true
  return (
    /SCUOLA\s*NUOTO/.test(t) ||
    /AGONISMO\s*CATEGORIE/.test(t) ||
    /ACQUATICIT/.test(t) ||
    /\bBAMBIN[IO]\b/.test(t) ||
    /\bBIMB[IO]\b/.test(t) ||
    /\bKIDS\b/.test(t) ||
    /\bMINI\b/.test(t) ||
    /GIOVANISSIM/.test(t) ||
    /ESORDIEN/.test(t) ||
    /PREAGONISMO/.test(t) ||
    /PROPAGANDA/.test(t) ||
    /RAGAZZ/.test(t) ||
    /\bU(6|8|10|12|14)\b/.test(t) ||
    /PICCOLI/.test(t) ||
    (/\bAGONISMO\b/.test(t) && !/\b(MASTER|SENIOR)\b/.test(t))
  )
}

function prodottoNelSegmento(p: AttiviProdotto, segmento: SegmentoFiltro): boolean {
  if (isStaffOrDanza(p.macro ?? "") || isStaffOrDanza(p.categoria) || isStaffOrDanza(p.piano)) return false
  if (segmento === "adulti") return isProdottoAdultiListino(p)
  if (segmento === "bambini") return isProdottoBambini(p)
  return isProdottoAdultiListino(p) || isProdottoBambini(p)
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

type FiltriCaricati = {
  asOf: string
  segmento: SegmentoFiltro
  sesso: SessoFiltro
  q: string
  gruppi: string[]
  piani: string[]
}

export function ScadutiEx() {
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const asOfParam = searchParams.get("asOf")?.trim()
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : localIsoDate()
  const [segmento, setSegmento] = useState<SegmentoFiltro>("adulti")
  const [sessoFiltro, setSessoFiltro] = useState<SessoFiltro>("tutti")
  const [gruppiSel, setGruppiSel] = useState<Set<string>>(new Set())
  const [pianiSel, setPianiSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState("")
  const [contattoFiltro, setContattoFiltro] = useState<ContattoFiltro>("tutti")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applied, setApplied] = useState<FiltriCaricati | null>(null)

  const catalogQ = useQuery({
    queryKey: ["abbonamenti-scaduti-catalogo", asOf],
    queryFn: () => dataApi.getAbbonamentiScadutiCatalogo({ asOf }),
    enabled: role === "admin",
    staleTime: 5 * 60_000,
  })

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["abbonamenti-scaduti-contatti", applied],
    queryFn: () =>
      dataApi.getAbbonamentiScadutiContatti({
        asOf: applied!.asOf,
        segmento: applied!.segmento,
        sesso: applied!.sesso === "tutti" ? undefined : applied!.sesso,
        q: applied!.q || undefined,
        gruppi: applied!.gruppi.length ? applied!.gruppi : undefined,
        piani: applied!.piani.length ? applied!.piani : undefined,
      }),
    enabled: role === "admin" && applied != null,
    staleTime: 60_000,
  })

  const ql = q.trim().toLowerCase()
  const catalogProdotti = catalogQ.data?.prodotti ?? []

  const foglie = useMemo(() => {
    const m = new Map<string, Leaf>()
    for (const p of catalogProdotti) {
      const piano = normPiano(p.piano)
      const cat = normPiano(p.categoria)
      const macro = normPiano(p.macro ?? "")
      if (!piano || isStaffOrDanza(piano) || isStaffOrDanza(cat) || isStaffOrDanza(macro)) continue
      const prod = { ...p, piano, categoria: cat, macro }
      if (!prodottoNelSegmento(prod, segmento)) continue
      const g = gruppoDi(prod)
      if (ql && !prodottoMatchQ(prod, ql)) continue
      const key = `${g}|||${piano}`
      const prev = m.get(key)
      if (prev) prev.n += 1
      else m.set(key, { key, gruppo: g, piano, n: 1 })
    }
    return Array.from(m.values()).sort((a, b) => a.gruppo.localeCompare(b.gruppo, "it") || a.piano.localeCompare(b.piano, "it"))
  }, [catalogProdotti, ql, segmento])

  const gruppi = useMemo(() => {
    return Array.from(new Set(foglie.map((f) => f.gruppo))).sort((a, b) => a.localeCompare(b, "it"))
  }, [foglie])

  const foglieGruppo = useMemo(() => {
    if (!gruppiSel.size) return foglie
    return foglie.filter((f) => gruppiSel.has(f.gruppo))
  }, [foglie, gruppiSel])

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
    setGruppiSel((prev) => {
      if (!prev.size) return prev
      const ok = new Set(gruppi)
      const next = new Set([...prev].filter((x) => ok.has(x)))
      if (next.size === prev.size) return prev
      return next
    })
  }, [gruppi])

  useEffect(() => {
    setPianiSel((prev) => {
      if (!prev.size) return prev
      const ok = new Set(prodottiSelect.map((p) => p.piano))
      const next = new Set([...prev].filter((x) => ok.has(x)))
      if (next.size === prev.size) return prev
      return next
    })
  }, [prodottiSelect])

  const rowsAll = data?.rows ?? []
  const rows = useMemo(() => {
    return rowsAll.filter((r) => {
      if (contattoFiltro === "email") return Boolean(r.email)
      if (contattoFiltro === "soloCellulare") return Boolean(r.telefono) && !r.email
      return true
    })
  }, [rowsAll, contattoFiltro])
  const hasLoaded = applied != null && !isFetching
  const rowKey = `${applied?.asOf ?? ""}|${contattoFiltro}|${rows.length}|${rows[0]?.clienteId ?? ""}`
  useEffect(() => {
    setSelected(new Set(rows.map((r) => r.clienteId)))
  }, [rowKey])

  const caricaLista = () => {
    const next: FiltriCaricati = {
      asOf,
      segmento,
      sesso: sessoFiltro,
      q: gruppiSel.size || pianiSel.size ? "" : q.trim(),
      gruppi: [...gruppiSel].sort(),
      piani: [...pianiSel].sort(),
    }
    const same =
      applied != null &&
      applied.asOf === next.asOf &&
      applied.segmento === next.segmento &&
      applied.sesso === next.sesso &&
      applied.q === next.q &&
      applied.gruppi.join("|") === next.gruppi.join("|") &&
      applied.piani.join("|") === next.piani.join("|")
    if (same) {
      void refetch()
      return
    }
    setApplied(next)
  }

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
            Adulti = voci spuntate in gestionale (GOLD, rinnovi, gym, nuoto libero, pacchetti corsi,
            scuola nuoto adulti, rossi/verdi, agonismo master, private adulti). Poi puoi filtrare chi ha
            email o chi ha solo il cellulare.
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
        <span className="mx-1 hidden h-4 w-px bg-zinc-700 sm:block" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Contatto</span>
        {(
          [
            ["tutti", "Tutti"],
            ["email", "Con email"],
            ["soloCellulare", "Solo cellulare"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={`contatto-${id}`}
            type="button"
            onClick={() => setContattoFiltro(id)}
            className={`rounded-full px-3 py-1 text-sm ${
              contattoFiltro === id ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
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
        <div className="block text-xs font-medium text-zinc-400">
          <div className="flex items-center justify-between gap-2">
            <span>Gruppo (macro / categoria)</span>
            <span className="font-normal text-zinc-500">
              {gruppiSel.size ? `${gruppiSel.size} selezionat${gruppiSel.size === 1 ? "o" : "i"}` : "tutti visibili"}
            </span>
          </div>
          <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-zinc-600 bg-zinc-950 px-2 py-1">
            {catalogQ.isLoading ? (
              <p className="py-2 text-zinc-500">Caricamento gruppi…</p>
            ) : gruppi.length === 0 ? (
              <p className="py-2 text-zinc-500">
                {segmento === "bambini"
                  ? "Nessun gruppo bambini (scuola nuoto, acquaticità, agonismo, private)."
                  : "Nessun gruppo in elenco."}
              </p>
            ) : (
              gruppi.map((g) => (
                <label
                  key={g}
                  className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm text-zinc-100 hover:bg-zinc-800/70"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={gruppiSel.has(g)}
                    onChange={() => {
                      setGruppiSel((prev) => toggleSet(prev, g))
                      setPianiSel(new Set())
                    }}
                  />
                  <span className="min-w-0 flex-1 leading-snug">{g}</span>
                </label>
              ))
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 border-t border-zinc-800 pt-1.5 font-normal">
            <button
              type="button"
              className="text-[11px] text-amber-400 hover:underline"
              onClick={() => {
                setGruppiSel(new Set(gruppi))
                setPianiSel(new Set())
              }}
            >
              Tutti visibili
            </button>
            <button
              type="button"
              className="text-[11px] text-zinc-400 hover:underline"
              onClick={() => {
                setGruppiSel(new Set())
                setPianiSel(new Set())
              }}
            >
              Azzera selezione
            </button>
          </div>
        </div>
        <div className="block text-xs font-medium text-zinc-400">
          <div className="flex items-center justify-between gap-2">
            <span>Prodotto (abbonamento scaduto)</span>
            <span className="font-normal text-zinc-500">
              {pianiSel.size
                ? `${pianiSel.size} selezionat${pianiSel.size === 1 ? "o" : "i"}`
                : gruppiSel.size
                  ? "tutti dei gruppi"
                  : "tutti"}
            </span>
          </div>
          <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-zinc-600 bg-zinc-950 px-2 py-1">
            {catalogQ.isLoading ? (
              <p className="py-2 text-zinc-500">Caricamento prodotti…</p>
            ) : prodottiSelect.length === 0 ? (
              <p className="py-2 text-zinc-500">Nessun prodotto in elenco. Puoi anche scrivere h2o, smile, gym…</p>
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={caricaLista}
          disabled={isFetching}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-wait disabled:opacity-60"
        >
          {isFetching ? "Caricamento lista…" : "Carica lista"}
        </button>
        {applied == null ? (
          <p className="text-sm text-zinc-500">Imposta i filtri e premi Carica lista. Non si scaricano i 50mila all&apos;apertura.</p>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-sm text-red-400">{(error as Error).message}</p> : null}

      {applied == null ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-10 text-center text-sm text-zinc-500">
          Seleziona adulti / bambini, sesso e prodotto, poi carica i nominativi.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3">
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Totale</p>
                <p className="text-3xl font-semibold tabular-nums text-zinc-50">
                  {isFetching ? "…" : rows.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Con email</p>
                <p className="text-xl font-semibold tabular-nums text-zinc-200">
                  {isFetching ? "…" : rows.filter((r) => r.email).length}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Con cellulare</p>
                <p className="text-xl font-semibold tabular-nums text-zinc-200">
                  {isFetching ? "…" : rows.filter((r) => r.telefono).length}
                </p>
              </div>
              <p className="pb-1 text-sm text-zinc-500">
                {selectedRows.length} spuntat{selectedRows.length === 1 ? "o" : "i"} per il file
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-sm text-amber-400 hover:underline"
                onClick={() => setSelected(new Set(rows.map((r) => r.clienteId)))}
              >
                Seleziona tutti
              </button>
              <button type="button" className="text-sm text-zinc-400 hover:underline" onClick={() => setSelected(new Set())}>
                Nessuno
              </button>
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

          <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-zinc-800">
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
                {hasLoaded && rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
                      Nessuno scaduto / ex con questi filtri.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
