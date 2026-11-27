'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { commercialKinds, commercialLabels, type CommercialKind } from '@/lib/commercial-rules'
import { enqueueCommercial } from '@/lib/commercial-notices'
import { can, permissionKeys, type Permission } from '@/lib/permissions'
import { changePublicAddress } from '@/lib/public-identity'
import { DateTime } from 'luxon'
import { changeStock, reverseSale } from '@/lib/commerce'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { endSession, membership, startSession, userSession, verifyPassword } from '@/lib/auth'
import { AgendaError, blockSchedule, book, closeAppointment, dayBounds, localDateTime, rescheduleAppointment } from '@/lib/agenda'
import { checkStripeConnection, pauseStripePayments, saveStripeConfiguration, StripeSettingsError, stripeForNewPayments } from '@/lib/stripe-settings'
import { stripeSettingsForm, type StripeSettingsFormState } from '@/lib/stripe-settings-form'
import { officialCheckoutLink, subscriptionCheckout } from '@/lib/billing'
import { instanceName, provisionWhatsApp, removeWhatsApp } from '@/lib/whatsapp'
import { connectWhatsApp, logoutWhatsApp, sendWhatsApp, whatsAppStatus } from '@/lib/evolution'
import { reconcileOrder, reserveOrder } from '@/lib/orders'
import { changeConnectAvailability, connectStatus, startConnectOnboarding, openAppointmentCheckout, reconcileAppointment, refundAppointment, refundOrder } from '@/lib/connect'
import { stripe } from '@/lib/stripe'
import { allowAttempt, consumeAccountToken, mailConfigured, sendAccountLink } from '@/lib/account-security'
import { consumeMfaRecovery, finishMfaSetup, issueMfaRecovery, startMfaSetup, verifyMfa } from '@/lib/mfa'
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

export async function account(form: FormData) {
  await perform(async () => {
    const data = credentials.parse(Object.fromEntries(form))
    if (!(await allowAttempt('login', data.email, 10, 600))) {
      throw new AgendaError('Aguarde alguns minutos antes de tentar novamente.')
    }
    const user = await db.user.findUnique({ where: { email: data.email } })
    if (!(await verifyPassword(data.password, user?.password)) || !user) throw new AgendaError('E-mail ou senha inválidos.')
    if (user.platformAdmin && user.mfaSecret) {
      const code = z.string().trim().max(27).parse(form.get('code') ?? '')
      const valid = /^\d{6}$/.test(code) ? await verifyMfa(user, code) : await consumeMfaRecovery(user, code)
      if (!valid) throw new AgendaError('Informe um código válido do aplicativo ou um código de recuperação disponível.')
      await startSession(user.id, true)
      return '/super-admin'
    }
    await startSession(user.id)
    return user.platformAdmin ? '/conta' : '/dashboard'
  }, '/login')
}

