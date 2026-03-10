import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppLayout } from "@/layouts/AppLayout"
import { Dashboard } from "@/pages/Dashboard"
import { LeadList } from "@/features/crm/LeadList"
import { LeadDetail } from "@/features/crm/LeadDetail"
import { NewLead } from "@/features/crm/NewLead"
import { Abbonamenti } from "@/pages/Abbonamenti"
import { Clienti } from "@/pages/Clienti"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "crm", element: <LeadList /> },
      { path: "crm/nuovo", element: <NewLead /> },
      { path: "crm/lead/:id", element: <LeadDetail /> },
      { path: "abbonamenti", element: <Abbonamenti /> },
      { path: "clienti", element: <Clienti /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
