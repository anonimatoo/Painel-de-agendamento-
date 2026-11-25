'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { changeStock, reverseSale } from '@/lib/commerce'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { endSession, hashPassword, membership, startSession, userSession, verifyPassword } from '@/lib/auth'
import { AgendaError, blockSchedule, book, closeAppointment, dayBounds, localDateTime, rescheduleAppointment } from '@/lib/agenda'
import { checkStripeConnection, pauseStripePayments, saveStripeConfiguration, stripeForNewPayments } from '@/lib/stripe-settings'
import { subscriptionCheckout } from '@/lib/billing'
import { connectWhatsApp, logoutWhatsApp, sendWhatsApp, whatsAppStatus } from '@/lib/evolution'
import { reserveOrder } from '@/lib/orders'
import { openAppointmentCheckout, reconcileAppointment, refundAppointment, refundOrder } from '@/lib/connect'
import { stripe } from '@/lib/stripe'
import { allowAttempt, consumeAccountToken, mailConfigured, sendAccountLink } from '@/lib/account-security'
import { finishMfaSetup, startMfaSetup, verifyMfa } from '@/lib/mfa'
import { deleteMedia, storeMedia } from '@/lib/storage'

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
      if (user.platformAdmin && user.mfaSecret) {
        const code = z.string().trim().max(6).parse(form.get('code') ?? '')
        if (!(await verifyMfa(user, code))) throw new AgendaError('Informe um código válido do seu aplicativo autenticador.')
        await startSession(user.id, true)
        return '/super-admin'
      }
      await startSession(user.id)
      return user.platformAdmin ? '/conta' : '/dashboard'
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

export async function setupMfa(_previous: { message?: string; secret?: string }, form: FormData): Promise<{ message?: string; secret?: string }> {
  try {
    const user = await userSession()
    if (!user?.platformAdmin || user.mfaSecret || !(await allowAttempt('mfa-setup', user.id, 8, 600))) {
      return { message: 'Esta operação está indisponível agora.' }
    }
    const password = credentials.shape.password.parse(form.get('password'))
    if (!(await verifyPassword(password, user.password))) return { message: 'Não foi possível confirmar sua senha.' }
    return { secret: await startMfaSetup(user.id) }
  } catch {
    return { message: 'Não foi possível iniciar a autenticação em duas etapas.' }
  }
}