export async function accountLink(operation: 'request' | 'reset' | 'resend' | 'verify' | 'revoke', form: FormData) {
  await perform(async () => {
    if (operation === 'request') {
      const email = credentials.shape.email.parse(form.get('email'))
      if (await allowAttempt('password-reset', email, 3, 1800)) {
        const user = await db.user.findUnique({ where: { email } })
        if (user?.password && mailConfigured()) await sendAccountLink(user, 'PASSWORD_RESET').catch(() => console.error('password-reset-delivery'))
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

type SetupMfaState = { message?: string; secret?: string; challenge?: string; qr?: string }
type RecoveryMfaState = { message?: string; codes?: string[] }

export async function setupMfa(form: FormData): Promise<SetupMfaState> {
  const failure = (message: string) => ({ message })
  try {
    const user = await userSession()
    if (!user?.platformAdmin || user.mfaSecret) return { message: 'Esta operação está indisponível agora.' }
    if (!(await allowAttempt('mfa-setup', user.id, 8, 600))) return failure('Aguarde antes de tentar novamente.')
    const password = credentials.shape.password.safeParse(form.get('password'))
    if (!password.success || !(await verifyPassword(password.data, user.password))) return failure('Não foi possível confirmar sua senha.')
    const setup = await startMfaSetup(user)
    return setup ?? { message: 'Esta operação está indisponível agora.' }
  } catch {
    return failure('Não foi possível iniciar a autenticação em duas etapas.')
  }
}

export async function activateMfa(_previous: RecoveryMfaState, form: FormData): Promise<RecoveryMfaState> {
  try {
    const user = await userSession()
    if (!user?.platformAdmin || user.mfaSecret || !(await allowAttempt('mfa-activate', user.id, 10, 600))) {
      return { message: 'Esta operação está indisponível agora.' }
    }
    const input = z.object({ code: z.string().trim().regex(/^\d{6}$/), challenge: z.uuid() }).safeParse(Object.fromEntries(form))
    if (!input.success) return { message: 'Informe os seis dígitos exibidos no aplicativo.' }
    const codes = await finishMfaSetup(user, input.data.code, input.data.challenge)
    if (!codes) return { message: 'Confira o código ou gere uma nova chave.' }
    await startSession(user.id, true)
    return { codes }
  } catch {
    return { message: 'Não foi possível concluir a configuração. Entre novamente para verificar o estado da conta.' }
  }
}

export async function generateMfaRecovery(_previous: RecoveryMfaState, form: FormData): Promise<RecoveryMfaState> {
  try {
    const user = await userSession()
    if (!user?.platformAdmin || !user.adminMfaVerified || user.mfaRecoveryIssuedAt ||
        !(await allowAttempt('mfa-recovery', user.id, 8, 600))) return { message: 'Esta operação está indisponível agora.' }
    const password = credentials.shape.password.safeParse(form.get('password'))
    if (!password.success || !(await verifyPassword(password.data, user.password))) return { message: 'Não foi possível confirmar sua senha.' }
    const codes = await issueMfaRecovery(user)
    return codes ? { codes } : { message: 'Os códigos de recuperação já foram emitidos.' }
  } catch {
    return { message: 'Não foi possível gerar os códigos de recuperação.' }
  }
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
    const scopes: Record<string, Permission> = {
      settings: 'settings.manage', booking: 'agenda.create', cover: 'brand.manage', service: 'service.manage', professional: 'team.professionals',
      assignment: 'team.professionals', hours: 'team.professionals', customer: 'customer.create',
      product: 'product.manage', reschedule: 'agenda.edit', block: 'agenda.edit', unblock: 'agenda.edit',
      'wait-close': 'agenda.edit', refund: 'finance.refund'
    }
    const scope = operation === 'appointment' ? body.status === 'CANCELED' ? 'agenda.cancel' : 'agenda.edit' : scopes[operation]
    if (scope ? !can(member, scope) : member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
    switch (operation) {
      case 'settings': {
        const data = z.object({
          name: title, description: text, address: text, color: z.string().regex(/^#[\da-f]{6}$/i),
          depositPercent: z.coerce.number().int().min(1).max(100).default(100),
          reminderTemplate: z.string().trim().max(500).default(''),
          reminderMinutes: z.coerce.number().int().min(0).max(10080).default(0)
        }).parse(body)
        if (member.role !== 'ADMIN') {
          await db.tenant.update({ where: { id: tenantId }, data: { name: data.name, description: data.description, address: data.address, color: data.color } })
          break
        }
        const onlinePayment = form.has('onlinePayment')
        if (onlinePayment && (!tenant.stripeAccountId || !(await connectStatus(tenant.stripeAccountId)).payments)) {
          throw new AgendaError('Conclua a configuração da conta para aceitar pagamentos.')
        }
        await db.tenant.update({ where: { id: tenantId }, data: {
          ...data, statusMessages: Boolean(tenant.whatsappInstance && form.has('statusMessages')), reminderTemplate: data.reminderTemplate || null, reminderMinutes: data.reminderMinutes || null,
          onlinePayment
        } })
        break
      }
      case 'cover': {
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
      case 'booking': {
        if (!can(member, 'customer.read')) throw new AgendaError('Seu acesso não permite consultar clientes.')
        const data = z.object({ customerId: id, serviceId: id, professionalId: id, startsAt: z.string() }).parse(body)
        const customer = await db.customer.findFirst({ where: { tenantId, id: data.customerId } })
        if (!customer) throw new AgendaError('Cliente indisponível.')
        await book(tenant, {
          serviceId: data.serviceId, professionalId: data.professionalId, startsAt: localDateTime(data.startsAt, tenant.timezone).toISOString(),
          name: customer.name, phone: customer.phone, consent: false, online: false
        })
        return '/agenda'
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
        await refundAppointment(tenantId, id.parse(form.get('id')))
        break
      }
      case 'connect': {
        if (member.role !== 'ADMIN') throw new AgendaError('Seu acesso não permite esta operação.')
        return startConnectOnboarding(tenantId, user.email, base())
      }
      default:
        throw new AgendaError('Operação indisponível.')
    }
    return '/dashboard'
  }, ['booking', 'reschedule', 'block', 'unblock', 'wait-close'].includes(operation) ? '/agenda' : '/dashboard')
}

export async function brandSettings(operation: 'profile' | 'upload' | 'delete' | 'address', form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user) return '/login'
    const member = await membership(user.id)
    if (!member || !can(member, 'brand.manage') || !member.tenant.active || member.tenant.suspended) return '/dashboard'
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
    } else if (operation === 'address') {
      if (member.role !== 'ADMIN') throw new AgendaError('Somente o administrador pode alterar o endereço público.')
      await changePublicAddress(tenantId, slug.parse(form.get('slug')))
    } else if (operation === 'upload') {
      const kind = z.enum(['LOGO', 'PROFILE', 'BANNER', 'COVER', 'PROFESSIONAL', 'SERVICE', 'PRODUCT', 'GALLERY']).parse(form.get('kind'))
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

export async function commerce(operation: 'product' | 'stock' | 'sale' | 'reverse' | 'entry' | 'settle' | 'refund-order' | 'review-order', form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user) return '/login'
    const member = await membership(user.id)
    const scopes: Record<typeof operation, Permission> = {
      product: 'product.manage', stock: 'stock.manage', sale: 'sale.create', reverse: 'sale.create',
      entry: 'finance.write', settle: 'finance.write', 'refund-order': 'finance.refund', 'review-order': 'finance.read'
    }
    const scope = scopes[operation]
    if (!scope || !member || !can(member, scope) || !member.tenant.active || member.tenant.suspended) {
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
    } else if (operation === 'review-order') {
      const order = await db.shopOrder.findFirst({ where: { id: id.parse(body.id), tenantId, status: 'PENDING' } })
      if (!order || !member.tenant.stripeAccountId) throw new AgendaError('Pedido indisponível para consulta.')
      if (!(await allowAttempt('review-order', tenantId, 30, 600))) throw new AgendaError('Aguarde antes de consultar outro pedido.')
      await reconcileOrder(order, member.tenant.stripeAccountId, await stripe())
    } else if (operation === 'refund-order') {
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
    let instance = member?.tenant.whatsappInstance
    if (!member || !can(member, 'whatsapp.manage') || !member.tenant.active || member.tenant.suspended) {
      return { message: 'A conexão do WhatsApp ainda não está disponível para esta conta.' }
    }
    const operation = z.enum(['status', 'connect', 'logout', 'test', 'remove']).parse(form.get('operation'))
    if (!(await allowAttempt('whatsapp-' + operation, member.tenantId, operation === 'test' ? 3 : 12, 300))) {
      return { message: 'Aguarde alguns minutos antes de tentar novamente.' }
    }
    if (operation === 'connect') {
      instance = instance || await provisionWhatsApp(member.tenantId)
      const result = await connectWhatsApp(instance)
      return { qr: result.qr, message: result.connected ? 'WhatsApp conectado.' : result.qr ? 'Abra os dispositivos conectados do WhatsApp e escaneie o código.' : 'Aguardando o código. Tente novamente em instantes.' }
    }
    if (!instance) return { message: 'Conecte seu WhatsApp para continuar.' }
    if (operation === 'remove') {
      if (form.get('confirm') !== 'on') return { message: 'Confirme a exclusão antes de continuar.' }
      await removeWhatsApp(member.tenantId)
      return { message: 'Conexão excluída. Você pode cadastrar outra conta.' }
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
    return { message: error instanceof AgendaError ? error.message : error instanceof z.ZodError ? 'Confira os dados informados e tente novamente.' : 'Não foi possível concluir a operação no WhatsApp.' }
  }
}

export async function saveStripeSettings(form: FormData): Promise<StripeSettingsFormState> {
  try {
    const user = await userSession()
    if (!user?.platformAdmin || !user.adminMfaVerified) {
      return { status: 'authorization', message: 'Entre como Super Admin e confirme a autenticação em duas etapas.' }
    }
    const input = stripeSettingsForm.safeParse(Object.fromEntries(form))
    if (!input.success) {
      const errors = z.flattenError(input.error).fieldErrors
      return { status: 'validation', fields: {
        mode: errors.mode?.[0], publishableKey: errors.publishableKey?.[0], secret: errors.secret?.[0],
        billingWebhook: errors.billingWebhook?.[0], connectWebhook: errors.connectWebhook?.[0], password: errors.password?.[0]
      } }
    }
    const { password, mode, publishableKey, ...stripeCredentials } = input.data
    if (!(await allowAttempt('stripe-config', user.id, 6, 600))) {
      return { status: 'authorization', message: 'Limite de tentativas atingido. Aguarde antes de tentar novamente.' }
    }
    if (!(await verifyPassword(password, user.password))) {
      return { status: 'authorization', fields: { password: 'Não foi possível confirmar sua senha.' } }
    }
    await saveStripeConfiguration(user.id, mode, publishableKey, stripeCredentials)
    revalidatePath('/super-admin')
    return { status: 'saved', message: 'Conexão confirmada. Credenciais criptografadas e salvas.' }
  } catch (error) {
    if (error instanceof StripeSettingsError) return { status: error.kind, message: error.message }
    return { status: 'persistence', message: 'Não foi possível acessar o banco de dados para salvar a configuração.' }
  }
}

export async function admin(operation: 'plan' | 'suspend' | 'whatsapp' | 'stripe-test' | 'stripe-pause' | 'platform-fee', form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin) return '/login'
    if (!user.adminMfaVerified) return user.mfaSecret ? '/login' : '/conta'
    const body = Object.fromEntries(form)
    if (operation === 'stripe-test' || operation === 'stripe-pause') {
      const password = credentials.shape.password.parse(form.get('password'))
      if (!(await allowAttempt('stripe-config', user.id, 6, 600)) || !(await verifyPassword(password, user.password))) {
        throw new AgendaError('Não foi possível confirmar sua senha.')
      }
      if (operation === 'stripe-test') {
        await checkStripeConnection(user.id)
        return '/super-admin?stripe=conectada'
      }
      await pauseStripePayments(user.id, z.enum(['true', 'false']).parse(form.get('paused')) === 'true')
      return '/super-admin'
    }
    if (operation === 'platform-fee') {
      const values = z.object({
        id, scope: z.enum(['tenant', 'plan']), method: z.enum(['none', 'plan', 'percent', 'fixed']),
        percent: z.coerce.number().min(0).max(100), fixed: cents
      }).parse(body)
      if (values.scope === 'plan' && values.method === 'plan') throw new AgendaError('Escolha uma regra para o plano.')
      const percent = values.method === 'percent' ? Math.round(values.percent * 100) : 0
      const fixed = values.method === 'fixed' ? values.fixed : 0
      await db.$transaction(async tx => {
        if (values.scope === 'tenant') await tx.tenant.update({ where: { id: values.id }, data: {
          platformFeeBps: values.method === 'plan' ? null : percent, platformFeeFixed: values.method === 'plan' ? null : fixed
        } })
        else await tx.plan.update({ where: { id: values.id }, data: { platformFeeBps: percent, platformFeeFixed: fixed } })
        await tx.adminAudit.create({ data: { actorId: user.id, targetId: values.id, action: 'PLATFORM_FEE_UPDATED' } })
      })
      return '/super-admin'
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
      if (data.instance.startsWith('agenda-managed-') && data.instance !== instanceName(data.tenantId)) {
        throw new AgendaError('Esta conexão pertence a outro estabelecimento.')
      }
      await db.$transaction([
        db.tenant.update({ where: { id: data.tenantId }, data: { whatsappInstance: data.instance || null } }),
        db.adminAudit.create({ data: { actorId: user.id, action: 'WHATSAPP_LINK_UPDATED', targetId: data.tenantId } })
      ])
    } else {
      const data = z.object({ tenantId: id, suspended: z.enum(['true', 'false']) }).parse(body)
      await db.$transaction(async tx => {
        const suspended = data.suspended === 'true'
        const changed = await tx.tenant.updateMany({ where: { id: data.tenantId, suspended: !suspended }, data: { suspended } })
        if (!changed.count) return
        const audit = await tx.adminAudit.create({ data: { actorId: user.id, targetId: data.tenantId, action: suspended ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED' } })
        await enqueueCommercial(tx, { tenantId: data.tenantId, kind: suspended ? 'SUSPENDED' : 'REACTIVATED', reference: audit.id })
      })
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
    if (online && tenant.connectPausedAt) throw new AgendaError('O estabelecimento pausou novos pagamentos online. Entre em contato para agendar.')
    if (online && (!account || !(await connectStatus(account, await stripeForNewPayments())).payments)) throw new AgendaError('O pagamento está indisponível no momento.')
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
    if (!tenant?.stripeAccountId || tenant.connectPausedAt) throw new AgendaError('Compras online indisponíveis.')
    const account = tenant.stripeAccountId
    const api = await stripeForNewPayments()
    if (!(await connectStatus(account, api)).payments) throw new AgendaError('Compras online indisponíveis.')
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
      payment_intent_data: order.platformFeeCents ? { application_fee_amount: order.platformFeeCents } : undefined,
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
    if (!member || !can(member, 'finance.read')) return '/login'
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

export async function saveWhatsAppPreferences(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!member || !can(member, 'whatsapp.manage') || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const values = z.object({
      reminderMinutes: z.coerce.number().int().min(0).max(10080),
      reminderTemplate: z.string().trim().max(500),
      returnAfterDays: z.coerce.number().int().min(0).max(365).default(0),
      reviewUrl: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(300)])
    }).parse(Object.fromEntries(form))
    const reminderPresets = [...new Set(z.array(z.enum(['120', '1440', '2880'])).parse(form.getAll('presets')).map(Number))]
    const tenant = await db.tenant.update({
      where: { id: member.tenantId },
      data: { birthdayMessages: form.has('birthdayMessages'), returnAfterDays: values.returnAfterDays || null, reminderMinutes: values.reminderMinutes || null, reminderTemplate: values.reminderTemplate || null, statusMessages: form.has('statusMessages'), reminderPresets, completionMessages: form.has('completionMessages'), reviewUrl: values.reviewUrl || null }
    })
    if (!tenant.reminderMinutes && !tenant.reminderPresets.length) return '/whatsapp'
    const appointments = await db.appointment.findMany({ where: {
      tenantId: tenant.id, status: 'CONFIRMED', consent: true, startsAt: { gt: new Date() }
    }, take: 1000 })
    const { scheduleReminder } = await import('@/lib/agenda')
    for (const appointment of appointments) await scheduleReminder(db, tenant, appointment)
    return '/whatsapp'
  }, '/whatsapp')
}

export async function createTeamInvite(_previous: { link?: string; message?: string }, form: FormData): Promise<{ link?: string; message?: string }> {
  try {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!user || !member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) return { message: 'Acesso indisponível.' }
    if (!await allowAttempt('team-invite', member.tenantId, 20, 3600)) return { message: 'Aguarde antes de criar outro convite.' }
    const { inviteMember } = await import('@/lib/team')
    const values = z.object({ email: credentials.shape.email, role: z.enum(['MANAGER', 'RECEPTION', 'PROFESSIONAL', 'FINANCE', 'READONLY']), professionalId: z.string().max(100).optional() }).parse(Object.fromEntries(form))
    const token = await inviteMember(member.tenantId, user.id, values.email, values.role, values.professionalId)
    return { link: base() + '/convite?codigo=' + token }
  } catch (error) {
    return { message: error instanceof AgendaError ? error.message : 'Não foi possível criar o convite. Confira os dados informados.' }
  }
}

export async function finishTeamInvite(form: FormData) {
  await perform(async () => {
    const token = z.string().regex(/^[\w-]{43}$/).parse(form.get('code'))
    const password = credentials.shape.password.parse(form.get('password'))
    if (!await allowAttempt('team-accept', token, 8, 600)) throw new AgendaError('Aguarde antes de tentar novamente.')
    const { acceptInvite } = await import('@/lib/team')
    const user = await acceptInvite(token, password)
    await startSession(user.id)
    if (mailConfigured()) await sendAccountLink(user, 'EMAIL_VERIFY').catch(() => console.error('team-email-verification'))
    return '/dashboard'
  }, '/convite')
}

export async function teamAccess(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!user || !member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const { manageTeamAccess } = await import('@/lib/team')
    const values = z.object({ userId: id, state: z.enum(['disable', 'enable', 'revoke']) }).parse(Object.fromEntries(form))
    await manageTeamAccess(member.tenantId, user.id, values.userId, values.state)
    return '/equipe'
  }, '/equipe')
}

export async function professionalCommission(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const values = z.object({
      id, operation: z.enum(['save', 'paid']),
      percent: z.coerce.number().min(0).max(100).default(0), fixed: cents.default(0)
    }).parse(Object.fromEntries(form))
    if (values.operation === 'paid') {
      await db.professionalCommission.updateMany({
        where: { appointmentId: values.id, paidAt: null, appointment: { tenantId: member.tenantId } }, data: { paidAt: new Date() }
      })
    } else {
      if (values.percent && values.fixed) throw new AgendaError('Escolha um percentual ou um valor fixo.')
      await db.professional.updateMany({
        where: { id: values.id, tenantId: member.tenantId },
        data: { commissionBps: Math.round(values.percent * 100), commissionFixed: values.fixed }
      })
    }
    return '/comissoes'
  }, '/comissoes')
}

export async function sendInvoiceNotice(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin || !user.adminMfaVerified) return '/login'
    if (!form.has('confirmed')) throw new AgendaError('Confirme que o envio foi autorizado.')
    const invoiceId = id.parse(form.get('id'))
    if (!await allowAttempt('invoice-notice', user.id, 30, 3600)) throw new AgendaError('Aguarde antes de enviar novas mensagens.')
    const record = await db.billingInvoice.findUnique({
      where: { id: invoiceId }, include: { tenant: { include: {
        members: { where: { role: 'ADMIN', disabledAt: null, user: { emailVerifiedAt: { not: null } } },
          take: 1, orderBy: { userId: 'asc' }, include: { user: { select: { email: true } } } }
      } } }
    })
    const recipient = record?.tenant.members[0]?.user.email
    if (!record || !recipient || !record.tenant.stripeCustomerId) throw new AgendaError('Nenhum responsável com e-mail confirmado está disponível.')
    const invoice = await (await stripe()).invoices.retrieve(invoiceId)
    const customer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
    const link = invoice.hosted_invoice_url ? new URL(invoice.hosted_invoice_url) : null
    if (record.tenant.stripeCustomerId !== customer || invoice.status !== 'open' || invoice.amount_remaining <= 0 ||
      !link || link.protocol !== 'https:' || link.hostname !== 'invoice.stripe.com') {
      throw new AgendaError('Esta fatura não tem uma cobrança em aberto disponível para regularização.')
    }
    const day = DateTime.now().setZone('America/Sao_Paulo').toISODate()
    const key = 'invoice-notice/' + invoiceId + '/' + day
    const { sendEmail } = await import('@/lib/mail')
    await sendEmail({
      to: recipient, subject: 'Fatura em aberto · CS Agenda Pro',
      text: 'Olá,\n\nHá uma fatura em aberto da sua assinatura. Consulte o valor e as opções de pagamento pelo link oficial da Stripe:\n\n' + link +
        '\n\nEquipe CS Agenda Pro', key
    })
    await db.adminAudit.create({ data: { actorId: user.id, targetId: invoiceId, action: 'INVOICE_NOTICE_SENT' } })
    return '/comunicacao?enviado=1'
  }, '/comunicacao')
}

