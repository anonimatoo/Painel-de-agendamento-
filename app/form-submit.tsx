'use client'

import { useFormStatus } from 'react-dom'

export function FormSubmit({ children, pendingText = 'Aguarde…' }: { children: string; pendingText?: string }) {
  const { pending } = useFormStatus()
  return <button disabled={pending} aria-busy={pending}>{pending ? pendingText : children}</button>
}