export async function activateMfa(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin || user.mfaSecret || !(await allowAttempt('mfa-activate', user.id, 10, 600))) return '/conta'
    const code = z.string().trim().regex(/^\d{6}$/).parse(form.get('code'))
    if (!(await finishMfaSetup(user.id, code))) throw new AgendaError('Confira o código ou gere uma nova chave.')
    await startSession(user.id, true)
    return '/super-admin'
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
      if (operation === 'portal') {
        if (!tenant.stripeCustomerId) throw new AgendaError('Você ainda não possui uma assinatura.')
        const portal = await (await stripe()).billingPortal.sessions.create({ customer: tenant.stripeCustomerId, return_url: base() + '/assinatura' })
        return portal.url
      }
      if (mailConfigured() && !user.emailVerifiedAt) throw new AgendaError('Confirme seu e-mail antes de contratar uma assinatura.')
      return subscriptionCheckout({ tenantId, email: user.email, origin: base(), ...pay.parse(body) })
    }
    if (!tenant.active || tenant.suspended) throw new AgendaError('Seu estabelecimento precisa de uma assinatura ativa.')
    const manager = member.role === 'ADMIN' || member.role === 'MANAGER'
    if (!manager && !(member.role === 'RECEPTION' && ['customer', 'appointment', 'reschedule', 'wait-close'].includes(operation))) throw new AgendaError('Seu acesso não permite esta operação.')
    switch (operation) {
      case 'settings': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        const data = z.object({
          name: title, description: text, address: text, color: z.string().regex(/^#[\da-f]{6}$/i),
          depositPercent: z.coerce.number().int().min(1).max(100).default(100),
          reminderTemplate: z.string().trim().max(500).default(''),
          reminderMinutes: z.coerce.number().int().min(0).max(10080)
        }).parse(body)
        const onlinePayment = form.has('onlinePayment')
        if (onlinePayment && (!tenant.stripeAccountId || !(await (await stripe()).accounts.retrieve(tenant.stripeAccountId)).charges_enabled)) {
          throw new AgendaError('Conclua a configuração da conta para aceitar pagamentos.')
        }
        await db.tenant.update({ where: { id: tenantId }, data: {
          ...data, statusMessages: Boolean(tenant.whatsappInstance && form.has('statusMessages')), reminderTemplate: data.reminderTemplate || null, reminderMinutes: data.reminderMinutes || null,
          onlinePayment
        } })
        break
      }
      case 'cover': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        const image = form.get('cover')
        if (!(image instanceof File)) throw new AgendaError('Selecione uma imagem.')
        await storeMedia(tenantId, 'COVER', '', image)
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
        const data = z.object({ id, status: z.enum(['COMPLETED', 'CANCELED', 'NO_SHOW']) }).parse(body)
        await closeAppointment(tenantId, data.id, data.status, user.id)
        break
      }
      case 'reschedule': {
        const data = z.object({ id, startsAt: z.string() }).parse(body)
        await rescheduleAppointment(tenant, data.id, localDateTime(data.startsAt, tenant.timezone), user.id)
        return '/agenda'
      }
      case 'block': {
        const data = z.object({ professionalId: id, startsAt: z.string(), endsAt: z.string(), reason: title }).parse(body)
        await blockSchedule(tenantId, data.professionalId, localDateTime(data.startsAt, tenant.timezone), localDateTime(data.endsAt, tenant.timezone), data.reason)
        return '/agenda'
      }
      case 'unblock':
        await db.scheduleBlock.deleteMany({ where: { id: id.parse(body.id), tenantId } })
        return '/agenda'
      case 'wait-close':
        await db.waitEntry.updateMany({ where: { id: id.parse(body.id), tenantId, closedAt: null }, data: { closedAt: new Date() } })
        return '/agenda'
      case 'refund': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        await refundAppointment(tenantId, id.parse(form.get('id')))
        break
      }
      case 'connect': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        const api = await stripeForNewPayments()
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
  }, ['reschedule', 'block', 'unblock', 'wait-close'].includes(operation) ? '/agenda' : '/dashboard')
}

export async function brandSettings(operation: 'profile' | 'upload' | 'delete', form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user) return '/login'
    const member = await membership(user.id)
    if (!member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const tenantId = member.tenantId
    if (operation === 'profile') {
      const values = z.object({
        theme: z.enum(['light', 'dark']), policies: text,
        instagramUrl: z.union([z.literal(''), z.string().max(250).regex(/^https:\/\/(?:www\.)?instagram\.com\/[\w.]+\/?$/i)]),
        contactPhone: z.union([z.literal(''), phone])
      }).parse(Object.fromEntries(form))
      await db.tenant.update({ where: { id: tenantId }, data: {
        ...values, contactPhone: values.contactPhone || null, instagramUrl: values.instagramUrl || null
      } })
    } else if (operation === 'upload') {
      const kind = z.enum(['LOGO', 'BANNER', 'COVER', 'PROFESSIONAL', 'SERVICE', 'PRODUCT', 'GALLERY']).parse(form.get('kind'))
      const files = form.get('image')
      if (!(files instanceof File)) throw new AgendaError('Selecione uma imagem.')
      const target = kind === 'GALLERY' ? randomUUID() : ['PROFESSIONAL','SERVICE','PRODUCT'].includes(kind) ? id.parse(form.get('target')) : ''
      await storeMedia(tenantId, kind, target, files)
    } else if (operation === 'delete') {
      await deleteMedia(tenantId, id.parse(form.get('id')))
    }
    return '/personalizacao'
  }, '/personalizacao')
}

