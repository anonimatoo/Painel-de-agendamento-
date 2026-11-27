import { z } from 'zod'

const required = z.string({ error: 'Preencha este campo.' }).trim().min(1, 'Preencha este campo.')
  .max(300, 'O valor excede o tamanho permitido.')

export const stripeSettingsForm = z.object({
  mode: z.enum(['test', 'live'], { error: 'Selecione Teste ou Produção.' }),
  publishableKey: required.pipe(z.string().regex(/^pk_(?:test|live)_[A-Za-z0-9]+$/, 'Informe uma chave pública Stripe válida.')),
  secret: required.pipe(z.string().regex(/^sk_(?:test|live)_[A-Za-z0-9]+$/, 'Informe uma chave secreta Stripe válida.')),
  billingWebhook: required.pipe(z.string().regex(/^whsec_[A-Za-z0-9]+$/, 'Informe o segredo do webhook de assinaturas.')),
  connectWebhook: required.pipe(z.string().regex(/^whsec_[A-Za-z0-9]+$/, 'Informe o segredo do webhook Connect.')),
  password: z.string({ error: 'Informe sua senha.' }).min(1, 'Informe sua senha.').max(128, 'Confira sua senha.')
}).superRefine((data, ctx) => {
  for (const [field, prefix] of [['publishableKey', 'pk'], ['secret', 'sk']] as const) {
    if (!data[field].startsWith(prefix + '_' + data.mode + '_')) ctx.addIssue({
      code: 'custom', path: [field], message: 'A chave não corresponde ao ambiente selecionado.'
    })
  }
})

export type StripeSettingsFields = keyof z.infer<typeof stripeSettingsForm>
export type StripeSettingsFormState = {
  status?: 'saved' | 'validation' | 'authorization' | 'authentication' | 'communication' | 'encryption' | 'persistence' | 'financial'
  message?: string
  fields?: Partial<Record<StripeSettingsFields, string | undefined>>
}
