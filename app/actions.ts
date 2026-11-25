'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { endSession, hashPassword, membership, startSession, userSession, verifyPassword } from '@/lib/auth'
import { AgendaError, book } from '@/lib/agenda'
import { stripe } from '@/lib/stripe'
import { allowAttempt, consumeAccountToken, mailConfigured, sendAccountLink } from '@/lib/account-security'
import { uploadCover } from '@/lib/storage'

const title = z.string().trim().min(2).max(100)
const text = z.string().trim().max(1000)
const id = z.string().min(1).max(100)
const slug = z.string().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const cents = z.coerce.number().int().min(0).max(100_000_000)
const phone = z.string().transform(s => s.replace(/\D/g, '')).pipe(z.string().regex(/^55\d{10,11}$/))
const base = () => new URL(process.env.APP_URL ?? 'http://localhost:3000').origin
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).transform(s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)))
const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(12).max(128) })
const pay = z.object({ planId: id, cycle: z.enum(['monthly', 'annual']) })

async function perform(operation: () => Promise<string>, fallback: string) {
  let target: string
  try {
    target = await operation()
  } catch (error) {
    unstable_rethrow(error)
    let message = 'Não foi possível concluir esta operação. Tente novamente em instantes.'
    if (error instanceof z.ZodError) message = 'Confira os dados informados e tente novamente.'
    else if (error instanceof AgendaError) message = error.message
    else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') message = 'Já existe um cadastro com esses dados.'
    else if (error instanceof Error && /appointment_no_overlap|23P01/.test(error.message)) message = 'Esse horário acabou de ser reservado.'
    else console.error('agenda-action', error instanceof Error ? error.name : 'unknown')
    target = fallback + '?erro=' + encodeURIComponent(message)
  }
  redirect(target)
}

export async function account(action: 'login' | 'register', form: FormData) {
  await perform(async () => {
    const data = credentials.parse(Object.fromEntries(form))
    if (!(await allowAttempt(action, data.email, action === 'login' ? 10 : 5, 600))) {
      throw new AgendaError('Aguarde alguns minutos antes de tentar novamente.')
    }
    if (action === 'login') {
      const user = await db.user.findUnique({ where: { email: data.email } })
      if (!(await verifyPassword(data.password, user?.password)) || !user) throw new AgendaError('E-mail ou senha inválidos.')
      await startSession(user.id)
      return user.platformAdmin ? '/super-admin' : '/dashboard'
    }
    const { business, link } = z.object({ business: title, link: slug }).parse(Object.fromEntries(form))
    const user = await db.user.create({ data: {
      email: data.email, password: await hashPassword(data.password),
      memberships: { create: { role: 'ADMIN', tenant: { create: { name: business, slug: link } } } }
    } })
    await startSession(user.id)
    if (mailConfigured()) await sendAccountLink(user, 'EMAIL_VERIFY').catch(() => console.error('email-verification-delivery'))
    return '/dashboard'
  }, action === 'login' ? '/login' : '/cadastro')
}

export async function accountLink(operation: 'request' | 'reset' | 'resend' | 'verify' | 'revoke', form: FormData) {
  await perform(async () => {
    if (operation === 'request') {
      const email = credentials.shape.email.parse(form.get('email'))
      if (await allowAttempt('password-reset', email, 3, 1800)) {
        const user = await db.user.findUnique({ where: { email } })
        if (user && mailConfigured()) await sendAccountLink(user, 'PASSWORD_RESET').catch(() => console.error('password-reset-delivery'))
      }
      return '/conta?solicitado=1'
    }
    if (operation === 'reset' || operation === 'verify') {
      const token = z.string().max(43).parse(form.get('token'))
      const password = operation === 'reset' ? credentials.shape.password.parse(form.get('password')) : undefined
      if (!(await consumeAccountToken(token, operation === 'reset' ? 'PASSWORD_RESET' : 'EMAIL_VERIFY', password))) {
        throw new AgendaError('Este link expirou ou já foi utilizado. Solicite um novo link.')
      }
      return '/login?conta=' + operation
    }
    const user = await userSession()
    if (!user) return '/login'
    if (operation === 'revoke') {
      await db.session.deleteMany({ where: { userId: user.id } })
      await endSession()
      return '/login'
    }
    if (operation === 'resend' && !user.emailVerifiedAt && mailConfigured() && await allowAttempt('verify-email', user.id, 3, 1800)) {
      await sendAccountLink(user, 'EMAIL_VERIFY')
    }
    return '/conta?solicitado=1'
  }, '/conta')
}

