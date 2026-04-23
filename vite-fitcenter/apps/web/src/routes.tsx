import { createBrowserRouter, Navigate } from "react-router-dom"
import { AuthGuard, LoginRedirect } from "@/components/AuthGuard"
import { AppLayout } from "@/layouts/AppLayout"
import { useAuth } from "@/contexts/AuthContext"
import { Login } from "@/pages/Login"
import { Dashboard } from "@/pages/Dashboard"
import { LeadList } from "@/features/crm/LeadList"
import { LeadDetail } from "@/features/crm/LeadDetail"
import { NewLead } from "@/features/crm/NewLead"
import { Abbonamenti } from "@/pages/Abbonamenti"
import { AbbonamentoDettaglio } from "@/pages/AbbonamentoDettaglio"
import { AndamentoAbbonamenti } from "@/pages/AndamentoAbbonamenti"
import { Telefonate } from "@/pages/Telefonate"
import { ConvalideConsulenti } from "@/pages/ConvalideConsulenti"
import { AttiviAnalisi } from "@/pages/AttiviAnalisi"
import { SignaturesAdmin } from "@/pages/SignaturesAdmin"
import { FirmaDaCassa } from "@/pages/FirmaDaCassa"
import { SignPublicPage } from "@/pages/SignPublic"
import { Corsi, CorsiNoShow } from "@/pages/Corsi"
import { InformativaPrivacy } from "@/pages/InformativaPrivacy"
import { StampaReport } from "@/pages/StampaReport"
import { Campus } from "@/pages/Campus"

function DashboardOrRedirect() {
  const { leadFilter, role } = useAuth()
  if (leadFilter === "bambini") return <Navigate to="/crm" replace />
  if (role === "corsi" || role === "istruttore") return <Navigate to="/corsi" replace />
  if (role === "campus") return <Navigate to="/campus" replace />
  if (role === "firme") return <Navigate to="/firma-cassa" replace />
  return <Dashboard />
}

function ClientiDisabilitata() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <h2 className="text-lg font-semibold text-zinc-200">Clienti</h2>
        <p className="mt-2 text-sm text-zinc-500">Pagina temporaneamente non disponibile.</p>
      </div>
    </div>
  )
}

export const router = createBrowserRouter([
  {
    path: "/firma/:token",
    element: <SignPublicPage />,
  },
  {
    path: "/informativa",
    element: <InformativaPrivacy />,
  },
  {
    path: "/login",
    element: (
      <LoginRedirect>
        <Login />
      </LoginRedirect>
    ),
  },
  {
    path: "/",
    element: (
      <AuthGuard>
        <AppLayout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <DashboardOrRedirect /> },
      { path: "corsi", element: <Corsi /> },
      { path: "corsi/assenze", element: <CorsiNoShow /> },
      { path: "corsi/no-show", element: <Navigate to="/corsi/assenze" replace /> },
      { path: "campus", element: <Campus /> },
      { path: "crm", element: <LeadList /> },
      { path: "crm/nuovo", element: <NewLead /> },
      { path: "crm/lead/:id", element: <LeadDetail /> },
      { path: "abbonamenti", element: <Abbonamenti /> },
      { path: "andamento-vendite", element: <AndamentoAbbonamenti /> },
      { path: "telefonate", element: <Telefonate /> },
      { path: "convalide-consulenti", element: <ConvalideConsulenti /> },
      { path: "abbonamenti/dettaglio/:id", element: <AbbonamentoDettaglio /> },
      { path: "attivi-analisi", element: <AttiviAnalisi /> },
      { path: "firme", element: <SignaturesAdmin /> },
      { path: "firma-cassa", element: <FirmaDaCassa /> },
      { path: "stampa-report", element: <StampaReport /> },
      { path: "clienti", element: <ClientiDisabilitata /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
