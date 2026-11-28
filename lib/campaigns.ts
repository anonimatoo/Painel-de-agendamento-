import { db } from './db'
import { sendWhatsApp } from './evolution'
import { sendEmail } from './mail'
import { DeliveryRejected } from './delivery'

export async function sendCampaignDelivery(id: string, now = new Date()) {
  const claimed = await db.campaignDelivery.updateMany({ where: { id, state: 'QUEUED' }, data: { state: 'SENDING', claimedAt: now } })
  if (!claimed.count) return
  const row = await db.campaignDelivery.findUnique({
    where: { id }, include: { campaign: { include: { tenant: true } }, consumer: { include: { user: { select: { email: true, emailVerifiedAt: true } } } } }
  })
  if (!row) return
  const { campaign, consumer } = row
  const { tenant } = campaign
  const unsubscribe = new URL('/cliente/' + encodeURIComponent(tenant.slug) + '#comunicacoes', process.env.APP_URL ?? 'http://localhost:3000').href
  const text = tenant.name + '\n\n' + campaign.body + '\n\nGerencie suas autorizações: ' + unsubscribe
  let state = 'CANCELED'
  try {
    if (tenant.active && !tenant.suspended) {
      if (campaign.channel === 'EMAIL' && consumer.marketingEmailAt && consumer.user.emailVerifiedAt && consumer.marketingEmail === consumer.user.email) {
        await sendEmail({ to: consumer.user.email, subject: campaign.title, text, key: 'campaign-' + id })
        state = 'ACCEPTED'
      } else if (campaign.channel === 'WHATSAPP' && tenant.whatsappInstance && consumer.marketingPhoneAt && consumer.marketingPhone === consumer.phone) {
        state = await sendWhatsApp(tenant.whatsappInstance, consumer.phone, campaign.title + '\n\n' + text) ? 'ACCEPTED' : 'REVIEW'
      }
    }
  } catch (error) { state = error instanceof DeliveryRejected && !error.retryable ? 'FAILED' : 'REVIEW' }
  await db.campaignDelivery.updateMany({ where: { id, state: 'SENDING', claimedAt: now }, data: { state, claimedAt: null } })
}