export async function manageConnectAvailability(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!user || !member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const pause = z.enum(['pause', 'resume']).parse(form.get('operation')) === 'pause'
    if (!pause) {
      const account = member.tenant.stripeAccountId
      if (!account || !(await connectStatus(account, await stripeForNewPayments())).payments) {
        throw new AgendaError('Atualize seu cadastro na Stripe antes de retomar os recebimentos.')
      }
    }
    await changeConnectAvailability(member.tenantId, user.id, pause)
    return '/recebimentos'
  }, '/recebimentos')
}

export async function commercialRule(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin || !user.adminMfaVerified) return '/login'
    const values = z.object({
      kind: z.enum(commercialKinds), hour: z.coerce.number().int().min(0).max(23),
      leadDays: z.coerce.number().int().min(0).max(60), template: z.string().trim().min(10).max(1500)
    }).parse(Object.fromEntries(form))
    if (form.get('operation') === 'test') {
      if (!user.emailVerifiedAt) throw new AgendaError('Confirme seu e-mail antes de testar o envio.')
      if (!await allowAttempt('commercial-test', user.id, 5, 3600)) throw new AgendaError('Aguarde antes de enviar outro teste.')
      const label = commercialLabels[values.kind as CommercialKind]
      const { sendEmail } = await import('@/lib/mail')
      await sendEmail({ to: user.email, subject: 'Prévia autorizada · ' + label,
        text: values.template.replaceAll('{evento}', label).replaceAll('{estabelecimento}', 'Seu estabelecimento').replaceAll('{detalhes}', 'Prévia de mensagem do CS Agenda Pro.') })
      return '/comunicacao?enviado=1'
    }
    const config = { ...values, enabled: form.has('enabled') }
    await db.commercialRule.upsert({ where: { kind: config.kind }, create: config, update: config })
    return '/comunicacao'
  }, '/comunicacao')
}

