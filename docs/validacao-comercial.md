# Implementação e validação comercial do CS Agenda Pro

Base local `06d656c` na branch `homologacao-stripe-v2`. A atualização preserva as 32 migrations originais e acrescenta as migrations 33 a 37. Não altera dependências. O SDK Stripe instalado e o override `effect@3.22.1` permanecem no lockfile.

## Matriz de requisitos

| Requisito | Implementação e evidência | Pendências |
|---|---|---|
| 18.1 Identidade visual | Layout roxo e lilás, barra lateral escura, cartões, ícones, estados, foco visível e componentes CSS compartilhados. As telas reconstruídas renderizam HTML e dados do PostgreSQL. | Algumas telas administrativas auxiliares ainda usam o layout anterior. |
| 18.2 Tela inicial | Apresentação, fotografia, recursos de agenda, catálogo, Stripe e WhatsApp, planos ativos do banco, FAQ e links de cadastro, login e suporte. | O endereço de suporte é opcional via `SUPPORT_EMAIL`. Os textos de termos e privacidade são iniciais e dependem de revisão da operação. |
| 18.3 Acesso | Layout próprio para cadastrar e entrar, senha visível sob controle do usuário, prévia de slug, recuperação, Google e Apple conforme configuração. O portal cria perfil de consumidor sem abrir um estabelecimento. Super Admin mantém sessão protegida por TOTP e recuperação de uso único. | Homologar Apple e Google com credenciais autorizadas e origem pública. O fluxo do consumidor tem mensagens resumidas no servidor. |
| 18.4 Dashboard | Agenda diária, semanal e mensal, entradas por período com gráfico interativo, novos clientes, recorrência, situações, pagamentos, estornos, estoque baixo, mensagens aceitas e ações rápidas. Consultas respeitam o estabelecimento e permissões. | Média de avaliações depende de fonte de avaliações real. |
| 18.5 Navegação | Barra lateral no desktop e menu recolhível no celular. Clientes, profissionais e configurações têm vistas específicas. Catálogo, agenda, recebimentos, relatórios e automações têm rotas próprias. | Vendas e estoque compartilham a tela comercial. Marketing usa as preferências do WhatsApp. |
| 18.6 Catálogo | Tabelas de produtos e serviços, categorias, pesquisa, ordenação, paginação, preço em reais, SKU, descrição, estoque, mínimo, fotos, variações com estoque separado, duplicação, desativação, arquivo, restauração e publicação. | Galeria do editor limitada a três fotos por produto. A página pública exibe a imagem principal. |
| 18.7 Agenda | Vistas diária, semanal e mensal, filtros, detalhes, bloqueios, horários e ações conforme permissões. Cancelamentos e remarcações reavaliam disponibilidade no backend. | O calendário usa lista de atendimentos dentro de cada dia. |
| 18.8 Página pública e portal | Capa, marca, catálogo, contato, seleção de serviço, profissional, data e horários. Portal por estabelecimento com pedidos, pagamentos, estornos, histórico e dados. Autenticação, cancelamento e reagendamento protegidos por vínculo e antecedência. | A escolha da data usa o calendário nativo. Reservas e pedidos anteriores à autenticação no portal não são vinculados automaticamente. Avaliações dependem de fonte de dados real. |
| 18.9 Checkout | Revisão do preço, contratação e dados do cliente. Stripe Checkout oficial para cartão e Pix elegível. Atendimento presencial conforme configuração. Sessões ficam na conta Connect, usam idempotência e mantêm comissão. Sucesso depende de registro confirmado. Consumidor autenticado pode abrir o comprovante da Stripe para pagamentos vinculados. | Homologar Pix, cartão, estorno e comprovante na conta brasileira autorizada. O comprovante autenticado não permite consulta de reservas anônimas. |
| 18.10 Automações | Histórico de reserva, pagamento, reagendamento, conclusão, cancelamento, solicitação e confirmação de estorno. Lembrete manual com deduplicação, consentimento do consumidor e aviso de confirmação para o número configurado pelo comerciante. A interface distingue aceite técnico, falta de confirmação, estados de fila e falhas. | Validar entrega pela Evolution API. A aceitação pelo provedor não comprova leitura ou entrega no dispositivo. O estorno de solicitação do cliente depende de aprovação autorizada. |
| 18.11 Financeiro | Fluxo de caixa por período, cartão e Pix, estornos, CSV e XLSX. Conciliação Stripe existente com saldo, tarifas, repasses, ajustes e livro por conta e ambiente. | Manter separado o resultado do caixa e a liquidação apurada pela Stripe. Homologar conciliação e relatórios com transações de teste do provedor. |
| 18.12 Personalização | Editor de nome, descrição, cor, tema, contato, políticas e mídia, com prévia em computador e celular, endereço público e aliases. Os dados salvos aparecem na página pública. | Rascunho e publicação separados para cor secundária, botões, ordem de agendamento e produtos e destaques. Nome, contato e imagens mantêm o salvamento direto existente. |
| 18.13 Super Admin | Contagens de estabelecimentos, assinantes, inadimplência, cancelamentos e faturas pagas. Mantém 2FA e acesso a planos, Stripe, OAuth, comunicação, conciliação e diagnóstico. | Receita recorrente bruta mensal e anualizada inclui assinaturas ativas com valores confirmados pela sincronização. Assinaturas anteriores aguardam atualização pela Stripe. Comissões registradas são conferidas na conciliação. |
| 18.14 Responsividade | Layout de etapa, tabelas com rolagem local, navegação compacta, controles de formulário próprios para toque e desktop. | Chromium usa emulação de tamanho de tela. Revisão em dispositivos físicos e Safari permanece pendente. |
| 18.15 Problemas existentes | Menus, formulários, retornos das ações, estados vazios, estados dos pagamentos e visibilidade por autorização revisados nas telas principais. | Revisão das integrações de infraestrutura em ambiente de homologação. |
| 18.16 Auditoria visual | Capturas produzidas pelo Chromium com estabelecimento fictício, gravações verificadas e capa criada no armazenamento S3 simulado localmente. | As diferenças visuais e a cobertura das capturas constam na seção seguinte. |
| 18.17 Aprovação | Testes locais de navegador e banco exercitam cadastro, publicação, agendamento, reagendamento, estorno solicitado e cancelamento com liberação da vaga. | Aprovação comercial depende dos pontos funcionais restantes e da homologação externa. |
| 18.18 Preservação | Migrations aditivas. Atualização verificada sobre banco com 32 migrations e registros anteriores. Mantidos Stripe Billing, Connect Accounts v2, criptografia, MFA, recuperação e controles de escopo. | As migrations devem ser aplicadas pelo Prisma no ambiente escolhido, após backup do banco. |

