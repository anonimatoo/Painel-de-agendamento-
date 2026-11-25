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