export async function teamPermissions(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!user || !member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const target = id.parse(form.get('userId'))
    const operation = z.enum(['custom', 'default']).parse(form.get('operation'))
    const values = z.array(z.enum(permissionKeys)).parse(form.getAll('permissions'))
    const { updateTeamPermissions } = await import('@/lib/team')
    await updateTeamPermissions(member.tenantId, user.id, target, operation === 'custom' ? values : null)
    return '/equipe'
  }, '/equipe')
}

export async function saveEvolutionSettings(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin || !user.adminMfaVerified) return '/login'
    const password = credentials.shape.password.parse(form.get('password'))
    if (!await allowAttempt('evolution-settings', user.id, 6, 600) || !await verifyPassword(password, user.password)) {
      throw new AgendaError('Não foi possível confirmar sua senha.')
    }
    const values = z.object({ origin: z.string().max(300).url(), key: z.string().trim().min(8).max(500) }).parse(Object.fromEntries(form))
    const { saveEvolution } = await import('@/lib/evolution-settings')
    try { await saveEvolution(user.id, values.origin, values.key, form.has('qr')) } catch {
      throw new AgendaError('Não foi possível confirmar a conexão. Confira o endereço habilitado e a chave de integração.')
    }
    return '/diagnostico'
  }, '/diagnostico')
}

