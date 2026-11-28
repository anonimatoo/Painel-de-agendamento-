import { can } from '@/lib/permissions'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { readPublicDesign } from '@/lib/public-design'
import { updatePublicDesign } from './design-actions'
import { brandSettings } from '../actions'
import { MerchantShell } from '../merchant-shell'
import { ErrorNote, Field } from '../ui'

const names = { LOGO: 'Logotipo', PROFILE: 'Foto de perfil', BANNER: 'Banner', COVER: 'Capa', GALLERY: 'Galeria', PROFESSIONAL: 'Foto de profissional', SERVICE: 'Foto de serviço', PRODUCT: 'Foto de produto' } as const

export default async function Branding({ searchParams }: { searchParams: Promise<{ erro?: string; visual?: string; design?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || !can(member, 'brand.manage') || member.tenant.suspended) redirect('/dashboard')
  const { tenant } = member
  const where = { tenantId: tenant.id }
  const [media, professionals, services, products, query] = await Promise.all([
    db.mediaAsset.findMany({ where }), db.professional.findMany({ where }), db.service.findMany({ where }), db.product.findMany({ where }), searchParams
  ])
  const targets = { PROFESSIONAL: professionals, SERVICE: services, PRODUCT: products }
  const kinds = Object.keys(names) as Array<keyof typeof names>
  const cover = media.find(item => item.kind === 'COVER')?.key ?? tenant.coverKey
  const logo = media.find(item => item.kind === 'LOGO')?.key
  const design = readPublicDesign(tenant.publicDesignDraft ?? tenant.publicDesign)
  const publicPath = '/estabelecimento/' + encodeURIComponent(tenant.slug)
  const messages: Record<string, string> = { publicado: 'Alterações publicadas.', rascunho: 'Rascunho salvo. Visualize e publique quando estiver pronto.', dados: 'Confira os destaques e selecione até seis itens de cada tipo.', 'sem-rascunho': 'Ainda não há um rascunho para publicar.' }
  const profile = media.find(item => item.kind === 'PROFILE')?.key
  return <MerchantShell member={member} current="/personalizacao">
    <h1>Personalização</h1>
    {!tenant.active && <p role="status">Prepare sua página antes de assinar. A prévia é privada e as reservas ficam indisponíveis até a ativação.</p>}<ErrorNote error={query.erro} />
    <article><h2>Página pública</h2><form action={brandSettings.bind(null, 'profile')}>
      <Field label="Nome comercial" name="name" value={tenant.name} />
      <label>Descrição<textarea name="description" maxLength={1000} defaultValue={tenant.description} /></label>
      <Field label="Endereço" name="address" value={tenant.address} required={false} />
      <Field label="Cor principal" name="color" type="color" value={tenant.color} />
      <label>Tema<select name="theme" defaultValue={tenant.theme}><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
      <Field label="Endereço do perfil no Instagram" name="instagramUrl" type="url" required={false} value={tenant.instagramUrl ?? ''} />
      <Field label="WhatsApp com DDI" name="contactPhone" type="tel" required={false} value={tenant.contactPhone ?? ''} />
      <label>Políticas de atendimento<textarea name="policies" maxLength={1000} defaultValue={tenant.policies} /></label>
      <button>Salvar alterações</button>
    </form></article>
    {member.role === 'ADMIN' && <article><h2>Endereço público</h2><p>O endereço anterior continuará levando à sua página.</p>
      <form action={brandSettings.bind(null, 'address')} className="inline"><Field label="Endereço (letras minúsculas, números e hífens)" name="slug" value={tenant.slug} /><button>Salvar endereço</button></form>
    </article>}
    <article><h2>Imagens</h2>
      {kinds.map(kind => {
        const options = kind in targets ? targets[kind as keyof typeof targets] : undefined
        if (options && !options.length) return null
        return <details key={kind}><summary>{names[kind]}</summary><form className="inline" action={brandSettings.bind(null, 'upload')}>
          <input type="hidden" name="kind" value={kind} />
          {options && <label>Item<select name="target">{options.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
          <label>Imagem<input type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label><button>Salvar imagem</button>
        </form></details>
      })}
      <div className="grid">{media.map(item => <div key={item.id}>
        <img className="cover" src={'/api/imagens/' + item.key} alt={names[item.kind]} />
        <form action={brandSettings.bind(null, 'delete')}><input type="hidden" name="id" value={item.id} /><button className="outline">Excluir {names[item.kind].toLowerCase()}</button></form>
      </div>)}</div>
    </article>
    <article><h2>Apresentação da página pública</h2>
      {query.design && messages[query.design] && <p role="status" className={query.design === 'dados' ? 'error' : 'success'}>{messages[query.design]}</p>}
      <form action={updatePublicDesign}>
        <div className="inline">
          <Field label="Cor secundária" name="secondaryColor" type="color" value={design.secondaryColor} />
          <label>Botões<select name="buttonStyle" defaultValue={design.buttonStyle}><option value="rounded">Cantos arredondados</option><option value="pill">Pílula</option></select></label>
          <label>Primeira seção<select name="layout" defaultValue={design.layout}><option value="booking">Agendamento</option><option value="products">Produtos</option></select></label>
        </div>
        <div className="grid">
          <fieldset><legend>Produtos em destaque (até seis)</legend>{products.filter(item => item.published && !item.archivedAt).map(item => <label className="check" key={item.id}><input type="checkbox" name="productIds" value={item.id} defaultChecked={design.productIds.includes(item.id)} />{item.name}</label>)}</fieldset>
          <fieldset><legend>Serviços em destaque (até seis)</legend>{services.filter(item => item.active && !item.archivedAt).map(item => <label className="check" key={item.id}><input type="checkbox" name="serviceIds" value={item.id} defaultChecked={design.serviceIds.includes(item.id)} />{item.name}</label>)}</fieldset>
        </div>
        <div className="inline"><button name="command" value="save">Salvar rascunho</button><Link className="button outline" href={publicPath + '?previa=1'}>Visualizar página</Link></div>
      </form>
      {tenant.active && tenant.publicDesignDraft !== null && <form action={updatePublicDesign}><button name="command" value="publish">Publicar</button></form>}
    </article>
    <article><h2>Prévia da apresentação</h2>
      <nav className="row" aria-label="Tamanho da prévia"><Link href="/personalizacao?visual=computador">Computador</Link><Link href="/personalizacao?visual=celular">Celular</Link></nav>
      <section className={'public-title profile-preview ' + (query.visual === 'celular' ? 'preview-mobile ' : '') + (tenant.theme === 'dark' ? 'dark-profile' : '')} style={{ '--accent': tenant.color } as React.CSSProperties}>
        {cover && <img className="cover" src={'/api/imagens/' + cover} alt="" />}
        {logo && <img width={64} height={64} className="profile-logo" src={'/api/imagens/' + logo} alt="" />}
        {profile && <img width={96} height={96} className="profile-logo" src={'/api/imagens/' + profile} alt="" />}
        <h2>{tenant.name}</h2><p>{tenant.description}</p><p>{tenant.address}</p>
      </section>
      {tenant.active && <Link href={publicPath}>Visualizar página publicada</Link>}
    </article>
  </MerchantShell>
}
