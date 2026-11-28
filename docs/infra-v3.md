# Vercel, PostgreSQL e manutenção

## Configuração de homologação na Vercel

Confirme primeiro a equipe, o projeto, as integrações Git, os webhooks e a configuração de deploy automático. A branch de homologação precisa de ambiente, banco, credenciais e domínio próprios. A autorização de deploy pertence à operação.

Configure a raiz do repositório, Next.js e Node.js compatível com `package.json`. Use o comando de build atual `npm run build`. Execute migrations como etapa autorizada e controlada a partir de uma conexão direta. Mantenha a execução de migrations fora do build compartilhado.

- `DATABASE_URL` usa a conexão agrupada do Neon para as funções web. Configure `DATABASE_DIRECT_URL` para o Prisma CLI.
- `APP_URL` deve ser a origem HTTPS autorizada, sem caminho. Use as URLs de callback mostradas no Super Admin ao registrar Google e Apple.
- `CREDENTIAL_ENCRYPTION_KEY` deve corresponder à chave que criptografou os dados do ambiente. Controle o acesso ao valor e compartilhe a mesma chave com o worker.
- Configure S3, Redis, Resend e Evolution com credenciais e destinos exclusivos do ambiente. A lista `EVOLUTION_ALLOWED_URLS` restringe os destinos aceitos pelo painel.
- Na Stripe, configure os destinos nas rotas oficiais separadas de Billing e Connect. Envie eventos snapshot para as rotas existentes e mantenha segredos distintos. A conta v2, o dashboard Express, o Pix e as responsabilidades financeiras exigem validação no sandbox autorizado.
- Execute `npm run worker` num serviço persistente e supervisionado com acesso ao mesmo PostgreSQL e Redis do web. Configure reinício e monitore o heartbeat em Diagnóstico. O worker processa fila, lembretes e conciliações continuamente.
- Use `/api/saude` para prontidão HTTP do web. A rota retorna apenas o status da disponibilidade do banco.

[Configuração Git da Vercel](https://vercel.com/docs/project-configuration/git-configuration) · [Pooling no Neon](https://neon.com/docs/connect/connection-pooling) · [Accounts v2](https://docs.stripe.com/api/v2/core/accounts/create) · [Cobranças diretas](https://docs.stripe.com/connect/direct-charges) · [Webhooks Stripe](https://docs.stripe.com/webhooks)

## Backup e restauração

1. Registre o commit, as migrations aplicadas, a versão PostgreSQL, o ambiente e o horário do backup. Reserve uma janela sem gravações para a troca de chaves ou recuperação de desastre.
2. Use a conexão direta e um usuário autorizado. Use o serviço PostgreSQL configurado ou `PGPASSFILE` protegido para que credenciais fiquem fora do histórico do terminal.
3. Guarde separadamente o dump e a chave existente em armazenamento restrito. Registre o SHA256 e mantenha política de retenção. Uma restauração de PostgreSQL não restaura objetos S3. Versione ou copie os objetos conforme a política do ambiente.

```text
pg_dump --format=custom --file=cs-agenda.dump --dbname=service=agenda_backup
pg_restore --list cs-agenda.dump
pg_restore --exit-on-error --no-owner --dbname=service=agenda_restauracao_isolada cs-agenda.dump
```

Calcule o hash com `Get-FileHash .\cs-agenda.dump -Algorithm SHA256` no PowerShell. Compare o hash antes de restaurar. Use um banco de destino novo e isolado. Antes de iniciar processos de recuperação, aponte e-mail, Stripe, WhatsApp e S3 para fixtures ou sandbox autorizado e isole o Redis.

Compare usuários, estabelecimentos, produtos, assinaturas, agenda, movimentos e armazenamento cifrado. Execute o status das migrations e verifique o login e a abertura de uma credencial cifrada usando a chave correspondente. Reconcile eventos externos ocorridos depois da data do backup antes de reabrir pagamentos e notificações.

## Rotação da chave de aplicação

A ferramenta mantém as chaves fora dos argumentos e imprime contagens. Execute somente em janela autorizada, com web e worker parados e backup restaurado e conferido em cópia isolada. Forneça a chave existente por `CREDENTIAL_ENCRYPTION_KEY` e uma chave nova previamente preparada por `CREDENTIAL_ENCRYPTION_NEXT_KEY`, por canal seguro de variáveis do processo.

```text
node --import tsx scripts/rotate-credentials.ts --database=NOME_EXATO_DO_BANCO
node --import tsx scripts/rotate-credentials.ts --database=NOME_EXATO_DO_BANCO --apply --backup-verified
```

A primeira execução verifica e recriptografa em memória. A segunda grava numa transação com bloqueios, valida cada conteúdo e aborta toda a alteração em caso de falha. O procedimento preserva TOTP, contadores, hashes de recuperação, credenciais Stripe e sua janela anterior, Evolution, Resend e credenciais OAuth. Tentativas OAuth em andamento são invalidadas porque o estado original necessário à descriptografia não é armazenado. O cliente pode iniciar o login novamente.

Após commit bem-sucedido, instale a chave nova no web, worker, serviço Windows e referência de recuperação. Reinicie e confira login, segunda etapa e diagnóstico antes de reabrir o tráfego. Se a transação falhar, a configuração anterior continua válida. Se a aplicação falhar depois da troca, mantenha os processos desligados e valide a chave instalada. Se for necessário restaurar o backup anterior, use a chave anterior e faça a conciliação antes de reabrir.

## Operação e recuperação

Monitore os eventos Stripe recebidos, os pagamentos em revisão, os estornos pendentes, as mensagens em revisão e o heartbeat do worker. Em falha do Redis ou do worker, a fila pode ser reconstruída dos registros persistidos. Um envio sem confirmação fica em revisão para evitar duplicidade. Estornos automáticos reutilizam a chave de idempotência enquanto a tentativa estiver dentro da janela programada. Casos fora da janela exigem conferência na Stripe.

Alterações de preço criam novos preços para contratações futuras. Preços anteriores mantêm o vínculo com o plano. A desativação só retira o plano dos novos fluxos. Revise taxas, repasses e responsabilidade por saldo negativo antes de qualquer alteração de modelo financeiro.

[Documentação de estornos Stripe](https://docs.stripe.com/refunds) · [Envio transacional no Resend](https://resend.com/docs/api-reference/emails/send-email)
