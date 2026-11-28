import assert from 'node:assert/strict'

const origin = process.env.APP_URL || 'http://localhost:3000'
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { redirect: 'manual', ...options })
}

for (const [path, title] of [
  ['/', 'Seu próximo atendimento começa aqui'],
  ['/login', 'Entrar'],
  ['/cadastro', 'Criar conta'],
  ['/planos', 'Planos']
]) {
  const result = await request(path)
  assert.equal(result.status, 200, path)
  assert.match(await result.text(), new RegExp(title))
}
for (const path of ['/dashboard', '/super-admin']) {
  const result = await request(path)
  assert.equal(result.status, 307, path)
  assert.equal(result.headers.get('location'), '/login')
}
for (const source of ['billing', 'connect']) {
  const result = await request('/api/stripe/' + source, { method: 'POST', body: '{}' })
  assert.equal(result.status, 400)
}
assert.equal((await request('/estabelecimento/nao-cadastrado')).status, 404)
const schedule = await request('/api/estabelecimentos/nao-cadastrado/horarios?servico=a&profissional=b&dia=2026-11-30')
assert.equal(schedule.status, 404)
assert.equal((await request('/api/saude')).status, 204)
console.log('Verificação HTTP aprovada para 11 requisições.')
