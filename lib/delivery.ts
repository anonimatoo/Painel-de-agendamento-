import { db } from './db'

export class DeliveryRejected extends Error {
  constructor(readonly retryable: boolean) {
    super('O provedor recusou o envio.')
  }
}

export async function deliverMessage(id: string, send: () => Promise<string | undefined>, now = new Date()) {
  const claim = await db.reminder.updateManyAndReturn({
    where: { id, sentAt: null, deliveryState: 'QUEUED', OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
    data: { deliveryState: 'SENDING', claimedAt: now, deliveryAttempts: { increment: 1 } },
    select: { deliveryAttempts: true }
  })
  if (!claim.length) return
  const where = { id, claimedAt: now, deliveryState: 'SENDING' }
  let providerMessageId: string | undefined
  try {
    providerMessageId = await send()
  } catch (error) {
    const attempt = claim[0].deliveryAttempts
    const retry = error instanceof DeliveryRejected && error.retryable && attempt < 5
    const deliveryState = retry ? 'QUEUED' : error instanceof DeliveryRejected ? 'FAILED' : 'REVIEW'
    await db.reminder.updateMany({
      where, data: { deliveryState, claimedAt: null, retryAt: retry ? new Date(+now + 30_000 * 2 ** (attempt - 1)) : null }
    })
    return
  }
  // A crash here leaves SENDING. Recovery flags it for review and never retransmits automatically.
  await db.reminder.updateMany({
    where, data: { deliveryState: 'SENT', sentAt: new Date(), claimedAt: null, retryAt: null, providerMessageId }
  })
}

export async function recoverDelivery(now = new Date()) {
  await db.reminder.updateMany({
    where: { deliveryState: 'SENDING', claimedAt: { lt: new Date(+now - 120_000) } },
    data: { deliveryState: 'REVIEW' }
  })
}
