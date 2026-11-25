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
