import Link from 'next/link'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3, Bell, Boxes, CalendarDays, CircleHelp, ClipboardList, CreditCard, ExternalLink,
  House, LogOut, Menu, MessageCircle, Package, Palette, Receipt, RotateCcw, Scissors,
  Settings, ShoppingBag, Store, Tag, UserRound, UserRoundCog, UsersRound, Wallet, Zap
} from 'lucide-react'
import type { membership } from '@/lib/auth'
import { can, type Permission } from '@/lib/permissions'
import { logout } from './actions'
import { Brand } from './ui'
import styles from './merchant-shell.module.css'

export type MerchantMember = NonNullable<Awaited<ReturnType<typeof membership>>>
type Entry = { href: string; label: string; icon: LucideIcon; scopes?: Permission[]; admin?: boolean; availableWithoutPlan?: boolean; show?: boolean }

function merchantMenu(member: MerchantMember) {
  const enabled = member.tenant.active && !member.tenant.suspended
  const groups: { label: string; entries: Entry[] }[] = [
    { label: 'Operação', entries: [
      { href: '/dashboard', label: 'Visão geral', icon: House, availableWithoutPlan: true },
      { href: member.role === 'PROFESSIONAL' ? '/dashboard#minha-agenda' : '/agenda', label: 'Agenda', icon: CalendarDays, scopes: ['agenda.read'] },
      { href: '/dashboard?secao=clientes', label: 'Clientes', icon: UsersRound, scopes: ['customer.read', 'customer.create'] },
      { href: '/dashboard?secao=profissionais', label: 'Profissionais', icon: UserRoundCog, scopes: ['team.professionals'] },
      { href: '/equipe', label: 'Equipe', icon: UsersRound, admin: true }
    ] },
    { label: 'Catálogo', entries: [
      { href: '/catalogo', label: 'Produtos', icon: Package, scopes: ['product.manage'] },
      { href: '/catalogo?secao=servicos', label: 'Serviços', icon: Scissors, scopes: ['service.read', 'service.manage'] },
      { href: '/catalogo?secao=categorias', label: 'Categorias', icon: Tag, scopes: ['product.manage'] },
      { href: '/comercial#pedidos', label: 'Pedidos', icon: ShoppingBag, scopes: ['finance.read'] },
      { href: '/comercial#vendas', label: 'Vendas', icon: ShoppingBag, scopes: ['sale.create'] },
      { href: '/comercial#estoque', label: 'Estoque', icon: Boxes, scopes: ['stock.manage', 'product.manage'] }
    ] },
    { label: 'Financeiro', entries: [
      { href: '/comercial', label: 'Fluxo de caixa', icon: Wallet, scopes: ['finance.read'] },
      { href: '/recebimentos', label: 'Recebimentos e estornos', icon: RotateCcw, scopes: ['finance.read'] },
      { href: '/comissoes', label: 'Comissões', icon: Receipt, admin: true },
      { href: '/relatorios', label: 'Relatórios', icon: BarChart3, scopes: ['finance.read'] }
    ] },
    { label: 'Relacionamento', entries: [
      { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, scopes: ['whatsapp.manage'] },
      { href: '/whatsapp#preferencias', label: 'Marketing', icon: Bell, scopes: ['whatsapp.manage'] },
      { href: '/automacoes', label: 'Automações', icon: Zap, scopes: ['agenda.edit', 'whatsapp.manage'] }
    ] },
    { label: 'Estabelecimento', entries: [
      { href: '/personalizacao', label: 'Personalização', icon: Palette, scopes: ['brand.manage'] },
      { href: '/assinatura', label: 'Minha assinatura', icon: CreditCard, admin: true, availableWithoutPlan: true },
      { href: '/dashboard?secao=configuracoes', label: 'Configurações', icon: Settings, scopes: ['settings.manage'] },
      { href: '/primeiro-acesso', label: 'Primeiro acesso', icon: ClipboardList, admin: true, availableWithoutPlan: true },
      { href: '/conta', label: 'Minha conta', icon: UserRound, availableWithoutPlan: true },
      { href: '/ajuda', label: 'Ajuda e suporte', icon: CircleHelp, availableWithoutPlan: true }
    ] }
  ]
  return groups.flatMap(group => {
    const entries = group.entries.filter(entry =>
      (enabled || entry.availableWithoutPlan) && (!entry.admin || member.role === 'ADMIN') &&
      (!entry.scopes || entry.scopes.some(scope => can(member, scope))) && entry.show !== false
    )
    return entries.length ? [{ ...group, entries }] : []
  })
}

function MerchantNavigation({ groups, current }: { groups: ReturnType<typeof merchantMenu>; current: string }) {
  return <nav aria-label="Menu do comerciante" className={styles.navigation}>
    {groups.map(group => <div key={group.label} className={styles.group}>
      <div className={styles.groupLabel}>{group.label}</div>
      {group.entries.map(({ href, label, icon: Icon }) =>
        <Link key={href} href={href} aria-current={href === current ? 'page' : undefined}>
          <Icon aria-hidden size={18} /> <span>{label}</span>
        </Link>
      )}
    </div>)}
    <form action={logout} className={styles.logout}><button type="submit"><LogOut aria-hidden size={18} /> Sair</button></form>
  </nav>
}

export function MerchantShell({ member, current, children }: { member: MerchantMember; current: string; children: ReactNode }) {
  const groups = merchantMenu(member)
  const { tenant } = member
  const active = tenant.active && !tenant.suspended
  const label = groups.flatMap(group => group.entries).find(entry => entry.href === current)?.label
  return <div className={styles.workspace + (tenant.theme === 'dark' ? ' dark-workspace' : '')}>
    <a className={styles.skip} href="#conteudo-comerciante">Ir para o conteúdo</a>
    <aside className={styles.sidebar}>
      <Brand />
      <div className={styles.tenant}>
        <span className={styles.initial} aria-hidden>{tenant.name[0]?.toLocaleUpperCase('pt-BR')}</span>
        <div><strong>{tenant.name}</strong><span>{tenant.suspended ? 'Acesso suspenso' : active ? 'Estabelecimento ativo' : 'Aguardando assinatura'}</span></div>
      </div>
      <MerchantNavigation groups={groups} current={current} />
    </aside>
    <div className={styles.stage}>
      <header className={styles.topbar}>
        <div className={styles.desktopCrumb}><Store aria-hidden size={19} /> <span>{label ?? 'Painel do comerciante'}</span></div>
        <div className={styles.mobileBrand}><Brand /></div>
        <div className={styles.topActions}>
          {active && <Link href={'/estabelecimento/' + encodeURIComponent(tenant.slug)} className={styles.publicLink}>
            <ExternalLink aria-hidden size={16} /> <span>Página pública</span>
          </Link>}
          <Link href="/ajuda" aria-label="Ajuda e suporte" className={styles.iconLink}><CircleHelp aria-hidden size={21} /></Link>
          <Link href="/conta" aria-label="Minha conta" className={styles.iconLink}><UserRound aria-hidden size={21} /></Link>
        </div>
      </header>
      <details className={styles.mobileMenu}>
        <summary><Menu aria-hidden size={20} /> Menu <span>{tenant.name}</span></summary>
        <MerchantNavigation groups={groups} current={current} />
      </details>
      <main id="conteudo-comerciante" className={'content ' + styles.content}>{children}</main>
    </div>
  </div>
}
