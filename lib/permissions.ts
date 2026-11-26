import type { Role } from '@prisma/client'

export const permissionLabels = {
  'agenda.read': 'Visualizar agenda', 'agenda.edit': 'Alterar agenda e registrar atendimentos', 'agenda.cancel': 'Cancelar agendamentos',
  'customer.read': 'Visualizar clientes', 'customer.create': 'Cadastrar clientes', 'customer.edit': 'Editar clientes e preferências',
  'service.read': 'Visualizar serviços', 'service.manage': 'Gerenciar serviços',
  'product.manage': 'Gerenciar produtos', 'stock.manage': 'Gerenciar estoque', 'sale.create': 'Registrar e cancelar vendas',
  'finance.read': 'Consultar financeiro', 'finance.write': 'Registrar receitas e despesas', 'finance.refund': 'Solicitar estornos',
  'team.professionals': 'Gerenciar profissionais e horários', 'whatsapp.manage': 'Gerenciar WhatsApp',
  'brand.manage': 'Personalizar estabelecimento', 'report.export': 'Exportar relatórios'
} as const

export type Permission = keyof typeof permissionLabels
export const permissionKeys = Object.keys(permissionLabels) as Permission[]
const defaults: Record<Role, Permission[]> = {
  ADMIN: permissionKeys,
  MANAGER: ['agenda.read','agenda.edit','agenda.cancel','customer.read','customer.create','customer.edit','service.read','service.manage',
    'product.manage','stock.manage','sale.create','finance.read','finance.write','team.professionals','report.export'],
  RECEPTION: ['agenda.read','agenda.edit','agenda.cancel','customer.read','customer.create'],
  PROFESSIONAL: ['agenda.read'],
  FINANCE: ['finance.read','finance.write','report.export'],
  READONLY: ['agenda.read','customer.read','service.read']
}
export function defaultPermissions(role: Role) {
  return defaults[role]
}

export function can(member: { role: Role; permissionsCustomized: boolean; permissions: string[] } | null | undefined, permission: Permission) {
  if (!member) return false
  if (member.role === 'ADMIN') return true
  // Professional-grade identities remain confined to their own agenda.
  if (member.role === 'PROFESSIONAL' && permission !== 'agenda.read') return false
  return (member.permissionsCustomized ? member.permissions : defaults[member.role]).includes(permission)
}
