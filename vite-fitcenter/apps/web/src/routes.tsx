import { createBrowserRouter, Navigate } from "react-router-dom"
import { AuthGuard, LoginRedirect } from "@/components/AuthGuard"
import { AppLayout } from "@/layouts/AppLayout"
import { Login } from "@/pages/Login"
import { Dashboard } from "@/pages/Dashboard"
import { LeadList } from "@/features/crm/LeadList"
import { LeadDetail } from "@/features/crm/LeadDetail"
import { NewLead } from "@/features/crm/NewLead"
import { Abbonamenti } from "@/pages/Abbonamenti"
import { AbbonamentoDettaglio } from "@/pages/AbbonamentoDettaglio"

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
      { index: true, element: <Dashboard /> },
      { path: "crm", element: <LeadList /> },
      { path: "crm/nuovo", element: <NewLead /> },
      { path: "crm/lead/:id", element: <LeadDetail /> },
      { path: "abbonamenti", element: <Abbonamenti /> },
      { path: "abbonamenti/dettaglio/:id", element: <AbbonamentoDettaglio /> },
      { path: "clienti", element: <ClientiDisabilitata /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