## Diferenças em relação às imagens

| Referência | Aplicação em execução |
|---|---|
| Checkout e automação | Resumo, forma de pagamento e confirmação por etapas. A digitação de dados do cartão ocorre no Stripe Checkout. Linha do tempo e financeiro ficam em rotas próprias do painel. |
| Página pública | Capa, marca, navegação, agendamento e catálogo com dados do estabelecimento. As etapas quebram em linhas em telas estreitas. A data usa o seletor nativo de calendário. |
| Produtos e serviços | Busca, filtros, tabela, indicadores de estoque e formulário de edição ao lado em desktop. Configurações de pagamento e horários estão em vistas dedicadas. |
| Painel do comerciante | Menu, indicadores, agenda, gráfico, próximas reservas e ações rápidas. Os dados visíveis dependem da base local e do acesso. A avaliação média só pode usar medições reais. |
| Login e cadastro | Composição em duas colunas no desktop com identidade da plataforma e um formulário por rota. Botões de provedores aparecem quando habilitados. O acesso do Super Admin tem rota de apresentação própria. |
| Comerciante e consumidor | Interfaces e dados separados. O vínculo do consumidor é feito por usuário autenticado e estabelecimento. |

## Migrations

- `202611280033_consumer_portal` cria perfis por estabelecimento e relacionamentos opcionais para reservas e pedidos. Inclui a antecedência de alterações online.
- `202611280034_catalog` acrescenta categorias, SKU, descrição, variantes, estado de publicação e arquivamento. Produtos antigos começam publicados.
- `202611280035_merchant_notices` acrescenta destinatário opcional e novos tipos de lembrete.
- `202611280036_checkout_methods` registra o método de pagamento e adiciona preferência Pix desativada por padrão. Registros anteriores preservam o método cartão.

