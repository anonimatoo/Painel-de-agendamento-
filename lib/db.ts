import { PrismaClient } from '@prisma/client'

const globalDb = globalThis as typeof globalThis & { agendaDb?: PrismaClient }
export const db = globalDb.agendaDb ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalDb.agendaDb = db
