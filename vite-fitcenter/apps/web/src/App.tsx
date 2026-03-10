import { RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { router } from "./routes"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
