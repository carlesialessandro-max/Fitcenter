export type Role = "admin" | "operatore" | "firme" | "corsi" | "istruttore" | "campus" | "scuola_nuoto"

export interface LoginBody {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  user: {
    username: string
    nome: string
    role: Role
    consulenteNome?: string
  }
}
