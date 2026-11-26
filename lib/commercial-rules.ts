export const commercialLabels = {
  REGISTERED: 'Cadastro recebido', WELCOME: 'Boas-vindas', SUBSCRIBED: 'Assinatura confirmada',
  PAID: 'Pagamento confirmado', TRIAL_END: 'Avaliação próxima do fim',
  DUE_7: 'Vencimento em sete dias', DUE_3: 'Vencimento em três dias', DUE_1: 'Vencimento amanhã',
  RENEWAL: 'Renovação prevista', DECLINED: 'Pagamento recusado', OVERDUE: 'Fatura atrasada',
  SUSPENDED: 'Acesso suspenso', REACTIVATED: 'Acesso reativado', CANCELED: 'Assinatura cancelada',
  ANNUAL: 'Renovação anual'
} as const

export type CommercialKind = keyof typeof commercialLabels
export const commercialKinds = Object.keys(commercialLabels) as CommercialKind[]
export const leadDefaults: Partial<Record<CommercialKind, number>> = { DUE_7: 7, DUE_3: 3, DUE_1: 1, TRIAL_END: 3, RENEWAL: 5, ANNUAL: 15 }
export const defaultCommercialTemplate = '{evento}\n\nOlá! Este é um aviso do CS Agenda Pro para {estabelecimento}.\n{detalhes}'