export async function logout() {
  await endSession()
  redirect('/')
}

export async function manage(operation: string, form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user) return '/login'
    const member = await membership(user.id)
    if (!member) throw new AgendaError('Seu acesso não permite esta operação.')
    const { tenant } = member
    const tenantId = tenant.id
    const body = Object.fromEntries(form)
    if (operation === 'subscription' || operation === 'portal') {
      if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
      const api = stripe()
      if (operation === 'portal' || tenant.stripeCustomerId && await db.subscription.count({ where: { tenantId, status: { notIn: ['canceled', 'incomplete_expired'] } } })) {
        if (!tenant.stripeCustomerId) throw new AgendaError('Você ainda não possui uma assinatura.')
        const portal = await api.billingPortal.sessions.create({ customer: tenant.stripeCustomerId, return_url: base() + '/dashboard' })
        return portal.url
      }
      const data = pay.parse(body)
      const plan = await db.plan.findFirst({ where: { id: data.planId, active: true } })
      if (!plan) throw new AgendaError('Esse plano não está disponível.')
      const customer = tenant.stripeCustomerId ?? (await api.customers.create({ email: user.email, name: tenant.name }, { idempotencyKey: 'tenant:' + tenantId })).id
      await db.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customer } })
      const session = await api.checkout.sessions.create({
        mode: 'subscription', customer, line_items: [{ price: data.cycle === 'monthly' ? plan.monthlyPriceId : plan.annualPriceId, quantity: 1 }],
        success_url: base() + '/dashboard?assinatura=recebida', cancel_url: base() + '/dashboard'
      }, { idempotencyKey: ['billing', tenantId, plan.id, data.cycle, Math.floor(Date.now() / 1_800_000)].join(':') })
      if (!session.url) throw new AgendaError('Não foi possível iniciar o pagamento.')
      return session.url
    }
    if (!tenant.active || tenant.suspended) throw new AgendaError('Seu estabelecimento precisa de uma assinatura ativa.')
    const manager = member.role === 'ADMIN' || member.role === 'MANAGER'
    if (!manager && !(member.role === 'RECEPTION' && ['customer','appointment'].includes(operation))) throw new AgendaError('Seu acesso não permite esta operação.')
    switch (operation) {
      case 'settings': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        const data = z.object({
          name: title, description: text, address: text, color: z.string().regex(/^#[\da-f]{6}$/i),
          reminderMinutes: z.coerce.number().int().min(0).max(10080)
        }).parse(body)
        const onlinePayment = form.has('onlinePayment')
        if (onlinePayment && (!tenant.stripeAccountId || !(await stripe().accounts.retrieve(tenant.stripeAccountId)).charges_enabled)) {
          throw new AgendaError('Conclua a configuração da conta para aceitar pagamentos.')
        }
        await db.tenant.update({ where: { id: tenantId }, data: {
          ...data, reminderMinutes: data.reminderMinutes || null,
          onlinePayment
        } })
        break
      }
      case 'cover': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        const image = form.get('cover')
        if (!(image instanceof File)) throw new AgendaError('Selecione uma imagem.')
        const coverKey = await uploadCover(tenantId, image)
        await db.tenant.update({ where: { id: tenantId }, data: { coverKey } })
        break
      }
      case 'service':
        await db.service.create({ data: { tenantId, ...z.object({ name: title, description: text, cents, duration: z.coerce.number().int().min(5).max(720) }).parse(body) } })
        break
      case 'professional':
        await db.professional.create({ data: { tenantId, ...z.object({ name: title }).parse(body) } })
        break
      case 'assignment':
        await db.assignment.create({ data: { tenantId, ...z.object({ professionalId: id, serviceId: id }).parse(body) } })
        break
      case 'hours': {
        const data = z.object({ professionalId: id, weekday: z.coerce.number().int().min(1).max(7), startMinute: clock, endMinute: clock }).parse(body)
        if (data.startMinute >= data.endMinute) throw new AgendaError('O horário final deve ser após o início.')
        await db.workHours.create({ data: { tenantId, ...data } })
        break
      }
      case 'customer':
        await db.customer.create({ data: { tenantId, ...z.object({ name: title, phone }).parse(body) } })
        break
      case 'product':
        await db.product.create({ data: { tenantId, ...z.object({ name: title, cents, stock: z.coerce.number().int().min(0).max(1_000_000) }).parse(body) } })
        break
      case 'appointment': {
        const data = z.object({ id, status: z.enum(['COMPLETED', 'CANCELED']) }).parse(body)
        const result = await db.appointment.updateMany({
          where: { id: data.id, tenantId, status: 'CONFIRMED', ...(data.status === 'CANCELED' ? { paidAt: null } : { startsAt: { lte: new Date() } }) },
          data: { status: data.status }
        })
        if (!result.count) throw new AgendaError('Não foi possível atualizar esse atendimento.')
        break
      }
      case 'connect': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        const api = stripe()
        const account = tenant.stripeAccountId ?? (await api.accounts.create({
          country: 'BR', type: 'express', email: user.email,
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } }
        }, { idempotencyKey: 'connect:' + tenantId })).id
        await db.tenant.update({ where: { id: tenantId }, data: { stripeAccountId: account } })
        const link = await api.accountLinks.create({
          account, type: 'account_onboarding', refresh_url: base() + '/dashboard', return_url: base() + '/dashboard'
        })
        return link.url
      }
      default:
        throw new AgendaError('Operação indisponível.')
    }
    return '/dashboard'
  }, '/dashboard')
}