export async function commerce(operation: 'product' | 'stock' | 'sale' | 'reverse' | 'entry' | 'settle' | 'refund-order', form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user) return '/login'
    const member = await membership(user.id)
    if (!member || !['ADMIN', 'MANAGER'].includes(member.role) || !member.tenant.active || member.tenant.suspended) {
      return '/dashboard'
    }
    const tenantId = member.tenantId
    const body = Object.fromEntries(form)
    if (operation === 'product') {
      const data = z.object({
        id, name: title, category: z.string().trim().max(80), cents, costCents: cents,
        promotionCents: z.union([z.literal(''), cents.min(1)]), minimumStock: z.coerce.number().int().min(0).max(1_000_000)
      }).parse(body)
      if (data.promotionCents !== '' && data.promotionCents > data.cents) throw new AgendaError('O preço promocional deve ser menor ou igual ao preço de venda.')
      const result = await db.product.updateMany({
        where: { id: data.id, tenantId },
        data: { name: data.name, category: data.category, cents: data.cents, costCents: data.costCents, promotionCents: data.promotionCents || null, minimumStock: data.minimumStock }
      })
      if (!result.count) throw new AgendaError('Produto indisponível.')
    } else if (operation === 'stock' || operation === 'sale') {
      const values = z.object({
        productId: id, requestId: z.uuid(), quantity: z.coerce.number().int().min(-1000000).max(1000000).refine(value => value !== 0)
      }).parse(body)
      if (operation === 'sale' && values.quantity < 0) throw new AgendaError('Informe uma quantidade positiva.')
      await changeStock({ tenantId, ...values, sale: operation === 'sale' })
    } else if (operation === 'reverse') {
      await reverseSale(tenantId, id.parse(body.id))
    } else if (operation === 'refund-order') {
      if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
      await refundOrder(tenantId, id.parse(body.id))
    } else if (operation === 'entry') {
      const values = z.object({ title, kind: z.enum(['INCOME', 'EXPENSE']), cents: cents.min(1), dueAt: z.iso.date() }).parse(body)
      const date = DateTime.fromISO(values.dueAt, { zone: member.tenant.timezone })
      if (!date.isValid) throw new AgendaError('Informe um vencimento válido.')
      await db.financialEntry.create({ data: { tenantId, ...values, dueAt: date.toJSDate(), paidAt: form.has('paid') ? new Date() : null } })
    } else if (operation === 'settle') {
      await db.financialEntry.updateMany({ where: { id: id.parse(body.id), tenantId, paidAt: null }, data: { paidAt: new Date() } })
    }
    return '/comercial'
  }, '/comercial')
}

export async function whatsappControl(_previous: { message?: string; qr?: string }, form: FormData): Promise<{ message?: string; qr?: string }> {
  try {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    const instance = member?.tenant.whatsappInstance
    if (!member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended || !instance) {
      return { message: 'A conexão do WhatsApp ainda não está disponível para esta conta.' }
    }
    const operation = z.enum(['status', 'connect', 'logout', 'test']).parse(form.get('operation'))
    if (!(await allowAttempt('whatsapp-' + operation, member.tenantId, operation === 'test' ? 3 : 12, 300))) {
      return { message: 'Aguarde alguns minutos antes de tentar novamente.' }
    }
    if (operation === 'connect') {
      const result = await connectWhatsApp(instance)
      return { qr: result.qr, message: result.connected ? 'WhatsApp conectado.' : result.qr ? 'Abra os dispositivos conectados do WhatsApp e escaneie o código.' : 'Aguardando o código. Tente novamente em instantes.' }
    }
    if (operation === 'logout') {
      await logoutWhatsApp(instance)
      return { message: 'WhatsApp desconectado.' }
    }
    if (operation === 'test') {
      await sendWhatsApp(instance, phone.parse(form.get('phone')), 'Mensagem de teste do CS Agenda Pro.')
      return { message: 'Mensagem de teste enviada ao WhatsApp.' }
    }
    const state = await whatsAppStatus(instance)
    return { message: state === 'open' ? 'WhatsApp conectado.' : state === 'connecting' ? 'Conexão em andamento.' : 'WhatsApp desconectado.' }
  } catch (error) {
    return { message: error instanceof z.ZodError ? 'Confira os dados informados e tente novamente.' : 'Não foi possível concluir a operação no WhatsApp.' }
  }
}

