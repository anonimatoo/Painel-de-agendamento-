'use server'

import { unstable_rethrow, redirect } from 'next/navigation'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { userSession, membership } from '@/lib/auth'
import { AgendaError } from '@/lib/agenda'
import { can, type Permission } from '@/lib/permissions'
import { db } from '@/lib/db'
import { parseReais, renameCatalogCategory, saveCatalogProduct } from '@/lib/catalog'
import { deleteMedia, storeMedia } from '@/lib/storage'

const name = z.string({ error: 'Informe o nome.' }).trim().min(2, 'Informe um nome com ao menos dois caracteres.').max(100, 'Use até 100 caracteres no nome.')
const id = z.string().min(1).max(100)
const category = z.string().trim().max(80, 'Use até 80 caracteres na categoria.')
const description = z.string().trim().max(1000, 'Use até 1000 caracteres na descrição.')
const stock = z.coerce.number().int().min(0).max(1_000_000, 'Confira a quantidade de unidades.')
const sections = { produto: '/catalogo', servico: '/catalogo?secao=servicos', categoria: '/catalogo?secao=categorias' }
type Section = keyof typeof sections
const scopes: Record<Section, Permission> = { produto: 'product.manage', servico: 'service.manage', categoria: 'product.manage' }
const allowedCommands = z.enum(['salvar', 'ativar', 'desativar', 'arquivar', 'restaurar', 'duplicar', 'foto', 'remover-foto'])

function addQuery(path: string, key: string, value: string) {
  return path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(value)
}

export async function changeCatalog(section: Section, form: FormData) {
  const fallback = sections[section] ?? sections.produto
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || !member.tenant.active || member.tenant.suspended || !can(member, scopes[section]) ||
      (section === 'categoria' && !can(member, 'service.manage'))) redirect('/dashboard')
  const { tenantId } = member
  let target = fallback
  try {
    const command = allowedCommands.parse(form.get('command'))
    const itemId = form.get('id') ? id.parse(form.get('id')) : undefined
    const itemTarget = itemId ? addQuery(fallback, 'editar', itemId) : addQuery(fallback, 'novo', section)
    if (section !== 'categoria') target = itemTarget
    if (section === 'categoria') {
      const newName = category.min(2, 'Informe o nome da categoria.').parse(form.get('name'))
      const oldName = category.parse(form.get('oldName') ?? '')
      await renameCatalogCategory(tenantId, newName, oldName || undefined)
    } else if (command === 'salvar') {
      const common = { name: name.parse(form.get('name')), description: description.parse(form.get('description')), category: category.parse(form.get('category')) }
      const cents = parseReais(z.string().parse(form.get('price')))
      const active = form.has('published')
      if (section === 'produto') {
        const promotion = z.string().parse(form.get('promotion')).trim()
        const cost = z.string().parse(form.get('cost')).trim()
        const saved = await saveCatalogProduct(tenantId, {
          ...common, cents, costCents: cost ? parseReais(cost) : 0, promotionCents: promotion ? parseReais(promotion) : null,
          sku: z.string().trim().max(64, 'Use até 64 caracteres no SKU.').parse(form.get('sku')).toUpperCase() || null,
          minimumStock: stock.parse(form.get('minimumStock')), published: active
        }, {
          id: itemId, parentId: form.get('parentId') ? id.parse(form.get('parentId')) : undefined,
          stock: can(member, 'stock.manage') ? stock.parse(form.get('stock')) : undefined,
          expectedStock: itemId && can(member, 'stock.manage') ? stock.parse(form.get('expectedStock')) : undefined
        })
        target = addQuery(fallback, 'editar', saved.id)
      } else {
        const values = { ...common, cents, duration: z.coerce.number().int().min(5).max(720).parse(form.get('duration')), active }
        if (!itemId) {
          const saved = await db.service.create({ data: { ...values, tenantId } })
          target = addQuery(fallback, 'editar', saved.id)
        } else {
          const updated = await db.service.updateMany({ where: { tenantId, id: itemId, archivedAt: null }, data: values })
          if (!updated.count) throw new AgendaError('Serviço indisponível para edição.')
        }
      }
    } else if (command === 'foto' || command === 'remover-foto') {
      if (!itemId) throw new AgendaError('Salve o item antes de adicionar imagens.')
      const slot = section === 'produto' ? z.enum(['1', '2', '3']).parse(form.get('slot')) : '1'
      const mediaTarget = slot === '1' ? itemId : itemId + ':' + slot
      const kind = section === 'produto' ? 'PRODUCT' : 'SERVICE'
      if (command === 'foto') {
        const file = form.get('image')
        if (!(file instanceof File)) throw new AgendaError('Selecione um arquivo de imagem.')
        await storeMedia(tenantId, kind, mediaTarget, file)
      } else {
        const asset = await db.mediaAsset.findUnique({ where: { tenantId_kind_target: { tenantId, kind, target: mediaTarget } } })
        if (asset) await deleteMedia(tenantId, asset.id)
      }
    } else {
      if (!itemId) throw new AgendaError('Selecione um item do catálogo.')
      const where = { tenantId, id: itemId }
      const archived = command === 'arquivar'
      const restoring = command === 'restaurar'
      const publication = command === 'ativar'
      if (section === 'produto') {
        const product = await db.product.findFirst({ where })
        if (!product) throw new AgendaError('Produto indisponível.')
        if (command === 'duplicar') {
          const saved = await saveCatalogProduct(tenantId, {
            name: product.name.slice(0, 90) + ' (cópia)', description: product.description, category: product.category,
            cents: product.cents, costCents: product.costCents, promotionCents: product.promotionCents,
            minimumStock: product.minimumStock, sku: null, published: false
          }, {})
          target = addQuery(fallback, 'editar', saved.id)
        } else {
          const changed = await db.product.updateMany({
            where: { ...where, archivedAt: restoring ? { not: null } : null },
            data: { archivedAt: archived ? new Date() : restoring ? null : undefined, published: publication }
          })
          if (!changed.count) throw new AgendaError('O estado do produto mudou. Confira o catálogo.')
        }
      } else {
        if (command === 'duplicar') throw new AgendaError('Operação indisponível.')
        const changed = await db.service.updateMany({
          where: { ...where, archivedAt: restoring ? { not: null } : null },
          data: { archivedAt: archived ? new Date() : restoring ? null : undefined, active: publication }
        })
        if (!changed.count) throw new AgendaError('O estado do serviço mudou. Confira o catálogo.')
      }
    }
    target = addQuery(target, 'salvo', '1')
  } catch (error) {
    unstable_rethrow(error)
    const message = error instanceof AgendaError ? error.message : error instanceof z.ZodError ? error.issues[0]?.message
      : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 'Já existe um produto com este SKU.'
        : 'Não foi possível salvar a alteração.'
    target = addQuery(target, 'erro', message ?? 'Confira os dados do formulário.')
  }
  redirect(target)
}
