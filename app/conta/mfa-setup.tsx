'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { activateMfa, generateMfaRecovery, setupMfa } from '../actions'

export function MfaSetup({ email, enabled, recoveryIssued }: { email: string; enabled: boolean; recoveryIssued: boolean }) {
  const [setup, requestSetup, settingUp] = useActionState(async (previous: Awaited<ReturnType<typeof setupMfa>>, form: FormData) => {
    const next = await setupMfa(form)
    return next.message ? { ...previous, message: next.message } : next
  }, {})
  const [activation, activate, activating] = useActionState(activateMfa, {})
  const [recovery, issueRecovery, issuing] = useActionState(generateMfaRecovery, {})
  const [copyStatus, setCopyStatus] = useState('')
  const codes = activation.codes ?? recovery.codes
  const ready = Boolean(enabled || activation.codes)
  const busy = settingUp || activating || issuing

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret)
      setCopyStatus('Chave copiada.')
    } catch {
      setCopyStatus('Selecione e copie a chave manualmente.')
    }
  }

  return <section className="mfa-panel" aria-labelledby="mfa-title">
    <div>
      <h2 id="mfa-title">Autenticação em duas etapas</h2>
      {ready
        ? <p className="success" role="status">Autenticação em duas etapas ativa.</p>
        : <p>Proteja o acesso administrativo com Google Authenticator, Microsoft Authenticator ou outro aplicativo TOTP.</p>}
    </div>

    {codes ? <div className="mfa-step">
      <h3>Códigos de recuperação</h3>
      <p>Guarde estes códigos em um local seguro. Eles são exibidos somente agora. Use um código no login se perder acesso ao aplicativo. Cada código funciona uma vez.</p>
      <ul className="mfa-recovery-codes" aria-label="Códigos de recuperação">
        {codes.map(code => <li key={code}><code>{code}</code></li>)}
      </ul>
      <Link className="button" href="/super-admin">Continuar para a administração</Link>
    </div> : ready ? !recoveryIssued && <div className="mfa-step">
      <h3>Códigos de recuperação</h3>
      <p>Confirme sua senha para gerar códigos de uso único.</p>
      <form action={issueRecovery}>
        <label>Sua senha<input name="password" type="password" autoComplete="current-password" required /></label>
        <button disabled={busy}>Gerar códigos de recuperação</button>
      </form>
      {recovery.message && <p className="error" role="alert">{recovery.message}</p>}
    </div> : <>
      {setup.secret && setup.qr && setup.challenge && <div className="mfa-step" key={setup.challenge}>
        <h3>Vincule o aplicativo autenticador</h3>
        <div className="mfa-enrollment">
          <img className="mfa-qr" src={setup.qr} width={240} height={240} alt="QR Code para configurar a autenticação em duas etapas" />
          <div className="mfa-manual">
            <p>Escaneie o QR Code ou adicione uma conta baseada em tempo com os dados abaixo.</p>
            <dl><dt>Emissor</dt><dd>CS Agenda Pro</dd><dt>Conta</dt><dd>{email}</dd></dl>
            <label>Chave secreta<input className="mfa-secret" value={setup.secret} readOnly spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
            <button type="button" className="outline" onClick={() => copySecret(setup.secret!)}>Copiar chave</button>
            <p role="status" className="mfa-copy-status">{copyStatus}</p>
          </div>
        </div>
        <form action={activate}>
          <input type="hidden" name="challenge" value={setup.challenge} />
          <label>Código de seis dígitos<input className="mfa-code" name="code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="one-time-code" placeholder="000000" required /></label>
          <button disabled={busy}>{activating ? 'Validando…' : 'Ativar autenticação'}</button>
        </form>
        {activation.message && <p className="error" role="alert">{activation.message}</p>}
      </div>}
      <div className="mfa-step">
        <h3>{setup.secret ? 'Substituir a chave pendente' : 'Confirme sua identidade'}</h3>
        {setup.secret && <p>A chave expira em 10 minutos. Ao gerar outra, escaneie o novo QR Code.</p>}
        <form action={requestSetup} onSubmit={() => setCopyStatus('')}>
          <label>Sua senha<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className={setup.secret ? 'outline' : undefined} disabled={busy}>
            {settingUp ? 'Gerando…' : setup.secret ? 'Gerar nova chave' : 'Gerar QR Code'}
          </button>
        </form>
        {setup.message && <p className="error" role="alert">{setup.message}</p>}
      </div>
    </>}
  </section>
}
