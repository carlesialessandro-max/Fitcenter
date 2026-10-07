export type Role =
  | "admin"
  | "operatore"
  | "firme"
  | "corsi"
  | "istruttore"
  | "campus"
  | "scuola_nuoto"
  | "bagnini"
  | "danza"
  | "crm"
  | "calendari"

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
    leadFilter?: "bambini"
    vedeTotaliCentro?: boolean
    pages?: string[]
  }
}
