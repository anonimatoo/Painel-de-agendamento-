import type { Prisma } from '@prisma/client'

export function calculateCommission(amount: number, percentBps: number, fixedCents: number) {
  return Math.min(amount, fixedCents || Math.floor((amount * percentBps + 5000) / 10_000))
}

export async function platformFee(tx: Prisma.TransactionClient, tenantId: string, amount: number) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { platformFeeBps: true, platformFeeFixed: true } })
  if (tenant.platformFeeBps !== null || tenant.platformFeeFixed !== null) {
    return calculateCommission(amount, tenant.platformFeeBps ?? 0, tenant.platformFeeFixed ?? 0)
  }
  const subscription = await tx.subscription.findFirst({
    where: { tenantId, status: { in: ['active', 'trialing'] } }, orderBy: { updatedAt: 'desc' },
    select: { plan: { select: { platformFeeBps: true, platformFeeFixed: true } } }
  })
  return calculateCommission(amount, subscription?.plan.platformFeeBps ?? 0, subscription?.plan.platformFeeFixed ?? 0)
}
