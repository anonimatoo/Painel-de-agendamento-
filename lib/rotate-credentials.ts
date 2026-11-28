import { db } from './db'
import { seal, unseal } from './secrets'

export async function rotateCredentials(database: string, existing: Buffer, replacement: Buffer, apply: boolean) {
  if (existing.equals(replacement)) throw new Error('A chave nova precisa ser diferente.')
  return db.$transaction(async tx => {
    const [target] = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (target?.name !== database) throw new Error('Banco diferente do autorizado.')
    if (apply) {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
      await tx.$executeRaw`LOCK TABLE "EvolutionSetting", "MailSetting", "SocialAttempt", "SocialProviderSettings", "StripeSettings", "User" IN SHARE ROW EXCLUSIVE MODE`
    }
    const reencrypt = (value: string, context: string) => {
      const clear = unseal(value, context, existing)
      const sealed = seal(clear, context, replacement)
      if (unseal(sealed, context, replacement) !== clear) throw new Error('Falha na verificação criptográfica.')
      return sealed
    }
    const summary = { stripe: 0, evolution: 0, resend: 0, social: 0, authenticators: 0, pendingMfa: 0, pendingSocial: 0 }
    for (const row of await tx.stripeSettings.findMany()) {
      const namespace = row.accountId + ':' + row.mode
      const data = {
        encrypted: reencrypt(row.encrypted, 'stripe:' + namespace),
        previousWebhooks: row.previousWebhooks && reencrypt(row.previousWebhooks, 'stripe-webhooks:' + namespace)
      }
      if (apply) await tx.stripeSettings.update({ where: { id: row.id }, data })
      summary.stripe++
    }
    for (const row of await tx.evolutionSetting.findMany()) {
      const encryptedKey = reencrypt(row.encryptedKey, 'evolution:' + row.endpoint)
      if (apply) await tx.evolutionSetting.update({ where: { id: row.id }, data: { encryptedKey } })
      summary.evolution++
    }
    for (const row of await tx.mailSetting.findMany()) {
      const encryptedKey = reencrypt(row.encryptedKey, 'resend:1')
      if (apply) await tx.mailSetting.update({ where: { id: row.id }, data: { encryptedKey } })
      summary.resend++
    }
    for (const row of await tx.socialProviderSettings.findMany()) {
      const encrypted = reencrypt(row.encrypted, 'social:' + row.provider)
      if (apply) await tx.socialProviderSettings.update({ where: { provider: row.provider }, data: { encrypted } })
      summary.social++
    }
    for (const user of await tx.user.findMany({ where: { OR: [{ mfaSecret: { not: null } }, { mfaPending: { not: null } }] },
      select: { id: true, mfaSecret: true, mfaPending: true } })) {
      const mfaSecret = user.mfaSecret && reencrypt(user.mfaSecret, 'mfa:' + user.id)
      const mfaPending = user.mfaPending && reencrypt(user.mfaPending, 'setup:' + user.id)
      if (apply) await tx.user.update({ where: { id: user.id }, data: { mfaSecret, mfaPending } })
      summary.authenticators += Number(Boolean(mfaSecret))
      summary.pendingMfa += Number(Boolean(mfaPending))
    }
    // OAuth stores only a digest of state. Its ciphertext cannot be re-encrypted without state.
    summary.pendingSocial = apply ? (await tx.socialAttempt.deleteMany()).count : await tx.socialAttempt.count()
    return summary
  }, { timeout: 60_000, isolationLevel: 'RepeatableRead' })
}
