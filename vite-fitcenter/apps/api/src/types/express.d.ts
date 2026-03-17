import type { User } from "../store/auth.js"

declare global {
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

export {}

