import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Boxes, Camera, Plus, Scissors, Tag } from 'lucide-react'
import { membership,userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { MerchantShell } from '../merchant-shell'
import { brl, ErrorNote, Field } from '../ui'
import { changeCatalog } from './actions'

type Query = { secao?: string; busca?: string; categoria?: string; situacao?: string; ordenar?: string; pagina?: string; editar?: string; novo?: string; variante?: string; erro?: string; salvo?: string }
const money = (cents?: number | null) => typeof cents === 'number' ? (cents / 100).toFixed(2).replace('.', ',') : ''
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''

export default async function Catalog({ searchParams }: {searchParams:Promise<Query>}) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')
  const productsAllowed = can(member,'product.manage')
  const servicesAllowed = can(member,'service.read') || can(member,'service.manage')
  const stockAllowed = can(member,'stock.manage')
  const categoriesAllowed = productsAllowed && can(member,'service.manage')
  if (!productsAllowed && !servicesAllowed) redirect('/dashboard')
  const query = await searchParams
  const section = query.secao === 'categorias' && categoriesAllowed ? 'categorias' : (query.secao === 'servicos' && servicesAllowed) || !productsAllowed ? 'servicos' : 'produtos'
  const isProduct = section === 'produtos'
  const editAllowed = isProduct ? productsAllowed : can(member,'service.manage')
  const { tenantId } = member
  const search = text(query.busca,100)
  const category = text(query.categoria,80)
  const status = text(query.situacao,25)
  const orderBy = query.ordenar === 'preco' ? { cents:'asc' as const } : { name:'asc' as const }
  const publish = status === 'publicado' ? true : status === 'rascunho' ? false : undefined
  const archive = status === 'arquivado' ? { not: null } : null
  const productFilter = { tenantId, archivedAt: archive, published: publish, category: category || undefined,
    stock: status === 'baixo' ? { lte: db.product.fields.minimumStock } : undefined,
    OR: search ? [{ name: { contains: search, mode: 'insensitive' as const } }, { sku: { contains: search, mode: 'insensitive' as const } }] : undefined }
  const serviceFilter = { tenantId, archivedAt: archive, active: publish, category: category || undefined,
    name: search ? { contains: search, mode: 'insensitive' as const } : undefined }
  const total = section === 'categorias' ? 0 : isProduct ? await db.product.count({where:productFilter}) : await db.service.count({where:serviceFilter})
  const pages = Math.max(1,Math.ceil(total / 10))
  const page = Math.min(pages,Math.max(1,Math.trunc(Number(query.pagina)) || 1))
  const paginate = { take: 10, skip: (page - 1) * 10, orderBy: [orderBy, {id:'asc' as const}] }
  const [products,services,categories,product,service] = await Promise.all([
    isProduct ? db.product.findMany({where:productFilter,...paginate}) : [],
    section === 'servicos' ? db.service.findMany({where:serviceFilter,...paginate}) : [],
    db.catalogCategory.findMany({where:{tenantId},orderBy:{name:'asc'}}),
    query.editar && isProduct && editAllowed ? db.product.findFirst({where:{id:text(query.editar,100),tenantId}}) : null,
    query.editar && section === 'servicos' && editAllowed ? db.service.findFirst({where:{id:text(query.editar,100),tenantId}}) : null
  ])
  const item = product ?? service
  const ids = [...products,...services].map(row => row.id)
  const media = await db.mediaAsset.findMany({where:{tenantId,kind:isProduct?'PRODUCT':'SERVICE',OR:[{target:{in:ids}},{target:{in:item ? [item.id,item.id+':2',item.id+':3'] : []}}]}})
  const photo = (id: string) => media.find(row => row.target === id)?.key
  const sectionUrl = (target: string, options?: Record<string,string>) => '/catalogo?' + new URLSearchParams({secao:target,...options})
  const link = (next: number) => sectionUrl(section,{ busca:search,categoria:category,situacao:status,ordenar:text(query.ordenar,20),pagina:String(next) })
  const action = changeCatalog.bind(null,isProduct?'produto':'servico')
  return <MerchantShell member={member} current={section === 'produtos' ? '/catalogo' : sectionUrl(section)}>
    <div className="row"><div><h1>Produtos e serviços</h1><p>Gerencie o catálogo, os preços e a publicação na página pública.</p></div>
      <div className="inline">{productsAllowed && <Link className="button outline" href={sectionUrl('produtos',{novo:'produto'})}><Plus size={17} aria-hidden /> Novo produto</Link>}
      {can(member,'service.manage') && <Link className="button" href={sectionUrl('servicos',{novo:'servico'})}><Plus size={17} aria-hidden /> Novo serviço</Link>}</div></div>
    <ErrorNote error={query.erro} />{query.salvo && <p role="status" className="success">Catálogo atualizado.</p>}
    <nav aria-label="Seções do catálogo" className="catalog-tabs">
      {productsAllowed && <Link aria-current={isProduct?'page':undefined} href="/catalogo"><Boxes size={18} aria-hidden /> Produtos</Link>}
      {servicesAllowed && <Link aria-current={section==='servicos'?'page':undefined} href={sectionUrl('servicos')}><Scissors size={18} aria-hidden /> Serviços</Link>}
      {categoriesAllowed && <Link aria-current={section==='categorias'?'page':undefined} href={sectionUrl('categorias')}><Tag size={18} aria-hidden /> Categorias</Link>}
    </nav>
    {section==='categorias' ? <article><h2>Categorias</h2><form className="inline" action={changeCatalog.bind(null,'categoria')}><Field label="Nome" name="name" /><button name="command" value="salvar">Criar categoria</button></form>
      {categories.map(row => <form className="inline" key={row.name} action={changeCatalog.bind(null,'categoria')}><input name="oldName" type="hidden" value={row.name} /><Field label="Categoria" name="name" value={row.name} /><button className="outline" name="command" value="salvar">Renomear</button></form>)}</article> :
      <div className={'catalog-layout'+(item || query.novo && editAllowed ? ' catalog-layout-edit' : '')}>
      <article className="commercial-panel"><h2>Catálogo de {isProduct ? 'produtos' : 'serviços'} · {total}</h2>
        <form className="inline" method="get">
          <input name="secao" type="hidden" value={section} /><Field label="Buscar por nome ou SKU" name="busca" value={search} required={false} />
          <Field label="Categoria" name="categoria" value={category} required={false} />
          <label>Situação<select name="situacao" defaultValue={status}><option value="">Ativos e rascunhos</option><option value="publicado">Publicados</option><option value="rascunho">Rascunhos</option><option value="arquivado">Arquivados</option>{isProduct&&<option value="baixo">Estoque baixo</option>}</select></label>
          <label>Ordenar<select name="ordenar" defaultValue={query.ordenar??''}><option value="">Nome</option><option value="preco">Menor preço</option></select></label><button>Filtrar</button>
        </form>
        {total ? <div className="scroll"><table><thead><tr><th>{isProduct?'Produto':'Serviço'}</th><th>Categoria</th><th>Preço</th><th>{isProduct?'Estoque':'Duração'}</th><th>Situação</th>{editAllowed&&<th>Ações</th>}</tr></thead><tbody>
          {[...products,...services].map(row => <tr key={row.id}><td><span className="catalog-item">{photo(row.id) ? <img className="catalog-photo" src={'/api/imagens/'+photo(row.id)} alt="" /> : <span className="catalog-placeholder">{isProduct ? <Boxes aria-hidden /> : <Scissors aria-hidden />}</span>}<span><strong>{row.name}</strong>{'sku'in row&&row.sku&&<small>{row.sku}</small>}</span></span></td>
            <td>{row.category||'Sem categoria'}</td><td>{'promotionCents'in row&&row.promotionCents!==null?<><s>{brl(row.cents)}</s> <strong>{brl(row.promotionCents)}</strong></>:brl(row.cents)}</td>
            <td>{'stock'in row?<>{row.stock} un. {row.stock<=row.minimumStock&&<span className="state-pill" data-state="PENDING">Baixo</span>}</>:row.duration+' min'}</td>
            <td><span className="state-pill" data-state={row.archivedAt?'CANCELED':('published'in row?row.published:row.active)?'COMPLETED':'PENDING'}>{row.archivedAt?'Arquivado':('published'in row?row.published:row.active)?'Publicado':'Rascunho'}</span></td>
            {editAllowed&&<td><Link href={sectionUrl(section,{editar:row.id})}>{row.archivedAt?'Ver':'Editar'}</Link></td>}</tr>)}
        </tbody></table></div>:<p className="surface-empty">Nenhum item encontrado. Ajuste os filtros ou cadastre um item.</p>}
        <div className="inline catalog-pagination">{page>1&&<Link className="button outline" href={link(page-1)}>Anterior</Link>}<span>Página {page} de {pages}</span>{page<pages&&<Link className="button outline" href={link(page+1)}>Próxima</Link>}</div>
      </article>
      {editAllowed&&(item||query.novo)&&<article className="commercial-panel"><h2>{item?'Editar':'Novo'} {isProduct?'produto':'serviço'}</h2>
        {!item?.archivedAt&&<form action={action}>
          {item&&<input type="hidden" name="id" value={item.id} />}
          {isProduct&&query.variante&&<input type="hidden" name="parentId" value={text(query.variante,100)} />}
          <Field label="Nome" name="name" value={item?.name} /><Field label="Categoria" name="category" value={item?.category} required={false} />
          {isProduct&&<Field label="SKU" name="sku" value={product?.sku??''} required={false} />}
          <label>Descrição<textarea name="description" maxLength={1000} rows={3} defaultValue={item?.description}/></label>
          <Field label="Preço normal (R$)" name="price" value={money(item?.cents)} />
          {isProduct?<><Field label="Preço promocional (R$)" name="promotion" value={money(product?.promotionCents)} required={false} /><Field label="Custo (R$)" name="cost" value={money(product?.costCents)} required={false} />
            {stockAllowed&&<><Field label="Estoque atual" name="stock" type="number" min={0} value={product?.stock??0}/><input type="hidden" name="expectedStock" value={product?.stock??0}/></>}
            <Field label="Estoque mínimo" name="minimumStock" type="number" min={0} value={product?.minimumStock??0} /></>:
            <Field label="Duração (minutos)" name="duration" type="number" min={5} max={720} value={service?.duration??30} />}
          <label className="check"><input name="published" type="checkbox" defaultChecked={product?.published??service?.active??false} /> Publicar no catálogo</label>
          <button name="command" value="salvar">Salvar alterações</button>
        </form>}
        {item&&<><form className="inline" action={action}><input type="hidden" name="id" value={item.id}/>
          {item.archivedAt?<button name="command" value="restaurar">Restaurar</button>:<>
          <button className="outline" name="command" value="arquivar">Arquivar</button>
          {(product?.published??service?.active)?<button className="outline" name="command" value="desativar">Desativar</button>:<button className="outline" name="command" value="ativar">Publicar</button>}
          {isProduct&&<button className="outline" name="command" value="duplicar">Duplicar</button>}</>}
        </form>
        {product&&!product.archivedAt&&!product.variantOfId&&<Link href={sectionUrl(section,{novo:'produto',variante:product.id})}>Adicionar variação</Link>}
        {!item.archivedAt&&<><h3><Camera size={18} aria-hidden /> Fotografias</h3>{(isProduct?['1','2','3']:['1']).map(slot => <form key={slot} action={action}>
          <input type="hidden" name="id" value={item.id}/><input type="hidden" name="slot" value={slot}/>
          {photo(slot==='1'?item.id:item.id+':'+slot)&&<img className="catalog-photo" src={'/api/imagens/'+photo(slot==='1'?item.id:item.id+':'+slot)} alt={'Foto '+slot}/>}
          <label>Foto {slot}<input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label>
          <div className="inline"><button className="outline" name="command" value="foto">Enviar foto</button>{photo(slot==='1'?item.id:item.id+':'+slot)&&<button className="outline" name="command" value="remover-foto">Remover foto</button>}</div>
        </form>)}</>}</>}
      </article>}
    </div>}
  </MerchantShell>
}
