import type { User } from "../store/auth.js"
import type { LpagaSessionUser } from "../store/libro-paga-auth.js"

declare global {
  namespace Express {
    interface Request {
      user?: User
      lpaga?: LpagaSessionUser
    }
  }
}

export {}


export {}

