'use server'

import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { allowAttempt, mailConfigured, sendAccountLink } from '@/lib/account-security'
import { hashPassword, sessionDuration, sessionTokenHash, startSession, userSession, verifyPassword } from '@/lib/auth'
import { AgendaError } from '@/lib/agenda'
import { signupBusiness, signupEmail, signupPassword, registerBusiness } from '@/lib/registration'
import { beginSocial, clearSocialSignup, pendingSocialSignup } from '@/lib/social-auth'
import { checkSocialProvider, isSocialProvider, socialOrigin, type ProviderCredentials } from '@/lib/social-oidc'
import { seal, unseal } from '@/lib/secrets'

type RegisterState = { business?: string; email?: string; fields?: { business?: string; email?: string; password?: string }; message?: string }

export async function registerAccount(social: boolean, _: RegisterState, form: FormData): Promise<RegisterState> {
  const business = signupBusiness.safeParse(form.get('business'))
  const signup = social ? await pendingSocialSignup() : null
  const email = signupEmail.safeParse(social ? signup?.email : form.get('email'))
  const password = social ? null : signupPassword.safeParse(form.get('password'))
  const values = { business: String(form.get('business') ?? '').slice(0, 100), email: social ? undefined : String(form.get('email') ?? '').slice(0, 254) }
  if (social && (!signup || signup.consumerSlug || !email.success)) return { ...values, message: 'Sua confirmação expirou. Volte e entre pelo provedor novamente.' }
  if (!business.success || !email.success || password?.success === false) return { ...values, fields: {
    business: business.success ? undefined : business.error.issues[0].message,
    email: email.success ? undefined : 'Informe um e-mail válido.',
    password: password?.success === false ? password.error.issues[0].message : undefined
  } }
  try {
    if (!(await allowAttempt('register', email.data, 5, 600))) return { ...values, message: 'Aguarde alguns minutos antes de tentar novamente.' }
    const user = await registerBusiness({
      business: business.data, email: email.data, password: password ? await hashPassword(password.data) : undefined,
      emailVerified: signup?.emailVerified, identity: signup ?? undefined
    })
    if (social) await clearSocialSignup()
    await startSession(user.id, false, social)
    if (!user.emailVerifiedAt && await mailConfigured()) await sendAccountLink(user, 'EMAIL_VERIFY').catch(() => {})
  } catch (error) {
    return { ...values, message: error instanceof AgendaError ? error.message : 'Não foi possível criar a conta. Tente novamente.' }
  }
  redirect('/primeiro-acesso?novo=1')
}

export async function socialSignIn(provider: string, linking: boolean, form: FormData) {
  let target = linking ? '/conta?social=confirmar' : '/login?social=erro'
  try {
    if (isSocialProvider(provider)) {
      if (!linking) target = await beginSocial(provider) ?? target
      else {
        const user = await userSession()
        const tokenHash = await sessionTokenHash()
        if (user && !user.platformAdmin && tokenHash && await allowAttempt('social-link', user.id, 6, 600)) {
          const session = await db.session.findUnique({ where: { tokenHash } })
          const password = signupPassword.safeParse(form.get('password'))
          const verified = user.password
            ? password.success && await verifyPassword(password.data, user.password)
            : session && session.userId === user.id && +session.expiresAt >= Date.now() + sessionDuration - 5 * 60_000
          if (verified) target = await beginSocial(provider, { userId: user.id, tokenHash }) ?? target
        }
      }
    }
  } catch {
    // Keep provider secrets and protocol details out of responses.
  }
  redirect(target)
}

const text = z.string().trim().min(1).max(4096)
const googleConfig = z.object({ clientId: z.string().trim().regex(/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/).max(255), secret: text })
const appleConfig = z.object({
  clientId: z.string().trim().regex(/^[A-Za-z0-9.-]+$/).max(255), secret: text,
  teamId: z.string().trim().regex(/^[A-Z0-9]{10}$/),
  keyId: z.string().trim().regex(/^[A-Z0-9]{10}$/)
})
type ProviderState = { message?: string; success?: boolean }

export async function manageSocialProvider(provider: string, _: ProviderState, form: FormData): Promise<ProviderState> {
  if (!isSocialProvider(provider)) return { message: 'Provedor indisponível.' }
  const operation = form.get('operation')
  try {
    const user = await userSession()
    const password = signupPassword.safeParse(form.get('password'))
    if (!user?.platformAdmin || !user.adminMfaVerified || !password.success ||
        !(await allowAttempt('social-provider-admin', user.id, 8, 600)) ||
        !(await verifyPassword(password.data, user.password))) return { message: 'Confirme sua identidade de Super Admin.' }
    const previous = await db.socialProviderSettings.findUnique({ where: { provider } })
    if (operation === 'save') {
      const config = (provider === 'google' ? googleConfig : appleConfig).safeParse(Object.fromEntries(form))
      if (!config.success) return { message: 'Confira os identificadores e a credencial do provedor.' }
      if (provider === 'apple' && !socialOrigin().startsWith('https://')) return { message: 'A Apple exige uma origem HTTPS pública para o retorno.' }
      if (!(await checkSocialProvider(provider, config.data))) return { message: 'O provedor recusou a configuração.' }
      const saved = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${'social-provider:' + provider}))) AS lock`
        const [current] = await tx.$queryRaw<{ revision: string; encrypted: string }[]>`
          SELECT revision, encrypted FROM "SocialProviderSettings" WHERE provider = ${provider} FOR UPDATE`
        if (current?.revision !== previous?.revision) return false
        if (current && await tx.socialIdentity.count({ where: { provider } })) {
          const old = JSON.parse(unseal(current.encrypted, 'social:' + provider)) as ProviderCredentials
          const next: ProviderCredentials = config.data
          if (old.clientId !== next.clientId || old.teamId !== next.teamId) return false
        }
        const data = { encrypted: seal(JSON.stringify(config.data), 'social:' + provider), revision: randomUUID(), enabled: false }
        await tx.socialProviderSettings.upsert({ where: { provider }, create: { provider, ...data }, update: data })
        return true
      })
      if (!saved) return { message: 'A configuração mudou ou já possui contas vinculadas ao identificador anterior.' }
    } else if (operation === 'test' || operation === 'enable' || operation === 'disable') {
      if (!previous) return { message: 'Salve as credenciais primeiro.' }
      if (operation !== 'disable') {
        const config = JSON.parse(unseal(previous.encrypted, 'social:' + provider)) as ProviderCredentials
        if (!(await checkSocialProvider(provider, config))) return { message: 'O provedor recusou a configuração.' }
      }
      if (operation !== 'test') {
        const changed = await db.socialProviderSettings.updateMany({
          where: { provider, revision: previous.revision },
          data: { enabled: operation === 'enable', revision: randomUUID() }
        })
        if (!changed.count) return { message: 'A configuração mudou. Atualize a página e tente novamente.' }
      }
    } else return { message: 'Operação indisponível.' }
    revalidatePath('/super-admin')
    return {
      success: true,
      message: operation === 'disable' ? 'Provedor desativado.' : operation === 'enable' ? 'Provedor ativado.' :
        operation === 'save' ? 'Credenciais criptografadas e salvas. Ative o provedor para liberar o acesso.' :
          'Teste preliminar aceito. Confirme o login completo com uma conta do provedor.'
    }
  } catch {
    return { message: 'Não foi possível validar ou gravar a configuração. Confira as credenciais e tente novamente.' }
  }
}