export async function admin(operation: 'plan' | 'suspend' | 'whatsapp', form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin) return '/login'
    const body = Object.fromEntries(form)
    if (operation === 'plan') {
      const data = z.object({ name: title, description: title, monthlyCents: cents.min(100), annualCents: cents.min(100) }).parse(body)
      const api = stripe()
      const product = await api.products.create({ name: data.name, description: data.description })
      const [monthly, annual] = await Promise.all([
        api.prices.create({ product: product.id, unit_amount: data.monthlyCents, currency: 'brl', recurring: { interval: 'month' } }),
        api.prices.create({ product: product.id, unit_amount: data.annualCents, currency: 'brl', recurring: { interval: 'year' } })
      ])
      await db.plan.create({ data: { ...data, monthlyPriceId: monthly.id, annualPriceId: annual.id } })
    } else if (operation === 'whatsapp') {
      const data = z.object({ tenantId: id, instance: z.string().trim().regex(/^[\w-]{0,70}$/) }).parse(body)
      await db.tenant.update({ where: { id: data.tenantId }, data: { whatsappInstance: data.instance || null } })
    } else {
      const data = z.object({ tenantId: id, suspended: z.enum(['true', 'false']) }).parse(body)
      await db.$transaction([
        db.tenant.update({ where: { id: data.tenantId }, data: { suspended: data.suspended === 'true' } }),
        db.adminAudit.create({ data: { actorId: user.id, targetId: data.tenantId, action: data.suspended === 'true' ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED' } })
      ])
    }
    return '/super-admin'
  }, '/super-admin')
}

export async function reserve(link: string, form: FormData) {
  const path = '/estabelecimento/' + encodeURIComponent(link)
  await perform(async () => {
    const data = z.object({ serviceId: id, professionalId: id, startsAt: z.string().datetime(), name: title, phone }).parse(Object.fromEntries(form))
    const tenant = await db.tenant.findFirst({ where: { slug: link, active: true, suspended: false } })
    if (!tenant) throw new AgendaError('Agendamento indisponível.')
    const service = await db.service.findFirst({ where: { tenantId: tenant.id, id: data.serviceId, active: true } })
    if (!service) throw new AgendaError('Serviço indisponível.')
    const online = tenant.onlinePayment && service.cents > 0
    const account = tenant.stripeAccountId
    if (online && (!account || !(await stripe().accounts.retrieve(account)).charges_enabled)) throw new AgendaError('O pagamento está indisponível no momento.')
    const appointment = await book(tenant, { ...data, consent: form.has('consent'), online })
    if (!online || !account) return path + '?reserva=' + appointment.id
    const session = await stripe().checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'brl', unit_amount: appointment.cents, product_data: { name: 'Agendamento — ' + tenant.name } }, quantity: 1 }],
      metadata: { appointmentId: appointment.id },
      success_url: base() + path + '?reserva=pagamento', cancel_url: base() + path,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60
    }, { stripeAccount: account, idempotencyKey: 'appointment:' + appointment.id })
    await db.appointment.updateMany({ where: { id: appointment.id, status: 'PENDING' }, data: { checkoutId: session.id, expiresAt: new Date(session.expires_at * 1000) } })
    if (!session.url) throw new AgendaError('Não foi possível iniciar o pagamento.')
    return session.url
  }, path)
}
