import { Queue, Worker } from 'bullmq'
import { DateTime } from 'luxon'
import { scheduleBirthdays } from '../lib/whatsapp-followup'
import { messageTemplates, renderMessage } from '../lib/whatsapp-template'
import { reminderOffsets } from '../lib/agenda'
import { reconcileOrders } from '../lib/orders'
import { dispatchCommercial } from '../lib/commercial-notices'
import { reconcileBilling } from '../lib/billing-sync'
import { stripe } from '../lib/stripe'
import { reconcileAppointments } from '../lib/connect'
import { deliverMessage, recoverDelivery } from '../lib/delivery'
import { db } from '../lib/db'
import { sendWhatsApp } from '../lib/evolution'

const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:56379')
const connection = {
  host: url.hostname, port: Number(url.port || '6379'),
  username: url.username ? decodeURIComponent(url.username) : undefined,
  password: url.password ? decodeURIComponent(url.password) : undefined,
  db: Number(url.pathname.slice(1) || '0'), maxRetriesPerRequest: null,
  tls: url.protocol === 'rediss:' ? {} : undefined
}
const queue = new Queue('agenda-reminders', { connection })
const worker = new Worker('agenda-reminders', async job => {
  const now = new Date()
  const reminder = await db.reminder.findUnique({
    where: { id: job.data.id }, include: { appointment: { include: { customer: true, tenant: true, service: true, professional: true } } }
  })
  if (!reminder || reminder.deliveryState !== 'QUEUED' || reminder.sentAt || reminder.runAt > now) return
  const { appointment } = reminder
  const { tenant } = appointment
  const followup = reminder.kind === 'BIRTHDAY' || reminder.kind === 'RETURN'
  if (!tenant.active || tenant.suspended || !tenant.whatsappInstance) return
  const agreed = followup ? !!appointment.customer.followupConsentAt : appointment.consent
  const reminderEligible = reminder.kind === 'REMINDER' && appointment.status === 'CONFIRMED' && appointment.startsAt > now &&
    reminderOffsets(tenant).some(offset => +reminder.runAt === +appointment.startsAt - offset * 60_000)
  const sameStart = reminder.scheduledStart && +reminder.scheduledStart === +appointment.startsAt
  const completion = reminder.kind === 'COMPLETED' || reminder.kind === 'FEEDBACK'
  const statusEligible = reminder.kind !== 'REMINDER' && sameStart && (
    completion ? tenant.completionMessages && appointment.status === 'COMPLETED' && (reminder.kind !== 'FEEDBACK' || Boolean(tenant.reviewUrl))
      : tenant.statusMessages && (
        reminder.kind === 'CANCELED' ? appointment.status === 'CANCELED'
          : reminder.kind === 'PAYMENT_PENDING' ? appointment.status === 'PENDING' && appointment.startsAt > now && Boolean(appointment.expiresAt && appointment.expiresAt > now)
            : appointment.status === 'CONFIRMED' && appointment.startsAt > now
      )
  )
  let followupEligible = followup && appointment.status === 'COMPLETED'
  if (reminder.kind === 'BIRTHDAY') followupEligible &&= tenant.birthdayMessages && DateTime.fromJSDate(now, { zone: tenant.timezone }).toFormat('LL-dd') === appointment.customer.birthMonthDay
  if (reminder.kind === 'RETURN') {
    const expected = tenant.returnAfterDays && DateTime.fromJSDate(appointment.endsAt, { zone: tenant.timezone }).plus({ days: tenant.returnAfterDays }).startOf('day').set({ hour: 10 })
    followupEligible &&= Boolean(expected && +expected === +reminder.runAt) && !await db.appointment.count({
      where: { tenantId: tenant.id, customerId: appointment.customerId, status: { in: ['COMPLETED','CONFIRMED','PENDING'] }, startsAt: { gt: appointment.startsAt } }
    })
  }
  if (!agreed || (!reminderEligible && !statusEligible && !followupEligible)) {
    await db.reminder.updateMany({ where: { id: reminder.id, deliveryState: 'QUEUED' }, data: { deliveryState: 'CANCELED' } })
    return
  }
  const local = DateTime.fromJSDate(appointment.startsAt, { zone: tenant.timezone })
  const templates = tenant.whatsappTemplates as Record<string, string> | null
  const kind = reminder.kind as keyof typeof messageTemplates
  const base = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin
  const url = base + '/estabelecimento/' + encodeURIComponent(tenant.slug)
  const template = templates?.[kind] || (kind === 'REMINDER' ? tenant.reminderTemplate : null) || messageTemplates[kind]
  const message = renderMessage(template, {
    cliente: appointment.customer.name, estabelecimento: tenant.name, servico: appointment.service.name,
    profissional: appointment.professional.name, data: local.toFormat('dd/LL/yyyy'), hora: local.toFormat('HH:mm'),
    horario: local.toFormat("dd/LL 'às' HH:mm"),
    valor: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((appointment.chargeCents ?? appointment.cents) / 100),
    pagamento: appointment.checkoutReturnUrl && appointment.paymentToken ? appointment.checkoutReturnUrl + '?pagamento=' + appointment.paymentToken : '',
    agendamento: url, avaliacao: tenant.reviewUrl ?? ''
  })
  await deliverMessage(reminder.id, () => sendWhatsApp(tenant.whatsappInstance!, appointment.customer.phone, message), now)
}, { connection })

