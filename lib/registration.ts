import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from './db'
import { allocatePublicSlug } from './public-identity'
import { enqueueCommercial } from './commercial-notices'
import { AgendaError } from './agenda'

export const signupBusiness = z.string().trim().min(2, 'Informe o nome do estabelecimento.').max(100, 'Use até 100 caracteres.')
export const signupEmail = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254)
export const signupPassword = z.string().min(12, 'Use pelo menos 12 caracteres.').max(128, 'Use até 128 caracteres.')

export async function registerBusiness(input: {
  business: string; email: string; password?: string; emailVerified?: boolean;
  identity?: { provider: string; subject: string; revision: string }
}) {
  try {
    return await db.$transaction(async tx => {
      if (input.identity) {
        const [provider] = await tx.$queryRaw<{ enabled: boolean; revision: string }[]>`
          SELECT enabled, revision FROM "SocialProviderSettings" WHERE provider = ${input.identity.provider} FOR SHARE`
        if (!provider?.enabled || provider.revision !== input.identity.revision) throw new AgendaError('Inicie novamente pelo provedor.')
      }
      if (await tx.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select: { id: true } })) {
        throw new AgendaError('Já existe uma conta. Entre pelo método que você já utiliza.')
      }
      const slug = await allocatePublicSlug(tx, input.business)
      const user = await tx.user.create({
        data: {
          email: input.email, password: input.password, emailVerifiedAt: input.emailVerified ? new Date() : undefined,
          socialIdentities: input.identity ? { create: { provider: input.identity.provider, subject: input.identity.subject } } : undefined,
          memberships: { create: { role: 'ADMIN', tenant: { create: { name: input.business, slug } } } }
        }, include: { memberships: { select: { tenantId: true } } }
      })
      for (const kind of ['REGISTERED', 'WELCOME'] as const) await enqueueCommercial(tx, { tenantId: user.memberships[0].tenantId, kind, reference: user.id })
      return user
    }, { timeout: 15_000 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AgendaError('Já existe uma conta. Entre pelo método que você já utiliza.')
    }
    throw error
  }
}
