import { AgendaError } from './agenda'
import { db } from './db'

export const loyaltyThreshold = 5
export async function loyaltyBalance(tenantId: string, userId: string) {
  const [attendances, redeemed] = await Promise.all([
    db.appointment.count({ where: { tenantId, consumerUserId: userId, status: 'COMPLETED' } }),
    db.loyaltyReward.count({ where: { tenantId, userId } })
  ])
  return { attendances, redeemed, available: Math.max(0, Math.floor(attendances / loyaltyThreshold) - redeemed) }
}

export async function redeemLoyalty(tenantId: string, userId: string, sequence: number) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "userId" FROM "ConsumerProfile" WHERE "tenantId" = ${tenantId} AND "userId" = ${userId} FOR UPDATE`
    const customer = await tx.consumerProfile.findFirst({
      where: { tenantId, userId, tenant: { active: true, suspended: false, loyaltyEnabled: true } }
    })
    if (!customer) throw new AgendaError('Cliente indisponível para fidelidade.')
    const past = await tx.loyaltyReward.count({ where: { tenantId, userId } })
    const complete = await tx.appointment.count({ where: { tenantId, consumerUserId: userId, status: 'COMPLETED' } })
    if (sequence !== past + 1 || complete < sequence * loyaltyThreshold) throw new AgendaError('O resgate já foi registrado ou ainda não está disponível.')
    return tx.loyaltyReward.create({ data: { tenantId, userId, sequence } })
  })
}