async function publishReminders() {
  await queue.getWaitingCount()
  await db.workerHeartbeat.upsert({ where: { id: 1 }, create: { id: 1, seenAt: new Date() }, update: { seenAt: new Date() } })
  const now = new Date()
  await recoverDelivery(now)
  const due = await db.reminder.findMany({
    take: 100, orderBy: { runAt: 'asc' },
    where: {
      deliveryState: 'QUEUED', AND: [{ OR: [{ retryAt: null }, { retryAt: { lte: now } }] }],
      sentAt: null, runAt: { gte: new Date(+now - 86_400_000), lte: now },
      appointment: { tenant: { active: true, suspended: false, whatsappInstance: { not: null } } },
      OR: [
        { kind: 'REMINDER', appointment: { startsAt: { gt: now }, status: 'CONFIRMED' } },
        { kind: { notIn: ['REMINDER', 'COMPLETED', 'FEEDBACK', 'BIRTHDAY', 'RETURN'] }, appointment: { tenant: { statusMessages: true } } },
        { kind: { in: ['COMPLETED', 'FEEDBACK'] }, appointment: { tenant: { completionMessages: true } } },
        { kind: { in: ['BIRTHDAY', 'RETURN'] } }
      ]
    }
  })
  await queue.addBulk(due.map(({ id }) => ({
    name: 'send', data: { id },
    opts: { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true }
  })))
}
let pending: Promise<void> | undefined
async function checkBilling() {
  if (await db.tenant.count({ where: { stripeCustomerId: { not: null } } })) await reconcileBilling(await stripe())
}
let billingPending: Promise<void> | undefined
function tickBilling() {
  if (!billingPending) billingPending = Promise.allSettled([checkBilling(), dispatchCommercial(stripe), scheduleBirthdays()]).then(results => {
    if (results.some(result => result.status === 'rejected')) throw new Error('Falha ao processar assinaturas')
  })
    .catch(() => console.error('billing-reconciliation-unavailable')).finally(() => { billingPending = undefined })
}
function tick() {
  if (!pending) pending = Promise.all([publishReminders(), reconcileAppointments(), db.shopOrder.count({ where: { status: 'PENDING', paymentReview: false, expiresAt: { lte: new Date() } } })
    .then(async count => { if (count) await reconcileOrders(await stripe()) })]).then(() => undefined).catch(() => console.error('Não foi possível consultar os lembretes.')).finally(() => { pending = undefined })
}
const timer = setInterval(tick, 15_000)
const billingTimer = setInterval(tickBilling, 60_000)
tickBilling()
tick()
worker.on('error', () => console.error('Falha na conexão do worker.'))
worker.on('failed', job => console.error('Falha no envio do lembrete', job?.id))
async function shutdown() {
  clearInterval(timer)
  clearInterval(billingTimer)
  await billingPending
  await pending
  await worker.close()
  await queue.close()
  await db.$disconnect()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
