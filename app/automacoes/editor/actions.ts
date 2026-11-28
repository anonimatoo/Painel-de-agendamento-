'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { automationGraph, type AutomationGraph } from '@/lib/automation-graph'

export async function saveAutomation(input: { id?: string; revision?: number; name: string; enabled: boolean; graph: AutomationGraph }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'whatsapp.manage')) return { error: 'Acesso indisponível.' }
  const parsed = z.object({
    id: z.string().max(100).optional(), revision: z.number().int().positive().optional(),
    name: z.string().trim().min(2).max(100), enabled: z.boolean(), graph: automationGraph
  }).safeParse(input)
  if (!parsed.success) return { error: 'Revise o nome e os passos da automação.' }
  const { id, revision, graph, name, enabled } = parsed.data
  if (enabled && !graph.edges.length) return { error: 'Conecte o evento à ação antes de ativar.' }
  if (enabled && graph.nodes[1].data.action === 'WHATSAPP_REMINDER' && !member.tenant.whatsappInstance) {
    return { error: 'Conecte o WhatsApp em Configurações para ativar este fluxo.' }
  }
  const trigger = graph.nodes[0].data.trigger
  try {
    if (!id) {
      const row = await db.automationRule.create({ data: { tenantId: member.tenantId, graph, trigger, name, enabled } })
      revalidatePath('/automacoes/editor')
      return { id: row.id, revision: row.revision }
    }
    if (!revision) return { error: 'Atualize a página para editar esta automação.' }
    const changed = await db.automationRule.updateMany({ where: { tenantId: member.tenantId, id, revision },
      data: { graph, trigger, name, enabled, revision: { increment: 1 } } })
    if (!changed.count) return { error: 'O fluxo foi alterado. Atualize a página para continuar.' }
    revalidatePath('/automacoes/editor')
    return { id, revision: revision + 1 }
  } catch { return { error: 'Não foi possível salvar a automação.' } }
}
