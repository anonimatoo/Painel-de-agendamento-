# CS Agenda Pro V4 Business Suite

Base protegida `045b97a9633112531d68ab13216e3a826deebd46`. O desenvolvimento usa a branch `desenvolvimento-v4-business-suite` e bancos separados.

## Ferramentas da Issue #2

| Nº | Ferramenta | Rota e comportamento |
|---:|---|---|
| 1 | Agenda | `/agenda`. Reservas, alterações e conclusão com isolamento por estabelecimento. |
| 2 | Lista de espera | Agenda e vitrine. A V3 já programa aviso de vaga após consentimento. |
| 3 | Calendário | Agenda em dia, semana e mês. A página pública consulta os horários disponíveis. |
| 4 | Feriados | Agenda. Fechamento do dia no fuso da loja, com conflito de reservas como impedimento. |
| 5 | Cadastro de clientes | Painel → Clientes e cadastro no portal individual. |
| 6 | Histórico | Agenda e histórico do consumidor por identidade e estabelecimento. |
| 7 | Fidelidade | `/fidelidade`. Opção por estabelecimento, um benefício manual a cada cinco visitas concluídas pelo portal e registro de resgate com uso único. |
| 8 | Aniversários | WhatsApp, com consentimento para acompanhamento da V3. |
| 9 | Consentimento | Autorizações de reserva, acompanhamento e campanhas separadas. Revogação de campanhas no portal. |
| 10 | Profissionais | Cadastro e configuração no painel, inclusive durante o preparo privado. |
| 11 | Permissões | Equipe com papéis e permissões individuais preservados. |
| 12 | Jornadas | Painel → Profissionais. Turnos, conflitos e bloqueios com o fuso da loja. |
| 13 | Comissões | `/comissoes`. Cálculo no fechamento do atendimento, conforme regra do profissional. |
| 14 | Contas a pagar aos profissionais | Totais, baixas e referência do pagamento informado. |
| 15 | Comprovantes | Portal do consumidor mantém o comprovante oficial Stripe. A baixa de comissão guarda referência informada pelo comerciante. |
| 16 | Catálogo | `/catalogo` e editor dedicado com galeria ordenável e limites por produto. |
| 17 | Serviços | Catálogo. Cadastro privado, publicação após ativação e vínculos com profissionais. |
| 18 | Categorias | Catálogo. Cadastro, atribuição, renomeação e filtros. |
| 19 | Variantes | Editor do produto. Variações com SKU, preço, estoque e fotos próprios. |
| 20 | Estoque | Comercial e editor. Saldo, ajustes e desconto por venda ou reserva. |
| 21 | Inventário | Comercial → Estoque. Contagem por item com detecção de concorrência e registro das diferenças. |
| 22 | Fornecedores | `/compras`. Cadastro e contato da empresa fornecedora. |
| 23 | Compras | Recebimento com referência, custo médio no estoque e conta a pagar na mesma transação. |
| 24 | Alerta de reposição | Compras e catálogo exibem produtos no saldo mínimo ou abaixo dele. |
| 25 | Vendas | Comercial. Venda presencial, baixa de estoque e reversão. |
| 26 | Pedidos | Vitrine, portal e comercial. Estoque reservado, estado do pagamento e retirada. |
| 27 | Checkout Stripe | Stripe Checkout e Connect da V3. Valores de ofertas recalculados no servidor. |
| 28 | Estornos | Conciliação, solicitação e acompanhamento de estornos da V3. |
| 29 | Caixa | Comercial e `/resultado?regime=caixa`. Entradas e baixas informadas. |
| 30 | Receitas | Lançamentos manuais, vendas e pagamentos aprovados. |
| 31 | Despesas | Lançamentos manuais, impostos informados e compras registradas. |
| 32 | Contas a pagar e receber | Comercial. Vencimento e baixa da conta individual. |
| 33 | Lucro diário e mensal | `/resultado` usa o mês atual por padrão e agrupa por dia no fuso da loja. Valores parciais são identificados. |
| 34 | Conciliação | Recebimentos e relatório Stripe por escopo da conta conectada. |
| 35 | DRE gerencial | Receitas, devoluções, custos registrados, comissões, impostos, despesas e taxas conciliadas. |
| 36 | CSV e XLSX | Exportações financeiras e de movimentações já presentes na V3. |
| 37 | Cupons | `/marketing`. Cupom por loja, vigência, desativação e aplicação no Checkout. |
| 38 | Combos | Marketing. Itens com quantidades e desconto, sujeitos ao saldo e à publicação no momento do pedido. |
| 39 | Promoções programadas | Marketing. Desconto por produto na vigência; o Checkout recalcula o preço. |
| 40 | Editor de artes | Marketing. Modelos em Canvas, texto, prévia e exportação PNG de 1080 × 1080. |
| 41 | Links e QR | Marketing gera QR local e link de compartilhamento. Produto publicado possui link próprio na vitrine. |
| 42 | Campanhas WhatsApp e e-mail | `/marketing/campanhas`. Resend e Evolution, com autorização por canal e envio em fila. |
| 43 | Automações visuais | `/automacoes/editor`. Confirmação ou reagendamento dispara registro ou programação de lembrete quando autorizado. |
| 44 | Logs de automação | Editor e central. Registro de execução, elegibilidade e estado do provedor são separados. |
| 45 | Personalização da loja | `/personalizacao`. Rascunho, imagens, endereço, cores e destaques. |
| 46 | Portal do consumidor | Cadastro e login, horários, pedidos, histórico, dados e consentimento por loja. |
| 47 | Super Admin | Credenciais cifradas, 2FA, diagnósticos e oferta Business Suite. |
| 48 | Reagendamento | Agenda comercial e portal, com janela do estabelecimento e disponibilidade revalidada no servidor. |

