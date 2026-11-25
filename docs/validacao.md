# Validação

## Executado em ambiente local

- Instalação das dependências fixadas no lockfile, geração do Prisma Client e build de produção com Node.js 24, Next.js 16.4.6 e Prisma 7.10.1.
- Duas migrations aplicadas em PostgreSQL 16. Após atualizar o Prisma, a ferramenta confirmou que as migrations estavam atualizadas.
- Quatro testes aprovados em `npm test`. Foram verificados o armazenamento derivado de senhas, a data civil no fuso do estabelecimento, a restrição contra vinculação entre estabelecimentos, a concorrência de reservas sobrepostas e a rejeição de um arquivo inválido apresentado como imagem.
- Dez requisições verificadas com `node tests/smoke.mjs` sobre o build de produção. O painel redireciona visitantes deslogados, destinos de webhook recusam requisições sem autenticação de origem e páginas inexistentes retornam 404.
- Fluxo HTTP aprovado com `node --import tsx tests/fluxo.ts`. Passa por cadastro, sessão, cadastros de serviço e profissional, vínculo, turno, disponibilidade, reserva pública e confirmação persistida. A ativação do estabelecimento foi feita por uma fixture no banco. Esse teste também confirmou a restrição do Super Admin ao assinante e a invalidação de sessão ao sair.
- Redis local respondeu a PING e o worker iniciou com a configuração local. A entrega de um lembrete por WhatsApp continua sem verificação.
- A auditoria npm apontou o aviso GHSA-7589-6fvf-x4pw em `effect`, dependência transitiva das ferramentas de configuração do Prisma. O Prisma CLI é uma dependência de desenvolvimento. A auditoria deve ser repetida antes da publicação.

## Estado dos critérios de aceitação

| Critérios | Estado |
| --- | --- |
| 1. Criar planos e gerenciar assinantes | Criação via Stripe e suspensão implementadas. Operações de planos dependem de homologação. Gestão comercial adicional pendente. |
| 2–4. Contratar plano, confirmar cobrança e liberar acesso | Checkout Billing, Portal e atualização de acesso por webhook implementados. Pendente de credenciais e homologação. |
| 5–6. Personalizar e cadastrar catálogo e equipe | Personalização básica e cadastros implementados. Criação de serviço, equipe, vínculo e turno testados. Fluxos completos de edição e exclusão pendentes. |
| 7. Imagens persistentes | Upload, conversão para WebP e gravação em S3 implementados. Rejeição local de imagem inválida testada. Persistência e republicação dependem de bucket e homologação. |
| 8–9. Reservas e prevenção de conflito | Implementadas e testadas com PostgreSQL real. |
| 10–12. Connect, Checkout e confirmação por evento | Onboarding Express, cobrança direta por cartão e verificação de eventos implementados. Teste de requisição sem assinatura executado. Cobrança e confirmação reais pendentes de homologação. |
| 13–15. Conectar WhatsApp e enviar lembretes | Vínculo administrativo de instância existente, consentimento, agendamento e envio pelo worker implementados. Provisionamento no painel, QR e lembretes de assinatura pendentes. Entrega real depende de credenciais e homologação. |
| 16. Inadimplência e reativação | Acesso calculado por estado retornado pela Stripe. Política comercial completa, conciliação e homologação pendentes. |
| 17. Isolamento | Vínculo autenticado e filtros por estabelecimento implementados. Chaves compostas e consultas de agenda testadas. Revisão completa dos perfis e dos fluxos administrativos pendente. |
| 18. Relatórios reais | Quantidade mensal de atendimentos e valor pago online obtidos do PostgreSQL. Relatórios financeiros detalhados pendentes. |
| 19–21. Interfaces funcionais, responsivas e comerciais | Formulários do fluxo principal testados por HTTP. Layout adaptável implementado. Verificação visual em navegadores e dispositivos pendente. |
| 22–24. Testes, publicação e documentação | Testes locais e instruções de instalação e publicação disponíveis. Testes completos, homologação e validação em produção pendentes. |

