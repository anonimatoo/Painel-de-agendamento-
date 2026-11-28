'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { allowAttempt } from '@/lib/account-security'
import { AgendaError, closeAppointment, rescheduleAppointment } from '@/lib/agenda'
import { endSession, hashPassword, membership, startSession, userSession, verifyPassword } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { activeStore, consumerDeadline, consumerPath, currentConsumer } from '@/lib/consumer'
import { requestConsumerRefund } from '@/lib/connected-refunds'
import { db } from '@/lib/db'
import { signupEmail, signupPassword } from '@/lib/registration'
import { beginSocial, clearSocialSignup, pendingSocialSignup } from '@/lib/social-auth'
import { isSocialProvider } from '@/lib/social-oidc'

const contact = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().transform(value => value.replace(/\D/g, '')).pipe(z.string().regex(/^55\d{10,11}$/))
})

async function finish(path: string, operation: () => Promise<string>, registering = false) {
  let target: string
  try {
    target = await operation()
  } catch (error) {
    unstable_rethrow(error)
    const message = error instanceof AgendaError ? error.message
      : error instanceof z.ZodError ? 'Confira o nome, e-mail, senha e telefone nos campos preenchidos.'
      : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 'Entre com o método que você já utiliza.'
      : 'Não foi possível concluir. Tente novamente.'
    target = path + '?erro=' + encodeURIComponent(message) + (registering ? '&criar=1' : '')
  }
  redirect(target)
}

export async function consumerAccess(slug: string, mode: 'login' | 'register' | 'social' | 'profile', form: FormData) {
  const path = consumerPath(slug)
  await finish(path, async () => {
    const store = await activeStore(slug)
    if (!store) throw new AgendaError('Estabelecimento indisponível.')
    if (mode === 'profile') {
      const user = await userSession()
      if (!user || user.platformAdmin) throw new AgendaError('Entre na sua conta para continuar.')
      const values = contact.parse(Object.fromEntries(form))
      await db.consumerProfile.upsert({
        where: { tenantId_userId: { tenantId: store.id, userId: user.id } },
        update: values, create: { ...values, tenantId: store.id, userId: user.id }
      })
      return path + '?perfil=1#meus-dados'
    }
    const social = mode === 'social' ? await pendingSocialSignup() : null
    if (mode === 'social' && social?.consumerSlug !== slug) throw new AgendaError('Inicie novamente pelo provedor.')
    const email = social?.email ?? signupEmail.parse(form.get('email'))
    if (!await allowAttempt('consumer-' + mode, email, 10, 600)) throw new AgendaError('Aguarde alguns minutos antes de tentar novamente.')
    const password = social ? undefined : signupPassword.parse(form.get('password'))
    if (mode === 'login') {
      const user = await db.user.findUnique({ where: { email } })
      if (!(await verifyPassword(password!, user?.password)) || !user || user.platformAdmin) throw new AgendaError('E-mail ou senha inválidos.')
      await startSession(user.id, false, true)
    } else {
      const values = contact.parse(Object.fromEntries(form))
      const passwordHash = password ? await hashPassword(password) : undefined
      const user = await db.$transaction(async tx => {
        if (social) {
          const [provider] = await tx.$queryRaw<{ enabled: boolean; revision: string }[]>`
            SELECT enabled, revision FROM "SocialProviderSettings" WHERE provider = ${social.provider} FOR SHARE`
          if (!provider?.enabled || provider.revision !== social.revision) throw new AgendaError('Inicie novamente pelo provedor.')
        }
        if (await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) {
          throw new AgendaError('Entre com o método que você já utiliza.')
        }
        return tx.user.create({ data: {
          email, password: passwordHash, emailVerifiedAt: social?.emailVerified ? new Date() : undefined,
          socialIdentities: social ? { create: { provider: social.provider, subject: social.subject } } : undefined,
          consumerProfiles: { create: { tenantId: store.id, ...values } }
        } })
      })
      await startSession(user.id, false, true)
      if (social) await clearSocialSignup()
    }
    return path
  }, mode === 'register')
}

export async function consumerSocial(slug: string, provider: string) {
  const path = consumerPath(slug)
  await finish(path, async () => {
    if (typeof provider !== 'string' || !isSocialProvider(provider) || !await activeStore(slug)) throw new AgendaError('Provedor indisponível.')
    return await beginSocial(provider, undefined, slug) ?? path + '?social=erro'
  })
}

export async function consumerLogout(slug: string) {
  await endSession()
  redirect(consumerPath(slug))
}

export async function updateConsumerNotice(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member || !can(member, 'settings.manage') || !member.tenant.active || member.tenant.suspended) redirect('/login')
  const value = z.union([z.literal(''), z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().max(168))]).safeParse(form.get('hours'))
  if (!value.success) redirect('/dashboard?secao=configuracoes&erro=' + encodeURIComponent('Informe entre 0 e 168 horas.') + '#configuracoes')
  await db.tenant.update({ where: { id: member.tenantId }, data: { consumerNoticeHours: value.data === '' ? null : value.data,
    ...(member.role === 'ADMIN' ? { automaticAppointmentRefunds: value.data !== '' && form.has('automaticAppointmentRefunds') } : {}) } })
  redirect('/dashboard?secao=configuracoes&politica=1#configuracoes')
}

export async function changeConsumerAppointment(slug: string, appointmentId: string, mode: 'cancel' | 'reschedule', form: FormData) {
  const path = consumerPath(slug)
  await finish(path, async () => {
    const store = await activeStore(slug)
    const profile = store ? await currentConsumer(store.id) : null
    const after = store ? consumerDeadline(store.consumerNoticeHours) : null
    if (!store || !profile || !after) throw new AgendaError('Alterações online estão indisponíveis para este atendimento.')
    const scope = { id: appointmentId, tenantId: store.id, consumerUserId: profile.userId, startsAt: { gt: after }, status: 'CONFIRMED' as const }
    const appointment = await db.appointment.findFirst({ where: scope })
    if (!appointment) throw new AgendaError('Atendimento indisponível ou fora do prazo de alteração.')
    if (mode === 'reschedule') {
      const start = new Date(z.iso.datetime().parse(form.get('startsAt')))
      await rescheduleAppointment(store, appointmentId, start, profile.userId, { userId: profile.userId, after })
    } else if (appointment.paidAt) {
      const canceled = await requestConsumerRefund(store.id, appointmentId, profile.userId, after)
      return path + (canceled ? '?alteracao=cancelada' : '?alteracao=solicitada') + '#agendamentos'
    } else {
      await closeAppointment(store.id, appointmentId, 'CANCELED', profile.userId, { userId: profile.userId, after })
    }
    return path + '?alteracao=concluida#agendamentos'
  })
}
