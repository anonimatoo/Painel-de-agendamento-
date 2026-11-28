# Instalação e inicialização no Windows 11

Use PowerShell com o mesmo usuário que protegeu a chave existente por DPAPI. Instale Git, Node.js 22 ou superior e os clientes PostgreSQL compatíveis com a versão do servidor. O aplicativo precisa de PostgreSQL e Redis em execução. Guarde a chave protegida e o backup fora do diretório Git.

## Atualizar a instalação

Na raiz do projeto, preserve as alterações locais com um commit ou stash identificado antes de aplicar o patch. Compare a versão base com `git rev-parse HEAD`. Este patch parte de `0c180f91988b6a99dfbb2bf9de4ffdd17388885a`.

```powershell
git status --short
git rev-parse HEAD
git am --3way C:\caminho\cs-agenda-pro-v3.patch
npm ci
npx prisma generate
npx prisma migrate status
```

Registre o destino do banco e faça o backup conforme o procedimento de manutenção. Depois aplique as migrations com `npm run db:deploy` e execute `npx prisma migrate status` novamente. O Prisma lê os arquivos SQL. O prompt do PowerShell não interpreta instruções SQL.

## Configuração persistente

Mantenha `DATABASE_URL`, `APP_URL` e `REDIS_URL` em `.env.local` ou nas variáveis persistentes do serviço. Use `DATABASE_DIRECT_URL` para migrations quando o runtime usa conexão agrupada. A origem do inicializador local é HTTP em `localhost` ou `127.0.0.1`. Para HTTPS remoto, configure o hosting correspondente.

O inicializador recebe o caminho da chave **já existente** em formato de texto produzido por `ConvertFrom-SecureString` sem chave explícita, protegido pelo usuário local. Se a instalação anterior usa outro formato DPAPI, confirme o método de exportação e converta a **mesma chave** pelo procedimento da instalação anterior. Faça isso antes de iniciar o aplicativo.

```powershell
.\scripts\iniciar-windows.ps1 -ArquivoDpapi 'C:\caminho\chave-existente.dpapi' -Compilar
```

Use `-Compilar` na primeira execução ou após atualizar o código. O script mantém o servidor e o worker sob supervisão no mesmo terminal. Em seguida, execute sem esse parâmetro para usar a compilação existente.

O mutex protege cada checkout de lançamentos simultâneos pelo inicializador. A porta ocupada impede uma segunda instância web local. O script verifica PostgreSQL, migrations, Redis, prontidão HTTP e a primeira leitura do worker. A compilação manual em outro terminal deve ocorrer somente com o inicializador parado. O arquivo `.local/windows-runtime.log` registra etapas e falhas sem valores de variáveis ou retorno bruto de provedores.

Para iniciar após login ou reinício, crie no Agendador de Tarefas uma tarefa executada pelo proprietário do DPAPI. Use `powershell.exe` com `-NoProfile -File` e os caminhos absolutos do script e do arquivo protegido. Selecione a opção de não iniciar uma segunda instância e configure reinício em falha. Valide a tarefa manualmente e reinicie o Windows para confirmar a execução. A compilação deve ser feita antes de habilitar o agendamento.
