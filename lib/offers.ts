import { z } from 'zod'

export const comboItems = z.array(z.object({ productId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(20) })).min(2).max(5)
  .refine(items => new Set(items.map(item => item.productId)).size === items.length)

export function centsWithDiscount(unit: number, bps: number) {
  return Math.max(1, unit - Math.floor(unit * bps / 10_000))
}
