# CS Agenda Pro

Aplicação de agendamento multiempresa. Consulte a [arquitetura](docs/arquitetura.md), a [operação](docs/operacao.md) e os [resultados de verificação](docs/validacao.md).

## Desenvolvimento no Windows 11

Instale Node.js 22 ou superior e Docker Desktop. Abra o PowerShell na raiz do projeto.

```powershell
Copy-Item .env.example .env
docker compose up -d
npm ci
npm run db:deploy
npm run dev
```

Abra http://localhost:3000. Para inicializar o Super Admin, use outra sessão do PowerShell.

```powershell
$env:ADMIN_EMAIL = Read-Host 'E-mail do Super Admin'
$env:ADMIN_PASSWORD = Read-Host 'Senha inicial' -MaskInput
node --env-file=.env --import tsx scripts/admin.ts
Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

Execute o worker separadamente.

```powershell
node --env-file=.env --import tsx worker/index.ts
```

Execute os testes com um PostgreSQL exclusivo de desenvolvimento.

```powershell
node --env-file=.env --import tsx --test tests/agenda.test.ts
npm run build
```

Com a aplicação em execução e um banco de testes separado, rode as verificações HTTP.

```powershell
node --env-file=.env tests/smoke.mjs
node --env-file=.env --import tsx tests/fluxo.ts
```

A versão atual cobre o fluxo central de agenda. Consulte a matriz de aceitação em [Validação](docs/validacao.md) para ver a cobertura, os limites e os itens pendentes.

## Revisão da finalização comercial

Leia a [matriz da branch](docs/finalizacao.md) e o [roteiro de homologação](docs/operacao.md#roteiro-de-homologação-externa). Configure CREDENTIAL_ENCRYPTION_KEY para a autenticação em duas etapas do Super Admin. Faça a primeira ativação pelo painel após criar a conta.

Para as verificações adicionais com uma instância local em execução:

```powershell
npm run lint
npx tsc --noEmit
$env:CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --env-file=.env --import tsx tests/responsivo.ts
node --env-file=.env --import tsx tests/infra.ts
```

O teste de infraestrutura requer Redis, banco e bucket S3 dedicados para testes. O teste de webhook local usa um segredo de teste, com web e script apontando para a mesma instância e o mesmo banco.

### Revisão do PR #1

Consulte a [matriz atual](docs/finalizacao.md), a [evidência de testes](docs/validacao.md) e os [procedimentos de operação e homologação](docs/operacao.md). A configuração Stripe salva no painel prevalece sobre o ambiente técnico. O provisionamento automático por QR na Evolution é opcional e usa EVOLUTION_QR_PROVISIONING.

### Verificação da revisão de encerramento

Crie um banco PostgreSQL dedicado, sem configuração Stripe salva. Execute `npm ci`, aplique as migrations e rode `npm run build`, `npx tsc --noEmit`, `npm run lint` e `npm test`. As suítes exercitam alterações de credenciais e dados descartáveis. Para testes de integração externa, utilize contas, domínios e segredos exclusivos de homologação. Consulte o [diagnóstico e a operação](docs/operacao.md#encerramento-das-pendências-de-desenvolvimento).