- `202611280037_public_design` acrescenta rascunho e apresentação publicados da página pública e campos opcionais de valor e intervalo recorrentes em assinaturas.

No Windows, execute `npm ci` e `npm run db:deploy` no diretório do repositório, com as variáveis existentes do ambiente pretendido. O Prisma lê os arquivos SQL da pasta de migrations e controla quais já foram aplicados.

## Validação local

- `npm test`. 31 testes aprovados, incluindo os 29 anteriores e dois testes adicionais de Checkout e Pix.
- `tsx --test tests/connect-integration.ts`. Criação, onboarding, falhas, duplicidade e isolamento com Stripe simulada.
- `tsc --noEmit --incremental false`, `npm run lint` e `npm run build`.
- `npm audit` e `npm audit --omit=dev`. Zero vulnerabilidades reportadas.
- PostgreSQL local. Aplicação das 37 migrations em banco novo e das cinco últimas sobre as 32 anteriores, com verificação de usuário, valor de senha previamente gravado na fixture SQL, vínculo de administrador, slug e estoque já gravados.
- HTTP. Smoke com dez requisições, cadastro, sessão, agenda, reserva, bloqueio de acesso ao Super Admin, isolamento Connect, webhook snapshot assinado, deduplicação e rejeição de thin event na rota snapshot.
- Infraestrutura. Redis e BullMQ locais, retentativa e deduplicação. Armazenamento S3 com servidor HTTP simulado, upload, leitura, substituição, exclusão e isolamento.
- Chromium em 390 e 1280 px. Formulários Stripe do Super Admin com API simulada e MFA com cópia, regeneração, recuperação e bloqueio de reuso.
- Chromium em 390 e 1280 px. Cadastro comercial e de consumidor pelo Google, acesso à administração dos provedores, estado inválido, reuso e desativação. Callback Apple via POST com JWT assinado, em HTTP simulado.
- Chromium em 390 × 844, 768 × 1024, 1280 × 800, 1440 × 900 e 1920 × 1080. Foram produzidas 55 capturas de 11 vistas. A primeira rodada detectou overflow no painel com registros. As rodadas seguintes validaram a grade, a rolagem local das tabelas, os indicadores de status e a navegação compacta.
- Fluxo comercial. Cadastro de consumidor sem criação de loja, publicação de produto, rascunho privado, publicação da apresentação, reserva, reagendamento, pagamento confirmado por evento simulado, estorno solicitado, cancelamento e liberação do horário. Duas lojas e dois perfis verificaram o isolamento.
- Worker. BullMQ e Evolution simulada confirmaram duas notificações do comerciante e uma do consumidor que autorizou o envio. O consumidor sem consentimento não recebeu mensagem.

## Homologação externa

As simulações não comprovam a disponibilidade do Pix, do modelo Express ou das responsabilidades financeiras na conta Stripe do usuário. A integração de cartão preserva a rota v1 Checkout em conta conectada. Onboarding continua em Accounts API v2 e o estado da conta continua consultado por API. A rota de pagamentos processa snapshots assinados. O teste confirma que eventos thin são recusados nessa rota. Uma eventual adoção de destino thin para atualizações de conta requer validação específica.

Validar Google, Apple, Stripe Checkout, Stripe Connect, Evolution API, Resend e armazenamento S3 com os ambientes autorizados. O teste do Pix verifica a opção do Checkout, a elegibilidade e o tratamento local da espera e da falha. Testes em modo simulado não encerram a homologação.

[Documentação oficial do Pix na Stripe](https://docs.stripe.com/payments/pix)