export async function customerPreferences(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!member || !can(member, 'customer.edit') || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const values = z.object({ id, name: title, birthday: z.union([z.literal(''), z.iso.date()]) }).parse(Object.fromEntries(form))
    await db.customer.updateMany({
      where: { id: values.id, tenantId: member.tenantId },
      data: { name: values.name, birthMonthDay: values.birthday ? values.birthday.slice(5) : null,
        followupConsentAt: form.has('followupConsent') ? new Date() : null }
    })
    return '/dashboard'
  }, '/dashboard')
}

export async function saveMessageTemplate(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (!member || !can(member, 'whatsapp.manage') || !member.tenant.active || member.tenant.suspended) return '/dashboard'
    const { messageTemplates } = await import('@/lib/whatsapp-template')
    const kind = z.string().parse(form.get('kind'))
    if (!Object.hasOwn(messageTemplates, kind)) throw new AgendaError('Selecione um tipo de mensagem válido.')
    const text = z.string().trim().max(500).parse(form.get('template'))
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${member.tenantId} FOR UPDATE`
      const latest = await tx.tenant.findUniqueOrThrow({ where: { id: member.tenantId }, select: { whatsappTemplates: true } })
      await tx.tenant.update({ where: { id: member.tenantId }, data: {
        whatsappTemplates: { ...(latest.whatsappTemplates as Record<string, string> | null), [kind]: text }
      } })
    })
    return '/whatsapp'
  }, '/whatsapp')
}

export async function sendCheckoutNotice(form: FormData) {
  await perform(async () => {
    const user = await userSession()
    if (!user?.platformAdmin || !user.adminMfaVerified) return '/login'
    if (!form.has('confirmed')) throw new AgendaError('Confirme que o envio foi autorizado.')
    if (!mailConfigured()) throw new AgendaError('Configure o serviço de e-mail antes de enviar.')
    const values = z.object({ tenantId: id, planId: id, cycle: z.enum(['monthly', 'annual']) }).parse(Object.fromEntries(form))
    if (!await allowAttempt('checkout-notice', values.tenantId, 5, 3600)) throw new AgendaError('Aguarde antes de enviar outro link.')
    const tenant = await db.tenant.findFirst({ where: { id: values.tenantId, active: false, suspended: false },
      include: { members: { where: { role: 'ADMIN', disabledAt: null, user: { emailVerifiedAt: { not: null } } },
        orderBy: { userId: 'asc' }, take: 1, include: { user: { select: { email: true } } } } }
    })
    const email = tenant?.members[0]?.user.email
    if (!tenant || !email) throw new AgendaError('O estabelecimento não está disponível para contratação ou não tem e-mail confirmado.')
    const api = await stripeForNewPayments()
    if (tenant.stripeCustomerId && (await api.invoices.list({ customer: tenant.stripeCustomerId, status: 'open', limit: 1 })).data.length) {
      throw new AgendaError('Já existe uma fatura em aberto. Envie o aviso da fatura existente.')
    }
    const link = officialCheckoutLink(await subscriptionCheckout({ ...values, email, origin: base() }, api))
    if (!link) throw new AgendaError('Já existe uma assinatura. Oriente o assinante a consultar o portal.')
    const attempt = await db.billingCheckout.findUnique({ where: { tenantId: tenant.id } })
    if (!attempt) throw new AgendaError('O Checkout atual precisa ser consultado pelo responsável.')
    const plan = await db.plan.findFirst({ where: { OR: [{ monthlyPriceId: attempt.priceId }, { annualPriceId: attempt.priceId }] } })
    if (!plan) throw new AgendaError('Não foi possível confirmar o plano do Checkout.')
    const annual = plan.annualPriceId === attempt.priceId
    const valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((annual ? plan.annualCents : plan.monthlyCents) / 100)
    const date = DateTime.fromJSDate(attempt.expiresAt, { zone: 'America/Sao_Paulo' }).toFormat("dd/LL 'às' HH:mm")
    const { sendEmail } = await import('@/lib/mail')
    await sendEmail({ to: email, subject: 'Convite para contratar · CS Agenda Pro', key: 'checkout-notice/' + attempt.id,
      text: [
        'Olá,',
        'O link de contratação do plano ' + plan.name + ' está disponível. Valor ' + (annual ? 'anual' : 'mensal') + ': ' + valor + '. Válido até ' + date + ' (Brasília).',
        link, 'Equipe CS Agenda Pro'
      ].join('\n\n') })
    await db.adminAudit.create({ data: { actorId: user.id, targetId: tenant.id, action: 'CHECKOUT_NOTICE_SENT' } })
    return '/comunicacao?enviado=1'
  }, '/comunicacao')
}
