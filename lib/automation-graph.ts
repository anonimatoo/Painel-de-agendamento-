import { z } from 'zod'

export const triggers = { CONFIRMED: 'Agendamento confirmado', RESCHEDULED: 'Agendamento reagendado' } as const
export const actions = { AUDIT: 'Registrar execução', WHATSAPP_REMINDER: 'Programar lembrete no WhatsApp' } as const

const position = z.object({ x: z.number().min(-10000).max(10000), y: z.number().min(-10000).max(10000) })
export const automationGraph = z.object({
  nodes: z.tuple([
    z.object({ id: z.literal('event'), position, data: z.object({ trigger: z.enum(['CONFIRMED', 'RESCHEDULED']) }) }),
    z.object({ id: z.literal('task'), position, data: z.object({
      action: z.enum(['AUDIT', 'WHATSAPP_REMINDER']), minutes: z.number().int().min(5).max(10080)
    }) })
  ]),
  edges: z.array(z.object({ id: z.literal('event-task'), source: z.literal('event'), target: z.literal('task') })).max(1)
})

export type AutomationGraph = z.infer<typeof automationGraph>
export type AutomationTrigger = keyof typeof triggers
export const initialGraph: AutomationGraph = {
  nodes: [
    { id: 'event', position: { x: 20, y: 50 }, data: { trigger: 'CONFIRMED' } },
    { id: 'task', position: { x: 20, y: 180 }, data: { action: 'AUDIT', minutes: 60 } }
  ],
  edges: [{ id: 'event-task', source: 'event', target: 'task' }]
}