## Contratos e catálogo

A oferta Business Suite define R$ 59,99 por mês e R$ 499,99 por ano. O Super Admin com 2FA pode cadastrar a oferta na Stripe após validação da conta e aprovação do ambiente. Abrir a página ou instalar as migrations não cadastra preços na Stripe. Os contratos anteriores mantêm seus identificadores e valores. Uma assinatura ativa usa o intervalo registrado no contrato. Um cadastro ainda inativo usa a preferência salva no painel. Sem intervalo contratual conhecido, o limite seguro é de dez fotos.

As galerias aceitam 10 ou 30 fotos por produto. O servidor valida assinatura ou preferência, vínculo, tamanho e conteúdo, e serializa gravações do estabelecimento. O limite é de 4 MB por arquivo e 512 MB de fotos já comprimidas por catálogo. As imagens anteriores permanecem em caso de downgrade. A primeira foto da ordem é a capa do produto. Rascunhos não são retornados por rotas públicas e suas imagens exigem sessão autorizada. O worker repete a remoção de objetos obsoletos quando o armazenamento volta a responder.

Antes da assinatura, produtos e serviços novos permanecem em rascunho. As áreas de catálogo, equipe e personalização ficam disponíveis às permissões da loja para preparação. Reserva pública e venda online verificam novamente a situação do estabelecimento dentro da transação. Com a assinatura ativa, publique os itens que deseja oferecer.

## Financeiro e campanhas

O resultado gerencial usa centavos inteiros e distingue competência de caixa. Em competência, serviços entram quando concluídos, lançamentos manuais pelo vencimento e mercadorias pelo custo de venda conhecido. Compras de estoque entram no caixa na baixa e no resultado de competência quando o custo é reconhecido na venda. Não lance novamente em despesas gerais pagamentos já registrados pelo sistema. Baixar comissão registra o pagamento informado pela empresa. A DRE assinala custos históricos e taxas de cobrança sem evidência registrada. Ela usa o arredondamento do provedor e os estornos conciliados disponíveis. As devoluções de pedidos repostos no estoque revertem o custo gravado no Checkout. Pedidos históricos de classificação incerta, créditos tributários e taxas relacionadas a estornos exigem conciliação adicional.

Campanhas dependem de e-mail verificado ou telefone confirmado por código, com limite de três campanhas a cada 24 horas, 250 destinatários por campanha e oito jobs por minuto. A fila revalida a autorização antes do envio. A aceitação do provedor não afirma entrega ao destinatário. Envio ambíguo entra em verificação e não é repetido automaticamente. Homologue permissões, políticas de mensagens e custos com os fornecedores efetivamente contratados.

CS Automation Pro usa PostgreSQL para fluxos e execuções, Redis e BullMQ para fila e worker existente para processamento. O editor utiliza `@xyflow/react@13.0.3`, licença MIT, com React 19. Os tipos de evento e ação são delimitados pelo servidor. Não há carga de scripts, URL de ação ou dependência de n8n. [Licença React Flow](https://github.com/xyflow/xyflow/blob/main/LICENSE)

## Windows, Vercel, recuperação

Use uma segunda pasta e preserve os serviços da V3. Exemplo a partir de um clone do repositório em PowerShell.

```powershell
git fetch origin desenvolvimento-v4-business-suite
git worktree add --detach ..\CS-AGENDA-PRO-V4 origin/desenvolvimento-v4-business-suite
Set-Location ..\CS-AGENDA-PRO-V4
npm ci
```

Crie uma configuração independente apontando para um banco PostgreSQL de homologação, Redis separado e S3 de teste. Use os nomes de variáveis do `.env.example`. Examine a configuração antes de rodar o Prisma. Depois de validar o destino, execute `npm run db:deploy`, `npx prisma generate` e `npx next build --webpack`. Inicie `npm run start -- --port 3295` e `node --env-file=.env --import tsx worker/index.ts` em terminais separados com o mesmo ambiente de homologação. Confirme o heartbeat no diagnóstico. Consulte o [manual Windows da V3](windows-v3.md) para manter os dois ambientes isolados e proteger as chaves com DPAPI.

A configuração da branch bloqueia o deploy Git da Vercel. Se a V4 for autorizada para um ambiente futuro, configure a aplicação web e um processo persistente separado para o worker com Redis e PostgreSQL. Para Apple, use HTTPS público e a URL de callback cadastrada no provedor. Google, Apple, Stripe, Resend, S3 e Evolution podem envolver cobrança do fornecedor ou de infraestrutura. [Configuração Git na Vercel](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled)

As migrations 42 a 48 são aditivas. Antes de migrar um ambiente com dados reais, faça um dump PostgreSQL em formato custom e um backup do bucket. Valide ambos em ambiente separado. Se necessário, retome a versão anterior com a cópia anterior do banco, junto ao estado correspondente dos objetos. Evite promover essa cópia sobre um banco que tenha recebido operações novas desde o backup sem conciliar as diferenças.
