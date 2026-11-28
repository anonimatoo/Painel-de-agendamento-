export const businessSuiteOffer = {
  monthly: { cents: 5999, photoLimit: 10 },
  annual: { cents: 49999, photoLimit: 30 }
} as const

export function productPhotoLimit(tenant: { active: boolean; draftBillingCycle: string }, contractInterval?: string | null) {
  const annual = tenant.active ? contractInterval === 'year' : tenant.draftBillingCycle === 'annual'
  return businessSuiteOffer[annual ? 'annual' : 'monthly'].photoLimit
}
