'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { AgendaError } from '@/lib/agenda'
import { userSession, membership } from '@/lib/auth'
import { saveCatalogProduct, parseReais } from '@/lib/catalog'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { productMediaFilter } from '@/lib/product-gallery'
import { addProductPhoto, deleteMedia, orderProductPhotos, productPhotos } from '@/lib/storage'

const key = z.string().regex(/^[\w-]{1,100}$/)
const quantity = z.coerce.number().int().min(0).max(1_000_000)
const fields = z.object({
  name: z.string().trim().min(2, 'Informe o nome do produto.').max(100),
  sku: z.string().trim().max(64),
  barcode: z.string().trim().regex(/^\d{0,32}$/, 'Informe somente dígitos.'),
  description: z.string().trim().max(1000),
  category: z.string().trim().max(80),
  price: z.string(), cost: z.string(), promotion: z.string(), minimumStock: quantity
})

export type Photo = { id: string; key: string }

async function catalogMember() {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member || member.tenant.suspended || !can(member, 'product.manage')) throw new AgendaError('Acesso ao catálogo indisponível.')
  return member
}

function message(error: unknown) {
  if (error instanceof AgendaError) return error.message
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Confira os campos.'
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'Já existe um produto com este SKU.'
  return 'Não foi possível concluir a operação.'
}

export async function saveProductEditor(form: FormData) {
  try {
    const member = await catalogMember()
    const item = form.get('id') ? key.parse(form.get('id')) : undefined
    const parentId = form.get('parentId') && !item ? key.parse(form.get('parentId')) : undefined
    const allowStock = can(member, 'stock.manage')
    const { name, sku, barcode, description, category, price, cost, promotion, minimumStock } = fields.parse(Object.fromEntries(form))
    const saved = await saveCatalogProduct(member.tenantId, {
      name, sku: sku.toUpperCase() || null, barcode: barcode || null, description, category, minimumStock,
      cents: parseReais(price), costCents: cost.trim() ? parseReais(cost) : 0,
      promotionCents: promotion.trim() ? parseReais(promotion) : null, published: form.has('published')
    }, {
      id: item, parentId,
      stock: allowStock ? quantity.parse(form.get('stock')) : undefined,
      expectedStock: item && allowStock ? quantity.parse(form.get('expectedStock')) : undefined
    })
    return { id: saved.id, stock: saved.stock }
  } catch (error) { return { error: message(error) } }
}

export async function editProductPhotos(productId: string, form: FormData): Promise<{ photos: Photo[] } | { error: string }> {
  try {
    const member = await catalogMember()
    const { tenantId } = member
    const id = key.parse(productId)
    if (!await db.product.count({ where: { id, tenantId, archivedAt: null } })) throw new AgendaError('Produto indisponível.')
    switch (form.get('command')) {
      case 'add': {
        const file = form.get('image')
        if (!(file instanceof File)) throw new AgendaError('Selecione uma imagem.')
        await addProductPhoto(tenantId, id, file)
        break
      }
      case 'remove': {
        const asset = await db.mediaAsset.findFirst({
          where: { ...productMediaFilter(tenantId, id), id: key.parse(form.get('photo')) }, select: { id: true }
        })
        if (!asset) throw new AgendaError('Imagem indisponível.')
        await deleteMedia(tenantId, asset.id)
        break
      }
      case 'order':
        await orderProductPhotos(tenantId, id, z.array(key).max(30).parse(form.getAll('photo')))
        break
      default: return { error: 'Operação indisponível.' }
    }
    return { photos: (await productPhotos(tenantId, id)).map(({ id, key }) => ({ id, key })) }
  } catch (error) { return { error: message(error) } }
}

export async function saveDraftCycle(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  const cycle = z.enum(['monthly', 'annual']).safeParse(form.get('cycle'))
  if (member?.role !== 'ADMIN' || !cycle.success) return
  await db.tenant.updateMany({ where: { id: member.tenantId, active: false, suspended: false }, data: { draftBillingCycle: cycle.data } })
  revalidatePath('/dashboard')
  revalidatePath('/catalogo', 'layout')
}
