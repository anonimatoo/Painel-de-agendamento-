# Operação

## Configuração local

Use as instruções do README e mantenha arquivos com credenciais fora do Git. Crie os planos no painel Super Admin após configurar Stripe em modo de teste.

## Publicação

Na Vercel, configure Node.js 22 ou superior, defina as variáveis de ambiente em um projeto separado por ambiente e use `npm run build`. Defina APP_URL com a origem HTTPS pública. Na Neon, use PostgreSQL com a extensão btree_gist. Execute `npm run db:deploy` usando uma conexão direta e uma conta autorizada para migrations. Configure a aplicação com a conexão de execução. Publique o worker em um serviço de processo persistente, executando `npm run worker`, e configure REDIS_URL com um Redis dedicado. Use TLS no Redis em produção.

Mantenha um bucket privado compatível com S3. Configure S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY. Restrinja as permissões da chave ao bucket do ambiente. A aplicação publica apenas a imagem atualmente associada a um estabelecimento ativo.

## Stripe

Use uma conta Stripe com Billing e Connect habilitados e configure o Customer Portal. As credenciais salvas pelo Super Admin têm precedência sobre STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET e STRIPE_CONNECT_WEBHOOK_SECRET. O ambiente técnico é usado quando ainda não existe configuração salva. Web, worker e destinos consultam o mesmo registro ao iniciar cada operação. Use a mesma CREDENTIAL_ENCRYPTION_KEY em todos os processos do ambiente. Separe banco, chave, Redis, bucket, domínios e destinos de homologação e produção.

- Crie um destino para eventos da conta da plataforma em `/api/stripe/billing`. Selecione `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.finalization_failed`, `invoice.voided` e `invoice.marked_uncollectible`.
- Crie um destino para eventos das contas conectadas em `/api/stripe/connect`. Selecione `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` `checkout.session.async_payment_failed`, `refund.created` e `refund.updated`.
- Em ambiente de teste, contrate um plano e verifique a assinatura na plataforma. Conclua o onboarding de uma conta BR com cobrança por cartão habilitada. Faça um agendamento pago e confirme no painel que o Stripe registrou a cobrança na conta conectada.
- Se a criação do Checkout for interrompida, o worker recupera a tentativa de atendimento usando os mesmos parâmetros e a mesma chave. Quando não houver prova financeira, a reserva fica em verificação e permanece bloqueada. Consulte **Receber pagamentos** para reconciliar o estado com a Stripe. Pedidos com estado incerto mantêm o estoque reservado. Use **Estoque e financeiro** para verificar novamente. Casos de pagamento tardio após cancelamento exigem análise do responsável e eventual estorno pelo provedor.

## WhatsApp

Configure EVOLUTION_URL e EVOLUTION_API_KEY apenas no web e worker. O painel permite conectar uma instância previamente vinculada. Para habilitar o provisionamento automático por QR, configure EVOLUTION_QR_PROVISIONING=true após verificar a compatibilidade e as políticas do WhatsApp. O fluxo automático usa o modo Baileys do fornecedor. Se a operação exigir uma modalidade oficial, mantenha o provisionamento por QR desativado e vincule uma instância compatível provisionada pela infraestrutura. O assinante ajusta os lembretes em **WhatsApp**.

O worker registra cada envio no PostgreSQL antes de chamar o provedor. Uma recusa explícita por limite pode ser repetida com espera progressiva. Falhas ambíguas ou interrupções durante o envio ficam em **Envio em verificação**. Confirme o histórico diretamente no provedor antes de autorizar outro contato. O status aceito pelo provedor não equivale à confirmação de leitura ou entrega final.

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

## Preparar a branch finalizacao-comercial

Crie uma chave aleatória de 32 bytes em hexadecimal para CREDENTIAL_ENCRYPTION_KEY. Configure a mesma chave em todos os processos do mesmo ambiente e mantenha backup fora do banco. Preserve a chave durante atualizações. A perda dela impede a leitura das credenciais salvas e a validação do autenticador dos administradores.

Configure RESEND_API_KEY, MAIL_FROM e APP_URL. Verifique o domínio de envio e valide recebimento, expiração, uso único, confirmação de e-mail e redefinição em homologação. Ao configurar e-mail, a contratação exige endereço confirmado. A aplicação mantém o acesso ao painel para que assinantes existentes solicitem a confirmação.

O worker pode ser construído com `docker build -f Dockerfile.worker -t cs-agenda-worker .`. Passe as variáveis ao executar o contêiner. Configure Redis persistente, processo supervisionado e observabilidade para a fila, as retentativas e a conciliação. Execute a migração na Neon antes de atualizar web e worker. Valide restauração e inicialização dos serviços no ambiente de homologação.

## Manual do Super Admin

1. Entre com a senha inicial, abra **Minha conta** e gere a chave do autenticador. Adicione a chave no aplicativo e confirme com o código. Nos acessos seguintes informe o código na seção **Acesso de Super Admin**.
2. Em **Configuração da Stripe**, selecione o ambiente e informe as chaves e os dois segredos dos destinos. Confirme sua senha. Use **Testar conexão** após atualizar. Mantenha um banco e um projeto separados por ambiente.
3. Cadastre os planos mensais e anuais e indique os dias de avaliação. Crie os cupons e códigos promocionais na Stripe. Ative cancelamento, atualização de pagamento e mudanças entre preços no Customer Portal.
4. Consulte os estabelecimentos e suspenda ou reative quando necessário. Cada estabelecimento possui um vínculo exclusivo. Ative o provisionamento automático por QR apenas na modalidade compatível.

