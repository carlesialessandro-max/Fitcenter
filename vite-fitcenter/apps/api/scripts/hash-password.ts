/**
 * Genera hash bcrypt per AUTH_USERS_JSON.
 * Uso: pnpm exec tsx scripts/hash-password.ts "LaTuaPasswordSicura1!"
 */
import bcrypt from "bcrypt"

const plain = process.argv[2]
if (!plain) {
  console.error('Uso: pnpm exec tsx scripts/hash-password.ts "password"')
  process.exit(1)
}
const rounds = Math.min(15, Math.max(10, Number(process.env.BCRYPT_ROUNDS ?? 12)))
const hash = bcrypt.hashSync(plain, rounds)
console.log(hash)
