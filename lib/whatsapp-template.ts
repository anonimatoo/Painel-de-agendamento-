export const messageTemplates = {
  REMINDER: 'Olá, {cliente}! Seu atendimento em {estabelecimento} está marcado para {data} às {hora}.',
  CONFIRMED: '{estabelecimento}: seu horário de {servico} foi confirmado para {data} às {hora}.',
  PAID: '{estabelecimento}: pagamento recebido. Atendimento confirmado para {data} às {hora}.',
  CANCELED: '{estabelecimento}: o atendimento de {data} às {hora} foi cancelado.',
  RESCHEDULED: '{estabelecimento}: o atendimento foi reagendado para {data} às {hora}.',
  PAYMENT_PENDING: '{estabelecimento}: o pagamento do seu horário ainda está pendente. {pagamento}',
  COMPLETED: '{estabelecimento}: agradecemos sua visita, {cliente}!',
  FEEDBACK: '{estabelecimento}: como foi seu atendimento? Deixe sua avaliação em {avaliacao}',
  BIRTHDAY: 'Feliz aniversário, {cliente}! São os votos de {estabelecimento}.',
  RETURN: 'Olá, {cliente}! Se quiser agendar seu retorno em {estabelecimento}, consulte {agendamento}.'
} as const

export const messageLabels: Record<keyof typeof messageTemplates, string> = {
  REMINDER: 'Lembrete', CONFIRMED: 'Confirmação', PAID: 'Pagamento confirmado', CANCELED: 'Cancelamento',
  RESCHEDULED: 'Reagendamento', PAYMENT_PENDING: 'Pagamento pendente', COMPLETED: 'Atendimento concluído',
  FEEDBACK: 'Avaliação', BIRTHDAY: 'Aniversário', RETURN: 'Retorno'
}

export const messageVariables = {
  cliente: 'Nome do cliente', estabelecimento: 'Estabelecimento', servico: 'Serviço', profissional: 'Profissional',
  data: 'Data', hora: 'Hora', valor: 'Valor', pagamento: 'Link de pagamento', agendamento: 'Link de agendamento', avaliacao: 'Link de avaliação'
} as const

export function renderMessage(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-z]+)\}/g, (expected, key: string) => Object.hasOwn(values, key) ? values[key] : expected)
}