export async function admin(operation: 'plan' | 'suspend' | 'whatsapp' | 'stripe-config' | 'stripe-test' | 'stripe-pause', form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin) return '/login'
    if (!user.adminMfaVerified) return user.mfaSecret ? '/login' : '/conta'
    const body = Object.fromEntries(form)
    if (operation === 'stripe-config' || operation === 'stripe-test' || operation === 'stripe-pause') {
      const password = credentials.shape.password.parse(form.get('password'))
      if (!(await allowAttempt('stripe-config', user.id, 6, 600)) || !(await verifyPassword(password, user.password))) {
        throw new AgendaError('Não foi possível confirmar sua senha.')
      }
      if (operation === 'stripe-test') {
        await checkStripeConnection(user.id)
        return '/super-admin?stripe=conectada'
      }
      if (operation === 'stripe-pause') {
        await pauseStripePayments(user.id, z.enum(['true', 'false']).parse(form.get('paused')) === 'true')
        return '/super-admin'
      }
      const data = z.object({
        mode: z.enum(['test', 'live']),
        publishableKey: z.string().regex(/^pk_(?:test|live)_[A-Za-z0-9]+$/).max(300),
        secret: z.string().regex(/^sk_(?:test|live)_[A-Za-z0-9]+$/).max(300),
        billingWebhook: z.string().regex(/^whsec_[A-Za-z0-9]+$/).max(300),
        connectWebhook: z.string().regex(/^whsec_[A-Za-z0-9]+$/).max(300)
      }).parse(body)
      await saveStripeConfiguration(user.id, data.mode, data.publishableKey, {
        secret: data.secret, billingWebhook: data.billingWebhook, connectWebhook: data.connectWebhook
      })
      return '/super-admin?stripe=conectada'
    }
    if (operation === 'plan') {
      const data = z.object({ name: title, description: title, monthlyCents: cents.min(100), annualCents: cents.min(100), trialDays: z.coerce.number().int().min(0).max(90).default(0) }).parse(body)
      const api = await stripeForNewPayments()
      const product = await api.products.create({ name: data.name, description: data.description })
      const [monthly, annual] = await Promise.all([
        api.prices.create({ product: product.id, unit_amount: data.monthlyCents, currency: 'brl', recurring: { interval: 'month' } }),
        api.prices.create({ product: product.id, unit_amount: data.annualCents, currency: 'brl', recurring: { interval: 'year' } })
      ])
      await db.plan.create({ data: { ...data, monthlyPriceId: monthly.id, annualPriceId: annual.id } })
    } else if (operation === 'whatsapp') {
      const data = z.object({ tenantId: id, instance: z.string().trim().regex(/^[\w-]{0,70}$/) }).parse(body)
      await db.$transaction([
        db.tenant.update({ where: { id: data.tenantId }, data: { whatsappInstance: data.instance || null } }),
        db.adminAudit.create({ data: { actorId: user.id, action: 'WHATSAPP_LINK_UPDATED', targetId: data.tenantId } })
      ])
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
    if (!(await allowAttempt('reservation', tenant.id + ':' + data.phone, 10, 1800))) throw new AgendaError('Aguarde antes de iniciar outra reserva.')
    const service = await db.service.findFirst({ where: { tenantId: tenant.id, id: data.serviceId, active: true } })
    if (!service) throw new AgendaError('Serviço indisponível.')
    const online = tenant.onlinePayment && service.cents > 0
    const account = tenant.stripeAccountId
    if (online && (!account || !(await (await stripeForNewPayments()).accounts.retrieve(account)).charges_enabled)) throw new AgendaError('O pagamento está indisponível no momento.')
    const appointment = await book(tenant, { ...data, consent: form.has('consent'), online, checkoutReturnUrl: base() + path })
    if (!online || !account) return path + '?reserva=' + appointment.id
    const session = await openAppointmentCheckout(appointment).catch(() => null)
    return session?.status === 'open' && session.url ? session.url : path + '?pagamento=' + appointment.paymentToken
  }, path)
}

