import type { MediaAsset, Prisma } from '@prisma/client'
import { productPhotoLimit } from './business-plan'

export function productMediaFilter(tenantId: string, id: string): Prisma.MediaAssetWhereInput {
  return { tenantId, kind: 'PRODUCT', OR: [{ target: id }, { target: { startsWith: id + ':' } }] }
}

export function productGallery<T extends Pick<MediaAsset, 'target' | 'position' | 'createdAt' | 'id'>>(media: T[], id: string) {
  const rank = (item: T) => item.position ?? (item.target === id ? 0 : item.target === id + ':2' ? 1 : 2)
  return media.filter(item => item.target === id || item.target.startsWith(id + ':'))
    .sort((a, b) => rank(a) - rank(b) || +a.createdAt - +b.createdAt || a.id.localeCompare(b.id))
}

export async function resolvePhotoLimit(tx: Prisma.TransactionClient, tenant: { id: string; active: boolean; draftBillingCycle: string }) {
  const contract = tenant.active ? await tx.subscription.findFirst({
    where: { tenantId: tenant.id, status: { in: ['active', 'trialing'] } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], select: { recurringInterval: true }
  }) : null
  return productPhotoLimit(tenant, contract?.recurringInterval)
}
