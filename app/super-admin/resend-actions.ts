'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { allowAttempt } from '@/lib/account-security'
import { userSession, verifyPassword } from '@/lib/auth'
import { saveMailConfiguration, sendEmail } from '@/lib/mail'

type State = { message?: string; success?: boolean }

export async function manageResend(_: State, form: FormData): Promise<State> {
  try {
    const user = await userSession()
    const password = z.string().min(12).max(128).safeParse(form.get('password'))
    if (!user?.platformAdmin || !user.adminMfaVerified || !password.success ||
        !await allowAttempt('resend-settings', user.id, 6, 600) || !await verifyPassword(password.data, user.password)) {
      return { message: 'Confirme sua identidade de Super Admin.' }
    }
    if (form.get('command') === 'test') {
      await sendEmail({ to: user.email, subject: 'Teste de e-mail · CS Agenda Pro', text: 'Este e-mail confirma o envio transacional solicitado no painel.' })
      return { success: true, message: 'E-mail de teste aceito pelo provedor. Confira a entrega na sua caixa de entrada.' }
    }
    const parsed = z.object({ sender: z.email().max(254), apiKey: z.string().trim().regex(/^re_[A-Za-z0-9_-]{12,250}$/) }).safeParse(Object.fromEntries(form))
    if (!parsed.success) return { message: 'Confira o endereço do remetente e a chave do Resend.' }
    await saveMailConfiguration(user.id, parsed.data.sender, parsed.data.apiKey)
    revalidatePath('/super-admin')
    return { success: true, message: 'Configuração criptografada e salva. Use o envio de teste para verificar a entrega.' }
  } catch {
    return { message: 'Não foi possível concluir a operação do Resend.' }
  }
}
