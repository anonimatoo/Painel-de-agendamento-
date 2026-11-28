export function supportEmail() {
  const address = process.env.SUPPORT_EMAIL?.trim()
  return address && /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(address) ? address : 'cs.solucoesdigitais@protonmail.com'
}
