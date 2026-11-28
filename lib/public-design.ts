import { z } from 'zod'

export const publicDesignSchema = z.object({
  secondaryColor: z.string().regex(/^#[a-f0-9]{6}$/i),
  buttonStyle: z.enum(['rounded', 'pill']),
  layout: z.enum(['booking', 'products']),
  productIds: z.array(z.string().min(1).max(100)).max(6),
  serviceIds: z.array(z.string().min(1).max(100)).max(6)
})

export const defaultPublicDesign: z.infer<typeof publicDesignSchema> = {
  secondaryColor: '#f2e8fc', buttonStyle: 'rounded', layout: 'booking', productIds: [], serviceIds: []
}

export const readPublicDesign = (value: unknown) => publicDesignSchema.safeParse(value).data ?? defaultPublicDesign

export function featuredFirst<T extends { id: string }>(rows: T[], featured: string[]) {
  return [...rows.filter(row => featured.includes(row.id)), ...rows.filter(row => !featured.includes(row.id))]
}
