import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { userSession, membership } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { resolvePhotoLimit } from '@/lib/product-gallery'
import { productPhotos } from '@/lib/storage'
import { MerchantShell } from '../../../merchant-shell'
import { ProductEditor } from '../product-editor'

export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ variante?: string }>
}) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || member.tenant.suspended || !can(member, 'product.manage')) redirect('/dashboard')
  const { id } = await params
  const { variante } = await searchParams
  const where = { tenantId: member.tenantId }
  const [product, parent, categories, photos, limit] = await Promise.all([
    id !== 'novo' ? db.product.findFirst({ where: { ...where, id } }) : null,
    id === 'novo' && typeof variante === 'string' ? db.product.findFirst({ where: { ...where, id: variante, archivedAt: null, variantOfId: null } }) : null,
    db.catalogCategory.findMany({ where, select: { name: true }, orderBy: { name: 'asc' } }),
    id === 'novo' ? [] : productPhotos(member.tenantId, id),
    resolvePhotoLimit(db, member.tenant)
  ])
  if ((id !== 'novo' && !product) || (id === 'novo' && variante && !parent)) notFound()
  return <MerchantShell member={member} current="/catalogo">
    <div className="row"><div><Link href="/catalogo">← Produtos</Link>
      <h1>{product ? product.name : parent ? 'Nova variação' : 'Novo produto'}</h1>
      {parent && <p>Variação de {parent.name}</p>}</div>
      {product?.published && !product.archivedAt && product.stock > 0 && member.tenant.active && <Link className="button outline" href={'/estabelecimento/' + encodeURIComponent(member.tenant.slug) + '#produto-' + product.id}>Ver produto na loja</Link>}
      {product && <Link className="button outline" href={'/catalogo?editar=' + encodeURIComponent(product.id)}>Gerenciar situação</Link>}
    </div>
    {product?.archivedAt ? <article><h2>Produto arquivado</h2><p>Restaure o produto para voltar a editar seus dados e imagens.</p></article> :
      <ProductEditor initial={product} parentId={parent?.id} categories={categories.map(row => row.name)}
        photos={photos.map(({ id, key }) => ({ id, key }))} limit={limit} active={member.tenant.active} canEditStock={can(member, 'stock.manage')} />}
  </MerchantShell>
}
