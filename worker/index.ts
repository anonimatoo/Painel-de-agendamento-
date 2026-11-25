import { Queue, Worker } from 'bullmq'
import { DateTime } from 'luxon'
import { reconcileOrders } from '../lib/orders'
import { reconcileBilling } from '../lib/billing-sync'
import { stripe } from '../lib/stripe'
import { reconcileAppointments } from '../lib/connect'
import { deliverMessage, recoverDelivery } from '../lib/delivery'
import { db } from '../lib/db'
import { reminderMessage, sendWhatsApp } from '../lib/evolution'

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
    where: { id: job.data.id }, include: { appointment: { include: { customer: true, tenant: true } } }
  })
  if (!reminder || reminder.deliveryState !== 'QUEUED' || reminder.sentAt || reminder.runAt > now) return
  const { appointment } = reminder
  const { tenant } = appointment
  if (!appointment.consent || !tenant.active || tenant.suspended || !tenant.whatsappInstance) return
  const reminderEligible = reminder.kind === 'REMINDER' && appointment.status === 'CONFIRMED' && appointment.startsAt > now &&
    tenant.reminderMinutes && +reminder.runAt === +appointment.startsAt - tenant.reminderMinutes * 60_000
  const sameStart = reminder.scheduledStart && +reminder.scheduledStart === +appointment.startsAt
  const statusEligible = reminder.kind !== 'REMINDER' && tenant.statusMessages && sameStart &&
    (reminder.kind === 'CANCELED' ? appointment.status === 'CANCELED' : appointment.status === 'CONFIRMED' && appointment.startsAt > now)
  if (!reminderEligible && !statusEligible) {
    await db.reminder.updateMany({ where: { id: reminder.id, deliveryState: 'QUEUED' }, data: { deliveryState: 'CANCELED' } })
    return
  }
    const time = DateTime.fromJSDate(appointment.startsAt, { zone: tenant.timezone }).toFormat("dd/LL 'às' HH:mm")
    const messages: Record<string, string> = {
      CONFIRMED: 'atendimento confirmado para ' + time + '.',
      PAID: 'pagamento recebido. Atendimento confirmado para ' + time + '.',
      CANCELED: 'o atendimento de ' + time + ' foi cancelado.',
      RESCHEDULED: 'o atendimento foi reagendado para ' + time + '.'
    }
    const message = reminder.kind === 'REMINDER' ? reminderMessage(tenant.reminderTemplate, tenant.name, time)
      : tenant.name + ' informa: ' + messages[reminder.kind]
    await deliverMessage(reminder.id, () => sendWhatsApp(tenant.whatsappInstance!, appointment.customer.phone, message), now)
}, { connection })

async function publishReminders() {
  const now = new Date()
  await recoverDelivery(now)
  const due = await db.reminder.findMany({
    take: 100, orderBy: { runAt: 'asc' },
    where: {
      deliveryState: 'QUEUED', AND: [{ OR: [{ retryAt: null }, { retryAt: { lte: now } }] }],
      sentAt: null, runAt: { gte: new Date(+now - 86_400_000), lte: now },
      appointment: { consent: true, tenant: { active: true, suspended: false, whatsappInstance: { not: null } } },
      OR: [
        { kind: 'REMINDER', appointment: { startsAt: { gt: now }, status: 'CONFIRMED', tenant: { reminderMinutes: { not: null } } } },
        { kind: { not: 'REMINDER' }, appointment: { tenant: { statusMessages: true } } }
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
  if (!billingPending) billingPending = checkBilling()
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