## Manual do assinante

- Abra **Minha conta** para confirmar seu e-mail ou encerrar todas as sessões. Na tela de entrada, use **Esqueci minha senha** para receber um link.
- Consulte faturas e abra o portal pelo painel. Em **Configurações**, consulte a situação do cadastro, recebimentos e repasses da conta Stripe e escolha o percentual do pagamento antecipado.
- Use **Agenda** para reagendar, bloquear períodos e acompanhar a lista de espera. Registre faltas e cancelamentos pelo painel. Use **Estornar e cancelar** para uma reserva paga elegível.
- Em **Estoque e financeiro**, ajuste quantidades, registre vendas presenciais, confira pedidos para retirada e exporte o caixa. O cancelamento de venda presencial dá baixa no registro e repõe o estoque. Um pedido pago deve ser estornado pelo administrador.
- Em **Personalização**, gerencie imagens e revise a apresentação em formato de computador ou celular. Na área de WhatsApp, consulte o status, exiba o QR, envie uma mensagem de teste para um número autorizado e escolha os avisos.

## Roteiro de homologação externa

1. Stripe em modo de teste. Use os dois destinos configurados para suas respectivas contas. Adicione `refund.created` e `refund.updated` ao destino do Connect. Valide um ciclo com plano mensal, anual, avaliação, cupom, alteração no Portal, cancelamento, falha de pagamento e regularização. Inicie a mesma assinatura em duas abas e confira uma única sessão ativa. Use os relatórios da Stripe para confirmar o estado do pagamento e a conta beneficiária.
2. Connect. Conclua o onboarding BR. Faça pagamento integral, sinal e compra de produto no Checkout. Verifique saldo e estorno na conta vinculada, devolução do estoque, expiração e conciliação com desligamento temporário do destino de webhook. Para pagamentos antigos sem sessão associada, faça a conciliação manual antes de liberar horário.
3. Evolution. Confirme a versão implantada. Os endpoints foram conferidos no código oficial da versão 2.3.8. Provisione uma instância de teste e valide QR, status, desconexão e reconexão. Faça reserva com consentimento e verifique lembrete, atualização após pagamento, reagendamento e cancelamento. Confirme que outra unidade não acessa a instância. [Roteador oficial da Evolution API](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/routes/instance.router.ts)
4. S3. Configure bucket privado com as permissões necessárias para gravar, ler e apagar. Publique uma imagem, substitua-a, publique novamente a aplicação e confirme a leitura. Verifique se objetos excluídos deixaram de ser servidos e faça inventário para identificar objetos órfãos.
5. Redis e worker. Em homologação, reinicie o worker durante um atraso e durante uma falha de provedor. Confirme a recuperação dos registros pendentes. Confirme que o worker deixa envios ambíguos em verificação após reiniciar. Em caso de dúvida, confira o histórico do provedor antes de contatar o destinatário de novo.

## Planejamento de capacidade e custos

Dimensione requests e duração de funções Vercel, armazenamento e horas de compute Neon, espaço e operações S3, Redis por memória e retenção e dois serviços persistentes para worker e Evolution. O plano gratuito da Vercel é voltado a uso pessoal. Selecione o plano adequado para uso comercial. O consumo e o orçamento dependem da quantidade de empresas, reservas, mensagens e imagens. A escolha de planos e a cotação ficam pendentes até definir região e volume. [Vercel](https://vercel.com/pricing) · [Neon](https://neon.com/pricing) · [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/)


## Operação e monitoramento

- Monitore o código HTTP da página pública e da página de entrada, disponibilidade do banco e autenticação dos destinos Stripe. Verifique no painel quando cada tipo de notificação foi processado. Compare com a aba de entregas da Stripe após rotação de segredos.
- Acompanhe logs e reinícios do worker, atraso das filas, pedidos e reservas em verificação, faturas em aberto e mensagens com falha. Garanta Redis persistente e PostgreSQL com cópias testadas.
- Para interromper novas cobranças, use **Desconectar** na configuração Stripe após salvar suas credenciais. O acompanhamento de cobranças existentes, webhooks e estornos continua. Use **Reconectar** para habilitar novas cobranças.
- Antes de alterar a regra de comissão, confirme o valor comercial com o estabelecimento. Uma cobrança já preparada mantém o valor gravado na tentativa. A comissão profissional é apurada ao concluir o atendimento. Registrar pagamento é uma baixa manual.
- Para homologar comissões e movimentações, compare as tarifas, comissões, estornos, contestações e repasses com o extrato oficial. A página de movimentações usa os valores do provedor na conta selecionada.
- Em **Comunicação**, utilize apenas o aviso manual autorizado. Ele consulta uma fatura em aberto e envia seu link oficial ao administrador com e-mail confirmado. Nenhuma cobrança é criada pela ação.
