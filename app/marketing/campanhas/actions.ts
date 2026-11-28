'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AgendaError } from '@/lib/agenda'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { mailConfigured } from '@/lib/mail'

export async function queueCampaign(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'whatsapp.manage')) redirect('/dashboard')
  let result = '/marketing/campanhas?resultado=salvo'
  try {
    const data = z.object({
      id: z.uuid(), channel: z.enum(['EMAIL', 'WHATSAPP']), title: z.string().trim().min(2).max(100),
      body: z.string().trim().min(3).max(1000), confirm: z.literal('yes')
    }).parse(Object.fromEntries(form))
    const { tenantId } = member
    if (data.channel === 'EMAIL' && !await mailConfigured()) throw new AgendaError('O envio de e-mail ainda não foi configurado.')
    if (data.channel === 'WHATSAPP' && !member.tenant.whatsappInstance) throw new AgendaError('Conecte o WhatsApp para enviar campanhas.')
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
      if (!await tx.tenant.count({ where: { id: tenantId, active: true, suspended: false } })) throw new AgendaError('Estabelecimento indisponível.')
      const existing = await tx.campaign.findUnique({ where: { tenantId_id: { tenantId, id: data.id } } })
      if (existing) {
        if (existing.channel !== data.channel || existing.title !== data.title || existing.body !== data.body) throw new AgendaError('Atualize a página para enviar outra campanha.')
        return
      }
      if (await tx.campaign.count({ where: { tenantId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }) >= 3) {
        throw new AgendaError('Limite de três campanhas a cada 24 horas.')
      }
      const candidates = await tx.consumerProfile.findMany({
        where: { tenantId, ...(data.channel === 'EMAIL' ? { marketingEmailAt: { not: null }, user: { emailVerifiedAt: { not: null } } } : { marketingPhoneAt: { not: null } }) },
        select: { userId: true, phone: true, marketingEmail: true, marketingPhone: true, user: { select: { email: true } } }, orderBy: { userId: 'asc' }
      })
      const recipients = candidates.filter(row => data.channel === 'EMAIL' ? row.marketingEmail === row.user.email : row.marketingPhone === row.phone)
      const unique = new Map(recipients.map(row => [data.channel === 'EMAIL' ? row.user.email : row.phone, row.userId]))
      if (!unique.size) throw new AgendaError('Nenhum cliente autorizou esse canal.')
      if (unique.size > 250) throw new AgendaError('Uma campanha comporta até 250 destinatários autorizados.')
      const campaign = await tx.campaign.create({ data: { id: data.id, channel: data.channel, title: data.title, body: data.body, tenantId } })
      await tx.campaignDelivery.createMany({ data: [...unique.values()].map(userId => ({ tenantId, campaignId: campaign.id, userId })) })
    })
  } catch (error) {
    result = '/marketing/campanhas?erro=' + encodeURIComponent(error instanceof AgendaError ? error.message : 'Preencha o assunto, a mensagem e a confirmação.')
  }
  redirect(result)
}
