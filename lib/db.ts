import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const globalDb = globalThis as typeof globalThis & { agendaDb?: PrismaClient }
export const db = globalDb.agendaDb ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
if (process.env.NODE_ENV !== 'production') globalDb.agendaDb = db
