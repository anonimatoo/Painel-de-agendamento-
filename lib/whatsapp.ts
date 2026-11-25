import { createHash } from 'node:crypto'
import { db } from './db'
import { createWhatsAppInstance, deleteWhatsAppInstance, whatsAppStatus } from './evolution'
import { AgendaError } from './agenda'

export function instanceName(tenantId: string) {
  return 'agenda-managed-' + createHash('sha256').update(tenantId).digest('hex').slice(0, 40)
}

export async function provisionWhatsApp(tenantId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    if (tenant.whatsappInstance) return tenant.whatsappInstance
    if (process.env.EVOLUTION_QR_PROVISIONING !== 'true') {
      throw new AgendaError('A conexão por QR Code ainda não está disponível. Solicite a ativação do WhatsApp ao suporte.')
    }
    const instance = instanceName(tenantId)
    try {
      await createWhatsAppInstance(instance)
    } catch (error) {
      // A retry can recover an instance already created before a network interruption.
      if (!await whatsAppStatus(instance).catch(() => null)) throw error
    }
    await tx.tenant.update({ where: { id: tenantId }, data: { whatsappInstance: instance } })
    return instance
  }, { timeout: 28_000 })
}

export async function removeWhatsApp(tenantId: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    if (tenant.whatsappInstance !== instanceName(tenantId)) {
      throw new AgendaError('Solicite ao suporte a remoção desta conexão de WhatsApp.')
    }
    await deleteWhatsAppInstance(tenant.whatsappInstance)
    await tx.tenant.update({ where: { id: tenantId }, data: { whatsappInstance: null, reminderMinutes: null, reminderPresets: [], statusMessages: false, completionMessages: false } })
    await tx.reminder.updateMany({
      where: { appointment: { tenantId }, deliveryState: 'QUEUED' }, data: { deliveryState: 'CANCELED' }
    })
  }, { timeout: 16_000 })
}