Permanecem pendentes o calendário completo com bloqueios, lista de espera e reagendamento, a gestão completa de estoque e pedidos, o módulo financeiro completo, a auditoria administrativa, a recuperação de senha, o acesso individual da equipe, o assistente de configuração e parte das automações comerciais. As interfaces atuais usam CSS próprio e componentes React. Tailwind, shadcn/ui, React Hook Form, Recharts e FullCalendar ainda não foram incorporados.

## Homologação e produção

Nenhuma integração externa foi validada em sandbox ou em produção. A homologação requer contas e credenciais de Stripe Billing e Connect, um bucket S3 e uma Evolution API compatível. Nenhuma aplicação foi implantada em produção. Os testes locais usaram PostgreSQL e Redis em contêineres descartáveis.

## Branch finalizacao-comercial até a18adec

A matriz acima registra a situação do commit-base `dfa6d3b`. A matriz detalhada abaixo cobre a revisão mais recente.

- Treze migrations aplicadas em PostgreSQL 16 local, inclusive em um banco vazio.
- TypeScript, lint, build de produção e dez testes automatizados executados. Os testes adicionais cobrem redefinição de senha, revogação de sessões, TOTP, limite de tentativas, concorrência de estoque, liberação de estoque, bloqueios e reagendamento.
- Testes HTTP e fluxo de cadastro, autenticação, catálogo, agenda e reserva executados sobre o build de produção. Neste fluxo a ativação da assinatura continua sendo uma preparação local dos dados.
- Seis telas verificadas no Chromium a 390 px e 1.280 px.
- Redis local confirmou retentativa e deduplicação por identificador. SeaweedFS 4.55 confirmou upload, leitura WebP, isolamento, substituição e exclusão via S3.
- Nenhuma cobrança Stripe, mensagem Evolution ou e-mail Resend foi homologado com credenciais de terceiros. Nenhum resultado de teste local representa homologação de produção.
- Um evento local assinado com o SDK da Stripe foi entregue duas vezes ao endpoint e produziu um único registro. O evento verifica assinatura e deduplicação sem realizar uma transação externa.
- No Chromium, um lançamento liquidado passou pelo formulário comercial. As exportações autenticadas retornaram o registro em CSV e um arquivo XLSX com tipo e assinatura esperados.
- A auditoria de dependências ainda aponta o aviso GHSA-7589-6fvf-x4pw na cadeia do Prisma CLI. O aviso deve ser reavaliado antes do deploy.

## Revisão posterior a a18adec

- Build de produção, TypeScript e lint aprovados. O primeiro build identificou conflito com o nome de um componente do editor do WhatsApp. Renomeei o componente e repeti a execução completa.
- 21 migrations aplicadas em um PostgreSQL 16 vazio e em um banco da revisão anterior.
- 12 testes automatizados aprovados. A execução inclui regras de concorrência em agenda e estoque, retomada de Checkout com mesma chave após interrupção simulada, bloqueio de reserva incerta, estado de faturamento com eventos fora de ordem, envio ambíguo sem repetição, escopo do convite da equipe, revogação de sessão e cálculo de comissões.
- Dez requisições HTTP passaram. O fluxo de cadastro, sessão, catálogo, agenda e reserva passou. Duas entregas de um evento local assinado resultaram em um registro.
- Doze telas verificadas em 390 px e 1.280 px no Chromium. Registro financeiro e downloads autenticados em CSV e XLSX passaram.
- Redis com BullMQ confirmou retentativa e deduplicação. SeaweedFS 4.55 confirmou upload, leitura, substituição, exclusão e isolamento S3.
- Stripe, Evolution e Resend sem homologação externa. A simulação de transporte e assinatura local não usa credenciais nem transações de sandbox. Nenhum deploy ou cobrança em produção foi realizado.

Consulte a [matriz atual por requisito](finalizacao.md) e o [roteiro de homologação](operacao.md#roteiro-de-homologação-externa).
