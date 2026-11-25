import { db } from '../lib/db'
import { hashPassword } from '../lib/auth'

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email?.includes('@') || !password || password.length < 12) {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD com uma senha de pelo menos 12 caracteres.')
  }
  await db.user.create({ data: { email, password: await hashPassword(password), platformAdmin: true } })
  console.log('Administrador criado.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => db.$disconnect())
