'use server'

import { randomInt, timingSafeEqual } from 'node:crypto'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { allowAttempt } from '@/lib/account-security'
import { userSession } from '@/lib/auth'
import { activeStore, consumerPath } from '@/lib/consumer'
import { db } from '@/lib/db'
import { sendWhatsApp } from '@/lib/evolution'
import { seal, unseal } from '@/lib/secrets'

export async function communicationPreference(slug: string, form: FormData) {
  const user = await userSession()
  const tenant = typeof slug === 'string' && user ? await activeStore(slug) : null
  if (!tenant || !user || user.platformAdmin) redirect('/login')
  const { id: tenantId } = tenant
  const userId = user.id
  const where = { tenantId_userId: { tenantId, userId } }
  const profile = await db.consumerProfile.findUnique({ where })
  const command = form.get('command')
  let state = 'salvo'
  try {
    if (!profile) throw new Error()
    switch (command) {
      case 'email-on':
        if (!user.emailVerifiedAt) throw new Error()
        await db.consumerProfile.update({ where, data: { marketingEmail: user.email, marketingEmailAt: new Date() } })
        break
      case 'email-off':
        await db.consumerProfile.update({ where, data: { marketingEmail: null, marketingEmailAt: null } })
        break
      case 'whatsapp-off':
        await db.consumerProfile.update({
          where, data: { marketingPhone: null, marketingPhoneAt: null, marketingPhoneCode: null, marketingPhoneCodeUntil: null }
        })
        break
      case 'whatsapp-code': {
        if (!tenant.whatsappInstance || !/^55\d{10,11}$/.test(profile.phone) ||
            !await allowAttempt('campaign-phone-user', tenantId + ':' + userId, 3, 1800) ||
            !await allowAttempt('campaign-phone-number', tenantId + ':' + profile.phone, 3, 1800)) throw new Error()
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
        const secret = seal(code, 'marketing-phone:' + tenantId + ':' + userId + ':' + profile.phone)
        const updated = await db.consumerProfile.updateMany({ where: { tenantId, userId, phone: profile.phone }, data: {
          marketingPhoneCode: secret, marketingPhoneCodeUntil: new Date(Date.now() + 600_000)
        } })
        if (!updated.count) throw new Error()
        try {
          if (!await sendWhatsApp(tenant.whatsappInstance, profile.phone, 'Código para autorizar novidades de ' + tenant.name + ': ' + code + '. Expira em 10 minutos.')) throw new Error()
        } catch {
          await db.consumerProfile.updateMany({ where: { tenantId, userId, marketingPhoneCode: secret }, data: {
            marketingPhoneCode: null, marketingPhoneCodeUntil: null
          } })
          throw new Error()
        }
        state = 'codigo'
        break
      }
      case 'whatsapp-on': {
        const value = z.string().regex(/^\d{6}$/).parse(form.get('code'))
        if (!await allowAttempt('campaign-phone-confirm', tenantId + ':' + userId, 6, 600) ||
            !profile.marketingPhoneCode || !profile.marketingPhoneCodeUntil || profile.marketingPhoneCodeUntil <= new Date()) throw new Error()
        const expected = unseal(profile.marketingPhoneCode, 'marketing-phone:' + tenantId + ':' + userId + ':' + profile.phone)
        if (!timingSafeEqual(Buffer.from(expected), Buffer.from(value))) throw new Error()
        const saved = await db.consumerProfile.updateMany({
          where: { tenantId, userId, phone: profile.phone, marketingPhoneCode: profile.marketingPhoneCode, marketingPhoneCodeUntil: { gt: new Date() } },
          data: { marketingPhone: profile.phone, marketingPhoneAt: new Date(), marketingPhoneCode: null, marketingPhoneCodeUntil: null }
        })
        if (!saved.count) throw new Error()
        break
      }
      default: throw new Error()
    }
  } catch { state = 'erro' }
  redirect(consumerPath(slug) + '?comunicacao=' + state + '#comunicacoes')
}
