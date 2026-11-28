import type { Prisma } from '@prisma/client'
import { automationGraph, type AutomationTrigger } from './automation-graph'
import { db } from './db'

export async function queueAutomation(tx: Prisma.TransactionClient, appointment: { id: string; tenantId: string; startsAt: Date }, trigger: AutomationTrigger) {
  const rules = await tx.automationRule.findMany({
    where: { tenantId: appointment.tenantId, trigger, enabled: true, tenant: { active: true, suspended: false } },
    select: { id: true, revision: true }
  })
  if (!rules.length) return
  await tx.automationRun.createMany({ data: rules.map(rule => ({
    tenantId: appointment.tenantId, appointmentId: appointment.id, startsAt: appointment.startsAt, trigger,
    ruleId: rule.id, revision: rule.revision
  })), skipDuplicates: true })
}

export async function processAutomationRuns(now = new Date()) {
  const waiting = await db.automationRun.findMany({ where: { state: 'QUEUED' }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true } })
  for (const { id } of waiting) await db.$transaction(async tx => {
    const claimed = await tx.automationRun.updateMany({ where: { id, state: 'QUEUED' }, data: { state: 'DISCARDED' } })
    if (!claimed.count) return
    const run = await tx.automationRun.findUniqueOrThrow({
      where: { id }, include: { rule: { include: { tenant: true } }, appointment: true }
    })
    const { rule, appointment } = run
    const { tenant } = rule
    if (!tenant.active || tenant.suspended || !rule.enabled || rule.revision !== run.revision) return
    const parsed = automationGraph.safeParse(rule.graph)
    if (!parsed.success || !parsed.data.edges.length) return
    const task = parsed.data.nodes[1].data
    if (task.action === 'AUDIT') {
      await tx.automationRun.update({ where: { id }, data: { state: 'RECORDED' } })
      return
    }
    const runAt = new Date(+run.startsAt - task.minutes * 60_000)
    if (appointment.status !== 'CONFIRMED' || +appointment.startsAt !== +run.startsAt ||
        !appointment.consent || !tenant.whatsappInstance || runAt <= now) return
    const scheduled = await tx.reminder.findUnique({
      where: { appointmentId_runAt_kind: { appointmentId: appointment.id, runAt, kind: 'REMINDER' } },
      select: { id: true, deliveryState: true }
    })
    const reminder = scheduled && scheduled.deliveryState !== 'CANCELED' ? scheduled : await tx.reminder.upsert({
      where: { appointmentId_runAt_kind: { appointmentId: appointment.id, runAt, kind: 'CS_AUTOMATION' } },
      update: {}, create: { appointmentId: appointment.id, runAt, kind: 'CS_AUTOMATION', scheduledStart: run.startsAt }, select: { id: true }
    })
    await tx.automationRun.update({ where: { id }, data: { state: 'SCHEDULED', reminderId: reminder.id } })
  })
}