export async function joinWaitlist(link: string, form: FormData) {
  const values = Object.fromEntries(form)
  const path = '/estabelecimento/' + encodeURIComponent(link)
  await perform(async () => {
    const { serviceId, professionalId, day, name, phone: number } = z.object({ serviceId: id, professionalId: id, day: z.iso.date(), name: title, phone }).parse(values)
    const tenant = await db.tenant.findFirst({ where: { slug: link, active: true, suspended: false } })
    if (!tenant) throw new AgendaError('Lista de espera indisponível.')
    const { start } = dayBounds(day, tenant.timezone)
    const today = DateTime.now().setZone(tenant.timezone).startOf('day')
    if (start < today || start > today.plus({ days: 90 })) throw new AgendaError('Escolha uma data até 90 dias à frente.')
    if (!(await allowAttempt('waitlist', tenant.id + ':' + number, 6, 3600))) throw new AgendaError('Aguarde antes de fazer outro pedido.')
    const tenantId = tenant.id
    if (!await db.assignment.findFirst({ where: { tenantId, serviceId, professionalId, service: { active: true }, professional: { active: true } } })) {
      throw new AgendaError('Esse profissional não está disponível para o serviço escolhido.')
    }
    await db.waitEntry.upsert({
      where: { tenantId_professionalId_serviceId_day_phone: { tenantId, professionalId, serviceId, day, phone: number } },
      update: {}, create: { tenantId, serviceId, professionalId, day, name, phone: number }
    })
    return path + '?espera=1'
  }, path)
}

export async function shopCheckout(link: string, form: FormData) {
  const path = '/estabelecimento/' + encodeURIComponent(link)
  await perform(async () => {
    const values = z.object({ name: title, phone, requestId: z.uuid() }).parse(Object.fromEntries(form))
    const tenant = await db.tenant.findFirst({ where: { slug: link, active: true, suspended: false, stripeAccountId: { not: null } } })
    if (!tenant?.stripeAccountId) throw new AgendaError('Compras online indisponíveis.')
    const account = tenant.stripeAccountId
    const api = await stripeForNewPayments()
    if (!(await api.accounts.retrieve(account)).charges_enabled) throw new AgendaError('Compras online indisponíveis.')
    if (!(await allowAttempt('shop-checkout', tenant.id + ':' + values.phone, 6, 1800))) throw new AgendaError('Aguarde antes de iniciar outro pedido.')
    const count = z.coerce.number().int().min(0).max(100)
    const cart = [...form.entries()].filter(([key]) => key.startsWith('product:')).map(([key, value]) => ({
      productId: id.parse(key.slice('product:'.length)), quantity: count.parse(value)
    })).filter(item => item.quantity)
    if (!cart.length) throw new AgendaError('Selecione ao menos um produto.')
    const order = await reserveOrder({ tenantId: tenant.id, cart, ...values })
    if (order.status !== 'PENDING' || order.expiresAt <= new Date()) return path + '?pedido=' + order.id
    const session = await api.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'], expires_at: +order.expiresAt / 1000,
      line_items: order.items.map(item => ({
        quantity: item.quantity, price_data: { currency: 'brl', unit_amount: item.unitCents, product_data: { name: item.name } }
      })),
      metadata: { orderId: order.id }, success_url: base() + path + '?pedido=' + order.id, cancel_url: base() + path
    }, { stripeAccount: account, idempotencyKey: 'order:' + order.id })
    await db.shopOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { checkoutId: session.id } })
    if (!session.url || session.status !== 'open') return path + '?pedido=' + order.id
    return session.url
  }, path)
}

export async function retryPayment(link: string, token: string) {
  const path = '/estabelecimento/' + encodeURIComponent(link)
  await perform(async () => {
    const paymentToken = z.uuid().parse(token)
    const reservation = await db.appointment.findFirst({
      where: { paymentToken, tenant: { slug: link, active: true, suspended: false } }
    })
    if (!reservation) return path
    if (!await allowAttempt('retry-payment', paymentToken, 12, 600)) return path + '?pagamento=' + paymentToken
    const session = await openAppointmentCheckout(reservation).catch(() => null)
    return session?.status === 'open' && session.url ? session.url : path + '?pagamento=' + paymentToken
  }, path)
}

export async function reviewPayment(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!member || !['ADMIN', 'MANAGER'].includes(member.role)) return '/login'
    const reservation = await db.appointment.findFirst({
      where: { id: id.parse(form.get('id')), tenantId: member.tenantId, status: 'PENDING' }
    })
    const account = reservation?.checkoutAccountId ?? member.tenant.stripeAccountId
    if (!reservation || !account) throw new AgendaError('Este pagamento está indisponível para consulta.')
    if (!await allowAttempt('review-payment', member.tenantId, 30, 600)) throw new AgendaError('Aguarde alguns minutos antes de consultar novamente.')
    await reconcileAppointment(reservation, account, await stripe())
    return '/recebimentos'
  }, '/recebimentos')
}
