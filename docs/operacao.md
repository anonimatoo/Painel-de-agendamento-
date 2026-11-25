# Operação

## Configuração local

Use as instruções do README e mantenha arquivos com credenciais fora do Git. Crie os planos no painel Super Admin após configurar Stripe em modo de teste.

## Publicação

Na Vercel, configure Node.js 22 ou superior, defina as variáveis de ambiente em um projeto separado por ambiente e use `npm run build`. Defina APP_URL com a origem HTTPS pública. Na Neon, use PostgreSQL com a extensão btree_gist. Execute `npm run db:deploy` usando uma conexão direta e uma conta autorizada para migrations. Configure a aplicação com a conexão de execução. Publique o worker em um serviço de processo persistente, executando `npm run worker`, e configure REDIS_URL com um Redis dedicado. Use TLS no Redis em produção.

Mantenha um bucket privado compatível com S3. Configure S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY. Restrinja as permissões da chave ao bucket do ambiente. A aplicação publica apenas a imagem atualmente associada a um estabelecimento ativo.

## Stripe

Configure STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET e STRIPE_CONNECT_WEBHOOK_SECRET no ambiente técnico. Use uma conta Stripe com Billing e Connect habilitados e configure o Customer Portal.

- Crie um destino para eventos da conta da plataforma em `/api/stripe/billing`. Selecione `customer.subscription.created`, `customer.subscription.updated` e `customer.subscription.deleted`.
- Crie um destino para eventos das contas conectadas em `/api/stripe/connect`. Selecione `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` e `checkout.session.async_payment_failed`.
- Em ambiente de teste, contrate um plano e verifique a assinatura na plataforma. Conclua o onboarding de uma conta BR com cobrança por cartão habilitada. Faça um agendamento pago e confirme no painel que o Stripe registrou a cobrança na conta conectada.
- Se uma falha ocorrer durante a criação do Checkout, concilie primeiro a reserva com a Stripe antes de liberar o horário. Os eventos de expiração cancelam as reservas associadas à sessão. A recuperação automática de uma falha entre reserva e criação da sessão está pendente.

## WhatsApp

Configure EVOLUTION_URL e EVOLUTION_API_KEY para uma instância Evolution API v2 sob controle técnico. Provisione um WhatsApp por estabelecimento e vincule o nome da instância usando o painel Super Admin. O assinante ajusta a antecedência do lembrete no próprio painel. O worker consulta os lembretes no PostgreSQL e os publica no Redis. Confirme a entrega com um destinatário autorizado.

O provisionamento por QR dentro do painel está pendente. A entrega pode ser repetida se o provedor aceitar uma mensagem e a gravação da confirmação local falhar.

## Atualizações e recuperação

Faça backup do PostgreSQL e inventário dos objetos antes de mudanças de schema. Rode o build e os testes em homologação. Aplique migrations e publique web e worker a partir da mesma revisão. Verifique os dois destinos de webhook após a atualização.

Teste a restauração em PostgreSQL separado. Restaure os objetos do bucket junto com os registros correspondentes e reconfigure credenciais por ambiente. Revise no provedor financeiro as sessões e eventos do período recuperado antes de retomar as cobranças. Faça a reconciliação de lembretes em execução antes de religar o worker.

## Manual comercial

1. Crie uma conta com um endereço para a página do seu estabelecimento e assine um plano.
2. No painel, adicione serviços e profissionais. Vincule os serviços a cada profissional e cadastre seus turnos.
3. Em Configurações, personalize a página e compartilhe o endereço pelo botão **Ver página pública**.
4. Para cobrar online, configure sua conta de pagamentos e habilite a cobrança depois que a conta estiver aprovada.
5. Acompanhe as reservas na seção **Agenda**. Conclua o atendimento depois que ele começar. O cancelamento no painel está disponível para reservas sem pagamento online.
6. Para ver sua assinatura e atualizar a forma de pagamento, use **Gerenciar assinatura**.
